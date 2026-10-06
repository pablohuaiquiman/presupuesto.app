-- Ejecución de proyectos: centro de costo, estados de pago y gastos.
-- Requiere 202610050001_plataforma.sql. Aplicar UNA VEZ.
begin;

create table public.proyectos (
 id uuid primary key default gen_random_uuid(),
 empresa_id uuid not null references public.empresas(id),
 presupuesto_id text not null references public.presupuestos(id),
 codigo text not null check(length(trim(codigo)) between 1 and 40),
 nombre text not null check(length(trim(nombre)) between 1 and 160),
 estado text not null default 'activo' check(estado in ('activo','cerrado')),
 administrador_id uuid references public.perfiles(id) on delete set null,
 config jsonb not null default '{}'::jsonb,
 creado_en timestamptz not null default now(),
 actualizado_en timestamptz not null default now(),
 unique(empresa_id,presupuesto_id)
);
create table public.proyecto_edps (
 id uuid primary key default gen_random_uuid(),
 proyecto_id uuid not null references public.proyectos(id),
 empresa_id uuid not null references public.empresas(id),
 numero integer not null,
 tipo text not null default 'avance' check(tipo in ('avance','devolucion_retencion')),
 estado text not null default 'borrador' check(estado in ('borrador','presentado','aprobado','pagado')),
 fecha_presentacion date,
 fecha_aprobacion date,
 items jsonb not null default '[]'::jsonb,
 totales jsonb not null default '{}'::jsonb,
 oc_numero text, hes_numero text,
 factura_numero text, factura_fecha date, factura_path text,
 fecha_pago_estimada date, fecha_pago_real date, comprobante_path text,
 obs text,
 creado_en timestamptz not null default now(),
 actualizado_en timestamptz not null default now(),
 unique(proyecto_id,numero)
);
create table public.proyecto_gastos (
 id uuid primary key default gen_random_uuid(),
 proyecto_id uuid not null references public.proyectos(id),
 empresa_id uuid not null references public.empresas(id),
 fecha date not null,
 categoria text not null check(categoria in ('materiales','mano_obra','generales')),
 subcategoria text check(length(subcategoria)<=80),
 descripcion text not null check(length(trim(descripcion)) between 1 and 300),
 proveedor text check(length(proveedor)<=160),
 tipo_doc text not null default 'boleta' check(tipo_doc in ('boleta','factura','guia','sin_documento')),
 numero_doc text check(length(numero_doc)<=40),
 monto integer not null check(monto>0),
 adjunto_path text,
 estado text not null default 'pendiente' check(estado in ('pendiente','aprobado','rechazado')),
 registrado_por uuid references auth.users(id),
 revisado_por uuid references auth.users(id),
 revisado_en timestamptz,
 motivo_rechazo text,
 creado_en timestamptz not null default now()
);
create index on public.proyecto_edps(proyecto_id,numero);
create index on public.proyecto_gastos(proyecto_id,fecha desc);
alter table public.proyectos enable row level security;
alter table public.proyecto_edps enable row level security;
alter table public.proyecto_gastos enable row level security;
revoke all on public.proyectos,public.proyecto_edps,public.proyecto_gastos from anon,authenticated;
grant select,insert,update,delete on public.proyectos,public.proyecto_edps,public.proyecto_gastos to authenticated;

-- Gestiona: administrador de la empresa o administrador designado del proyecto.
create or replace function public.puede_gestionar_proyecto(p_proyecto_id uuid)
returns boolean language sql security definer stable set search_path=public as $$
 select exists(select 1 from public.proyectos p where p.id=p_proyecto_id and p.empresa_id=public.mi_empresa_id()
  and (public.soy_admin_empresa(p.empresa_id) or p.administrador_id=auth.uid()));
$$;

create policy proyectos_lectura on public.proyectos for select to authenticated using(empresa_id=public.mi_empresa_id());
create policy proyectos_alta on public.proyectos for insert to authenticated
 with check(empresa_id=public.mi_empresa_id() and public.soy_admin_empresa(empresa_id));
create policy proyectos_cambio on public.proyectos for update to authenticated
 using(public.puede_gestionar_proyecto(id)) with check(public.puede_gestionar_proyecto(id));
create policy proyectos_baja on public.proyectos for delete to authenticated using(public.soy_admin_empresa(empresa_id));
create policy proyectos_servicio on public.proyectos as restrictive for all to authenticated
 using(public.empresa_puede_operar(empresa_id)) with check(public.empresa_puede_operar(empresa_id));

create policy edps_lectura on public.proyecto_edps for select to authenticated using(empresa_id=public.mi_empresa_id());
create policy edps_alta on public.proyecto_edps for insert to authenticated with check(public.puede_gestionar_proyecto(proyecto_id));
create policy edps_cambio on public.proyecto_edps for update to authenticated
 using(public.puede_gestionar_proyecto(proyecto_id)) with check(public.puede_gestionar_proyecto(proyecto_id));
create policy edps_baja on public.proyecto_edps for delete to authenticated using(public.puede_gestionar_proyecto(proyecto_id) and estado='borrador');
create policy edps_servicio on public.proyecto_edps as restrictive for all to authenticated
 using(public.empresa_puede_operar(empresa_id)) with check(public.empresa_puede_operar(empresa_id));

create policy gastos_lectura on public.proyecto_gastos for select to authenticated using(empresa_id=public.mi_empresa_id());
create policy gastos_alta on public.proyecto_gastos for insert to authenticated with check(empresa_id=public.mi_empresa_id());
create policy gastos_cambio on public.proyecto_gastos for update to authenticated
 using(empresa_id=public.mi_empresa_id()) with check(empresa_id=public.mi_empresa_id());
create policy gastos_baja on public.proyecto_gastos for delete to authenticated
 using(public.puede_gestionar_proyecto(proyecto_id) or (registrado_por=auth.uid() and estado='pendiente'));
create policy gastos_servicio on public.proyecto_gastos as restrictive for all to authenticated
 using(public.empresa_puede_operar(empresa_id)) with check(public.empresa_puede_operar(empresa_id));

create or replace function public.validar_proyecto()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
  if not exists(select 1 from public.presupuestos where id=new.presupuesto_id and empresa_id=new.empresa_id) then
   raise exception 'Presupuesto inexistente';
  end if;
 else
  new.empresa_id:=old.empresa_id; new.presupuesto_id:=old.presupuesto_id; new.creado_en:=old.creado_en;
  if new.administrador_id is distinct from old.administrador_id and not public.soy_admin_empresa(old.empresa_id) then
   raise exception 'Solo el administrador de la empresa designa al administrador del proyecto';
  end if;
 end if;
 if new.administrador_id is not null and not exists(select 1 from public.perfiles where id=new.administrador_id and empresa_id=new.empresa_id) then
  raise exception 'El administrador debe pertenecer a la empresa';
 end if;
 new.actualizado_en:=now();
 return new;
end;
$$;
create trigger proyectos_validar before insert or update on public.proyectos
 for each row execute function public.validar_proyecto();

-- Secuencia de estados de pago: uno abierto a la vez y montos congelados al presentar.
create or replace function public.validar_edp()
returns trigger language plpgsql security definer set search_path=public as $$
declare pr public.proyectos;
begin
 if tg_op='INSERT' then
  select * into strict pr from public.proyectos where id=new.proyecto_id for update;
  if pr.estado<>'activo' then raise exception 'El proyecto está cerrado'; end if;
  if exists(select 1 from public.proyecto_edps where proyecto_id=new.proyecto_id and estado in ('borrador','presentado')) then
   raise exception 'Ya hay un estado de pago abierto. Apruébalo antes de crear otro';
  end if;
  new.empresa_id:=pr.empresa_id;
  new.numero:=(select coalesce(max(numero),0)+1 from public.proyecto_edps where proyecto_id=new.proyecto_id);
  new.estado:='borrador'; new.fecha_aprobacion:=null; new.fecha_pago_real:=null;
  new.creado_en:=now(); new.actualizado_en:=now();
  return new;
 end if;
 new.proyecto_id:=old.proyecto_id; new.empresa_id:=old.empresa_id; new.numero:=old.numero; new.tipo:=old.tipo; new.creado_en:=old.creado_en;
 if old.estado<>'borrador' and (new.items is distinct from old.items or new.totales is distinct from old.totales) then
  raise exception 'El estado de pago ya fue presentado; sus montos no se modifican';
 end if;
 if new.estado is distinct from old.estado then
  if (old.estado,new.estado) not in (('borrador','presentado'),('presentado','borrador'),('presentado','aprobado'),('aprobado','pagado'),('pagado','aprobado')) then
   raise exception 'Cambio de estado no permitido: % a %',old.estado,new.estado;
  end if;
  if new.estado='presentado' and new.fecha_presentacion is null then new.fecha_presentacion:=(now() at time zone 'America/Santiago')::date; end if;
  if new.estado='aprobado' and old.estado='presentado' then new.fecha_aprobacion:=coalesce(new.fecha_aprobacion,(now() at time zone 'America/Santiago')::date); end if;
  if new.estado='borrador' then new.fecha_aprobacion:=null; end if;
 end if;
 if new.estado='pagado' and new.fecha_pago_real is null then raise exception 'Indica la fecha de pago'; end if;
 if new.estado<>'pagado' then new.fecha_pago_real:=null; new.comprobante_path:=null; end if;
 new.actualizado_en:=now();
 return new;
end;
$$;
create trigger edps_validar before insert or update on public.proyecto_edps
 for each row execute function public.validar_edp();

-- Los trabajadores registran gastos como pendientes; solo quien gestiona el proyecto aprueba o rechaza.
create or replace function public.validar_gasto()
returns trigger language plpgsql security definer set search_path=public as $$
declare pr public.proyectos; gestiona boolean;
begin
 if tg_op='INSERT' then
  select * into strict pr from public.proyectos where id=new.proyecto_id;
  if pr.estado<>'activo' then raise exception 'El proyecto está cerrado'; end if;
  new.empresa_id:=pr.empresa_id; new.estado:='pendiente'; new.registrado_por:=auth.uid();
  new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null; new.creado_en:=now();
  return new;
 end if;
 gestiona:=public.puede_gestionar_proyecto(old.proyecto_id);
 new.proyecto_id:=old.proyecto_id; new.empresa_id:=old.empresa_id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
 if new.estado is distinct from old.estado then
  if not gestiona then raise exception 'Solo el administrador del proyecto aprueba gastos'; end if;
  if new.estado='rechazado' and length(trim(coalesce(new.motivo_rechazo,'')))<3 then raise exception 'Indica el motivo del rechazo'; end if;
  if new.estado='pendiente' then new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null;
  else new.revisado_por:=auth.uid(); new.revisado_en:=now(); end if;
  if new.estado='aprobado' then new.motivo_rechazo:=null; end if;
 else
  if not gestiona and (old.registrado_por is distinct from auth.uid() or old.estado<>'pendiente') then
   raise exception 'Solo puedes modificar tus gastos pendientes';
  end if;
  new.revisado_por:=old.revisado_por; new.revisado_en:=old.revisado_en;
  if not gestiona then new.motivo_rechazo:=old.motivo_rechazo; end if;
 end if;
 return new;
end;
$$;
create trigger gastos_validar before insert or update on public.proyecto_gastos
 for each row execute function public.validar_gasto();

revoke all on function public.puede_gestionar_proyecto(uuid) from public,anon;
grant execute on function public.puede_gestionar_proyecto(uuid) to authenticated;

-- Respaldos (facturas, comprobantes, boletas): {empresa_id}/{proyecto_id}/{tipo}/{archivo}
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('proyectos','proyectos',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do nothing;
create policy proyectos_archivos_lectura on storage.objects for select to authenticated
 using(bucket_id='proyectos' and (storage.foldername(name))[1]=public.mi_empresa_id()::text and public.empresa_puede_operar(public.mi_empresa_id()));
create policy proyectos_archivos_alta on storage.objects for insert to authenticated
 with check(bucket_id='proyectos' and (storage.foldername(name))[1]=public.mi_empresa_id()::text and public.empresa_puede_operar(public.mi_empresa_id()));
create policy proyectos_archivos_baja on storage.objects for delete to authenticated
 using(bucket_id='proyectos' and (storage.foldername(name))[1]=public.mi_empresa_id()::text and public.empresa_puede_operar(public.mi_empresa_id()));
commit;
