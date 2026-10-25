-- Gastos e ingresos en proyectos cerrados (facturas o pagos que llegan después del cierre).
-- Solo quien gestiona el proyecto (admin de la empresa o administrador del proyecto) los registra; el personal asignado no.
-- Requiere 202610240001_app_terreno.sql. Aplicar UNA VEZ.
begin;

create or replace function public.validar_gasto()
returns trigger language plpgsql security definer set search_path=public as $$
declare pr public.proyectos; gestiona boolean;
begin
 if tg_op='INSERT' then
  select * into strict pr from public.proyectos where id=new.proyecto_id;
  if pr.estado<>'activo' and not public.puede_gestionar_proyecto(new.proyecto_id) then
   raise exception 'El proyecto está cerrado: solo su administrador registra gastos';
  end if;
  if not public.asignado_a_proyecto(new.proyecto_id) then raise exception 'No estás asignado a este proyecto'; end if;
  new.empresa_id:=pr.empresa_id; new.estado:='pendiente'; new.registrado_por:=auth.uid();
  new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null; new.creado_en:=now();
  new.reembolsado_en:=null; new.reembolsado_por:=null;
  return new;
 end if;
 gestiona:=public.puede_gestionar_proyecto(old.proyecto_id);
 new.proyecto_id:=old.proyecto_id; new.empresa_id:=old.empresa_id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
 if new.estado is distinct from old.estado then
  if not gestiona then raise exception 'Solo el administrador del proyecto aprueba gastos'; end if;
  if new.estado='rechazado' and length(trim(coalesce(new.motivo_rechazo,'')))<3 then raise exception 'Indica el motivo del rechazo'; end if;
  if new.estado='pendiente' then new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null;
  else new.revisado_por:=auth.uid(); new.revisado_en:=now(); end if;
  if new.estado='aprobado' then new.motivo_rechazo:=null; end if;
 else
  if not gestiona and (old.registrado_por is distinct from auth.uid() or old.estado<>'pendiente') then
   raise exception 'Solo puedes modificar tus gastos pendientes';
  end if;
  new.revisado_por:=old.revisado_por; new.revisado_en:=old.revisado_en;
  if not gestiona then new.motivo_rechazo:=old.motivo_rechazo; end if;
 end if;
 -- Reembolso al trabajador: solo gastos pagados con dinero propio y aprobados.
 if new.reembolsado_en is distinct from old.reembolsado_en then
  if not gestiona then raise exception 'Solo el administrador del proyecto registra reembolsos'; end if;
  if new.reembolsado_en is not null and (new.origen_fondos<>'propio' or new.estado<>'aprobado') then
   raise exception 'Solo se reembolsan gastos aprobados pagados con dinero propio';
  end if;
  new.reembolsado_por:=case when new.reembolsado_en is null then null else auth.uid() end;
 else
  new.reembolsado_por:=old.reembolsado_por;
 end if;
 if new.estado<>'aprobado' or new.origen_fondos<>'propio' then new.reembolsado_en:=null; new.reembolsado_por:=null; end if;
 return new;
end;
$$;

create or replace function public.validar_ingreso()
returns trigger language plpgsql security definer set search_path=public as $$
declare pr public.proyectos; gestiona boolean;
begin
 if tg_op='INSERT' then
  select * into strict pr from public.proyectos where id=new.proyecto_id;
  if pr.estado<>'activo' and not public.puede_gestionar_proyecto(new.proyecto_id) then
   raise exception 'El proyecto está cerrado: solo su administrador registra ingresos';
  end if;
  if not public.asignado_a_proyecto(new.proyecto_id) then raise exception 'No estás asignado a este proyecto'; end if;
  new.empresa_id:=pr.empresa_id; new.estado:='pendiente'; new.registrado_por:=auth.uid();
  new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null; new.creado_en:=now();
  return new;
 end if;
 gestiona:=public.puede_gestionar_proyecto(old.proyecto_id);
 new.proyecto_id:=old.proyecto_id; new.empresa_id:=old.empresa_id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
 if new.estado is distinct from old.estado then
  if not gestiona then raise exception 'Solo el encargado del proyecto autoriza ingresos'; end if;
  if new.estado='rechazado' and length(trim(coalesce(new.motivo_rechazo,'')))<3 then raise exception 'Indica el motivo del rechazo'; end if;
  if new.estado='pendiente' then new.revisado_por:=null; new.revisado_en:=null; new.motivo_rechazo:=null;
  else new.revisado_por:=auth.uid(); new.revisado_en:=now(); end if;
  if new.estado='aprobado' then new.motivo_rechazo:=null; end if;
 else
  if not gestiona and (old.registrado_por is distinct from auth.uid() or old.estado<>'pendiente') then
   raise exception 'Solo puedes modificar tus ingresos pendientes';
  end if;
  new.revisado_por:=old.revisado_por; new.revisado_en:=old.revisado_en;
  if not gestiona then new.motivo_rechazo:=old.motivo_rechazo; end if;
 end if;
 return new;
end;
$$;
commit;
