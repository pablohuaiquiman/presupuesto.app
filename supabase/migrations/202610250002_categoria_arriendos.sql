-- Nueva categoría de gasto "arriendos" (equipos, andamios, maquinaria, contenedores...), antes dentro de "generales".
-- Requiere 202610060001_proyectos.sql y 202610070004_ordenes_compra.sql. Aplicar UNA VEZ.
begin;
alter table public.proyecto_gastos drop constraint proyecto_gastos_categoria_check;
alter table public.proyecto_gastos add constraint proyecto_gastos_categoria_check
 check(categoria in ('materiales','mano_obra','arriendos','generales'));
alter table public.ordenes_compra drop constraint ordenes_compra_categoria_check;
alter table public.ordenes_compra add constraint ordenes_compra_categoria_check
 check(categoria in ('materiales','mano_obra','arriendos','generales'));

-- Los gastos de arriendo ya registrados pasan a la nueva categoría. El trigger se apaga solo para esta
-- corrección de datos (sin sesión, validar_gasto rechazaría el cambio).
alter table public.proyecto_gastos disable trigger gastos_validar;
update public.proyecto_gastos set categoria='arriendos' where categoria='generales' and subcategoria ilike 'arriendo%';
alter table public.proyecto_gastos enable trigger gastos_validar;
commit;
