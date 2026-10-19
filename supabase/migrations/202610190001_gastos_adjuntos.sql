-- Varios respaldos por gasto (por ejemplo, un pago hecho en dos transferencias).
-- Requiere 202610060001_proyectos.sql. Aplicar UNA VEZ.
-- adjuntos guarda todas las rutas de Storage; adjunto_path se mantiene con el primero para compatibilidad.
-- Quien puede editar el gasto (trigger validar_gasto) puede agregar o quitar respaldos después de registrarlo.
begin;
alter table public.proyecto_gastos add column adjuntos text[] not null default '{}'
 check(cardinality(adjuntos)<=10);
update public.proyecto_gastos set adjuntos=array[adjunto_path] where adjunto_path is not null;
commit;
