-- Aplicar UNA VEZ a la base existente. No ejecutar de nuevo supabase_schema.sql.
-- Empresas sin suscripción conservan su acceso actual.
begin;
-- Columna del esquema base que no llegó a aplicarse en esta base; alta idempotente.
alter table public.empresas add column if not exists logo_b64 text;
alter table public.empresas add column acceso_transitorio boolean not null default true;
alter table public.empresas alter column acceso_transitorio set default false;
alter table public.empresas add column estado_acceso text;
update public.empresas set estado_acceso=case when aprobada then 'autorizada' else 'pendiente' end;
alter table public.empresas alter column estado_acceso set default 'pendiente';
alter table public.empresas alter column estado_acceso set not null;
alter table public.empresas add constraint empresas_estado_check check
 (estado_acceso in ('pendiente','autorizada','suspendida','bloqueada','archivada'));

create table public.suscripciones (
 empresa_id uuid primary key references public.empresas(id),
 plan_nombre text not null check(length(trim(plan_nombre)) between 1 and 80),
 monto_mensual integer not null check(monto_mensual>0),
 inicio date not null,
 dias_gracia integer not null default 5 check(dias_gracia between 0 and 30),
 periodos_pagados integer not null default 0 check(periodos_pagados>=0),
 cancelada boolean not null default false,
 actualizado_en timestamptz not null default now()
);
create table public.pagos_suscripcion (
 id uuid primary key,
 empresa_id uuid not null references public.suscripciones(empresa_id),
 periodo_inicio date not null,
 periodo_fin date not null check(periodo_fin>periodo_inicio),
 monto integer not null check(monto>0),
 referencia text not null check(length(trim(referencia)) between 1 and 160),
 fecha_pago date not null,
 registrado_por uuid not null references auth.users(id),
 registrado_en timestamptz not null default now(),
 unique(empresa_id,periodo_inicio), unique(empresa_id,referencia)
);
create table public.plataforma_historial (
 id bigint generated always as identity primary key,
 empresa_id uuid references public.empresas(id) on delete set null,
 actor uuid not null references auth.users(id),
 accion text not null, detalle jsonb not null,
 creado_en timestamptz not null default now()
);
create index on public.plataforma_historial(empresa_id,creado_en desc);
create index on public.pagos_suscripcion(empresa_id,registrado_en desc);
alter table public.suscripciones enable row level security;
alter table public.pagos_suscripcion enable row level security;
alter table public.plataforma_historial enable row level security;

create or replace function public.soy_admin_empresa(p_empresa_id uuid)
returns boolean language sql security definer stable set search_path=public as $$
 select exists(select 1 from public.perfiles where id=auth.uid() and empresa_id=p_empresa_id and rol='admin');
$$;
create policy suscripciones_lectura on public.suscripciones for select to authenticated
 using(public.soy_superadmin() or public.soy_admin_empresa(empresa_id));
create policy pagos_lectura on public.pagos_suscripcion for select to authenticated
 using(public.soy_superadmin() or public.soy_admin_empresa(empresa_id));
create policy historial_lectura on public.plataforma_historial for select to authenticated using(public.soy_superadmin());
revoke all on public.suscripciones,public.pagos_suscripcion,public.plataforma_historial from anon,authenticated;
grant select on public.suscripciones,public.pagos_suscripcion,public.plataforma_historial to authenticated;

-- Calculado siempre desde el aniversario: 31 enero -> 28 febrero -> 31 marzo.
create or replace function public.fecha_ciclo(p_inicio date,p_periodos integer)
returns date language sql immutable set search_path=public as $$
 select (p_inicio+make_interval(months=>p_periodos))::date;
$$;
create or replace function public.estado_servicio(p_empresa_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare e public.empresas; s public.suscripciones;
 hoy date:=(now() at time zone 'America/Santiago')::date; vence date; estado text; operativo boolean;
begin
 if auth.uid() is null or not coalesce(public.soy_superadmin() or p_empresa_id=public.mi_empresa_id(),false) then raise exception 'No autorizado'; end if;
 select * into strict e from public.empresas where id=p_empresa_id;
 select * into s from public.suscripciones where empresa_id=p_empresa_id;
 if not found then estado:='sin_configurar'; operativo:=e.acceso_transitorio;
 else
  vence:=public.fecha_ciclo(s.inicio,s.periodos_pagados);
  estado:=case when s.cancelada then 'cancelada' when hoy<s.inicio then 'programada'
   when hoy<vence then 'al_dia' when hoy<vence+s.dias_gracia then 'en_gracia' else 'vencida' end;
  operativo:=hoy>=s.inicio and (hoy<vence or (not s.cancelada and hoy<vence+s.dias_gracia));
 end if;
 return jsonb_build_object('estado_acceso',e.estado_acceso,'estado_pago',estado,
  'vencimiento',vence,'operativo',e.estado_acceso='autorizada' and e.aprobada and operativo);
end;
$$;
create or replace function public.empresa_puede_operar(p_empresa_id uuid)
returns boolean language plpgsql security definer stable set search_path=public as $$
begin
 if auth.uid() is null or p_empresa_id is distinct from public.mi_empresa_id() then return false; end if;
 return coalesce((public.estado_servicio(p_empresa_id)->>'operativo')::boolean,false);
end;
$$;
-- Revocar permisos generales heredados de los defaults de Supabase.
revoke all on public.empresas,public.perfiles from anon,authenticated;
grant select on public.empresas,public.perfiles to authenticated;
grant update(nombre_comercial,razon_social,rut,direccion,telefono,email_contacto,firma_b64,logo_b64,responsable_nombre,responsable_cargo) on public.empresas to authenticated;
grant update(nombre) on public.perfiles to authenticated;

create policy presupuestos_servicio on public.presupuestos as restrictive for all to authenticated
 using(public.empresa_puede_operar(empresa_id)) with check(public.empresa_puede_operar(empresa_id));
drop policy if exists empresas_update_own on public.empresas;
create policy empresas_update_own on public.empresas for update to authenticated
 using(public.soy_superadmin() or (public.soy_admin_empresa(id) and public.empresa_puede_operar(id)))
 with check(public.soy_superadmin() or (public.soy_admin_empresa(id) and public.empresa_puede_operar(id)));

create or replace function public.plataforma_cambiar_acceso(p_empresa_id uuid,p_estado text,p_motivo text)
returns void language plpgsql security definer set search_path=public as $$
declare anterior text;
begin
 if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
 if p_estado is null or p_estado not in ('pendiente','autorizada','suspendida','bloqueada','archivada') then raise exception 'Estado inválido'; end if;
 if length(trim(coalesce(p_motivo,'')))<5 then raise exception 'Indica un motivo de al menos 5 caracteres'; end if;
 if p_estado<>'autorizada' and exists(select 1 from public.perfiles where empresa_id=p_empresa_id and es_superadmin) then
  raise exception 'No se puede restringir una empresa con administradores de plataforma';
 end if;
 select estado_acceso into strict anterior from public.empresas where id=p_empresa_id for update;
 update public.empresas set estado_acceso=p_estado,aprobada=(p_estado='autorizada') where id=p_empresa_id;
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(p_empresa_id,auth.uid(),'acceso',jsonb_build_object('anterior',anterior,'nuevo',p_estado,'motivo',trim(p_motivo)));
end;
$$;
-- Eliminación definitiva solo para empresas archivadas sin documentos ni pagos.
create or replace function public.plataforma_eliminar_empresa(p_empresa_id uuid,p_nombre text)
returns void language plpgsql security definer set search_path=public as $$
declare e public.empresas;
begin
 if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
 select * into strict e from public.empresas where id=p_empresa_id for update;
 if e.estado_acceso<>'archivada' or p_nombre is distinct from e.nombre_comercial then raise exception 'Archiva la empresa y confirma su nombre exacto'; end if;
 if exists(select 1 from public.perfiles where empresa_id=p_empresa_id and es_superadmin) then raise exception 'La empresa tiene administradores de plataforma'; end if;
 if exists(select 1 from public.presupuestos where empresa_id=p_empresa_id)
 or exists(select 1 from public.ot_publicas where empresa_id=p_empresa_id)
 or exists(select 1 from public.pagos_suscripcion where empresa_id=p_empresa_id) then
  raise exception 'La empresa tiene documentos o pagos. Conserva la baja mediante archivo';
 end if;
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(p_empresa_id,auth.uid(),'eliminacion',jsonb_build_object('empresa_id',p_empresa_id,'nombre',e.nombre_comercial));
 delete from public.suscripciones where empresa_id=p_empresa_id;
 delete from public.empresas where id=p_empresa_id;
end;
$$;
create or replace function public.aprobar_empresa(p_empresa_id uuid,p_aprobada boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.plataforma_cambiar_acceso(p_empresa_id,case when p_aprobada then 'autorizada' else 'suspendida' end,'Cambio desde administración');
end;
$$;
create or replace function public.set_limite_usuarios(p_empresa_id uuid,p_limite int)
returns void language plpgsql security definer set search_path=public as $$
declare anterior int;
begin
 if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
 select limite_usuarios into strict anterior from public.empresas where id=p_empresa_id for update;
 if p_limite is null or p_limite<1 or p_limite>10000 or p_limite<(select count(*) from public.perfiles where empresa_id=p_empresa_id) then
  raise exception 'El cupo debe cubrir los usuarios existentes y estar entre 1 y 10000';
 end if;
 update public.empresas set limite_usuarios=p_limite where id=p_empresa_id;
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(p_empresa_id,auth.uid(),'cupo',jsonb_build_object('anterior',anterior,'nuevo',p_limite));
end;
$$;
create or replace function public.plataforma_configurar_suscripcion(
 p_empresa_id uuid,p_plan text,p_monto integer,p_inicio date,p_gracia integer,p_cancelada boolean)
returns void language plpgsql security definer set search_path=public as $$
declare anterior public.suscripciones;
begin
 if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
 perform 1 from public.empresas where id=p_empresa_id for update;
 if not found then raise exception 'Empresa inexistente'; end if;
 select * into anterior from public.suscripciones where empresa_id=p_empresa_id for update;
 if anterior.periodos_pagados>0 and p_inicio is distinct from anterior.inicio then raise exception 'El inicio no se cambia después de registrar pagos'; end if;
 if p_inicio is null or p_inicio<date '2020-01-01' or p_inicio>(now() at time zone 'America/Santiago')::date+366 then raise exception 'Fecha de inicio inválida'; end if;
 insert into public.suscripciones(empresa_id,plan_nombre,monto_mensual,inicio,dias_gracia,cancelada)
 values(p_empresa_id,trim(p_plan),p_monto,p_inicio,p_gracia,p_cancelada)
 on conflict(empresa_id) do update set plan_nombre=excluded.plan_nombre,monto_mensual=excluded.monto_mensual,
 inicio=excluded.inicio,dias_gracia=excluded.dias_gracia,cancelada=excluded.cancelada,actualizado_en=now();
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(p_empresa_id,auth.uid(),'suscripcion',jsonb_build_object('anterior',to_jsonb(anterior),'plan',trim(p_plan),'monto',p_monto,'inicio',p_inicio,'gracia',p_gracia,'cancelada',p_cancelada));
end;
$$;
create or replace function public.plataforma_registrar_pago(
 p_id uuid,p_empresa_id uuid,p_periodo_inicio date,p_monto integer,p_referencia text,p_fecha_pago date)
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.suscripciones; existente public.pagos_suscripcion; desde date; hasta date;
begin
 if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
 perform 1 from public.empresas where id=p_empresa_id for update;
 select * into strict s from public.suscripciones where empresa_id=p_empresa_id for update;
 select * into existente from public.pagos_suscripcion where id=p_id;
 if found then
  if existente.empresa_id=p_empresa_id and existente.periodo_inicio=p_periodo_inicio and existente.monto=p_monto
   and existente.referencia=lower(trim(p_referencia)) and existente.fecha_pago=p_fecha_pago then return p_id; end if;
  raise exception 'Identificador de pago utilizado con otros datos';
 end if;
 if s.cancelada then raise exception 'Reactiva la suscripción antes de registrar pagos'; end if;
 desde:=public.fecha_ciclo(s.inicio,s.periodos_pagados); hasta:=public.fecha_ciclo(s.inicio,s.periodos_pagados+1);
 if p_periodo_inicio is distinct from desde then raise exception 'El período cambió. Actualiza la ficha'; end if;
 if p_monto is distinct from s.monto_mensual then raise exception 'Registra el importe completo del período'; end if;
 if p_fecha_pago is null or p_fecha_pago>(now() at time zone 'America/Santiago')::date or p_fecha_pago<date '2020-01-01' then raise exception 'Fecha de pago inválida'; end if;
 insert into public.pagos_suscripcion(id,empresa_id,periodo_inicio,periodo_fin,monto,referencia,fecha_pago,registrado_por)
 values(p_id,p_empresa_id,desde,hasta,p_monto,lower(trim(p_referencia)),p_fecha_pago,auth.uid());
 update public.suscripciones set periodos_pagados=periodos_pagados+1,actualizado_en=now() where empresa_id=p_empresa_id;
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(p_empresa_id,auth.uid(),'pago',jsonb_build_object('pago_id',p_id,'desde',desde,'hasta',hasta,'monto',p_monto));
 return p_id;
end;
$$;

-- Protege incluso inserciones con service_role y altas concurrentes.
create or replace function public.validar_alta_perfil()
returns trigger language plpgsql security definer set search_path=public as $$
declare e public.empresas; s public.suscripciones; hoy date:=(now() at time zone 'America/Santiago')::date; vence date;
begin
 select * into strict e from public.empresas where id=new.empresa_id for update;
 if (select count(*) from public.perfiles where empresa_id=new.empresa_id and id<>new.id)>=e.limite_usuarios then raise exception 'No hay cupos disponibles'; end if;
 if exists(select 1 from public.perfiles where empresa_id=new.empresa_id and id<>new.id) then
  if e.estado_acceso<>'autorizada' or not e.aprobada then raise exception 'Empresa sin acceso'; end if;
  select * into s from public.suscripciones where empresa_id=new.empresa_id;
  if found then
   vence:=public.fecha_ciclo(s.inicio,s.periodos_pagados);
   if hoy<s.inicio or (hoy>=vence and (s.cancelada or hoy>=vence+s.dias_gracia)) then raise exception 'Suscripción sin acceso'; end if;
  elsif not e.acceso_transitorio then raise exception 'La empresa requiere una suscripción';
  end if;
 end if;
 return new;
end;
$$;
create trigger perfiles_validar_alta before insert or update of empresa_id on public.perfiles
 for each row execute function public.validar_alta_perfil();

-- Publicar requiere ser dueño y tener servicio activo; firmar enlaces existentes sigue permitido.
alter table public.ot_publicas add column empresa_id uuid references public.empresas(id);
update public.ot_publicas o set empresa_id=p.empresa_id from public.presupuestos p
 where exists(select 1 from jsonb_array_elements(coalesce(p.data->'ordenesTrabajo','[]'::jsonb)) x where x->>'id'=o.id);
create or replace function public.validar_publicacion_ot()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and (to_jsonb(new)-array['estado','firma_b64','foto_b64','fecha_firma'])=
  (to_jsonb(old)-array['estado','firma_b64','foto_b64','fecha_firma']) then return new; end if;
 if auth.uid() is null or not public.empresa_puede_operar(public.mi_empresa_id()) then raise exception 'Sin acceso para publicar'; end if;
 if tg_op='UPDATE' and old.empresa_id is distinct from public.mi_empresa_id() then raise exception 'Orden de otra empresa'; end if;
 if not exists(select 1 from public.presupuestos p where p.empresa_id=public.mi_empresa_id()
  and exists(select 1 from jsonb_array_elements(coalesce(p.data->'ordenesTrabajo','[]'::jsonb)) x where x->>'id'=new.id)) then
  raise exception 'Guarda la orden en tu empresa antes de publicarla';
 end if;
 new.empresa_id:=public.mi_empresa_id();
 return new;
end;
$$;
create trigger ot_validar_publicacion before insert or update on public.ot_publicas
 for each row execute function public.validar_publicacion_ot();
revoke execute on function public.publicar_ot from public,anon;
grant execute on function public.publicar_ot to authenticated;
revoke all on function public.plataforma_cambiar_acceso,public.plataforma_configurar_suscripcion,
 public.plataforma_eliminar_empresa,public.plataforma_registrar_pago,public.estado_servicio,public.empresa_puede_operar,
 public.soy_admin_empresa,public.aprobar_empresa,public.set_limite_usuarios from public,anon;
grant execute on function public.plataforma_cambiar_acceso,public.plataforma_configurar_suscripcion,
 public.plataforma_eliminar_empresa,public.plataforma_registrar_pago,public.estado_servicio,public.empresa_puede_operar,
 public.soy_admin_empresa,public.aprobar_empresa,public.set_limite_usuarios to authenticated;
commit;
