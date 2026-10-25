// Edge Function: leer-boleta
// Lee la foto de una boleta, factura o guía chilena con Claude (visión) y devuelve los datos
// para prellenar un gasto en la app de terreno. El usuario los revisa antes de registrar.
// La API key de Anthropic vive solo aquí (secreto ANTHROPIC_API_KEY), nunca en el celular.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Mismas listas que gastos-app.js / proyectos.js, para que el concepto sugerido calce con la app.
const SUBCATEGORIAS = {
  materiales: ['Yeso / volcanita', 'Perfiles metálicos', 'Cemento / hormigón', 'Áridos', 'Fierro', 'Madera', 'Pintura', 'Cerámica / porcelanato', 'Material eléctrico', 'Material sanitario', 'Ferretería y fijaciones', 'Adhesivos y selladores', 'Aislación'],
  mano_obra: ['Maestro', 'Ayudante', 'Jornal', 'Trato / a destajo', 'Subcontrato', 'Horas extra', 'Leyes sociales', 'Bono de producción', 'Finiquito'],
  generales: ['Petróleo', 'Colaciones', 'Peajes', 'Estacionamiento', 'Fletes', 'Movilización', 'Hospedaje', 'Herramientas', 'Arriendo de equipos', 'EPP', 'Retiro de escombros', 'Aseo de obra'],
};

const texto = { type: ['string', 'null'] };
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'tipo_doc', 'numero_doc', 'fecha', 'proveedor', 'rut_proveedor', 'monto_total', 'descripcion', 'categoria', 'subcategoria', 'observacion'],
  properties: {
    legible: { type: 'boolean' },
    tipo_doc: { type: 'string', enum: ['boleta', 'factura', 'guia', 'sin_documento'] },
    numero_doc: texto,
    fecha: texto,
    proveedor: texto,
    rut_proveedor: texto,
    monto_total: { type: ['integer', 'null'] },
    descripcion: texto,
    categoria: { type: 'string', enum: ['materiales', 'mano_obra', 'generales'] },
    subcategoria: texto,
    observacion: texto,
  },
};

const INSTRUCCIONES = `La imagen es la foto de un comprobante de compra chileno (boleta, factura electrónica, guía de despacho o similar) que un trabajador de una constructora registra como gasto de obra. Extrae sus datos:

- legible: false si la imagen no es un comprobante o no se puede leer lo esencial (monto total); en ese caso deja el resto en null.
- tipo_doc: "boleta", "factura" o "guia" según el documento; "sin_documento" si es otro tipo de comprobante (voucher, ticket, recibo simple).
- numero_doc: folio o N° del documento, solo dígitos.
- fecha: fecha de emisión en formato AAAA-MM-DD.
- proveedor: razón social o nombre de fantasía del emisor (la tienda o empresa que vende), no del comprador.
- rut_proveedor: RUT del emisor con puntos y guion, por ejemplo 76.123.456-7.
- monto_total: total pagado en pesos chilenos, como entero sin puntos ni signo (en Chile el punto separa miles: "$ 12.990" es 12990). En facturas es el TOTAL con IVA.
- descripcion: resumen breve (máximo 80 caracteres) de lo comprado, por ejemplo "Pintura látex y rodillos".
- categoria: "materiales" si son insumos para la obra, "mano_obra" si es pago de trabajo o servicios de personas, "generales" para combustible, colaciones, peajes, fletes, herramientas, etc.
- subcategoria: el concepto que mejor calce de esta lista según la categoría, o null si ninguno calza: ${JSON.stringify(SUBCATEGORIAS)}
- observacion: algo que el trabajador deba revisar (por ejemplo "monto parcialmente borroso"), o null.

Si un dato no se ve con claridad, devuélvelo en null. Nunca inventes ni estimes valores.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { imagen } = await req.json();
    if (typeof imagen !== 'string' || imagen.length < 100) return json({ error: 'Falta la foto de la boleta' }, 400);
    if (imagen.length > 7_000_000) return json({ error: 'La foto es demasiado grande' }, 400);

    // Solo usuarios con sesión y empresa en Presupuestos Pro.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supaCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });
    const { data: { user }, error: userErr } = await supaCaller.auth.getUser();
    if (userErr || !user) return json({ error: 'No autenticado' }, 401);
    const { data: perfil } = await supaCaller.from('perfiles').select('empresa_id').eq('id', user.id).maybeSingle();
    if (!perfil?.empresa_id) return json({ error: 'Tu cuenta no pertenece a una empresa' }, 403);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'La lectura automática aún no está configurada (falta ANTHROPIC_API_KEY)' }, 503);
    const client = new Anthropic({ apiKey });

    const respuesta = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagen } },
          { type: 'text', text: INSTRUCCIONES },
        ],
      }],
    // deno-lint-ignore no-explicit-any
    } as any);

    if (respuesta.stop_reason === 'refusal') return json({ error: 'No se pudo leer la boleta, complétala a mano' }, 422);
    // deno-lint-ignore no-explicit-any
    const bloque = respuesta.content.find((b: any) => b.type === 'text') as { text: string } | undefined;
    if (!bloque) return json({ error: 'No se pudo leer la boleta, complétala a mano' }, 422);
    const datos = JSON.parse(bloque.text);
    if (datos.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) datos.fecha = null;
    if (datos.monto_total != null && !(datos.monto_total > 0)) datos.monto_total = null;
    return json({ datos });
  } catch (error) {
    console.error('leer-boleta', error);
    return json({ error: 'No se pudo leer la boleta, complétala a mano' }, 500);
  }
});
