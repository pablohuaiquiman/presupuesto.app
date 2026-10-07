-- Aprobación de órdenes de compra por tramos de monto (neto, sin IVA), configurable por empresa.
-- Requiere 202610070004_ordenes_compra.sql. Aplicar UNA VEZ.
-- empresas.aprobacion_oc = {activo, limite_administrador, limite_gerente_proyectos, gerente_proyectos_id, gerente_general_id}
--   neto <= limite_administrador                       → administrador del proyecto (o superior)
--   limite_administrador < neto <= limite_gerente_proy. → gerente de proyectos (o gerente general)
--   neto > limite_gerente_proyectos                     → gerente general
-- Sin gerente designado, ese nivel lo aprueba el administrador de la empresa. Desactivado: regla anterior.
begin;
alter table public.empresas add column aprobacion_oc jsonb not null default '{}'::jsonb
 check(jsonb_typeof(aprobacion_oc)='object');
grant update(aprobacion_oc) on public.empresas to authenticated;

-- Nivel exigido para un neto: 1 administrador del proyecto, 2 gerente de proyectos, 3 gerente general (0 = sin tramos).
create or replace function public.nivel_aprobacion_oc(p_empresa_id uuid,p_neto numeric)
returns integer language plpgsql security definer stable set search_path=public as $$
declare c jsonb;
begin
 select aprobacion_oc into c from public.empresas where id=p_empresa_id;
 if not coalesce((c->>'activo')::boolean,false) then return 0; end if;
 if p_neto<=coalesce((c->>'limite_administrador')::numeric,500000) then return 1; end if;
 if p_neto<=coalesce((c->>'limite_gerente_proyectos')::numeric,1500000) then return 2; end if;
 return 3;
end;
$$;
create or replace function public.puede_aprobar_oc(p_proyecto_id uuid,p_neto numeric)
returns boolean language plpgsql security definer stable set search_path=public as $$
declare pr public.proyectos; c jsonb; yo uuid:=auth.uid(); admin boolean; gp uuid; gg uuid; n2 boolean; n3 boolean; nivel integer;
begin
 select * into pr from public.proyectos where id=p_proyecto_id;
 if not found or pr.empresa_id is distinct from public.mi_empresa_id() then return false; end if;
 admin:=public.soy_admin_empresa(pr.empresa_id);
 nivel:=public.nivel_aprobacion_oc(pr.empresa_id,p_neto);
 if nivel=0 then return admin or pr.administrador_id=yo; end if;
 select aprobacion_oc into c from public.empresas where id=pr.empresa_id;
 -- Solo cuentan designados que sigan perteneciendo a la empresa.
 select id into gp from public.perfiles where id=nullif(c->>'gerente_proyectos_id','')::uuid and empresa_id=pr.empresa_id;
 select id into gg from public.perfiles where id=nullif(c->>'gerente_general_id','')::uuid and empresa_id=pr.empresa_id;
 n3:=(gg is not null and gg=yo) or (gg is null and admin);
 n2:=n3 or (gp is not null and gp=yo);
 return case nivel when 1 then n2 or admin or pr.administrador_id=yo when 2 then n2 else n3 end;
end;
$$;
revoke all on function public.nivel_aprobacion_oc(uuid,numeric),public.puede_aprobar_oc(uuid,numeric) from public,anon;
grant execute on function public.nivel_aprobacion_oc(uuid,numeric),public.puede_aprobar_oc(uuid,numeric) to authenticated;

-- Valida la configuración al guardarla.
create or replace function public.validar_aprobacion_oc()
returns trigger language plpgsql security definer set search_path=public as $$
declare c jsonb:=new.aprobacion_oc; l1 numeric; l2 numeric;
begin
 if c is not distinct from old.aprobacion_oc or c='{}'::jsonb then return new; end if;
 l1:=(c->>'limite_administrador')::numeric; l2:=(c->>'limite_gerente_proyectos')::numeric;
 if l1 is null or l2 is null or l1<0 or l2<l1 then raise exception 'Los montos de aprobación deben ser positivos y crecientes'; end if;
 if nullif(c->>'gerente_proyectos_id','') is not null and not exists(select 1 from public.perfiles where id=(c->>'gerente_proyectos_id')::uuid and empresa_id=new.id) then
  raise exception 'El gerente de proyectos debe pertenecer a la empresa';
 end if;
 if nullif(c->>'gerente_general_id','') is not null and not exists(select 1 from public.perfiles where id=(c->>'gerente_general_id')::uuid and empresa_id=new.id) then
  raise exception 'El gerente general debe pertenecer a la empresa';
 end if;
 return new;
end;
$$;
create trigger empresas_validar_aprobacion_oc before update of aprobacion_oc on public.empresas
 for each row execute function public.validar_aprobacion_oc();

-- Igual que en 202610070004, salvo la emisión (borrador → emitida), que exige el aprobador del tramo.
create or replace function public.validar_oc()
returns trigger language plpgsql security definer set search_path=public as $$
declare pr public.proyectos; gestiona boolean;
begin
 if length(trim(coalesce(new.proveedor->>'nombre','')))=0 then raise exception 'Indica el proveedor'; end if;
 if jsonb_typeof(new.items)<>'array' or jsonb_array_length(new.items)=0 then raise exception 'La orden de compra no tiene ítems'; end if;
 if tg_op='INSERT' then
  select * into strict pr from public.proyectos where id=new.proyecto_id and empresa_id=public.mi_empresa_id();
  if pr.estado<>'activo' then raise exception 'El proyecto está cerrado'; end if;
  perform pg_advisory_xact_lock(hashtext('oc:'||pr.empresa_id::text));
  new.empresa_id:=pr.empresa_id;
  new.numero:=(select coalesce(max(numero),0)+1 from public.ordenes_compra where empresa_id=pr.empresa_id);
  new.estado:='borrador'; new.solicitado_por:=auth.uid(); new.aprobado_por:=null; new.aprobado_en:=null;
  new.gasto_id:=null; new.creado_en:=now(); new.actualizado_en:=now();
  return new;
 end if;
 gestiona:=public.puede_gestionar_proyecto(old.proyecto_id);
 new.empresa_id:=old.empresa_id; new.proyecto_id:=old.proyecto_id; new.numero:=old.numero;
 new.solicitado_por:=old.solicitado_por; new.creado_en:=old.creado_en;
 if old.estado<>'borrador' and (to_jsonb(new)-array['estado','factura_numero','adjunto_path','gasto_id','aprobado_por','aprobado_en','actualizado_en'])
   is distinct from (to_jsonb(old)-array['estado','factura_numero','adjunto_path','gasto_id','aprobado_por','aprobado_en','actualizado_en']) then
  raise exception 'La orden de compra ya fue emitida; vuelve a borrador para modificarla';
 end if;
 if old.estado='borrador' and new.estado='borrador' and not gestiona and old.solicitado_por is distinct from auth.uid() then
  raise exception 'Solo puedes modificar tus órdenes de compra en borrador';
 end if;
 if new.estado is distinct from old.estado then
  if (old.estado,new.estado) not in (('borrador','emitida'),('emitida','borrador'),('emitida','recibida'),('recibida','emitida'),
     ('borrador','anulada'),('emitida','anulada'),('recibida','anulada'),('anulada','borrador')) then
   raise exception 'Cambio de estado no permitido: % a %',old.estado,new.estado;
  end if;
  if (old.estado,new.estado)=('borrador','emitida') then
   if not public.puede_aprobar_oc(old.proyecto_id,coalesce((new.totales->>'neto')::numeric,0)) then
    raise exception 'No te corresponde aprobar esta orden de compra por su monto';
   end if;
  elsif (old.estado,new.estado)<>('emitida','recibida') and not gestiona then
   raise exception 'Solo el administrador del proyecto emite, anula o reabre órdenes de compra';
  end if;
  if new.estado in ('borrador','anulada') and new.gasto_id is not null then
   raise exception 'La orden de compra ya está cargada a gastos; elimina primero ese gasto';
  end if;
  if new.estado='emitida' and old.estado='borrador' then new.aprobado_por:=auth.uid(); new.aprobado_en:=now(); end if;
  if new.estado='borrador' then new.aprobado_por:=null; new.aprobado_en:=null; end if;
 else
  new.aprobado_por:=old.aprobado_por; new.aprobado_en:=old.aprobado_en;
 end if;
 if new.gasto_id is distinct from old.gasto_id and new.gasto_id is not null then
  if new.estado not in ('emitida','recibida') then raise exception 'Solo se cargan a gastos órdenes emitidas o recibidas'; end if;
  if not exists(select 1 from public.proyecto_gastos g where g.id=new.gasto_id and g.proyecto_id=old.proyecto_id) then
   raise exception 'El gasto no pertenece al proyecto de la orden de compra';
  end if;
 end if;
 new.actualizado_en:=now();
 return new;
end;
$$;
commit;
