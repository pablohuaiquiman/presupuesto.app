-- Datos para transferencia de la empresa (banco, tipo y número de cuenta, titular, RUT, correo).
-- Se imprimen en los estados de pago. Solo el administrador de la empresa los modifica (política empresas_update_own).
-- Aplicar UNA VEZ.
begin;
alter table public.empresas add column if not exists datos_bancarios jsonb not null default '{}'::jsonb
  check (jsonb_typeof(datos_bancarios) = 'object' and length(datos_bancarios::text) <= 2000);
grant update(datos_bancarios) on public.empresas to authenticated;
commit;
