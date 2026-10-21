-- Firmas registradas por empresa: [{id, nombre, cargo, firma_b64}], hasta 10.
-- Requiere 202610050001_plataforma.sql. Aplicar UNA VEZ.
-- Se insertan solas en los documentos (estados de pago, órdenes de compra) cuando el firmante
-- coincide por nombre. Solo el administrador de la empresa las modifica (política empresas_update_own).
begin;
alter table public.empresas add column if not exists firmas jsonb not null default '[]'::jsonb
 check(jsonb_typeof(firmas)='array' and jsonb_array_length(firmas)<=10 and octet_length(firmas::text)<=1500000);
grant update(firmas) on public.empresas to authenticated;
commit;
