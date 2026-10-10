-- Cuentas de cortesía, lectura del panel acotada a los permisos del colaborador e historial legible.
-- Requiere 202610070003_colaboradores.sql y 202610060002_mercadopago.sql. Aplicar UNA VEZ.
--
-- Qué corrige (revisión del 10-10-2026):
--  1. No existía la cuenta de cortesía: el precio debía ser mayor que cero y una suscripción sin pagos
--     quedaba sin acceso apenas vencía la gracia (o de inmediato si estaba cancelada). Una cuenta de regalo
--     solo se sostenía registrando pagos ficticios, que ensucian «Pagos recibidos este mes».
--  2. Un colaborador de plataforma con CUALQUIER permiso (incluso ninguno) leía todas las suscripciones,
--     los pagos, los cobros de Mercado Pago, los perfiles de todos los usuarios y el historial completo.
--  3. El historial se mostraba como JSON crudo y con el identificador del administrador en vez de su nombre.
begin;

-- ── 1. Cuenta de cortesía ───────────────────────────────────────────────────────────────────────
-- Sin cobro y sin vencimiento: opera mientras la empresa esté autorizada y la cortesía no se cancele.
alter table public.suscripciones add column cortesia boolean not null default false;
alter table public.suscripciones drop constraint suscripciones_monto_mensual_check;
alter table public.suscripciones add constraint suscripciones_monto_mensual_check
 check((not cortesia and monto_mensual>0) or (cortesia and monto_mensual=0));

create or replace function public.estado_servicio(p_empresa_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare e public.empresas; s public.suscripciones;
 hoy date:=(now() at time zone 'America/Santiago')::date; vence date; estado text; operativo boolean;
begin
 if auth.uid() is null or not coalesce(public.soy_equipo_plataforma() or p_empresa_id=public.mi_empresa_id(),false) then raise exception 'No autorizado'; end if;
 select * into strict e from public.empresas where id=p_empresa_id;
 select * into s from public.suscripciones where empresa_id=p_empresa_id;
 if not found then estado:='sin_configurar'; operativo:=e.acceso_transitorio;
 elsif s.cortesia then
  estado:=case when s.cancelada then 'cancelada' when hoy<s.inicio then 'programada' else 'cortesia' end;
  operativo:=hoy>=s.inicio and not s.cancelada;
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
   if s.cortesia then
    if hoy<s.inicio or s.cancelada then raise exception 'Suscripción sin acceso'; end if;
   else
    vence:=public.fecha_ciclo(s.inicio,s.periodos_pagados);
    if hoy<s.inicio or (hoy>=vence and (s.cancelada or hoy>=vence+s.dias_gracia)) then raise exception 'Suscripción sin acceso'; end if;
   end if;
  elsif not e.acceso_transitorio then raise exception 'La empresa requiere una suscripción';
  end if;
 end if;
 return new;
end;
$$;

-- Se reemplaza la firma de 6 parámetros por una de 7 con valor por defecto: las llamadas antiguas siguen funcionando.
drop function public.plataforma_configurar_suscripcion(uuid,text,integer,date,integer,boolean);
create function public.plataforma_configurar_suscripcion(
 p_empresa_id uuid,p_plan text,p_monto integer,p_inicio date,p_gracia integer,p_cancelada boolean,p_cortesia boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare anterior public.suscripciones; v_cortesia boolean:=coalesce(p_cortesia,false); v_monto integer;
begin
 if not public.tengo_permiso_plataforma('suscripciones') then raise exception 'No autorizado'; end if;
 perform 1 from public.empresas where id=p_empresa_id for update;
 if not found then raise exception 'Empresa inexistente'; end if;
 select * into anterior from public.suscripciones where empresa_id=p_empresa_id for update;
 if anterior.periodos_pagados>0 and p_inicio is distinct from anterior.inicio then raise exception 'El inicio no se cambia después de registrar pagos'; end if;
 if p_inicio is null or p_inicio<date '2020-01-01' or p_inicio>(now() at time zone 'America/Santiago')::date+366 then raise exception 'Fecha de inicio inválida'; end if;
 -- La cortesía no cobra: el precio queda en cero aunque llegue otro valor.
 v_monto:=case when v_cortesia then 0 else p_monto end;
 if not v_cortesia and (v_monto is null or v_monto<=0) then raise exception 'El precio mensual debe ser mayor que cero. Para no cobrar, marca la cuenta como cortesía'; end if;
 insert into public.suscripciones(empresa_id,plan_nombre,monto_mensual,inicio,dias_gracia,cancelada,cortesia)
 values(p_empresa_id,trim(p_plan),v_monto,p_inicio,p_gracia,p_cancelada,v_cortesia)
 on conflict(empresa_id) do update set plan_nombre=excluded.plan_nombre,monto_mensual=excluded.monto_mensual,
 inicio=excluded.inicio,dias_gracia=excluded.dias_gracia,cancelada=excluded.cancelada,cortesia=excluded.cortesia,actualizado_en=now();
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(p_empresa_id,auth.uid(),'suscripcion',jsonb_build_object('anterior',to_jsonb(anterior),'plan',trim(p_plan),'monto',v_monto,'inicio',p_inicio,'gracia',p_gracia,'cancelada',p_cancelada,'cortesia',v_cortesia));
end;
$$;
revoke all on function public.plataforma_configurar_suscripcion(uuid,text,integer,date,integer,boolean,boolean) from public,anon;
grant execute on function public.plataforma_configurar_suscripcion(uuid,text,integer,date,integer,boolean,boolean) to authenticated;

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
 if s.cortesia then raise exception 'Una cuenta de cortesía no registra pagos. Quita la cortesía para cobrar'; end if;
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

-- ── 2. Lectura del panel según los permisos del colaborador ─────────────────────────────────────
-- Todo el equipo sigue viendo la lista de empresas. Lo demás depende del permiso:
--   'suscripciones' → suscripciones, pagos y cobros de Mercado Pago
--   'acceso'        → perfiles de los usuarios de las empresas
-- El dueño (es_superadmin) ve todo, porque tengo_permiso_plataforma devuelve true para él.
drop policy suscripciones_lectura on public.suscripciones;
create policy suscripciones_lectura on public.suscripciones for select to authenticated
 using(public.tengo_permiso_plataforma('suscripciones') or public.soy_admin_empresa(empresa_id));
drop policy pagos_lectura on public.pagos_suscripcion;
create policy pagos_lectura on public.pagos_suscripcion for select to authenticated
 using(public.tengo_permiso_plataforma('suscripciones') or public.soy_admin_empresa(empresa_id));
drop policy cobros_mp_lectura on public.cobros_mp;
create policy cobros_mp_lectura on public.cobros_mp for select to authenticated
 using(public.tengo_permiso_plataforma('suscripciones') or public.soy_admin_empresa(empresa_id));
drop policy perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select
 using(id=auth.uid() or empresa_id=public.mi_empresa_id() or public.tengo_permiso_plataforma('acceso'));

-- La lista de empresas muestra «usuarios / cupo»: el conteo no revela quiénes son.
create or replace function public.plataforma_usuarios_por_empresa()
returns table(empresa_id uuid,usuarios integer)
language sql security definer stable set search_path=public as $$
 select p.empresa_id,count(*)::integer from public.perfiles p
 where public.soy_equipo_plataforma() and p.empresa_id is not null group by p.empresa_id;
$$;

-- Historial: cada persona del equipo ve solo los movimientos de lo que puede gestionar.
-- Colaboradores y eliminaciones de empresas quedan solo para el dueño.
create or replace function public.puede_ver_movimiento(p_accion text)
returns boolean language sql security definer stable set search_path=public as $$
 select public.soy_superadmin()
  or (p_accion in ('acceso','cupo') and public.tengo_permiso_plataforma('acceso'))
  or (p_accion in ('suscripcion','pago','pago_revision') and public.tengo_permiso_plataforma('suscripciones'));
$$;
drop policy historial_lectura on public.plataforma_historial;
create policy historial_lectura on public.plataforma_historial for select to authenticated
 using(public.puede_ver_movimiento(accion));

-- ── 3. Historial con el nombre de quien hizo el cambio ─────────────────────────────────────────
-- Devuelve los mismos movimientos que la persona puede ver, con el nombre (o el correo) del actor.
create or replace function public.plataforma_historial_legible(p_empresa_id uuid,p_limite integer default 50)
returns table(id bigint,accion text,detalle jsonb,creado_en timestamptz,actor_nombre text)
language sql security definer stable set search_path=public as $$
 select h.id,h.accion,h.detalle,h.creado_en,
  case when h.actor is null then null else coalesce(nullif(trim(p.nombre),''),u.email::text,'Cuenta eliminada') end
 from public.plataforma_historial h
 left join public.perfiles p on p.id=h.actor
 left join auth.users u on u.id=h.actor
 where h.empresa_id=p_empresa_id and public.puede_ver_movimiento(h.accion)
 order by h.creado_en desc,h.id desc
 limit least(greatest(coalesce(p_limite,50),1),200);
$$;

-- Mercado Pago: una cuenta de cortesía no tiene nada que cobrar; si llegara un pago, queda en revisión.
create or replace function public.mp_acreditar_pago(p_cobro_id uuid,p_payment_id text,p_monto integer,p_fecha_pago date,p_status text)
returns text language plpgsql security definer set search_path=public as $$
declare c public.cobros_mp; s public.suscripciones; desde date; hasta date;
begin
 select * into strict c from public.cobros_mp where id=p_cobro_id for update;
 if c.estado='aplicado' then return 'aplicado'; end if;
 if exists(select 1 from public.cobros_mp where mp_payment_id=p_payment_id and id<>c.id) then return 'duplicado'; end if;
 update public.cobros_mp set mp_payment_id=p_payment_id,mp_status=p_status,actualizado_en=now() where id=c.id;
 if p_status in ('pending','in_process','authorized') then
  update public.cobros_mp set estado='pendiente' where id=c.id; return 'pendiente';
 end if;
 if p_status<>'approved' then
  update public.cobros_mp set estado='rechazado' where id=c.id; return 'rechazado';
 end if;
 perform 1 from public.empresas where id=c.empresa_id for update;
 select * into s from public.suscripciones where empresa_id=c.empresa_id for update;
 if not found or s.cancelada or s.cortesia or p_monto is distinct from c.monto or c.monto is distinct from s.monto_mensual then
  update public.cobros_mp set estado='revision' where id=c.id;
  insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
  values(c.empresa_id,null,'pago_revision',jsonb_build_object('origen','mercadopago','payment_id',p_payment_id,'monto',p_monto,'motivo','El pago no coincide con la suscripción vigente; revisar y registrar manualmente'));
  return 'revision';
 end if;
 desde:=public.fecha_ciclo(s.inicio,s.periodos_pagados); hasta:=public.fecha_ciclo(s.inicio,s.periodos_pagados+1);
 insert into public.pagos_suscripcion(id,empresa_id,periodo_inicio,periodo_fin,monto,referencia,fecha_pago,registrado_por,origen)
 values(gen_random_uuid(),c.empresa_id,desde,hasta,p_monto,'mp-'||p_payment_id,coalesce(p_fecha_pago,(now() at time zone 'America/Santiago')::date),null,'mercadopago');
 update public.suscripciones set periodos_pagados=periodos_pagados+1,actualizado_en=now() where empresa_id=c.empresa_id;
 update public.cobros_mp set estado='aplicado' where id=c.id;
 insert into public.plataforma_historial(empresa_id,actor,accion,detalle)
 values(c.empresa_id,null,'pago',jsonb_build_object('origen','mercadopago','payment_id',p_payment_id,'desde',desde,'hasta',hasta,'monto',p_monto));
 return 'aplicado';
end;
$$;

revoke all on function public.plataforma_usuarios_por_empresa(),public.puede_ver_movimiento(text),public.plataforma_historial_legible(uuid,integer) from public,anon;
grant execute on function public.plataforma_usuarios_por_empresa(),public.puede_ver_movimiento(text),public.plataforma_historial_legible(uuid,integer) to authenticated;
commit;
