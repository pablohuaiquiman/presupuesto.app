// Edge Function: invitar-usuario
// El admin de una empresa invita a un colega (hasta su límite de cupos).
// Usa la service_role key (secreto del servidor, nunca expuesto al navegador)
// para crear el usuario invitado y su perfil — esto no se puede hacer con la
// llave anon pública por seguridad.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { email, nombre } = await req.json();
    if (!email) return json({ error: 'Falta el correo del invitado' }, 400);

    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Cliente "como quien llama", solo para saber quién es.
    const supaCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supaCaller.auth.getUser();
    if (userErr || !user) return json({ error: 'No autenticado' }, 401);

    // Cliente con permisos completos, para validar y ejecutar la invitación.
    const supaAdmin = createClient(supabaseUrl, serviceKey);

    const { data: perfil } = await supaAdmin
      .from('perfiles').select('empresa_id, rol').eq('id', user.id).single();
    if (!perfil) return json({ error: 'No se encontró tu perfil' }, 404);
    if (perfil.rol !== 'admin') return json({ error: 'Solo el administrador de tu empresa puede invitar usuarios' }, 403);

    const { data: empresa } = await supaAdmin
      .from('empresas').select('limite_usuarios, aprobada').eq('id', perfil.empresa_id).single();
    if (!empresa?.aprobada) return json({ error: 'Tu empresa aún no está aprobada' }, 403);

    const { count } = await supaAdmin
      .from('perfiles').select('id', { count: 'exact', head: true }).eq('empresa_id', perfil.empresa_id);
    if ((count ?? 0) >= empresa.limite_usuarios) {
      return json({ error: `Ya usaste los ${empresa.limite_usuarios} cupo(s) de tu plan. Contacta al administrador del sistema para ampliarlo.` }, 403);
    }

    const { data: invited, error: inviteErr } = await supaAdmin.auth.admin.inviteUserByEmail(email);
    if (inviteErr || !invited?.user) {
      return json({ error: inviteErr?.message || 'No se pudo invitar al usuario (¿ya existe una cuenta con ese correo?)' }, 400);
    }

    const { error: perfilErr } = await supaAdmin
      .from('perfiles').insert({ id: invited.user.id, empresa_id: perfil.empresa_id, rol: 'miembro', nombre: nombre || null });
    if (perfilErr) return json({ error: 'Usuario invitado pero no se pudo asociar a tu empresa: ' + perfilErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
