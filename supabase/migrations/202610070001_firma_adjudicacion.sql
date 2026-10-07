-- Firma remota de la adjudicación: permite publicar en ot_publicas el link de firma de un presupuesto
-- adjudicado (id guardado en data->>'firmaRemotaId'), además de las órdenes de trabajo. Requiere 202610050001_plataforma.sql. Aplicar UNA VEZ.
begin;
create or replace function public.validar_publicacion_ot()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and (to_jsonb(new)-array['estado','firma_b64','foto_b64','fecha_firma'])=
  (to_jsonb(old)-array['estado','firma_b64','foto_b64','fecha_firma']) then return new; end if;
 if auth.uid() is null or not public.empresa_puede_operar(public.mi_empresa_id()) then raise exception 'Sin acceso para publicar'; end if;
 if tg_op='UPDATE' and old.empresa_id is distinct from public.mi_empresa_id() then raise exception 'Orden de otra empresa'; end if;
 if not exists(select 1 from public.presupuestos p where p.empresa_id=public.mi_empresa_id()
  and (p.data->>'firmaRemotaId'=new.id
   or exists(select 1 from jsonb_array_elements(coalesce(p.data->'ordenesTrabajo','[]'::jsonb)) x where x->>'id'=new.id))) then
  raise exception 'Guarda el documento en tu empresa antes de publicarlo';
 end if;
 new.empresa_id:=public.mi_empresa_id();
 return new;
end;
$$;
commit;
