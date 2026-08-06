-- ═══════════════════════════════════════════════════════════
-- Presupuestos — esquema completo (multiempresa)
-- Ejecutar TODO este archivo una sola vez en:
-- Supabase → tu proyecto → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────
-- 1) Órdenes de trabajo con firma remota (público, sin login)
-- ───────────────────────────────────────────────────────────
create table if not exists public.ot_publicas (
  id                  text primary key,
  numero              text not null,
  presupuesto_numero  text not null,
  empresa_nombre      text,
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

alter table public.ot_publicas add column if not exists empresa_nombre text;

alter table public.ot_publicas enable row level security;

-- Importante: NO se crean policies de select/insert/update directas sobre la tabla.
-- Con RLS activado y sin policies, nadie puede leer/escribir la tabla usando la
-- anon key directamente. Todo el acceso pasa por las 3 funciones de abajo
-- (security definer), cada una acotada a una sola fila por id — así alguien con
-- la anon key (que queda visible en el código público de la app) no puede listar
-- ni curiosear las demás cotizaciones/firmas de otros clientes.

create or replace function public.publicar_ot(
  p_id text, p_numero text, p_presupuesto_numero text, p_empresa_nombre text,
  p_cliente_nombre text, p_cliente_direccion text, p_cliente_comuna text, p_cliente_region text,
  p_condicion text, p_capitulos jsonb,
  p_costo_directo numeric, p_gg numeric, p_util numeric, p_gg_pct numeric, p_util_pct numeric,
  p_usar_gg_util boolean, p_subtotal numeric, p_iva numeric, p_total numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ot_publicas (
    id, numero, presupuesto_numero, empresa_nombre, cliente_nombre, cliente_direccion, cliente_comuna, cliente_region,
    condicion, capitulos, costo_directo, gg, util, gg_pct, util_pct, usar_gg_util, subtotal, iva, total
  ) values (
    p_id, p_numero, p_presupuesto_numero, p_empresa_nombre, p_cliente_nombre, p_cliente_direccion, p_cliente_comuna, p_cliente_region,
    p_condicion, p_capitulos, p_costo_directo, p_gg, p_util, p_gg_pct, p_util_pct, p_usar_gg_util, p_subtotal, p_iva, p_total
  )
  on conflict (id) do update set
    numero = excluded.numero, presupuesto_numero = excluded.presupuesto_numero, empresa_nombre = excluded.empresa_nombre,
    cliente_nombre = excluded.cliente_nombre, cliente_direccion = excluded.cliente_direccion,
    cliente_comuna = excluded.cliente_comuna, cliente_region = excluded.cliente_region,
    condicion = excluded.condicion, capitulos = excluded.capitulos,
    costo_directo = excluded.costo_directo, gg = excluded.gg, util = excluded.util,
    gg_pct = excluded.gg_pct, util_pct = excluded.util_pct, usar_gg_util = excluded.usar_gg_util,
    subtotal = excluded.subtotal, iva = excluded.iva, total = excluded.total
  where public.ot_publicas.estado = 'pendiente';
end;
$$;

create or replace function public.obtener_ot_publica(p_id text)
returns setof public.ot_publicas
language sql security definer set search_path = public as $$
  select * from public.ot_publicas where id = p_id;
$$;

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

-- ───────────────────────────────────────────────────────────
-- 2) Empresas y perfiles (multiempresa, con aprobación manual)
-- ───────────────────────────────────────────────────────────
create table if not exists public.empresas (
  id                 uuid primary key default gen_random_uuid(),
  nombre_comercial   text not null,
  razon_social       text,
  rut                text,
  direccion          text,
  telefono           text,
  email_contacto     text,
  firma_b64          text,
  responsable_nombre text,
  responsable_cargo  text,
  limite_usuarios    int not null default 1,
  aprobada           boolean not null default false,
  creado_en          timestamptz not null default now()
);

create table if not exists public.perfiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  rol            text not null default 'admin' check (rol in ('admin','miembro')),
  es_superadmin  boolean not null default false,
  nombre         text,
  creado_en      timestamptz not null default now()
);

-- Funciones auxiliares (security definer) para evitar recursión en las policies.
create or replace function public.mi_empresa_id()
returns uuid language sql security definer stable set search_path = public as $$
  select empresa_id from public.perfiles where id = auth.uid();
$$;

create or replace function public.soy_superadmin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select es_superadmin from public.perfiles where id = auth.uid()), false);
$$;

alter table public.empresas enable row level security;
alter table public.perfiles enable row level security;

create policy "empresas_select" on public.empresas for select
  using (id = public.mi_empresa_id() or public.soy_superadmin());
create policy "empresas_update_own" on public.empresas for update
  using (id = public.mi_empresa_id() or public.soy_superadmin());

create policy "perfiles_select" on public.perfiles for select
  using (id = auth.uid() or empresa_id = public.mi_empresa_id() or public.soy_superadmin());
create policy "perfiles_update_own" on public.perfiles for update
  using (id = auth.uid());

grant select on public.empresas to authenticated;
-- Los datos de negocio los edita el propio admin; el límite de cupos y la
-- aprobación SOLO se cambian a través de las funciones de más abajo
-- (para que ningún cliente pueda auto-aprobarse ni subirse el cupo solo).
grant update (nombre_comercial, razon_social, rut, direccion, telefono, email_contacto, firma_b64, responsable_nombre, responsable_cargo)
  on public.empresas to authenticated;

grant select on public.perfiles to authenticated;
grant update (nombre) on public.perfiles to authenticated;

-- Alta de una empresa nueva (auto-registro). Queda "no aprobada" hasta que
-- tú la revises. No se puede llamar dos veces con el mismo usuario.
create or replace function public.crear_empresa_y_admin(p_nombre_comercial text, p_nombre_usuario text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa_id uuid;
begin
  if exists (select 1 from public.perfiles where id = auth.uid()) then
    raise exception 'Este usuario ya tiene una empresa asociada';
  end if;
  insert into public.empresas (nombre_comercial, limite_usuarios, aprobada)
    values (p_nombre_comercial, 1, false)
    returning id into v_empresa_id;
  insert into public.perfiles (id, empresa_id, rol, es_superadmin, nombre)
    values (auth.uid(), v_empresa_id, 'admin', false, p_nombre_usuario);
  return v_empresa_id;
end;
$$;
grant execute on function public.crear_empresa_y_admin to authenticated;

-- Aprobar / rechazar una empresa. Solo tú (superadmin) puedes ejecutarla.
create or replace function public.aprobar_empresa(p_empresa_id uuid, p_aprobada boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
  update public.empresas set aprobada = p_aprobada where id = p_empresa_id;
end;
$$;
grant execute on function public.aprobar_empresa to authenticated;

-- Subir el cupo de usuarios de una empresa (cuando te pagan por más cupos).
create or replace function public.set_limite_usuarios(p_empresa_id uuid, p_limite int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.soy_superadmin() then raise exception 'No autorizado'; end if;
  update public.empresas set limite_usuarios = p_limite where id = p_empresa_id;
end;
$$;
grant execute on function public.set_limite_usuarios to authenticated;

-- ───────────────────────────────────────────────────────────
-- 3) Presupuestos — uno por empresa, visibles para todo su equipo
-- ───────────────────────────────────────────────────────────
create table if not exists public.presupuestos (
  id          text primary key,
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.presupuestos enable row level security;

-- Solo se ve/edita si la fila es de tu empresa Y tu empresa está aprobada.
create policy "presupuestos_select" on public.presupuestos for select
  using (empresa_id = public.mi_empresa_id()
    and exists (select 1 from public.empresas e where e.id = empresa_id and e.aprobada = true));
create policy "presupuestos_insert" on public.presupuestos for insert
  with check (empresa_id = public.mi_empresa_id()
    and exists (select 1 from public.empresas e where e.id = empresa_id and e.aprobada = true));
create policy "presupuestos_update" on public.presupuestos for update
  using (empresa_id = public.mi_empresa_id()
    and exists (select 1 from public.empresas e where e.id = empresa_id and e.aprobada = true));
create policy "presupuestos_delete" on public.presupuestos for delete
  using (empresa_id = public.mi_empresa_id()
    and exists (select 1 from public.empresas e where e.id = empresa_id and e.aprobada = true));

grant select, insert, update, delete on public.presupuestos to authenticated;

-- ═══════════════════════════════════════════════════════════
-- PASO 2 — ejecutar DESPUÉS de todo lo anterior:
--
-- 1. Abre la app y crea tu cuenta normalmente (botón "Crear cuenta"),
--    con el nombre de tu empresa, tu correo y una contraseña.
--    Quedará "pendiente de aprobación" — es esperado.
-- 2. Reemplaza 'tu-correo@ejemplo.com' por el correo que usaste,
--    en las 5 líneas de abajo, y ejecuta este bloque completo.
--    Esto te aprueba, te hace superadmin (para aprobar futuros
--    clientes) y recupera los 4 presupuestos reconstruidos desde tus PDF.
-- ═══════════════════════════════════════════════════════════

update public.perfiles set es_superadmin = true
  where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');

update public.empresas set aprobada = true
  where id = (select empresa_id from public.perfiles p join auth.users u on u.id = p.id
              where u.email = 'tu-correo@ejemplo.com');

insert into public.presupuestos (id, empresa_id, data, updated_at)
select 'restore-pre100-extruder',
  (select empresa_id from public.perfiles p join auth.users u on u.id = p.id where u.email = 'tu-correo@ejemplo.com'),
  '{
  "id": "restore-pre100-extruder", "numero": "PRE-100", "fecha": "2026-07-10",
  "validez": 30, "condicion": "Contado",
  "cliente": { "nombre": "EXTRUDER S.A.", "rut": "96.888.220-1", "telefono": "939180349",
    "direccion": "6 Poniente, Parcela 157-159", "region": "Región Metropolitana de Santiago", "comuna": "Paine" },
  "ggPct": 15, "utilPct": 10, "usarGGUtil": false,
  "capitulos": [{ "id": "restore-cap-1", "numero": "1.0", "nombre": "", "items": [
    { "id": "restore-item-1", "numero": "1.1", "codigo": "serv.const",
      "descripcion": "instalación de cerradura inteligente A1HNEGRA",
      "unidad": "un", "cantidad": 1, "precioUnit": 210084, "total": 210084 }
  ]}],
  "costoDirecto": 210084, "gg": 0, "util": 0, "subtotal": 210084, "iva": 39915.96, "total": 249999.96,
  "notas": "SERVICIO DE SUMINISTRO E INSTALACIÓN DE CERRADURA EN PUERTA DE ACCESO EXTRUDER",
  "estado": "adjudicado", "fechaAdjudicacion": "2026-07-14", "firma": null, "edps": [],
  "ordenesTrabajo": [{ "id": "restore-ot-100-01", "numero": "OT-100-01", "fecha": "2026-07-14",
    "estado": "firmada", "firma": null, "remota": false }]
  }'::jsonb, now()
union all
select 'restore-pre101-extruder',
  (select empresa_id from public.perfiles p join auth.users u on u.id = p.id where u.email = 'tu-correo@ejemplo.com'),
  '{
  "id": "restore-pre101-extruder", "numero": "PRE-101", "fecha": "2026-07-10",
  "validez": 30, "condicion": "Contado",
  "cliente": { "nombre": "EXTRUDER S.A.", "rut": "96.888.220-1", "telefono": "939180349",
    "direccion": "6 Poniente, Parcela 157-159", "region": "Región Metropolitana de Santiago", "comuna": "Paine" },
  "ggPct": 15, "utilPct": 10, "usarGGUtil": false,
  "capitulos": [{ "id": "restore-cap-2", "numero": "1.0", "nombre": "", "items": [
    { "id": "restore-item-2", "numero": "1.1", "codigo": "ser.const.",
      "descripcion": "ajuste y reparación de puerta de acceso",
      "unidad": "gl", "cantidad": 1, "precioUnit": 113445, "total": 113445 }
  ]}],
  "costoDirecto": 113445, "gg": 0, "util": 0, "subtotal": 113445, "iva": 21554.55, "total": 134999.55,
  "notas": "la reparación considera materiales y mano de obra no considero terminación final.",
  "estado": "adjudicado", "fechaAdjudicacion": "2026-07-14", "firma": null, "edps": [],
  "ordenesTrabajo": [{ "id": "restore-ot-101-01", "numero": "OT-101-01", "fecha": "2026-07-14",
    "estado": "firmada", "firma": null, "remota": false }]
  }'::jsonb, now()
union all
select 'restore-pre100-oscar',
  (select empresa_id from public.perfiles p join auth.users u on u.id = p.id where u.email = 'tu-correo@ejemplo.com'),
  '{
  "id": "restore-pre100-oscar", "numero": "PRE-100", "fecha": "2026-08-04",
  "validez": 30, "condicion": "Contado",
  "cliente": { "nombre": "oscar alexis godoy caceres", "rut": "12.144.527-1", "telefono": "+56992778712",
    "direccion": "Adelino Mendez Arias 48", "region": "Región Metropolitana de Santiago", "comuna": "Buin" },
  "ggPct": 15, "utilPct": 10, "usarGGUtil": true,
  "capitulos": [{ "id": "restore-cap-3", "numero": "1.0", "nombre": "", "items": [
    { "id": "restore-item-3", "numero": "1.1", "codigo": "", "descripcion": "Desmontar e instalar puerta de madera con marco acceso1 a quincho", "unidad": "un", "cantidad": 1, "precioUnit": 140000, "total": 140000 },
    { "id": "restore-item-4", "numero": "1.2", "codigo": "", "descripcion": "Instalación de alero exterior (mismo ancho de la puerta)", "unidad": "un", "cantidad": 1, "precioUnit": 200000, "total": 200000 },
    { "id": "restore-item-5", "numero": "1.3", "codigo": "", "descripcion": "Pintura cielo exterior (empaste recorrido y 2 manos de pintura blanca)", "unidad": "m²", "cantidad": 1, "precioUnit": 180000, "total": 180000 },
    { "id": "restore-item-6", "numero": "1.4", "codigo": "", "descripcion": "Puerta de acceso a terraza (cepillado, sellado perimetral y cambio de enchape de una cara)", "unidad": "un", "cantidad": 1, "precioUnit": 120000, "total": 120000 },
    { "id": "restore-item-7", "numero": "1.5", "codigo": "", "descripcion": "Instalación de campana de 3 metros de ancho por 60 cm para quincho", "unidad": "gl", "cantidad": 1, "precioUnit": 590000, "total": 590000 },
    { "id": "restore-item-8", "numero": "1.6", "codigo": "", "descripcion": "Mejoramiento de quincho e instalación de revestimiento (cerámica o granito sobre base de hormigón)", "unidad": "gl", "cantidad": 1, "precioUnit": 1800000, "total": 1800000 },
    { "id": "restore-item-9", "numero": "1.7", "codigo": "", "descripcion": "Baño de quincho: Accesorios, grifería y cuadre de ventana de 50x50 cm de aluminio", "unidad": "gl", "cantidad": 1, "precioUnit": 80000, "total": 80000 },
    { "id": "restore-item-10", "numero": "1.8", "codigo": "", "descripcion": "Radier exterior (Pulido para pendiente u picado y reparación + 10 focos de piso) (Cliente pone porcelanato y Bekron):", "unidad": "m²", "cantidad": 1, "precioUnit": 450000, "total": 450000 },
    { "id": "restore-item-11", "numero": "1.9", "codigo": "", "descripcion": "Impermeabilización de cascada de mármol (60 x 30 x 30 cm) por filtración", "unidad": "un", "cantidad": 1, "precioUnit": 80000, "total": 80000 }
  ]}],
  "costoDirecto": 3640000, "gg": 546000, "util": 364000, "subtotal": 4550000, "iva": 864500, "total": 5414500,
  "notas": "", "estado": "enviado", "firma": null, "edps": [], "ordenesTrabajo": []
  }'::jsonb, now()
union all
select 'restore-pre101-oscar',
  (select empresa_id from public.perfiles p join auth.users u on u.id = p.id where u.email = 'tu-correo@ejemplo.com'),
  '{
  "id": "restore-pre101-oscar", "numero": "PRE-101", "fecha": "2026-08-04",
  "validez": 30, "condicion": "Contado",
  "cliente": { "nombre": "oscar alexis godoy caceres", "rut": "12.144.527-1", "telefono": "+56992778712",
    "direccion": "Adelino Mendez Arias 48", "region": "Región Metropolitana de Santiago", "comuna": "Buin" },
  "ggPct": 15, "utilPct": 10, "usarGGUtil": true,
  "capitulos": [{ "id": "restore-cap-4", "numero": "1.0", "nombre": "", "items": [
    { "id": "restore-item-12", "numero": "1.1", "codigo": "", "descripcion": "pintura dormitorio principal cielo", "unidad": "m²", "cantidad": 22.08, "precioUnit": 8000, "total": 176640 },
    { "id": "restore-item-13", "numero": "1.2", "codigo": "", "descripcion": "pintura living comedor cielo", "unidad": "m²", "cantidad": 19.42, "precioUnit": 8000, "total": 155360 }
  ]}],
  "costoDirecto": 332000, "gg": 49800, "util": 33200, "subtotal": 415000, "iva": 78850, "total": 493850,
  "notas": "", "estado": "enviado", "firma": null, "edps": [], "ordenesTrabajo": []
  }'::jsonb, now()
on conflict (id) do nothing;
