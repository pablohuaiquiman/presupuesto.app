// Edge Function: mercadopago (desplegar con --no-verify-jwt; la autenticación se valida aquí).
// POST {accion:'crear'} con el JWT del administrador de la empresa: crea el link de pago (Checkout Pro)
//   de la siguiente mensualidad pendiente.
// POST ?webhook=1 (Mercado Pago): consulta el pago en la API de Mercado Pago y, si está aprobado,
//   acredita el período con mp_acreditar_pago. Nunca se confía en el contenido de la notificación.
// Secretos: MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET (ambos obligatorios; sin la clave de Webhooks no se procesa ningún aviso), APP_URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MP_API = 'https://api.mercadopago.com';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function fechaCiclo(inicio: string, meses: number): string {
  const [y, m, d] = inicio.split('-').map(Number);
  const primero = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(primero.getUTCFullYear(), primero.getUTCMonth() + 1, 0)).getUTCDate();
  primero.setUTCDate(Math.min(d, ultimoDia));
  return primero.toISOString().slice(0, 10);
}

function hoyChile(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function mp(path: string, init: RequestInit = {}) {
  const token = Deno.env.get('MP_ACCESS_TOKEN');
  if (!token) throw new Error('Los pagos en línea aún no están configurados');
  const res = await fetch(MP_API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `Mercado Pago respondió ${res.status}`);
  return body;
}

async function firmaValida(req: Request, dataId: string): Promise<boolean> {
  const secreto = Deno.env.get('MP_WEBHOOK_SECRET');
  if (!secreto) return false;
  const partes = Object.fromEntries((req.headers.get('x-signature') || '').split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!partes.ts || !partes.v1) return false;
  const manifiesto = `id:${dataId.toLowerCase()};request-id:${req.headers.get('x-request-id') || ''};ts:${partes.ts};`;
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(manifiesto));
  const hex = Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === partes.v1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supaAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);

  if (url.searchParams.get('webhook')) {
    try {
      const body = await req.json().catch(() => ({}));
      const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || body?.type || body?.topic;
      const id = String(url.searchParams.get('data.id') || url.searchParams.get('id') || body?.data?.id || '');
      if (tipo !== 'payment' || !/^\d+$/.test(id)) return json({ ok: true, ignorado: true });
      if (!Deno.env.get('MP_WEBHOOK_SECRET')) { console.error('mercadopago: falta MP_WEBHOOK_SECRET; aviso no procesado'); return json({ error: 'Avisos no configurados' }, 503); }
      if (!(await firmaValida(req, id))) return json({ error: 'Firma inválida' }, 401);
      const pago = await mp(`/v1/payments/${id}`);
      const cobroId = String(pago.external_reference || '');
      if (!/^[0-9a-f-]{36}$/.test(cobroId)) return json({ ok: true, ignorado: true });
      const { data, error } = await supaAdmin.rpc('mp_acreditar_pago', {
        p_cobro_id: cobroId,
        p_payment_id: id,
        p_monto: pago.currency_id === 'CLP' ? Math.round(Number(pago.transaction_amount)) : -1,
        p_fecha_pago: String(pago.date_approved || '').slice(0, 10) || null,
        p_status: String(pago.status || ''),
      });
      if (error) { console.error('mercadopago: no se pudo acreditar', error.message); return json({ error: 'No se pudo registrar el pago' }, 500); }
      return json({ ok: true, resultado: data });
    } catch (e) {
      console.error('mercadopago: aviso con error', e);
      return json({ error: 'No se pudo procesar el aviso' }, 500);
    }
  }

  try {
    const { accion } = await req.json().catch(() => ({}));
    if (accion !== 'crear') return json({ error: 'Acción no válida' }, 400);
    const supaCaller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });
    const { data: { user }, error: userErr } = await supaCaller.auth.getUser();
    if (userErr || !user) return json({ error: 'No autenticado' }, 401);

    const { data: perfil } = await supaAdmin.from('perfiles').select('empresa_id, rol').eq('id', user.id).single();
    if (!perfil) return json({ error: 'No se encontró tu perfil' }, 404);
    if (perfil.rol !== 'admin') return json({ error: 'Solo el administrador de la empresa puede pagar la suscripción' }, 403);

    const { data: empresa } = await supaAdmin.from('empresas').select('id, nombre_comercial, estado_acceso').eq('id', perfil.empresa_id).single();
    if (!empresa || empresa.estado_acceso !== 'autorizada') {
      return json({ error: 'El acceso de tu empresa no permite pagar en línea. Contacta a la administración de la plataforma.' }, 403);
    }
    const { data: s } = await supaAdmin.from('suscripciones').select('*').eq('empresa_id', empresa.id).maybeSingle();
    if (!s) return json({ error: 'Tu empresa no tiene un plan asignado' }, 400);
    if (s.cortesia) return json({ error: 'Tu empresa tiene una cuenta de cortesía: no hay mensualidades que pagar' }, 400);
    if (s.cancelada) return json({ error: 'La suscripción está cancelada' }, 400);

    const desde = fechaCiclo(s.inicio, s.periodos_pagados);
    const hasta = fechaCiclo(s.inicio, s.periodos_pagados + 1);
    if (desde > fechaCiclo(hoyChile(), 12)) return json({ error: 'Ya tienes pagado más de un año por adelantado' }, 400);

    const { data: cobro, error: cobroErr } = await supaAdmin.from('cobros_mp')
      .insert({ empresa_id: empresa.id, periodo_inicio: desde, monto: s.monto_mensual, creado_por: user.id })
      .select('id').single();
    if (cobroErr || !cobro) { console.error('mercadopago: no se pudo crear el cobro', cobroErr?.message); return json({ error: 'No se pudo iniciar el cobro' }, 500); }

    const app = (Deno.env.get('APP_URL') || 'https://pablohuaiquiman.github.io/presupuesto.app/').replace(/\/?$/, '/');
    const preferencia = await mp('/checkout/preferences', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': cobro.id },
      body: JSON.stringify({
        items: [{
          id: 'mensualidad',
          title: `Mensualidad ${s.plan_nombre} — ${empresa.nombre_comercial}`.slice(0, 250),
          description: `Período ${desde} al ${hasta}`,
          quantity: 1,
          unit_price: s.monto_mensual,
          currency_id: 'CLP',
        }],
        external_reference: cobro.id,
        notification_url: `${supabaseUrl}/functions/v1/mercadopago?webhook=1`,
        back_urls: { success: `${app}?mp=aprobado`, pending: `${app}?mp=pendiente`, failure: `${app}?mp=rechazado` },
        auto_return: 'approved',
        metadata: { empresa_id: empresa.id, periodo_inicio: desde },
      }),
    });
    await supaAdmin.from('cobros_mp').update({ preference_id: preferencia.id }).eq('id', cobro.id);
    return json({ url: preferencia.init_point, desde, hasta, monto: s.monto_mensual });
  } catch (e) {
    console.error('mercadopago: error al crear el pago', e);
    return json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo en unos minutos.' }, 500);
  }
});
