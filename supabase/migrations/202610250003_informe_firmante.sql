-- Firma del informe de trabajo: nombre de la firma registrada (empresas.firmas) que se estampa en el PDF.
-- Requiere 202610240001_app_terreno.sql. Aplicar UNA VEZ.
begin;
alter table public.proyecto_informes add column firmante text check(length(firmante)<=120);
commit;
