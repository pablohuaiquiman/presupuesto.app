-- ═══════════════════════════════════════════════════════════
-- Presupuestos PHH — Firma remota de Órdenes de Trabajo
-- Ejecutar una sola vez en: Supabase → tu proyecto → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════

create table if not exists public.ot_publicas (
  id                  text primary key,
  numero              text not null,
  presupuesto_numero  text not null,
  cliente_nombre      text not null,
  cliente_direccion   text,
  cliente_comuna      text,
  cliente_region      text,
  condicion           text,
  capitulos           jsonb not null default '[]',
  costo_directo       numeric not null default 0,
  gg                  numeric not null default 0,
  util                numeric not null default 0,
  gg_pct              numeric not null default 0,
  util_pct            numeric not null default 0,
  usar_gg_util        boolean not null default true,
  subtotal            numeric not null default 0,
  iva                 numeric not null default 0,
  total               numeric not null default 0,
  estado              text not null default 'pendiente', -- 'pendiente' | 'firmada'
  firma_b64           text,
  foto_b64            text,
  fecha_firma         timestamptz,
  creado_en           timestamptz not null default now()
);

alter table public.ot_publicas enable row level security;

-- Importante: NO se crean policies de select/insert/update directas sobre la tabla.
-- Con RLS activado y sin policies, nadie puede leer/escribir la tabla usando la
-- anon key directamente. Todo el acceso pasa por las 3 funciones de abajo
-- (security definer), cada una acotada a una sola fila por id — así alguien con
-- la anon key (que queda visible en el código público de la app) no puede listar
-- ni curiosear las demás cotizaciones/firmas de otros clientes.

-- 1) La app del dueño publica/actualiza una OT para poder compartir el link.
--    No pisa una OT que ya fue firmada por el cliente.
create or replace function public.publicar_ot(
  p_id text, p_numero text, p_presupuesto_numero text,
  p_cliente_nombre text, p_cliente_direccion text, p_cliente_comuna text, p_cliente_region text,
  p_condicion text, p_capitulos jsonb,
  p_costo_directo numeric, p_gg numeric, p_util numeric, p_gg_pct numeric, p_util_pct numeric,
  p_usar_gg_util boolean, p_subtotal numeric, p_iva numeric, p_total numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ot_publicas (
    id, numero, presupuesto_numero, cliente_nombre, cliente_direccion, cliente_comuna, cliente_region,
    condicion, capitulos, costo_directo, gg, util, gg_pct, util_pct, usar_gg_util, subtotal, iva, total
  ) values (
    p_id, p_numero, p_presupuesto_numero, p_cliente_nombre, p_cliente_direccion, p_cliente_comuna, p_cliente_region,
    p_condicion, p_capitulos, p_costo_directo, p_gg, p_util, p_gg_pct, p_util_pct, p_usar_gg_util, p_subtotal, p_iva, p_total
  )
  on conflict (id) do update set
    numero = excluded.numero, presupuesto_numero = excluded.presupuesto_numero,
    cliente_nombre = excluded.cliente_nombre, cliente_direccion = excluded.cliente_direccion,
    cliente_comuna = excluded.cliente_comuna, cliente_region = excluded.cliente_region,
    condicion = excluded.condicion, capitulos = excluded.capitulos,
    costo_directo = excluded.costo_directo, gg = excluded.gg, util = excluded.util,
    gg_pct = excluded.gg_pct, util_pct = excluded.util_pct, usar_gg_util = excluded.usar_gg_util,
    subtotal = excluded.subtotal, iva = excluded.iva, total = excluded.total
  where public.ot_publicas.estado = 'pendiente';
end;
$$;

-- 2) El cliente (o el dueño) consulta una OT puntual por su id exacto.
create or replace function public.obtener_ot_publica(p_id text)
returns setof public.ot_publicas
language sql security definer set search_path = public as $$
  select * from public.ot_publicas where id = p_id;
$$;

-- 3) El cliente firma: solo puede pasar de 'pendiente' a 'firmada', nunca al revés.
create or replace function public.firmar_ot_publica(p_id text, p_firma_b64 text, p_foto_b64 text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.ot_publicas
  set estado = 'firmada', firma_b64 = p_firma_b64, foto_b64 = p_foto_b64, fecha_firma = now()
  where id = p_id and estado = 'pendiente';
end;
$$;

grant usage on schema public to anon;
grant execute on function public.publicar_ot to anon;
grant execute on function public.obtener_ot_publica to anon;
grant execute on function public.firmar_ot_publica to anon;
revoke all on public.ot_publicas from anon, authenticated;
