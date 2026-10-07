-- Endurecimiento posterior a la auditoría del 06-10-2026. Ejecutar completo y una sola vez, con respaldo previo.
-- No cambia datos existentes: solo permisos y validaciones de funciones.
begin;

-- 1) Alta de empresa: solo usuarios con sesión.
--    PostgreSQL deja ejecutar a "public" cualquier función nueva; el grant a "authenticated" no quita ese permiso.
--    Hoy una llamada anónima falla solo porque perfiles.id no admite nulos. Se cierra explícitamente.
create or replace function public.crear_empresa_y_admin(p_nombre_comercial text, p_nombre_usuario text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if length(trim(coalesce(p_nombre_comercial, ''))) not between 2 and 120 then raise exception 'Indica el nombre de la empresa (2 a 120 caracteres)'; end if;
  if length(coalesce(p_nombre_usuario, '')) > 120 then raise exception 'El nombre es demasiado largo'; end if;
  if exists (select 1 from public.perfiles where id = auth.uid()) then
    raise exception 'Este usuario ya tiene una empresa asociada';
  end if;
  insert into public.empresas (nombre_comercial, limite_usuarios, aprobada)
    values (trim(p_nombre_comercial), 1, false)
    returning id into v_empresa_id;
  insert into public.perfiles (id, empresa_id, rol, es_superadmin, nombre)
    values (auth.uid(), v_empresa_id, 'admin', false, nullif(trim(coalesce(p_nombre_usuario, '')), ''));
  return v_empresa_id;
end;
$$;
revoke all on function public.crear_empresa_y_admin(text, text) from public, anon;
grant execute on function public.crear_empresa_y_admin(text, text) to authenticated;

-- 2) Funciones auxiliares de sesión: no tienen por qué responderle a un visitante sin sesión.
revoke all on function public.mi_empresa_id() from public, anon;
revoke all on function public.soy_superadmin() from public, anon;
grant execute on function public.mi_empresa_id() to authenticated;
grant execute on function public.soy_superadmin() to authenticated;

-- 3) Firma pública de una orden: se acepta solo una imagen, con tamaño acotado, y con un id plausible.
--    (La firma es PNG del lienzo; la foto, JPEG comprimido. Los límites dejan margen amplio para ambos.)
create or replace function public.firmar_ot_publica(p_id text, p_firma_b64 text, p_foto_b64 text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_id is null or length(p_id) not between 8 and 80 then raise exception 'Enlace no válido'; end if;
  if p_firma_b64 is null or left(p_firma_b64, 22) <> 'data:image/png;base64,' or length(p_firma_b64) > 1500000 then
    raise exception 'Firma no válida';
  end if;
  if p_foto_b64 is not null and (left(p_foto_b64, 11) <> 'data:image/' or length(p_foto_b64) > 6000000) then
    raise exception 'Foto no válida';
  end if;
  update public.ot_publicas
  set estado = 'firmada', firma_b64 = p_firma_b64, foto_b64 = p_foto_b64, fecha_firma = now()
  where id = p_id and estado = 'pendiente';
end;
$$;
revoke all on function public.firmar_ot_publica(text, text, text) from public;
grant execute on function public.firmar_ot_publica(text, text, text) to anon, authenticated;

-- 4) Consulta pública de una orden: mismo control del id (evita barridos con valores vacíos o absurdos).
create or replace function public.obtener_ot_publica(p_id text)
returns setof public.ot_publicas
language sql security definer set search_path = public as $$
  select * from public.ot_publicas where p_id is not null and length(p_id) between 8 and 80 and id = p_id;
$$;
revoke all on function public.obtener_ot_publica(text) from public;
grant execute on function public.obtener_ot_publica(text) to anon, authenticated;

commit;
