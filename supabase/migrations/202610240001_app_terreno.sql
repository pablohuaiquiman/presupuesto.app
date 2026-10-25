-- App de terreno (gastos.html): personal asignado por proyecto, origen del dinero y reembolso de gastos,
-- ingresos recibidos en obra e informes de trabajo con fotos antes/después.
-- Requiere 202610060001_proyectos.sql, 202610190001_gastos_adjuntos.sql y 202610070003_colaboradores.sql. Aplicar UNA VEZ.
begin;

-- ── Personal asignado ─────────────────────────────────────
alter table public.proyectos add column asignados uuid[] not null default '{}';

-- Gestiona el proyecto o figura en su personal asignado: puede registrar gastos, ingresos e informes.
create or replace function public.asignado_a_proyecto(p_proyecto_id uuid)
returns boolean language sql security definer stable set search_path=public as $$
 select public.puede_gestionar_proyecto(p_proyecto_id) or exists(select 1 from public.proyectos p
  where p.id=p_proyecto_id and p.empresa_id=public.mi_empresa_id() and auth.uid()=any(p.asignados));
$$;
revoke all on function public.asignado_a_proyecto(uuid) from public,anon;
grant execute on function public.asignado_a_proyecto(uuid) to authenticated;

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
 new.asignados:=array(select distinct x from unnest(coalesce(new.asignados,'{}')) x where x is not null order by 1);
 if exists(select 1 from unnest(new.asignados) x where not exists(select 1 from public.perfiles where id=x and empresa_id=new.empresa_id)) then
  raise exception 'El personal asignado debe pertenecer a la empresa';
 end if;
 new.actualizado_en:=now();
 return new;
end;
$$;

-- ── Gastos: con qué dinero se pagó y reembolso ────────────
alter table public.proyecto_gastos
 add column origen_fondos text not null default 'empresa' check(origen_fondos in ('empresa','propio')),
 add column reembolsado_en date,
 add column reembolsado_por uuid references auth.users(id);

create or replace function public.validar_gasto()
returns trigger language plpgsql security definer set search_path=public as $$
declare pr public.proyectos; gestiona boolean;
begin
 if tg_op='INSERT' then
  select * into strict pr from public.proyectos where id=new.proyecto_id;
  if pr.estado<>'activo' then raise exception 'El proyecto está cerrado'; end if;
  if not public.asignado_a_proyecto(new.proyecto_id) then raise exception 'No estás asignado a este proyecto'; end if;
  new.empresa_id:=pr.empresa_id; new.estado:='pendiente'; new.registrado_por:=auth.uid();
  new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null; new.creado_en:=now();
  new.reembolsado_en:=null; new.reembolsado_por:=null;
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
 -- Reembolso al trabajador: solo gastos pagados con dinero propio y aprobados.
 if new.reembolsado_en is distinct from old.reembolsado_en then
  if not gestiona then raise exception 'Solo el administrador del proyecto registra reembolsos'; end if;
  if new.reembolsado_en is not null and (new.origen_fondos<>'propio' or new.estado<>'aprobado') then
   raise exception 'Solo se reembolsan gastos aprobados pagados con dinero propio';
  end if;
  new.reembolsado_por:=case when new.reembolsado_en is null then null else auth.uid() end;
 else
  new.reembolsado_por:=old.reembolsado_por;
 end if;
 if new.estado<>'aprobado' or new.origen_fondos<>'propio' then new.reembolsado_en:=null; new.reembolsado_por:=null; end if;
 return new;
end;
$$;

-- ── Ingresos recibidos en obra ────────────────────────────
create table public.proyecto_ingresos (
 id uuid primary key default gen_random_uuid(),
 proyecto_id uuid not null references public.proyectos(id),
 empresa_id uuid not null references public.empresas(id),
 fecha date not null,
 monto integer not null check(monto>0),
 medio text not null check(medio in ('transferencia_empresa','transferencia_personal','efectivo')),
 pagador text check(length(pagador)<=160),
 descripcion text not null check(length(trim(descripcion)) between 1 and 300),
 adjuntos text[] not null default '{}' check(cardinality(adjuntos)<=10),
 estado text not null default 'pendiente' check(estado in ('pendiente','aprobado','rechazado')),
 registrado_por uuid references auth.users(id),
 revisado_por uuid references auth.users(id),
 revisado_en timestamptz,
 motivo_rechazo text,
 creado_en timestamptz not null default now()
);
create index on public.proyecto_ingresos(proyecto_id,fecha desc);
alter table public.proyecto_ingresos enable row level security;
revoke all on public.proyecto_ingresos from anon,authenticated;
grant select,insert,update,delete on public.proyecto_ingresos to authenticated;
create policy ingresos_lectura on public.proyecto_ingresos for select to authenticated using(empresa_id=public.mi_empresa_id());
create policy ingresos_alta on public.proyecto_ingresos for insert to authenticated with check(empresa_id=public.mi_empresa_id());
create policy ingresos_cambio on public.proyecto_ingresos for update to authenticated
 using(empresa_id=public.mi_empresa_id()) with check(empresa_id=public.mi_empresa_id());
create policy ingresos_baja on public.proyecto_ingresos for delete to authenticated
 using(public.puede_gestionar_proyecto(proyecto_id) or (registrado_por=auth.uid() and estado='pendiente'));
create policy ingresos_servicio on public.proyecto_ingresos as restrictive for all to authenticated
 using(public.empresa_puede_operar(empresa_id)) with check(public.empresa_puede_operar(empresa_id));

-- Todo ingreso queda pendiente hasta que el encargado del proyecto lo autoriza (transferencia al trabajador o efectivo)
-- o confirma que llegó (transferencia a la empresa).
create or replace function public.validar_ingreso()
returns trigger language plpgsql security definer set search_path=public as $$
declare pr public.proyectos; gestiona boolean;
begin
 if tg_op='INSERT' then
  select * into strict pr from public.proyectos where id=new.proyecto_id;
  if pr.estado<>'activo' then raise exception 'El proyecto está cerrado'; end if;
  if not public.asignado_a_proyecto(new.proyecto_id) then raise exception 'No estás asignado a este proyecto'; end if;
  new.empresa_id:=pr.empresa_id; new.estado:='pendiente'; new.registrado_por:=auth.uid();
  new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null; new.creado_en:=now();
  return new;
 end if;
 gestiona:=public.puede_gestionar_proyecto(old.proyecto_id);
 new.proyecto_id:=old.proyecto_id; new.empresa_id:=old.empresa_id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
 if new.estado is distinct from old.estado then
  if not gestiona then raise exception 'Solo el encargado del proyecto autoriza ingresos'; end if;
  if new.estado='rechazado' and length(trim(coalesce(new.motivo_rechazo,'')))<3 then raise exception 'Indica el motivo del rechazo'; end if;
  if new.estado='pendiente' then new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null;
  else new.revisado_por:=auth.uid(); new.revisado_en:=now(); end if;
  if new.estado='aprobado' then new.motivo_rechazo:=null; end if;
 else
  if not gestiona and (old.registrado_por is distinct from auth.uid() or old.estado<>'pendiente') then
   raise exception 'Solo puedes modificar tus ingresos pendientes';
  end if;
  new.revisado_por:=old.revisado_por; new.revisado_en:=old.revisado_en;
  if not gestiona then new.motivo_rechazo:=old.motivo_rechazo; end if;
 end if;
 return new;
end;
$$;
create trigger ingresos_validar before insert or update on public.proyecto_ingresos
 for each row execute function public.validar_ingreso();

-- ── Informes de trabajo (antes / después) ─────────────────
-- items: [{titulo, comentario, antes:[paths], despues:[paths]}]
create table public.proyecto_informes (
 id uuid primary key default gen_random_uuid(),
 proyecto_id uuid not null references public.proyectos(id),
 empresa_id uuid not null references public.empresas(id),
 fecha date not null,
 titulo text not null check(length(trim(titulo)) between 1 and 160),
 ubicacion text check(length(ubicacion)<=160),
 trabajo_realizado text check(length(trabajo_realizado)<=2000),
 items jsonb not null default '[]'::jsonb check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=30),
 observaciones text check(length(observaciones)<=2000),
 registrado_por uuid references auth.users(id),
 creado_en timestamptz not null default now(),
 actualizado_en timestamptz not null default now()
);
create index on public.proyecto_informes(proyecto_id,fecha desc);
alter table public.proyecto_informes enable row level security;
revoke all on public.proyecto_informes from anon,authenticated;
grant select,insert,update,delete on public.proyecto_informes to authenticated;
create policy informes_lectura on public.proyecto_informes for select to authenticated using(empresa_id=public.mi_empresa_id());
create policy informes_alta on public.proyecto_informes for insert to authenticated
 with check(empresa_id=public.mi_empresa_id() and public.asignado_a_proyecto(proyecto_id));
create policy informes_cambio on public.proyecto_informes for update to authenticated
 using(public.puede_gestionar_proyecto(proyecto_id) or registrado_por=auth.uid())
 with check(public.puede_gestionar_proyecto(proyecto_id) or registrado_por=auth.uid());
create policy informes_baja on public.proyecto_informes for delete to authenticated
 using(public.puede_gestionar_proyecto(proyecto_id) or registrado_por=auth.uid());
create policy informes_servicio on public.proyecto_informes as restrictive for all to authenticated
 using(public.empresa_puede_operar(empresa_id)) with check(public.empresa_puede_operar(empresa_id));

create or replace function public.validar_informe()
returns trigger language plpgsql security definer set search_path=public as $$
declare pr public.proyectos;
begin
 if tg_op='INSERT' then
  select * into strict pr from public.proyectos where id=new.proyecto_id;
  new.empresa_id:=pr.empresa_id; new.registrado_por:=auth.uid(); new.creado_en:=now();
 else
  new.proyecto_id:=old.proyecto_id; new.empresa_id:=old.empresa_id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
 end if;
 new.actualizado_en:=now();
 return new;
end;
$$;
create trigger informes_validar before insert or update on public.proyecto_informes
 for each row execute function public.validar_informe();

-- ── Eliminación de empresa: incluye las tablas nuevas ─────
create or replace function public.plataforma_eliminar_empresa(p_empresa_id uuid,p_nombre text)
returns void language plpgsql security definer set search_path=public as $$
declare e public.empresas; resumen jsonb;
begin
 if not public.soy_superadmin() then raise exception 'Solo el dueño de la plataforma elimina empresas'; end if;
 select * into strict e from public.empresas where id=p_empresa_id for update;
 if p_nombre is distinct from e.nombre_comercial then raise exception 'Confirma escribiendo el nombre exacto de la empresa'; end if;
 if exists(select 1 from public.perfiles where empresa_id=p_empresa_id and es_superadmin) then raise exception 'La empresa tiene administradores de plataforma'; end if;
 resumen:=jsonb_build_object('empresa_id',p_empresa_id,'nombre',e.nombre_comercial,'rut',e.rut,
  'presupuestos',(select count(*) from public.presupuestos where empresa_id=p_empresa_id),
  'proyectos',(select count(*) from public.proyectos where empresa_id=p_empresa_id),
  'pagos',(select count(*) from public.pagos_suscripcion where empresa_id=p_empresa_id),
  'usuarios',(select count(*) from public.perfiles where empresa_id=p_empresa_id));
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle) values(p_empresa_id,auth.uid(),'eliminacion',resumen);
 update public.perfiles set empresa_id=null,rol='miembro' where empresa_id=p_empresa_id and colaborador_plataforma;
 if to_regclass('public.ordenes_compra') is not null then
  execute 'delete from public.ordenes_compra where empresa_id=$1' using p_empresa_id;
 end if;
 delete from public.proyecto_informes where empresa_id=p_empresa_id;
 delete from public.proyecto_ingresos where empresa_id=p_empresa_id;
 delete from public.proyecto_gastos where empresa_id=p_empresa_id;
 delete from public.proyecto_edps where empresa_id=p_empresa_id;
 delete from public.proyectos where empresa_id=p_empresa_id;
 delete from public.ot_publicas where empresa_id=p_empresa_id;
 delete from public.cobros_mp where empresa_id=p_empresa_id;
 delete from public.pagos_suscripcion where empresa_id=p_empresa_id;
 delete from public.suscripciones where empresa_id=p_empresa_id;
 -- Supabase puede bloquear el borrado directo de archivos; si ocurre, quedan huérfanos e inaccesibles.
 begin
  delete from storage.objects where bucket_id='proyectos' and name like p_empresa_id::text||'/%';
 exception when others then null;
 end;
 delete from public.empresas where id=p_empresa_id; -- cascada: presupuestos y perfiles
end;
$$;
commit;
