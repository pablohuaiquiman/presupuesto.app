-- Colaboradores de la plataforma con permisos editables y eliminación completa de empresas.
-- Requiere 202610050001_plataforma.sql, 202610060001_proyectos.sql y 202610060002_mercadopago.sql. Aplicar UNA VEZ.
-- Dueño (es_superadmin): todo. Colaborador: ve el panel y, según sus permisos,
-- 'acceso' (estado de acceso y cupos) y 'suscripciones' (plan y registro de pagos).
begin;
-- Un colaborador puede no pertenecer a ninguna empresa.
alter table public.perfiles alter column empresa_id drop not null;
alter table public.perfiles add column colaborador_plataforma boolean not null default false;
alter table public.perfiles add column permisos_plataforma text[] not null default '{}'
 check(permisos_plataforma <@ array['acceso','suscripciones']::text[]);
alter table public.perfiles add constraint perfiles_empresa_o_colaborador check(empresa_id is not null or colaborador_plataforma);

create or replace function public.soy_equipo_plataforma()
returns boolean language sql security definer stable set search_path=public as $$
 select coalesce((select es_superadmin or colaborador_plataforma from public.perfiles where id=auth.uid()),false);
$$;
create or replace function public.tengo_permiso_plataforma(p_permiso text)
returns boolean language sql security definer stable set search_path=public as $$
 select coalesce((select es_superadmin or (colaborador_plataforma and p_permiso=any(permisos_plataforma))
  from public.perfiles where id=auth.uid()),false);
$$;

-- Lectura del panel para todo el equipo de plataforma.
drop policy "empresas_select" on public.empresas;
create policy empresas_select on public.empresas for select
 using(id=public.mi_empresa_id() or public.soy_equipo_plataforma());
drop policy "perfiles_select" on public.perfiles;
create policy perfiles_select on public.perfiles for select
 using(id=auth.uid() or empresa_id=public.mi_empresa_id() or public.soy_equipo_plataforma());
drop policy suscripciones_lectura on public.suscripciones;
create policy suscripciones_lectura on public.suscripciones for select to authenticated
 using(public.soy_equipo_plataforma() or public.soy_admin_empresa(empresa_id));
drop policy pagos_lectura on public.pagos_suscripcion;
create policy pagos_lectura on public.pagos_suscripcion for select to authenticated
 using(public.soy_equipo_plataforma() or public.soy_admin_empresa(empresa_id));
drop policy historial_lectura on public.plataforma_historial;
create policy historial_lectura on public.plataforma_historial for select to authenticated using(public.soy_equipo_plataforma());
drop policy cobros_mp_lectura on public.cobros_mp;
create policy cobros_mp_lectura on public.cobros_mp for select to authenticated
 using(public.soy_equipo_plataforma() or public.soy_admin_empresa(empresa_id));

create or replace function public.estado_servicio(p_empresa_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare e public.empresas; s public.suscripciones;
 hoy date:=(now() at time zone 'America/Santiago')::date; vence date; estado text; operativo boolean;
begin
 if auth.uid() is null or not coalesce(public.soy_equipo_plataforma() or p_empresa_id=public.mi_empresa_id(),false) then raise exception 'No autorizado'; end if;
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

-- Los perfiles sin empresa (colaboradores) no ocupan cupos.
create or replace function public.validar_alta_perfil()
returns trigger language plpgsql security definer set search_path=public as $$
declare e public.empresas; s public.suscripciones; hoy date:=(now() at time zone 'America/Santiago')::date; vence date;
begin
 if new.empresa_id is null then return new; end if;
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

create or replace function public.plataforma_cambiar_acceso(p_empresa_id uuid,p_estado text,p_motivo text)
returns void language plpgsql security definer set search_path=public as $$
declare anterior text;
begin
 if not public.tengo_permiso_plataforma('acceso') then raise exception 'No autorizado'; end if;
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
create or replace function public.set_limite_usuarios(p_empresa_id uuid,p_limite int)
returns void language plpgsql security definer set search_path=public as $$
declare anterior int;
begin
 if not public.tengo_permiso_plataforma('acceso') then raise exception 'No autorizado'; end if;
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
 if not public.tengo_permiso_plataforma('suscripciones') then raise exception 'No autorizado'; end if;
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
 if not public.tengo_permiso_plataforma('suscripciones') then raise exception 'No autorizado'; end if;
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

-- Eliminación completa (solo el dueño): documentos, proyectos, órdenes de compra, pagos y perfiles de la empresa.
-- Las cuentas de acceso se conservan: sus usuarios pueden volver a crear la empresa desde cero.
-- Los colaboradores de plataforma de esa empresa conservan su rol, sin empresa.
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

-- Gestión de colaboradores (solo el dueño).
create or replace function public.validar_permisos_plataforma(p_permisos text[])
returns text[] language plpgsql immutable set search_path=public as $$
begin
 if exists(select 1 from unnest(coalesce(p_permisos,'{}')) x where x not in ('acceso','suscripciones')) then raise exception 'Permiso inválido'; end if;
 return array(select distinct x from unnest(coalesce(p_permisos,'{}')) x order by 1);
end;
$$;
create or replace function public.plataforma_listar_colaboradores()
returns table(id uuid,email text,nombre text,empresa text,permisos text[],creado_en timestamptz)
language sql security definer stable set search_path=public as $$
 select p.id,u.email::text,p.nombre,e.nombre_comercial,p.permisos_plataforma,p.creado_en
 from public.perfiles p join auth.users u on u.id=p.id left join public.empresas e on e.id=p.empresa_id
 where public.soy_superadmin() and p.colaborador_plataforma and not p.es_superadmin
 order by p.creado_en;
$$;
-- Devuelve 'sin_cuenta' si el correo no tiene cuenta: la app envía entonces la invitación.
create or replace function public.plataforma_agregar_colaborador(p_email text,p_permisos text[])
returns text language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_perfil public.perfiles; v_permisos text[];
begin
 if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
 v_permisos:=public.validar_permisos_plataforma(p_permisos);
 select u.id into v_id from auth.users u where lower(u.email)=lower(trim(p_email));
 if v_id is null then return 'sin_cuenta'; end if;
 select * into v_perfil from public.perfiles where id=v_id for update;
 if found then
  if v_perfil.es_superadmin then raise exception 'Ese usuario ya es dueño de la plataforma'; end if;
  update public.perfiles set colaborador_plataforma=true,permisos_plataforma=v_permisos where id=v_id;
 else
  insert into public.perfiles(id,empresa_id,rol,colaborador_plataforma,permisos_plataforma) values(v_id,null,'miembro',true,v_permisos);
 end if;
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(null,auth.uid(),'colaborador',jsonb_build_object('cambio','agregar','usuario',v_id,'email',lower(trim(p_email)),'permisos',v_permisos));
 return 'agregado';
end;
$$;
create or replace function public.plataforma_permisos_colaborador(p_usuario uuid,p_permisos text[])
returns void language plpgsql security definer set search_path=public as $$
declare v_permisos text[];
begin
 if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
 v_permisos:=public.validar_permisos_plataforma(p_permisos);
 update public.perfiles set permisos_plataforma=v_permisos where id=p_usuario and colaborador_plataforma and not es_superadmin;
 if not found then raise exception 'Colaborador inexistente'; end if;
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(null,auth.uid(),'colaborador',jsonb_build_object('cambio','permisos','usuario',p_usuario,'permisos',v_permisos));
end;
$$;
create or replace function public.plataforma_quitar_colaborador(p_usuario uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_perfil public.perfiles;
begin
 if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
 select * into v_perfil from public.perfiles where id=p_usuario and colaborador_plataforma and not es_superadmin for update;
 if not found then raise exception 'Colaborador inexistente'; end if;
 -- Sin empresa no le queda nada: se borra el perfil y la cuenta podría crear su propia empresa.
 if v_perfil.empresa_id is null then delete from public.perfiles where id=p_usuario;
 else update public.perfiles set colaborador_plataforma=false,permisos_plataforma='{}' where id=p_usuario;
 end if;
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(null,auth.uid(),'colaborador',jsonb_build_object('cambio','quitar','usuario',p_usuario));
end;
$$;

revoke all on function public.soy_equipo_plataforma(),public.tengo_permiso_plataforma(text),public.validar_permisos_plataforma(text[]),
 public.plataforma_listar_colaboradores(),public.plataforma_agregar_colaborador(text,text[]),
 public.plataforma_permisos_colaborador(uuid,text[]),public.plataforma_quitar_colaborador(uuid) from public,anon;
grant execute on function public.soy_equipo_plataforma(),public.tengo_permiso_plataforma(text),public.validar_permisos_plataforma(text[]),
 public.plataforma_listar_colaboradores(),public.plataforma_agregar_colaborador(text,text[]),
 public.plataforma_permisos_colaborador(uuid,text[]),public.plataforma_quitar_colaborador(uuid) to authenticated;
commit;
