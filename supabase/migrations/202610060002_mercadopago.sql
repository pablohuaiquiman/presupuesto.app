-- Pago de mensualidades con Mercado Pago (Checkout Pro). Requiere 202610050001_plataforma.sql. Aplicar UNA VEZ.
begin;
-- Los pagos acreditados por Mercado Pago no tienen un administrador que los registre.
alter table public.pagos_suscripcion alter column registrado_por drop not null;
alter table public.pagos_suscripcion add column origen text not null default 'manual' check(origen in ('manual','mercadopago'));
alter table public.plataforma_historial alter column actor drop not null;

create table public.cobros_mp (
 id uuid primary key default gen_random_uuid(),
 empresa_id uuid not null references public.empresas(id),
 periodo_inicio date not null,
 monto integer not null check(monto>0),
 preference_id text,
 estado text not null default 'creado' check(estado in ('creado','pendiente','aplicado','rechazado','revision')),
 mp_payment_id text unique,
 mp_status text,
 creado_por uuid references auth.users(id),
 creado_en timestamptz not null default now(),
 actualizado_en timestamptz not null default now()
);
create index on public.cobros_mp(empresa_id,creado_en desc);
alter table public.cobros_mp enable row level security;
revoke all on public.cobros_mp from anon,authenticated;
grant select on public.cobros_mp to authenticated;
create policy cobros_mp_lectura on public.cobros_mp for select to authenticated
 using(public.soy_superadmin() or public.soy_admin_empresa(empresa_id));

-- Acredita un pago aprobado confirmado con la API de Mercado Pago. Idempotente por payment_id.
-- Cubre el siguiente período pendiente; si el monto ya no coincide o la suscripción cambió, queda en revisión.
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
 if not found or s.cancelada or p_monto is distinct from c.monto or c.monto is distinct from s.monto_mensual then
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
revoke all on function public.mp_acreditar_pago(uuid,text,integer,date,text) from public,anon,authenticated;
grant execute on function public.mp_acreditar_pago(uuid,text,integer,date,text) to service_role;
commit;
