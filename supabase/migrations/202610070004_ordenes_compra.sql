-- Órdenes de compra por proyecto (centro de costo), con carga a los gastos del proyecto.
-- Requiere 202610060001_proyectos.sql (y va después de 202610070003_colaboradores.sql). Aplicar UNA VEZ.
begin;

create table public.ordenes_compra (
 id uuid primary key default gen_random_uuid(),
 empresa_id uuid not null references public.empresas(id),
 -- cascade: plataforma_eliminar_empresa borra proyectos y gastos; la app no deja borrar un proyecto con OC.
 proyecto_id uuid not null references public.proyectos(id) on delete cascade,
 numero integer not null,
 fecha date not null default (now() at time zone 'America/Santiago')::date,
 estado text not null default 'borrador' check(estado in ('borrador','emitida','recibida','anulada')),
 categoria text not null default 'materiales' check(categoria in ('materiales','mano_obra','generales')),
 proveedor jsonb not null default '{}'::jsonb,   -- nombre, rut, direccion, ciudad, telefono, vendedor, email
 forma_pago text check(length(forma_pago)<=160),
 despacho jsonb not null default '{}'::jsonb,    -- direccion, contacto, fecha_entrega
 items jsonb not null default '[]'::jsonb,       -- codigo, detalle, unidad, cantidad, precio, total
 totales jsonb not null default '{}'::jsonb,     -- subtotal, descuento, cargos, neto, iva_pct, iva, total
 observaciones text check(length(observaciones)<=1000),
 numero_externo text check(length(numero_externo)<=60),
 adjunto_path text,
 factura_numero text check(length(factura_numero)<=40),
 gasto_id uuid references public.proyecto_gastos(id) on delete set null,
 solicitado_por uuid references auth.users(id),
 aprobado_por uuid references auth.users(id),
 aprobado_en timestamptz,
 creado_en timestamptz not null default now(),
 actualizado_en timestamptz not null default now(),
 unique(empresa_id,numero)
);
create index on public.ordenes_compra(proyecto_id,fecha desc);
alter table public.ordenes_compra enable row level security;
revoke all on public.ordenes_compra from anon,authenticated;
grant select,insert,update,delete on public.ordenes_compra to authenticated;

create policy oc_lectura on public.ordenes_compra for select to authenticated using(empresa_id=public.mi_empresa_id());
create policy oc_alta on public.ordenes_compra for insert to authenticated with check(empresa_id=public.mi_empresa_id());
create policy oc_cambio on public.ordenes_compra for update to authenticated
 using(empresa_id=public.mi_empresa_id()) with check(empresa_id=public.mi_empresa_id());
create policy oc_baja on public.ordenes_compra for delete to authenticated
 using(estado='borrador' and (public.puede_gestionar_proyecto(proyecto_id) or solicitado_por=auth.uid()));
create policy oc_servicio on public.ordenes_compra as restrictive for all to authenticated
 using(public.empresa_puede_operar(empresa_id)) with check(public.empresa_puede_operar(empresa_id));

-- Cualquier miembro solicita (borrador); solo quien gestiona el proyecto emite, anula o reabre.
-- Emitida la OC, su contenido queda congelado: solo cambian estado, factura, adjunto y gasto.
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
  if (old.estado,new.estado)<>('emitida','recibida') and not gestiona then
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
create trigger oc_validar before insert or update on public.ordenes_compra
 for each row execute function public.validar_oc();
commit;
