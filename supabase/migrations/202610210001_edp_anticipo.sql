-- Estado de pago de solicitud de anticipo: un % del subtotal neto del contrato.
-- Requiere 202610060001_proyectos.sql. Aplicar UNA VEZ.
-- Solo puede ser el primer estado de pago del proyecto; su neto pasa a ser el anticipo
-- (proyectos.config.anticipo_monto) que los estados de pago de avance amortizan.
begin;
alter table public.proyecto_edps drop constraint proyecto_edps_tipo_check;
alter table public.proyecto_edps add constraint proyecto_edps_tipo_check
 check(tipo in ('avance','devolucion_retencion','anticipo'));

create or replace function public.validar_edp_anticipo()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.proyecto_edps where proyecto_id=new.proyecto_id) then
  raise exception 'La solicitud de anticipo debe ser el primer estado de pago del proyecto';
 end if;
 return new;
end;
$$;
create trigger edps_anticipo before insert on public.proyecto_edps
 for each row when (new.tipo='anticipo') execute function public.validar_edp_anticipo();
revoke all on function public.validar_edp_anticipo() from public,anon,authenticated;
commit;
