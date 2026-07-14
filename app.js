// ═══════════════════════════════════════════════════════════
// app.js — Presupuestos PHH  (arquitectura Itemizar)
// Capítulos → Partidas → EDP por avance físico
// ═══════════════════════════════════════════════════════════

// ── Estado global ────────────────────────────────────────
const DB_KEY = 'phh_presupuestos_v3';
let presupuestos    = [];
let editandoId      = null;   // ID presupuesto en edición (tab Nuevo Presupuesto)
let contratoActualId= null;   // ID presupuesto en modal contrato
let edpPresId       = null;   // ID presupuesto con panel EDP abierto
let edpEditId       = null;   // ID del EDP que se está editando
let compPresId      = null;   // IDs para modal comprobante
let compEdpId       = null;
let catCapId        = null;   // capítulo destino al insertar del catálogo
let catGrupoActual  = '';
// Cámara modal contrato
let streamContrato  = null;
// Firma modal contrato
let fcCanvas, fcCtx, fcDibujando = false, fcUltimoPunto = null;
// Firma standalone (tab 4)
let firmaDataUrl = null, fotoDataUrl = null, streamCamara = null;
let fsCanvas, fsCtx, fsDibujando = false, fsUltimoPunto = null;
// Modal Orden de Trabajo (firma cliente + cámara)
let otPresId = null, otId = null;
let streamOT = null;
let ocCanvas, ocCtx, ocDibujando = false, ocUltimoPunto = null;

// Firma de Pablo Huaiquiman para encabezar/pie de los PDF (empresa).
// Reemplazar por la data URI real (data:image/png;base64,...) cuando se entregue el archivo.
const FIRMA_PABLO_B64 = null;

// ── Firma remota (Supabase) ──────────────────────────────
// anon/public key en Settings → API de tu proyecto Supabase (NO la service_role).
// Es seguro que esta clave quede visible en el código: el acceso real lo controlan
// las funciones RPC con seguridad a nivel de fila definidas en supabase_schema.sql.
const SUPABASE_URL      = 'https://oeqjqfjdswwyyjbgdaxk.supabase.co';
const SUPABASE_ANON_KEY = 'PENDIENTE_PEGAR_TU_ANON_KEY';
const supa = (typeof supabase !== 'undefined' && /^eyJ/.test(SUPABASE_ANON_KEY))
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
let rfCanvas, rfCtx, rfDibujando = false, rfUltimoPunto = null;
let streamRF = null, rfOtId = null, rfOtCache = null;

// ── Arranque ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const idFirmaRemota = new URLSearchParams(location.search).get('firmar');
    if (idFirmaRemota) { iniciarVistaFirmaRemota(idFirmaRemota); return; }
    cargarDB();
    initFecha();
    initRegiones();
    initFirmaContrato();
    initFirmaStandalone();
    initFirmaOT();
    agregarCapitulo();        // empieza con un capítulo vacío
    actualizarBadges();
    actualizarNumeroFormulario();
});

// ════════════════════════════════════════════════════════
// PERSISTENCIA
// ════════════════════════════════════════════════════════
function cargarDB() {
    try { presupuestos = JSON.parse(localStorage.getItem(DB_KEY)) || []; }
    catch { presupuestos = []; }
    presupuestos.forEach(p => {
        if (!p.ordenesTrabajo) p.ordenesTrabajo = [];
        if (typeof p.usarGGUtil !== 'boolean') p.usarGGUtil = true;
    });
}
function guardarDB() {
    localStorage.setItem(DB_KEY, JSON.stringify(presupuestos));
}

// ════════════════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════════════════
function uid() { return `_${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`; }

function fmt(n) { return '$ ' + Math.round(n || 0).toLocaleString('es-CL'); }

function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function fmtFechaLarga(iso) {
    if (!iso) return '—';
    const M = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const [y, m, d] = iso.split('-');
    return `${parseInt(d)} de ${M[parseInt(m)-1]} de ${y}`;
}

function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function calcPresupuesto(p) {
    const costoDirecto = p.capitulos.reduce((s, cap) =>
        s + cap.items.reduce((ss, it) => ss + (it.total||0), 0), 0);
    const usarGGUtil = p.usarGGUtil !== false;
    const gg       = usarGGUtil ? costoDirecto * (p.ggPct||0) / 100 : 0;
    const util     = usarGGUtil ? costoDirecto * (p.utilPct||0) / 100 : 0;
    const subtotal = costoDirecto + gg + util;
    const iva      = subtotal * 0.19;
    return { costoDirecto, gg, util, subtotal, iva, total: subtotal + iva };
}

// ════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════
function initFecha() {
    document.getElementById('header-fecha').textContent =
        new Date().toLocaleDateString('es-CL',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    document.getElementById('p-fecha').value = new Date().toISOString().slice(0,10);
}

function actualizarNumeroFormulario() {
    document.getElementById('p-numero').value = generarNumero();
}

function generarNumero() {
    const max = presupuestos.reduce((m, p) => {
        const n = parseInt((p.numero||'').replace('PRE-',''));
        return Math.max(m, isNaN(n) ? 0 : n);
    }, 99);
    return `PRE-${max + 1}`;
}

// ════════════════════════════════════════════════════════
// NAVEGACIÓN DE PESTAÑAS
// ════════════════════════════════════════════════════════
function mostrarTab(tabId) {
    // Ocultar todos los paneles
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(tabId)?.classList.remove('hidden');

    // Actualizar estilos de los botones de la nav
    document.querySelectorAll('.tab-btn').forEach(btn => {
        const activo = btn.dataset.tab === tabId;
        // Borde inferior y color de texto
        btn.classList.toggle('border-blue-700',   activo);
        btn.classList.toggle('text-blue-700',     activo);
        btn.classList.toggle('bg-blue-50',        activo);
        btn.classList.toggle('border-transparent',!activo);
        btn.classList.toggle('text-slate-500',    !activo);
        btn.classList.toggle('bg-transparent',    !activo);
    });

    // Renderizar contenido del tab destino
    if (tabId === 'tab-enviados')    renderEnviados();
    if (tabId === 'tab-adjudicados') renderAdjudicados();
    if (tabId === 'tab-ot')          renderOrdenesTrabajo();
    if (tabId === 'tab-firma')       renderSelectFirma();
}

function actualizarBadges() {
    const env = presupuestos.filter(p => p.estado === 'enviado').length;
    const adj = presupuestos.filter(p => p.estado === 'adjudicado').length;
    const ot  = presupuestos.reduce((s,p) => s + p.ordenesTrabajo.filter(o => o.estado === 'pendiente').length, 0);
    const be = document.getElementById('badge-enviados');
    const ba = document.getElementById('badge-adjudicados');
    const bo = document.getElementById('badge-ot');
    be.textContent = env; be.classList.toggle('hidden', env === 0);
    ba.textContent = adj; ba.classList.toggle('hidden', adj === 0);
    bo.textContent = ot;  bo.classList.toggle('hidden', ot === 0);
}

// ════════════════════════════════════════════════════════
// REGIONES Y COMUNAS
// ════════════════════════════════════════════════════════
function initRegiones() {
    const sel = document.getElementById('cli-region');
    sel.innerHTML = '<option value="">— Seleccione región —</option>' +
        REGIONES_COMUNAS.map(r =>
            `<option value="${esc(r.nombre)}">${r.codigo} — ${esc(r.nombre)}</option>`
        ).join('');
}

function filtrarComunas() {
    const regionNombre = document.getElementById('cli-region').value;
    const sel = document.getElementById('cli-comuna');
    if (!regionNombre) {
        sel.innerHTML = '<option value="">— Primero seleccione región —</option>';
        sel.disabled = true; return;
    }
    const r = REGIONES_COMUNAS.find(x => x.nombre === regionNombre);
    if (!r) return;
    sel.disabled = false;
    sel.innerHTML = '<option value="">— Seleccione comuna —</option>' +
        r.comunas.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

// ════════════════════════════════════════════════════════
// TAB 1 · CONSTRUCTOR DE CAPÍTULOS Y PARTIDAS
// ════════════════════════════════════════════════════════

// ── Capítulos ────────────────────────────────────────────
function contarCapitulos() {
    return document.querySelectorAll('#capitulos-container .cap-card').length;
}

function agregarCapitulo(prefill = null) {
    const id     = prefill?.id || uid();
    const num    = prefill?.numero || `${contarCapitulos() + 1}.0`;
    const nombre = prefill?.nombre || '';
    const container = document.getElementById('capitulos-container');

    const div = document.createElement('div');
    div.className = 'cap-card';
    div.id = `cap${id}`;
    div.dataset.capId = id;

    div.innerHTML = `
        <div class="cap-header">
            <span class="cap-num-badge">${esc(num)}</span>
            <input class="cap-nombre-input" type="text"
                placeholder="Nombre del capítulo (ej: OBRAS PRELIMINARES)"
                value="${esc(nombre)}">
            <span class="cap-total-badge" id="capTotal${id}">$ 0</span>
            <button onclick="eliminarCapitulo('${id}')"
                class="text-slate-600 hover:text-red-400 p-1 rounded transition-colors flex-shrink-0" title="Eliminar capítulo">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead class="bg-slate-100 text-slate-500 uppercase text-xs">
                    <tr>
                        <th class="px-3 py-2.5 text-left w-20 font-semibold">Partida</th>
                        <th class="px-3 py-2.5 text-left w-28 font-semibold">Código</th>
                        <th class="px-3 py-2.5 text-left font-semibold">Descripción</th>
                        <th class="px-3 py-2.5 text-center w-20 font-semibold">Unidad</th>
                        <th class="px-3 py-2.5 text-center w-24 font-semibold">Cantidad</th>
                        <th class="px-3 py-2.5 text-right w-32 font-semibold">P. Unitario</th>
                        <th class="px-3 py-2.5 text-right w-32 font-semibold">Total</th>
                        <th class="px-3 py-2.5 w-8"></th>
                    </tr>
                </thead>
                <tbody id="items${id}" class="items-tbody"></tbody>
            </table>
        </div>
        <div class="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <button onclick="agregarPartida('${id}')"
                class="text-blue-600 hover:text-blue-800 text-xs font-semibold flex items-center gap-1 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
                </svg>
                Agregar partida
            </button>
            <button onclick="abrirCatalogo('${id}')"
                class="text-indigo-600 hover:text-indigo-800 text-xs font-semibold flex items-center gap-1 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                Catálogo
            </button>
        </div>`;

    container.appendChild(div);

    // Reasignar números de capítulo
    renumerarCapitulos();

    // Prefill items
    if (prefill?.items?.length) {
        prefill.items.forEach(it => agregarPartida(id, it));
    }
}

function renumerarCapitulos() {
    document.querySelectorAll('#capitulos-container .cap-card').forEach((card, i) => {
        const badge = card.querySelector('.cap-num-badge');
        if (badge) badge.textContent = `${i + 1}.0`;
    });
}

function eliminarCapitulo(capId) {
    const el = document.getElementById(`cap${capId}`);
    if (el) el.remove();
    renumerarCapitulos();
    recalcularResumen();
}

// ── Partidas ─────────────────────────────────────────────
function agregarPartida(capId, prefill = null) {
    const tbody = document.getElementById(`items${capId}`);
    if (!tbody) return;

    const itemId  = prefill?.id || uid();
    const capCard = document.getElementById(`cap${capId}`);
    const capNum  = capCard?.querySelector('.cap-num-badge')?.textContent || '?';
    const itemIdx = tbody.querySelectorAll('tr').length + 1;
    const itemNum = `${capNum.replace('.0','')}.${itemIdx}`;

    const unidades = ['m²','m³','ml','gl','un','hr','kg','lt','m'];
    const uSel     = prefill?.unidad || 'm²';
    const cant     = prefill?.cantidad  ?? 1;
    const precio   = prefill?.precioUnit ?? 0;
    const total    = cant * precio;

    const tr = document.createElement('tr');
    tr.className = 'item-row border-t border-slate-100 hover:bg-slate-50 transition-colors';
    tr.dataset.itemId = itemId;
    tr.dataset.capId  = capId;

    tr.innerHTML = `
        <td class="px-3 py-1.5">
            <span class="text-xs font-mono font-bold text-slate-400 item-num">${esc(itemNum)}</span>
        </td>
        <td class="px-2 py-1.5">
            <input type="text" class="item-codigo w-full px-2 py-1 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-blue-400 outline-none"
                placeholder="COD" value="${esc(prefill?.codigo||'')}">
        </td>
        <td class="px-2 py-1.5">
            <input type="text" class="item-desc w-full px-2 py-1 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-blue-400 outline-none"
                placeholder="Descripción del trabajo o material" value="${esc(prefill?.descripcion||'')}">
        </td>
        <td class="px-2 py-1.5">
            <select class="item-unidad w-full px-1 py-1 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-blue-400 outline-none" style="appearance:none;">
                ${unidades.map(u=>`<option ${u===uSel?'selected':''}>${u}</option>`).join('')}
            </select>
        </td>
        <td class="px-2 py-1.5">
            <input type="number" class="item-cant w-full px-2 py-1 border border-slate-200 rounded text-xs text-center focus:ring-1 focus:ring-blue-400 outline-none"
                value="${cant}" min="0" step="any" oninput="recalcularFila(this,'${capId}')">
        </td>
        <td class="px-2 py-1.5">
            <input type="number" class="item-precio w-full px-2 py-1 border border-slate-200 rounded text-xs text-right focus:ring-1 focus:ring-blue-400 outline-none"
                value="${precio}" min="0" step="any" oninput="recalcularFila(this,'${capId}')">
        </td>
        <td class="px-2 py-1.5 text-right">
            <span class="item-total text-sm font-semibold text-slate-700">${fmt(total)}</span>
        </td>
        <td class="px-2 py-1.5 text-center">
            <button onclick="eliminarPartida(this,'${capId}')"
                class="text-slate-300 hover:text-red-500 transition-colors p-0.5 rounded" title="Eliminar partida">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
            </button>
        </td>`;

    tbody.appendChild(tr);
    renumerarPartidas(capId);
}

function eliminarPartida(btn, capId) {
    btn.closest('tr').remove();
    renumerarPartidas(capId);
    recalcularCapitulo(capId);
}

function renumerarPartidas(capId) {
    const capCard = document.getElementById(`cap${capId}`);
    if (!capCard) return;
    const capNum = (capCard.querySelector('.cap-num-badge')?.textContent || '?').replace('.0','');
    capCard.querySelectorAll('.item-row').forEach((tr, i) => {
        const numEl = tr.querySelector('.item-num');
        if (numEl) numEl.textContent = `${capNum}.${i+1}`;
    });
}

// ── Cálculos ─────────────────────────────────────────────
function recalcularFila(input, capId) {
    const tr     = input.closest('tr');
    const cant   = parseFloat(tr.querySelector('.item-cant').value)   || 0;
    const precio = parseFloat(tr.querySelector('.item-precio').value) || 0;
    tr.querySelector('.item-total').textContent = fmt(cant * precio);
    recalcularCapitulo(capId);
}

function recalcularCapitulo(capId) {
    const tbody = document.getElementById(`items${capId}`);
    if (!tbody) return;
    let total = 0;
    tbody.querySelectorAll('.item-row').forEach(tr => {
        const cant   = parseFloat(tr.querySelector('.item-cant')?.value)   || 0;
        const precio = parseFloat(tr.querySelector('.item-precio')?.value) || 0;
        total += cant * precio;
    });
    const badge = document.getElementById(`capTotal${capId}`);
    if (badge) badge.textContent = fmt(total);
    recalcularResumen();
}

function toggleGGUtil() {
    const on = document.getElementById('usar-gg-util').checked;
    document.getElementById('fila-gg').classList.toggle('hidden', !on);
    document.getElementById('fila-util').classList.toggle('hidden', !on);
    recalcularResumen();
}

function recalcularResumen() {
    let costoDirecto = 0;
    document.querySelectorAll('#capitulos-container .cap-card').forEach(card => {
        card.querySelectorAll('.item-row').forEach(tr => {
            const cant   = parseFloat(tr.querySelector('.item-cant')?.value)   || 0;
            const precio = parseFloat(tr.querySelector('.item-precio')?.value) || 0;
            costoDirecto += cant * precio;
        });
    });
    const usarGGUtil = document.getElementById('usar-gg-util').checked;
    const ggPct   = parseFloat(document.getElementById('gg-pct').value)   || 0;
    const utilPct = parseFloat(document.getElementById('util-pct').value) || 0;
    const gg      = usarGGUtil ? costoDirecto * ggPct   / 100 : 0;
    const util    = usarGGUtil ? costoDirecto * utilPct / 100 : 0;
    const sub     = costoDirecto + gg + util;
    const iva     = sub * 0.19;
    const total   = sub + iva;

    document.getElementById('res-costo-directo').textContent = fmt(costoDirecto);
    document.getElementById('res-gg').textContent            = fmt(gg);
    document.getElementById('res-util').textContent          = fmt(util);
    document.getElementById('res-subtotal').textContent      = fmt(sub);
    document.getElementById('res-iva').textContent           = fmt(iva);
    document.getElementById('res-total').textContent         = fmt(total);
}

// ── Leer capítulos del DOM ────────────────────────────────
function leerCapitulosDOM() {
    const caps = [];
    document.querySelectorAll('#capitulos-container .cap-card').forEach((card, ci) => {
        const capId  = card.dataset.capId;
        const badge  = card.querySelector('.cap-num-badge')?.textContent || `${ci+1}.0`;
        const nombre = card.querySelector('.cap-nombre-input')?.value?.trim() || '';
        const items  = [];
        card.querySelectorAll('.item-row').forEach((tr, ii) => {
            const cant   = parseFloat(tr.querySelector('.item-cant')?.value)   || 0;
            const precio = parseFloat(tr.querySelector('.item-precio')?.value) || 0;
            items.push({
                id:          tr.dataset.itemId || uid(),
                numero:      tr.querySelector('.item-num')?.textContent || `${ci+1}.${ii+1}`,
                codigo:      tr.querySelector('.item-codigo')?.value?.trim()  || '',
                descripcion: tr.querySelector('.item-desc')?.value?.trim()    || '',
                unidad:      tr.querySelector('.item-unidad')?.value           || 'm²',
                cantidad:    cant,
                precioUnit:  precio,
                total:       cant * precio,
            });
        });
        caps.push({ id: capId, numero: badge, nombre, items });
    });
    return caps;
}

// ── Guardar presupuesto ───────────────────────────────────
function guardarPresupuesto() {
    const nombre    = document.getElementById('cli-nombre').value.trim();
    const direccion = document.getElementById('cli-direccion').value.trim();
    const region    = document.getElementById('cli-region').value;
    const comuna    = document.getElementById('cli-comuna').value;
    if (!nombre)    return toast('El nombre del cliente es requerido', 'error');
    if (!direccion) return toast('La dirección es requerida', 'error');
    if (!region)    return toast('Selecciona una región', 'error');
    if (!comuna)    return toast('Selecciona una comuna', 'error');

    const capitulos = leerCapitulosDOM();
    const totalItems = capitulos.reduce((s, c) => s + c.items.length, 0);
    if (totalItems === 0) return toast('Agrega al menos una partida', 'error');
    const sinDesc = capitulos.some(c => c.items.some(i => !i.descripcion));
    if (sinDesc) return toast('Hay partidas sin descripción', 'error');

    const usarGGUtil = document.getElementById('usar-gg-util').checked;
    const ggPct   = parseFloat(document.getElementById('gg-pct').value)   || 0;
    const utilPct = parseFloat(document.getElementById('util-pct').value) || 0;
    const { costoDirecto, gg, util, subtotal, iva, total } = calcPresupuesto({ capitulos, ggPct, utilPct, usarGGUtil });

    const datos = {
        fecha: document.getElementById('p-fecha').value,
        validez: parseInt(document.getElementById('p-validez').value) || 30,
        condicion: document.getElementById('p-condicion').value,
        cliente: {
            nombre, rut: document.getElementById('cli-rut').value.trim(),
            telefono: document.getElementById('cli-telefono').value.trim(),
            direccion, region, comuna,
        },
        ggPct, utilPct, usarGGUtil, capitulos,
        costoDirecto, gg, util, subtotal, iva, total,
        notas: document.getElementById('p-notas').value.trim(),
    };

    if (editandoId) {
        const p = presupuestos.find(x => x.id === editandoId);
        if (!p) { editandoId = null; return toast('Presupuesto no encontrado', 'error'); }
        Object.assign(p, datos);
        guardarDB();
        actualizarBadges();
        toast(`Presupuesto ${p.numero} actualizado`, 'success');
        limpiarFormulario();
        mostrarTab('tab-enviados');
        return;
    }

    const p = {
        id: uid(), numero: document.getElementById('p-numero').value,
        ...datos,
        estado: 'enviado', firma: null, edps: [], ordenesTrabajo: [],
    };

    presupuestos.push(p);
    guardarDB();
    actualizarBadges();
    toast(`Presupuesto ${p.numero} guardado`, 'success');
    limpiarFormulario();
}

function limpiarFormulario() {
    editandoId = null;
    ['cli-nombre','cli-rut','cli-telefono','cli-direccion','p-notas']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('cli-region').selectedIndex = 0;
    const sc = document.getElementById('cli-comuna');
    sc.innerHTML = '<option value="">— Primero seleccione región —</option>';
    sc.disabled = true;
    document.getElementById('p-validez').value = '30';
    document.getElementById('p-condicion').selectedIndex = 0;
    document.getElementById('gg-pct').value   = '15';
    document.getElementById('util-pct').value = '10';
    document.getElementById('usar-gg-util').checked = true;
    document.getElementById('fila-gg').classList.remove('hidden');
    document.getElementById('fila-util').classList.remove('hidden');
    document.getElementById('p-fecha').value  = new Date().toISOString().slice(0,10);
    document.getElementById('capitulos-container').innerHTML = '';
    agregarCapitulo();
    recalcularResumen();
    actualizarNumeroFormulario();
    actualizarUIModoEdicion();
}

// ════════════════════════════════════════════════════════
// TAB 2 · ENVIADOS
// ════════════════════════════════════════════════════════
function renderEnviados() {
    const filtro = (document.getElementById('filtro-enviados')?.value || '').toLowerCase();
    const lista  = presupuestos.filter(p =>
        p.estado === 'enviado' &&
        (p.numero.toLowerCase().includes(filtro) || p.cliente.nombre.toLowerCase().includes(filtro))
    );
    const tbody = document.getElementById('enviados-tbody');
    const vacio = document.getElementById('enviados-vacio');

    if (!lista.length) { tbody.innerHTML=''; vacio.classList.remove('hidden'); return; }
    vacio.classList.add('hidden');

    tbody.innerHTML = lista.map(p => {
        const c = calcPresupuesto(p);
        return `<tr class="border-t border-slate-100 hover:bg-amber-50 transition-colors">
            <td class="px-4 py-3 font-mono text-xs font-bold text-blue-700">${esc(p.numero)}</td>
            <td class="px-4 py-3">
                <p class="font-semibold text-slate-800 text-sm">${esc(p.cliente.nombre)}</p>
                <p class="text-xs text-slate-400">${esc(p.cliente.comuna)}</p>
            </td>
            <td class="px-4 py-3 text-sm text-slate-500 hidden sm:table-cell">${fmtFecha(p.fecha)}</td>
            <td class="px-4 py-3 text-right">
                <p class="font-bold text-slate-800">${fmt(c.total)}</p>
                <p class="text-xs text-slate-400">${p.capitulos.length} cap. · ${p.capitulos.reduce((s,c)=>s+c.items.length,0)} partidas</p>
            </td>
            <td class="px-4 py-3 text-center">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">
                    <span class="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>Pendiente
                </span>
            </td>
            <td class="px-4 py-3">
                <div class="flex justify-center gap-1.5 flex-wrap">
                    <button onclick="editarPresupuesto('${p.id}')"
                        class="text-xs px-3 py-1.5 border border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Editar</button>
                    <button onclick="exportarPDF('${p.id}')"
                        class="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors">PDF</button>
                    <button onclick="abrirModalContrato('${p.id}')"
                        class="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-colors">Aprobar</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── Editar presupuesto ────────────────────────────────────
function editarPresupuesto(id) {
    const p = presupuestos.find(x => x.id === id);
    if (!p) return;
    editandoId = id;

    document.getElementById('p-numero').value    = p.numero;
    document.getElementById('p-fecha').value     = p.fecha;
    document.getElementById('p-validez').value   = p.validez;
    document.getElementById('p-condicion').value = p.condicion;

    document.getElementById('cli-nombre').value    = p.cliente.nombre;
    document.getElementById('cli-rut').value       = p.cliente.rut || '';
    document.getElementById('cli-telefono').value  = p.cliente.telefono || '';
    document.getElementById('cli-direccion').value = p.cliente.direccion;
    document.getElementById('cli-region').value    = p.cliente.region || '';
    filtrarComunas();
    document.getElementById('cli-comuna').value = p.cliente.comuna || '';

    document.getElementById('gg-pct').value   = p.ggPct;
    document.getElementById('util-pct').value = p.utilPct;
    document.getElementById('usar-gg-util').checked = p.usarGGUtil !== false;
    document.getElementById('fila-gg').classList.toggle('hidden', p.usarGGUtil === false);
    document.getElementById('fila-util').classList.toggle('hidden', p.usarGGUtil === false);

    document.getElementById('p-notas').value = p.notas || '';

    document.getElementById('capitulos-container').innerHTML = '';
    p.capitulos.forEach(cap => agregarCapitulo(cap));

    recalcularResumen();
    actualizarUIModoEdicion();
    mostrarTab('tab-nuevo');
    toast(`Editando presupuesto ${p.numero}`, 'info');
}

function cancelarEdicion() {
    limpiarFormulario();
    mostrarTab('tab-enviados');
}

function actualizarUIModoEdicion() {
    const banner = document.getElementById('editando-banner');
    const label  = document.getElementById('btn-guardar-label');
    if (editandoId) {
        const p = presupuestos.find(x => x.id === editandoId);
        banner.classList.remove('hidden');
        document.getElementById('editando-numero').textContent = p ? p.numero : '';
        label.textContent = 'Guardar Cambios';
    } else {
        banner.classList.add('hidden');
        label.textContent = 'Guardar y Enviar Presupuesto';
    }
}

// ════════════════════════════════════════════════════════
// MODAL CONTRATO · FIRMA + CÁMARA FRONTAL
// ════════════════════════════════════════════════════════
function initFirmaContrato() {
    fcCanvas = document.getElementById('firma-contrato-canvas');
    if (!fcCanvas) return;
    fcCanvas.width  = 500;
    fcCanvas.height = 220;
    fcCtx = fcCanvas.getContext('2d');
    fcCtx.strokeStyle = '#0f172a'; fcCtx.lineWidth = 2.5;
    fcCtx.lineCap = 'round'; fcCtx.lineJoin = 'round';

    const draw = (e, touch) => {
        if (!fcDibujando) return;
        const pos = getPosCanvas(touch || e, fcCanvas);
        if (!fcUltimoPunto) { fcUltimoPunto = pos; return; }
        fcCtx.beginPath();
        fcCtx.moveTo(fcUltimoPunto.x, fcUltimoPunto.y);
        fcCtx.lineTo(pos.x, pos.y);
        fcCtx.stroke();
        fcUltimoPunto = pos;
    };
    fcCanvas.addEventListener('mousedown', e => { fcDibujando=true; fcUltimoPunto=getPosCanvas(e,fcCanvas); });
    fcCanvas.addEventListener('mousemove', e => draw(e));
    fcCanvas.addEventListener('mouseup',   () => { fcDibujando=false; fcUltimoPunto=null; });
    fcCanvas.addEventListener('mouseleave',() => { fcDibujando=false; fcUltimoPunto=null; });
    fcCanvas.addEventListener('touchstart', e => { e.preventDefault(); fcDibujando=true; fcUltimoPunto=getPosCanvas(e.touches[0],fcCanvas); }, {passive:false});
    fcCanvas.addEventListener('touchmove',  e => { e.preventDefault(); draw(null,e.touches[0]); }, {passive:false});
    fcCanvas.addEventListener('touchend',   () => { fcDibujando=false; fcUltimoPunto=null; });
}

function limpiarFirmaContrato() {
    if (!fcCtx) return;
    fcCtx.clearRect(0, 0, fcCanvas.width, fcCanvas.height);
}

async function abrirModalContrato(id) {
    const p = presupuestos.find(x => x.id === id);
    if (!p) return;
    if (p.estado === 'adjudicado') return toast('Este presupuesto ya está adjudicado', 'info');
    contratoActualId = id;
    const c = calcPresupuesto(p);
    document.getElementById('contrato-subtitulo').textContent = `${p.numero} — ${p.cliente.nombre}`;
    document.getElementById('contrato-resumen').innerHTML = `
        <div class="grid grid-cols-2 gap-2 text-xs">
            <div><span class="text-slate-400">Cliente:</span> <span class="font-semibold">${esc(p.cliente.nombre)}</span></div>
            <div><span class="text-slate-400">N°:</span> <span class="font-bold text-blue-700">${esc(p.numero)}</span></div>
            <div><span class="text-slate-400">Dirección:</span> <span class="font-semibold">${esc(p.cliente.direccion)}, ${esc(p.cliente.comuna)}</span></div>
            <div><span class="text-slate-400">Total:</span> <span class="font-black text-emerald-700 text-base">${fmt(c.total)}</span></div>
        </div>`;
    limpiarFirmaContrato();
    abrirModal('modal-contrato');
    // Activar cámara frontal automáticamente
    iniciarCamaraContrato();
}

async function iniciarCamaraContrato() {
    try {
        streamContrato = await navigator.mediaDevices.getUserMedia(
            { video: { facingMode: 'user' }, audio: false });
        const vid = document.getElementById('camara-contrato-video');
        vid.srcObject = streamContrato;
        vid.classList.remove('hidden');
        document.getElementById('camara-contrato-canvas').classList.add('hidden');
        document.getElementById('camara-contrato-placeholder').classList.add('hidden');
    } catch {
        document.getElementById('camara-contrato-placeholder').querySelector('p').textContent =
            'Cámara no disponible';
    }
}

function detenerCamaraContrato() {
    streamContrato?.getTracks().forEach(t => t.stop());
    streamContrato = null;
}

function confirmarContrato() {
    if (!contratoActualId) return;
    // Verificar firma
    const data = fcCtx.getImageData(0, 0, fcCanvas.width, fcCanvas.height);
    const hasFirma = Array.from(data.data).some((v, i) => i % 4 === 3 && v > 0);
    if (!hasFirma) return toast('El cliente debe firmar primero', 'error');

    // Capturar foto del firmante
    let fotoB64 = null;
    const vid = document.getElementById('camara-contrato-video');
    if (!vid.classList.contains('hidden') && vid.videoWidth > 0) {
        const canvas = document.getElementById('camara-contrato-canvas');
        canvas.width  = vid.videoWidth;
        canvas.height = vid.videoHeight;
        canvas.getContext('2d').drawImage(vid, 0, 0);
        fotoB64 = canvas.toDataURL('image/jpeg', 0.85);
    }
    detenerCamaraContrato();

    const firmaB64 = fcCanvas.toDataURL('image/png');
    const p = presupuestos.find(x => x.id === contratoActualId);
    if (!p) return;
    p.estado = 'adjudicado';
    p.fechaAdjudicacion = new Date().toISOString().slice(0,10);
    p.firma = { firmaB64, fotoB64, fecha: new Date().toISOString() };
    guardarDB();
    actualizarBadges();
    renderEnviados();
    renderAdjudicados();
    cerrarModal('modal-contrato');
    toast(`Contrato ${p.numero} adjudicado y firmado`, 'success');
}

// ════════════════════════════════════════════════════════
// TAB 3 · ADJUDICADOS
// ════════════════════════════════════════════════════════
function renderAdjudicados() {
    const lista = presupuestos.filter(p => p.estado === 'adjudicado');
    const grid  = document.getElementById('adjudicados-grid');
    const vacio = document.getElementById('adjudicados-vacio');
    vacio.classList.toggle('hidden', lista.length > 0);

    grid.innerHTML = lista.map(p => {
        const c           = calcPresupuesto(p);
        const cobrado     = calcCobradoTotal(p);
        const avancePct   = c.total > 0 ? Math.min((cobrado / c.total) * 100, 100) : 0;
        const nEdps       = p.edps.length;
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden group"
                    onclick="abrirPanelEDP('${p.id}')">
            <div class="bg-gradient-to-r from-emerald-800 to-emerald-600 px-4 py-3">
                <p class="text-emerald-100 text-xs font-mono">${esc(p.numero)}</p>
                <p class="text-white font-bold text-sm mt-0.5 truncate">${esc(p.cliente.nombre)}</p>
                <p class="text-emerald-200 text-xs">${esc(p.cliente.comuna)}</p>
            </div>
            <div class="p-4 space-y-2.5">
                <div class="flex justify-between text-sm">
                    <span class="text-slate-500">Total contrato</span>
                    <span class="font-bold text-slate-800">${fmt(c.total)}</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span class="text-slate-500">Cobrado</span>
                    <span class="font-bold text-emerald-700">${fmt(cobrado)}</span>
                </div>
                <div>
                    <div class="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Avance</span><span class="font-bold text-emerald-700">${avancePct.toFixed(1)}%</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div class="h-2 rounded-full bg-gradient-to-r from-blue-400 to-emerald-500 transition-all" style="width:${avancePct}%"></div>
                    </div>
                </div>
                <div class="flex items-center justify-between pt-1">
                    <span class="text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-100 text-emerald-700">
                        Adjudicado ${fmtFecha(p.fechaAdjudicacion)}
                    </span>
                    <span class="text-xs text-slate-400">${nEdps} EDP${nEdps!==1?'s':''}</span>
                </div>
                <div class="flex gap-2">
                    <button onclick="event.stopPropagation(); exportarPDF('${p.id}')"
                        class="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors">PDF</button>
                    <button onclick="event.stopPropagation(); generarOrdenTrabajo('${p.id}')"
                        class="flex-1 text-xs px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-semibold transition-colors">
                        + Orden de Trabajo (${p.ordenesTrabajo.length})
                    </button>
                </div>
                ${p.firma?.firmaB64 ? `<img src="${p.firma.firmaB64}" alt="Firma" class="h-8 mt-1 opacity-60 border-t border-slate-100 pt-1">` : ''}
                <button onclick="event.stopPropagation(); revertirAdjudicacion('${p.id}')"
                    class="w-full text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg py-1 font-medium transition-colors">
                    ↩ Revertir adjudicación
                </button>
            </div>
        </div>`;
    }).join('');
}

function calcCobradoTotal(p) {
    return p.edps
        .filter(e => e.estado === 'pagado' || e.estado === 'aceptado')
        .reduce((s, e) => s + (e.totalEDP || 0), 0);
}

function revertirAdjudicacion(id) {
    const p = presupuestos.find(x => x.id === id);
    if (!p) return;
    const tieneEdps = p.edps.length > 0;
    const msg = tieneEdps
        ? `El contrato ${p.numero} ya tiene ${p.edps.length} EDP(s) registrados. Si revocas la adjudicación, volverá a "Enviados" y se perderá la firma del cliente. ¿Continuar de todas formas?`
        : `¿Revocar la adjudicación de ${p.numero}? Volverá a "Enviados" y se perderá la firma del cliente registrada.`;
    if (!confirm(msg)) return;

    p.estado = 'enviado';
    p.firma = null;
    delete p.fechaAdjudicacion;
    guardarDB();
    actualizarBadges();
    renderAdjudicados();
    renderEnviados();
    toast(`Presupuesto ${p.numero} vuelto a Enviados`, 'info');
}

// ════════════════════════════════════════════════════════
// TAB 5 · ÓRDENES DE TRABAJO
// ════════════════════════════════════════════════════════
function generarOrdenTrabajo(presId) {
    const p = presupuestos.find(x => x.id === presId);
    if (!p) return;
    const n = p.ordenesTrabajo.length + 1;
    const ot = {
        id: uid(),
        numero: `OT-${p.numero.replace('PRE-','')}-${String(n).padStart(2,'0')}`,
        fecha: new Date().toISOString().slice(0,10),
        estado: 'pendiente', // pendiente | firmada
        firma: null,
        remota: false, // true si se publicó un link de firma remota (Supabase)
    };
    p.ordenesTrabajo.push(ot);
    guardarDB();
    actualizarBadges();
    renderAdjudicados();
    toast(`Orden de trabajo ${ot.numero} generada`, 'success');
}

function eliminarOrdenTrabajo(presId, id) {
    const p  = presupuestos.find(x => x.id === presId);
    const ot = p?.ordenesTrabajo.find(x => x.id === id);
    if (!p || !ot) return;

    const msg = ot.estado === 'firmada'
        ? `La orden de trabajo ${ot.numero} ya está firmada por el cliente. ¿Eliminarla de todas formas? Se perderá la firma registrada.`
        : `¿Eliminar la orden de trabajo ${ot.numero}?`;
    if (!confirm(msg)) return;

    p.ordenesTrabajo = p.ordenesTrabajo.filter(x => x.id !== id);
    guardarDB();
    actualizarBadges();
    renderOrdenesTrabajo();
    renderAdjudicados();
    toast(`Orden de trabajo ${ot.numero} eliminada`, 'info');
}

function renderOrdenesTrabajo() {
    const filas = presupuestos.flatMap(p => p.ordenesTrabajo.map(ot => ({ p, ot })));
    const tbody = document.getElementById('ot-tbody');
    const vacio = document.getElementById('ot-vacio');

    if (!filas.length) { tbody.innerHTML=''; vacio.classList.remove('hidden'); return; }
    vacio.classList.add('hidden');

    filas.sort((a,b) => (b.ot.fecha||'').localeCompare(a.ot.fecha||''));

    tbody.innerHTML = filas.map(({p, ot}) => `
        <tr class="border-t border-slate-100 hover:bg-indigo-50 transition-colors">
            <td class="px-4 py-3 font-mono text-xs font-bold text-indigo-700">${esc(ot.numero)}</td>
            <td class="px-4 py-3">
                <p class="font-semibold text-slate-800 text-sm">${esc(p.numero)} — ${esc(p.cliente.nombre)}</p>
                <p class="text-xs text-slate-400">${esc(p.cliente.comuna)}</p>
            </td>
            <td class="px-4 py-3 text-sm text-slate-500 hidden sm:table-cell">${fmtFecha(ot.fecha)}</td>
            <td class="px-4 py-3 text-center">
                ${ot.estado === 'firmada'
                    ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold"><span class="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>Firmada</span>`
                    : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold"><span class="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>Pendiente firma</span>`}
            </td>
            <td class="px-4 py-3">
                <div class="flex justify-center gap-1.5 flex-wrap">
                    <button onclick="exportarOTPDF('${p.id}','${ot.id}')"
                        class="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors">PDF</button>
                    ${ot.estado !== 'firmada'
                        ? `<button onclick="abrirModalOT('${p.id}','${ot.id}')"
                            class="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition-colors">Firmar</button>
                        <button onclick="generarLinkFirmaOT('${p.id}','${ot.id}')"
                            class="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-colors">🔗 Link firma</button>`
                        : ''}
                    <button onclick="eliminarOrdenTrabajo('${p.id}','${ot.id}')"
                        class="text-xs px-3 py-1.5 border border-red-300 text-red-500 hover:bg-red-50 rounded-lg font-medium transition-colors">Eliminar</button>
                </div>
            </td>
        </tr>`).join('');
}

// ── Firma remota (link para el cliente) ───────────────────
async function generarLinkFirmaOT(presId, id) {
    if (!supa) return toast('Falta configurar la anon key de Supabase en app.js', 'error');
    const p  = presupuestos.find(x => x.id === presId);
    const ot = p?.ordenesTrabajo.find(x => x.id === id);
    if (!p || !ot) return;
    const c = calcPresupuesto(p);

    toast('Publicando…', 'info');
    const { error } = await supa.rpc('publicar_ot', {
        p_id: ot.id, p_numero: ot.numero, p_presupuesto_numero: p.numero,
        p_cliente_nombre: p.cliente.nombre, p_cliente_direccion: p.cliente.direccion,
        p_cliente_comuna: p.cliente.comuna, p_cliente_region: p.cliente.region,
        p_condicion: p.condicion, p_capitulos: p.capitulos,
        p_costo_directo: c.costoDirecto, p_gg: c.gg, p_util: c.util,
        p_gg_pct: p.ggPct, p_util_pct: p.utilPct, p_usar_gg_util: p.usarGGUtil !== false,
        p_subtotal: c.subtotal, p_iva: c.iva, p_total: c.total,
    });
    if (error) return toast('Error al publicar: ' + error.message, 'error');

    ot.remota = true;
    guardarDB();
    const link = `${location.origin}${location.pathname}?firmar=${ot.id}`;
    prompt('Copia este link y envíaselo al cliente (WhatsApp, email, etc.):', link);
    toast('Link generado', 'success');
}

async function sincronizarFirmasRemotas() {
    if (!supa) return toast('Falta configurar la anon key de Supabase en app.js', 'error');
    const pendientes = presupuestos.flatMap(p => p.ordenesTrabajo
        .filter(ot => ot.remota && ot.estado === 'pendiente')
        .map(ot => ot));
    if (!pendientes.length) return toast('No hay órdenes remotas pendientes por sincronizar', 'info');

    let actualizadas = 0;
    for (const ot of pendientes) {
        const { data, error } = await supa.rpc('obtener_ot_publica', { p_id: ot.id });
        if (error || !data || !data.length) continue;
        const remota = data[0];
        if (remota.estado === 'firmada') {
            ot.estado = 'firmada';
            ot.firma  = { firmaB64: remota.firma_b64, fotoB64: remota.foto_b64, fecha: remota.fecha_firma };
            actualizadas++;
        }
    }
    if (actualizadas > 0) {
        guardarDB();
        actualizarBadges();
        renderOrdenesTrabajo();
        toast(`${actualizadas} orden(es) de trabajo actualizadas`, 'success');
    } else {
        toast('Sin novedades', 'info');
    }
}

function initFirmaOT() {
    ocCanvas = document.getElementById('ot-firma-canvas');
    if (!ocCanvas) return;
    ocCanvas.width  = 500;
    ocCanvas.height = 220;
    ocCtx = ocCanvas.getContext('2d');
    ocCtx.strokeStyle = '#0f172a'; ocCtx.lineWidth = 2.5;
    ocCtx.lineCap = 'round'; ocCtx.lineJoin = 'round';

    const draw = (e, touch) => {
        if (!ocDibujando) return;
        const pos = getPosCanvas(touch || e, ocCanvas);
        if (!ocUltimoPunto) { ocUltimoPunto = pos; return; }
        ocCtx.beginPath();
        ocCtx.moveTo(ocUltimoPunto.x, ocUltimoPunto.y);
        ocCtx.lineTo(pos.x, pos.y);
        ocCtx.stroke();
        ocUltimoPunto = pos;
    };
    ocCanvas.addEventListener('mousedown', e => { ocDibujando=true; ocUltimoPunto=getPosCanvas(e,ocCanvas); });
    ocCanvas.addEventListener('mousemove', e => draw(e));
    ocCanvas.addEventListener('mouseup',   () => { ocDibujando=false; ocUltimoPunto=null; });
    ocCanvas.addEventListener('mouseleave',() => { ocDibujando=false; ocUltimoPunto=null; });
    ocCanvas.addEventListener('touchstart', e => { e.preventDefault(); ocDibujando=true; ocUltimoPunto=getPosCanvas(e.touches[0],ocCanvas); }, {passive:false});
    ocCanvas.addEventListener('touchmove',  e => { e.preventDefault(); draw(null,e.touches[0]); }, {passive:false});
    ocCanvas.addEventListener('touchend',   () => { ocDibujando=false; ocUltimoPunto=null; });
}

function limpiarFirmaOT() {
    if (!ocCtx) return;
    ocCtx.clearRect(0, 0, ocCanvas.width, ocCanvas.height);
}

async function abrirModalOT(presId, id) {
    const p = presupuestos.find(x => x.id === presId);
    const ot = p?.ordenesTrabajo.find(x => x.id === id);
    if (!p || !ot) return;
    otPresId = presId; otId = id;
    document.getElementById('ot-subtitulo').textContent = `${ot.numero} — ${p.numero} — ${p.cliente.nombre}`;
    document.getElementById('ot-resumen').innerHTML = `
        <div class="grid grid-cols-2 gap-2 text-xs">
            <div><span class="text-slate-400">Cliente:</span> <span class="font-semibold">${esc(p.cliente.nombre)}</span></div>
            <div><span class="text-slate-400">N° OT:</span> <span class="font-bold text-indigo-700">${esc(ot.numero)}</span></div>
            <div><span class="text-slate-400">Dirección:</span> <span class="font-semibold">${esc(p.cliente.direccion)}, ${esc(p.cliente.comuna)}</span></div>
            <div><span class="text-slate-400">Fecha:</span> <span class="font-semibold">${fmtFecha(ot.fecha)}</span></div>
        </div>`;
    limpiarFirmaOT();
    abrirModal('modal-ot');
    iniciarCamaraOT();
}

async function iniciarCamaraOT() {
    try {
        streamOT = await navigator.mediaDevices.getUserMedia(
            { video: { facingMode: 'user' }, audio: false });
        const vid = document.getElementById('camara-ot-video');
        vid.srcObject = streamOT;
        vid.classList.remove('hidden');
        document.getElementById('camara-ot-canvas').classList.add('hidden');
        document.getElementById('camara-ot-placeholder').classList.add('hidden');
    } catch {
        document.getElementById('camara-ot-placeholder').querySelector('p').textContent =
            'Cámara no disponible';
    }
}

function detenerCamaraOT() {
    streamOT?.getTracks().forEach(t => t.stop());
    streamOT = null;
}

function confirmarFirmaOT() {
    if (!otPresId || !otId) return;
    const data = ocCtx.getImageData(0, 0, ocCanvas.width, ocCanvas.height);
    const hasFirma = Array.from(data.data).some((v, i) => i % 4 === 3 && v > 0);
    if (!hasFirma) return toast('El cliente debe firmar primero', 'error');

    let fotoB64 = null;
    const vid = document.getElementById('camara-ot-video');
    if (!vid.classList.contains('hidden') && vid.videoWidth > 0) {
        const canvas = document.getElementById('camara-ot-canvas');
        canvas.width  = vid.videoWidth;
        canvas.height = vid.videoHeight;
        canvas.getContext('2d').drawImage(vid, 0, 0);
        fotoB64 = canvas.toDataURL('image/jpeg', 0.85);
    }
    detenerCamaraOT();

    const firmaB64 = ocCanvas.toDataURL('image/png');
    const p  = presupuestos.find(x => x.id === otPresId);
    const ot = p?.ordenesTrabajo.find(x => x.id === otId);
    if (!p || !ot) return;
    ot.estado = 'firmada';
    ot.firma  = { firmaB64, fotoB64, fecha: new Date().toISOString() };
    guardarDB();
    actualizarBadges();
    renderOrdenesTrabajo();
    cerrarModal('modal-ot');
    toast(`Orden de trabajo ${ot.numero} firmada`, 'success');
}

// ════════════════════════════════════════════════════════
// VISTA PÚBLICA · FIRMA REMOTA (?firmar=<id-ot>)
// Página independiente: no depende de localStorage ni del resto del formulario,
// solo consulta/actualiza la OT puntual en Supabase mediante las funciones RPC.
// ════════════════════════════════════════════════════════
async function iniciarVistaFirmaRemota(id) {
    document.getElementById('vista-firma-remota').classList.remove('hidden');
    rfOtId = id;
    initFirmaRF();

    if (!supa) {
        mostrarErrorRF('Falta configurar la conexión con la base de datos. Contacta a la constructora.');
        return;
    }
    const { data, error } = await supa.rpc('obtener_ot_publica', { p_id: id });
    if (error || !data || !data.length) {
        mostrarErrorRF('El documento no existe o el link ya no es válido.');
        return;
    }
    rfOtCache = data[0];
    renderDocumentoRF(rfOtCache);
}

function mostrarErrorRF(msg) {
    document.getElementById('rf-cargando').classList.add('hidden');
    document.getElementById('rf-error').classList.remove('hidden');
    document.getElementById('rf-error-msg').textContent = msg;
}

function renderDocumentoRF(ot) {
    document.getElementById('rf-cargando').classList.add('hidden');
    document.getElementById('rf-contenido').classList.remove('hidden');

    document.getElementById('rf-numero').textContent      = `${ot.numero} — ${ot.presupuesto_numero}`;
    document.getElementById('rf-cliente').textContent     = ot.cliente_nombre;
    document.getElementById('rf-presupuesto').textContent = ot.presupuesto_numero;
    document.getElementById('rf-direccion').textContent   = `${ot.cliente_direccion||''}, ${ot.cliente_comuna||''}`;
    document.getElementById('rf-condicion').textContent   = ot.condicion || '—';

    const badge = document.getElementById('rf-estado-badge');
    if (ot.estado === 'firmada') {
        badge.textContent = 'Firmada';
        badge.className   = 'text-xs px-3 py-1 rounded-full font-bold bg-emerald-100 text-emerald-700';
    } else {
        badge.textContent = 'Pendiente de firma';
        badge.className   = 'text-xs px-3 py-1 rounded-full font-bold bg-amber-100 text-amber-800';
    }

    document.getElementById('rf-capitulos').innerHTML = (ot.capitulos||[]).map(cap => {
        const capTot = cap.items.reduce((s,it)=>s+(it.total||0),0);
        const filas = cap.items.map(it => `
            <tr class="border-t border-slate-100">
                <td class="px-3 py-2 text-sm">${esc(it.descripcion)}</td>
                <td class="px-3 py-2 text-center text-xs text-slate-500">${esc(it.unidad)}</td>
                <td class="px-3 py-2 text-center text-sm">${it.cantidad}</td>
                <td class="px-3 py-2 text-right text-sm">${fmt(it.precioUnit)}</td>
                <td class="px-3 py-2 text-right font-semibold">${fmt(it.total)}</td>
            </tr>`).join('');
        return `<div class="border border-slate-200 rounded-xl overflow-hidden">
            <div class="bg-slate-800 px-4 py-2 flex justify-between text-white text-sm font-bold">
                <span>${esc(cap.numero)} — ${esc(cap.nombre||'Sin nombre')}</span><span>${fmt(capTot)}</span>
            </div>
            <table class="w-full text-sm">
                <thead class="bg-slate-50 text-slate-500 uppercase text-xs">
                    <tr><th class="px-3 py-2 text-left">Descripción</th><th class="px-3 py-2 text-center">Un.</th><th class="px-3 py-2 text-center">Cant.</th><th class="px-3 py-2 text-right">P.Unit.</th><th class="px-3 py-2 text-right">Total</th></tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
    }).join('');

    document.getElementById('rf-resumen').innerHTML = `
        <div class="flex justify-between px-4 py-2.5 bg-slate-50 border-b text-sm"><span class="text-slate-600">Costo Directo</span><span class="font-semibold">${fmt(ot.costo_directo)}</span></div>
        ${ot.usar_gg_util !== false ? `
        <div class="flex justify-between px-4 py-2.5 border-b text-sm"><span class="text-slate-600">Gastos Generales (${ot.gg_pct}%)</span><span class="font-semibold">${fmt(ot.gg)}</span></div>
        <div class="flex justify-between px-4 py-2.5 border-b text-sm"><span class="text-slate-600">Utilidades (${ot.util_pct}%)</span><span class="font-semibold">${fmt(ot.util)}</span></div>` : ''}
        <div class="flex justify-between px-4 py-2.5 border-b bg-blue-50 text-sm font-bold text-blue-900"><span>Subtotal Neto</span><span>${fmt(ot.subtotal)}</span></div>
        <div class="flex justify-between px-4 py-2.5 border-b text-sm"><span class="text-slate-600">IVA (19%)</span><span class="font-semibold">${fmt(ot.iva)}</span></div>
        <div class="flex justify-between px-4 py-3 bg-slate-900 text-base font-black"><span class="text-white">TOTAL</span><span class="text-amber-400">${fmt(ot.total)}</span></div>
    `;

    if (ot.estado === 'firmada') {
        document.getElementById('rf-form-firma').classList.add('hidden');
        document.getElementById('rf-ya-firmada').classList.remove('hidden');
        if (ot.firma_b64) document.getElementById('rf-firma-preview').src = ot.firma_b64;
        detenerCamaraRF();
    } else {
        iniciarCamaraRF();
    }
}

function initFirmaRF() {
    rfCanvas = document.getElementById('rf-firma-canvas');
    if (!rfCanvas) return;
    rfCanvas.width  = 500;
    rfCanvas.height = 220;
    rfCtx = rfCanvas.getContext('2d');
    rfCtx.strokeStyle = '#0f172a'; rfCtx.lineWidth = 2.5;
    rfCtx.lineCap = 'round'; rfCtx.lineJoin = 'round';

    const draw = (e, touch) => {
        if (!rfDibujando) return;
        const pos = getPosCanvas(touch || e, rfCanvas);
        if (!rfUltimoPunto) { rfUltimoPunto = pos; return; }
        rfCtx.beginPath();
        rfCtx.moveTo(rfUltimoPunto.x, rfUltimoPunto.y);
        rfCtx.lineTo(pos.x, pos.y);
        rfCtx.stroke();
        rfUltimoPunto = pos;
    };
    rfCanvas.addEventListener('mousedown', e => { rfDibujando=true; rfUltimoPunto=getPosCanvas(e,rfCanvas); });
    rfCanvas.addEventListener('mousemove', e => draw(e));
    rfCanvas.addEventListener('mouseup',   () => { rfDibujando=false; rfUltimoPunto=null; });
    rfCanvas.addEventListener('mouseleave',() => { rfDibujando=false; rfUltimoPunto=null; });
    rfCanvas.addEventListener('touchstart', e => { e.preventDefault(); rfDibujando=true; rfUltimoPunto=getPosCanvas(e.touches[0],rfCanvas); }, {passive:false});
    rfCanvas.addEventListener('touchmove',  e => { e.preventDefault(); draw(null,e.touches[0]); }, {passive:false});
    rfCanvas.addEventListener('touchend',   () => { rfDibujando=false; rfUltimoPunto=null; });
}

function limpiarFirmaRF() {
    if (!rfCtx) return;
    rfCtx.clearRect(0, 0, rfCanvas.width, rfCanvas.height);
}

async function iniciarCamaraRF() {
    try {
        streamRF = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        const vid = document.getElementById('rf-camara-video');
        vid.srcObject = streamRF;
        vid.classList.remove('hidden');
        document.getElementById('rf-camara-placeholder').classList.add('hidden');
    } catch {
        document.getElementById('rf-camara-placeholder').querySelector('p').textContent =
            'Cámara no disponible (puedes firmar igual)';
    }
}

function detenerCamaraRF() {
    streamRF?.getTracks().forEach(t => t.stop());
    streamRF = null;
}

async function confirmarFirmaRemota() {
    const data = rfCtx.getImageData(0, 0, rfCanvas.width, rfCanvas.height);
    const hasFirma = Array.from(data.data).some((v, i) => i % 4 === 3 && v > 0);
    if (!hasFirma) return toast('Dibuja tu firma primero', 'error');

    let fotoB64 = null;
    const vid = document.getElementById('rf-camara-video');
    if (!vid.classList.contains('hidden') && vid.videoWidth > 0) {
        const canvas = document.getElementById('rf-camara-canvas');
        canvas.width  = vid.videoWidth;
        canvas.height = vid.videoHeight;
        canvas.getContext('2d').drawImage(vid, 0, 0);
        fotoB64 = canvas.toDataURL('image/jpeg', 0.85);
    }
    detenerCamaraRF();

    const firmaB64 = rfCanvas.toDataURL('image/png');
    const { error } = await supa.rpc('firmar_ot_publica', { p_id: rfOtId, p_firma_b64: firmaB64, p_foto_b64: fotoB64 });
    if (error) return toast('No se pudo enviar la firma: ' + error.message, 'error');

    rfOtCache.estado    = 'firmada';
    rfOtCache.firma_b64 = firmaB64;
    renderDocumentoRF(rfOtCache);
    toast('Firma enviada correctamente', 'success');
}

// ════════════════════════════════════════════════════════
// PANEL EDP · ESTADOS DE PAGO
// ════════════════════════════════════════════════════════
function abrirPanelEDP(presId) {
    edpPresId = presId;
    const p = presupuestos.find(x => x.id === presId);
    if (!p) return;
    document.getElementById('edp-titulo').textContent =
        `Estados de Pago — ${p.numero}`;
    document.getElementById('edp-cliente-info').textContent =
        `${p.cliente.nombre} · ${p.cliente.direccion}, ${p.cliente.comuna}`;
    renderEDPPanel(presId);
    const panel = document.getElementById('panel-edp');
    panel.classList.remove('hidden');
    setTimeout(() => panel.scrollIntoView({ behavior:'smooth', block:'start' }), 50);
}

function cerrarPanelEDP() {
    document.getElementById('panel-edp').classList.add('hidden');
    edpPresId = null; edpEditId = null;
}

function renderEDPPanel(presId) {
    const p  = presupuestos.find(x => x.id === presId);
    if (!p) return;
    const c  = calcPresupuesto(p);
    const cobrado  = calcCobradoTotal(p);
    const saldo    = Math.max(0, c.total - cobrado);
    const avancePct = c.total > 0 ? Math.min((cobrado / c.total) * 100, 100) : 0;

    const kpis = `
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div class="kpi rounded-xl border bg-blue-50 border-blue-200 text-blue-800 p-3 text-center">
                <p class="text-xs opacity-70 font-medium">Total Contrato</p>
                <p class="text-lg font-black mt-0.5">${fmt(c.total)}</p>
            </div>
            <div class="kpi rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-800 p-3 text-center">
                <p class="text-xs opacity-70 font-medium">Cobrado</p>
                <p class="text-lg font-black mt-0.5">${fmt(cobrado)}</p>
            </div>
            <div class="kpi rounded-xl border bg-amber-50 border-amber-200 text-amber-800 p-3 text-center">
                <p class="text-xs opacity-70 font-medium">Saldo</p>
                <p class="text-lg font-black mt-0.5">${fmt(saldo)}</p>
            </div>
            <div class="kpi rounded-xl border bg-purple-50 border-purple-200 text-purple-800 p-3 text-center">
                <p class="text-xs opacity-70 font-medium">Avance</p>
                <p class="text-lg font-black mt-0.5">${avancePct.toFixed(1)}%</p>
            </div>
        </div>
        <div class="mb-5">
            <div class="flex justify-between text-xs text-slate-500 mb-1.5">
                <span class="font-medium">Avance acumulado de cobros</span>
                <span class="font-bold">${avancePct.toFixed(1)}%</span>
            </div>
            <div class="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
                <div class="h-4 rounded-full bg-gradient-to-r from-blue-500 via-emerald-400 to-emerald-500 transition-all duration-700" style="width:${avancePct}%"></div>
            </div>
        </div>`;

    const listaEdps = p.edps.length ? `
        <div class="mb-5">
            <h4 class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">Historial de EDPs</h4>
            <div class="space-y-2">
                ${p.edps.map((edp, i) => {
                    const badgeClass = { presentado:'badge-presentado', aceptado:'badge-aceptado', pagado:'badge-pagado' }[edp.estado] || '';
                    return `<div class="flex items-center justify-between p-3 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer" onclick="renderEDPEditor('${presId}','${edp.id}')">
                        <div class="flex items-center gap-3">
                            <span class="font-mono text-sm font-bold text-slate-700">${esc(edp.numero)}</span>
                            <span class="text-xs text-slate-400">${fmtFecha(edp.fecha)}</span>
                            <span class="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full ${badgeClass}">${esc(edp.estado.charAt(0).toUpperCase()+edp.estado.slice(1))}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-slate-800">${fmt(edp.totalEDP)}</span>
                            <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>` : '';

    const btnNuevo = avancePct < 100 ? `
        <button onclick="crearNuevoEDP('${presId}')"
            class="w-full border-2 border-dashed border-emerald-300 hover:border-emerald-500 hover:bg-emerald-50 rounded-xl py-3 text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition-all flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
            Crear Nuevo EDP
        </button>` : `<p class="text-center text-emerald-700 font-bold bg-emerald-50 rounded-xl py-3 border border-emerald-200">✓ Contrato completado al 100%</p>`;

    document.getElementById('edp-body').innerHTML =
        kpis + listaEdps + btnNuevo + `<div id="edp-editor" class="mt-5"></div>`;
}

function crearNuevoEDP(presId) {
    const p = presupuestos.find(x => x.id === presId);
    if (!p) return;
    const nextNum = (p.edps.length + 1).toString().padStart(3, '0');
    const edp = {
        id: uid(),
        numero: `EDP-${p.numero}-${nextNum}`,
        fecha: new Date().toISOString().slice(0,10),
        estado: 'presentado',
        itemsAvance: [],  // { itemId, capId, pctActual, monto }
        totalEDP: 0,
        comprobante: null,
        facturaNumero: '',
    };
    // Inicializar itemsAvance con todos los items del presupuesto
    p.capitulos.forEach(cap => {
        cap.items.forEach(item => {
            const pctAnt = calcPctAnterior(p, item.id);
            edp.itemsAvance.push({
                itemId: item.id, capId: cap.id,
                pctActual: pctAnt,  // comienza desde donde quedó
                monto: 0,
            });
        });
    });
    p.edps.push(edp);
    guardarDB();
    renderEDPPanel(presId);
    renderEDPEditor(presId, edp.id);
}

function calcPctAnterior(p, itemId) {
    // El % anterior es el máximo pctActual de todos los EDPs cerrados (no presentado)
    return p.edps
        .filter(e => e.estado !== 'presentado')
        .reduce((max, e) => {
            const ia = e.itemsAvance.find(x => x.itemId === itemId);
            return Math.max(max, ia?.pctActual || 0);
        }, 0);
}

function renderEDPEditor(presId, edpId) {
    edpEditId = edpId;
    const p   = presupuestos.find(x => x.id === presId);
    const edp = p?.edps.find(x => x.id === edpId);
    if (!p || !edp) return;

    const iaMap = {};
    edp.itemsAvance.forEach(ia => { iaMap[ia.itemId] = ia; });

    const estadoBadge = { presentado:'badge-presentado', aceptado:'badge-aceptado', pagado:'badge-pagado' }[edp.estado]||'';
    const editable = edp.estado === 'presentado';

    let capsHtml = '';
    p.capitulos.forEach(cap => {
        let capMonto = 0;
        let itemsHtml = '';
        cap.items.forEach(item => {
            const ia        = iaMap[item.id] || { pctActual: 0, monto: 0 };
            const pctAnt    = calcPctAnterior(p, item.id);
            const pctAct    = ia.pctActual;
            const pctPer    = Math.max(0, pctAct - pctAnt);
            const montoPer  = item.total * pctPer / 100;
            capMonto += montoPer;
            itemsHtml += `
                <tr class="border-t border-slate-100 hover:bg-slate-50" data-item-id="${item.id}">
                    <td class="px-3 py-2 text-xs font-mono text-slate-400">${esc(item.numero)}</td>
                    <td class="px-3 py-2 text-sm text-slate-800 max-w-xs">${esc(item.descripcion)}</td>
                    <td class="px-3 py-2 text-right font-semibold text-sm">${fmt(item.total)}</td>
                    <td class="px-3 py-2 text-center text-sm text-slate-400 font-mono">${pctAnt}%</td>
                    <td class="px-3 py-2 text-center">
                        ${editable
                            ? `<input type="number" class="edp-pct-input w-16 text-center border border-slate-300 rounded-lg px-1 py-1 text-xs font-bold focus:ring-2 focus:ring-emerald-400 outline-none"
                                min="${pctAnt}" max="100" value="${pctAct}" step="5"
                                data-item-id="${item.id}" data-item-total="${item.total}" data-pct-ant="${pctAnt}"
                                oninput="recalcularItemEDP(this,'${presId}','${edpId}')">`
                            : `<span class="font-bold text-sm">${pctAct}%</span>`
                        }
                    </td>
                    <td class="px-3 py-2 text-center text-sm font-semibold text-blue-700 pct-per">${pctPer}%</td>
                    <td class="px-3 py-2 text-right font-bold text-emerald-700 monto-edp">${fmt(montoPer)}</td>
                </tr>`;
        });
        capsHtml += `
            <div class="mb-4 border border-slate-200 rounded-xl overflow-hidden">
                <div class="bg-slate-800 px-4 py-2 flex justify-between items-center">
                    <span class="text-white font-bold text-sm">${esc(cap.numero)} — ${esc(cap.nombre||'Sin nombre')}</span>
                    <span class="text-amber-400 font-bold text-sm cap-edp-total" data-cap="${cap.id}">${fmt(capMonto)}</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="bg-slate-50 text-slate-500 uppercase text-xs">
                            <tr>
                                <th class="px-3 py-2 text-left w-16">N°</th>
                                <th class="px-3 py-2 text-left">Descripción</th>
                                <th class="px-3 py-2 text-right w-28">Contrato</th>
                                <th class="px-3 py-2 text-center w-20">Ant.%</th>
                                <th class="px-3 py-2 text-center w-24">Act.%</th>
                                <th class="px-3 py-2 text-center w-20">Per.%</th>
                                <th class="px-3 py-2 text-right w-28">Monto EDP</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                </div>
            </div>`;
    });

    const totalEdp = edp.itemsAvance.reduce((s, ia) => s + (ia.monto||0), 0);

    const acciones = editable ? `
        <div class="flex flex-wrap gap-3 justify-between items-center mt-4 pt-4 border-t border-slate-200">
            <div class="flex gap-2">
                <button onclick="cambiarEstadoEDP('${presId}','${edpId}','aceptado')"
                    class="bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-xl text-sm transition-colors">
                    Marcar como Aceptado
                </button>
            </div>
            <button onclick="guardarEDP('${presId}','${edpId}')"
                class="bg-blue-700 hover:bg-blue-800 text-white font-bold py-2 px-5 rounded-xl text-sm transition-colors">
                Guardar EDP
            </button>
        </div>` :
    edp.estado === 'aceptado' ? `
        <div class="flex gap-3 mt-4 pt-4 border-t border-slate-200">
            <button onclick="abrirModalComprobante('${presId}','${edpId}')"
                class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-5 rounded-xl text-sm transition-colors flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                Registrar Pago con Comprobante
            </button>
        </div>` :
    edp.comprobante ? `
        <div class="mt-4 pt-4 border-t border-slate-200">
            <p class="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">✓ Pago registrado — Fact. ${esc(edp.facturaNumero||'—')}</p>
            <img src="${edp.comprobante}" class="max-h-32 rounded-xl border border-slate-200" alt="Comprobante">
        </div>` : '';

    document.getElementById('edp-editor').innerHTML = `
        <div class="border-2 border-emerald-200 rounded-2xl overflow-hidden">
            <div class="bg-emerald-800 px-5 py-3 flex items-center justify-between">
                <div>
                    <span class="text-white font-bold">${esc(edp.numero)}</span>
                    <span class="ml-3 text-xs text-emerald-300">${fmtFecha(edp.fecha)}</span>
                </div>
                <span class="text-xs font-bold px-3 py-1 rounded-full ${estadoBadge}">${edp.estado.charAt(0).toUpperCase()+edp.estado.slice(1)}</span>
            </div>
            <div class="p-4">
                <div class="overflow-x-auto">
                    <table class="w-full text-xs mb-2">
                        <thead><tr class="bg-slate-100 text-slate-500 uppercase">
                            <th class="px-3 py-2 text-left" colspan="2">Encabezado columnas</th>
                        </tr></thead>
                    </table>
                </div>
                ${capsHtml}
                <div class="flex justify-end items-center gap-4 bg-slate-900 rounded-xl px-5 py-3">
                    <span class="text-white font-black text-base">Total EDP</span>
                    <span class="text-amber-400 font-black text-xl" id="edp-total-display">${fmt(totalEdp)}</span>
                </div>
                ${acciones}
            </div>
        </div>`;
}

function recalcularItemEDP(input, presId, edpId) {
    const p   = presupuestos.find(x => x.id === presId);
    const edp = p?.edps.find(x => x.id === edpId);
    if (!p || !edp) return;

    const itemId   = input.dataset.itemId;
    const total    = parseFloat(input.dataset.itemTotal) || 0;
    const pctAnt   = parseFloat(input.dataset.pctAnt)    || 0;
    let   pctAct   = parseFloat(input.value) || 0;

    // Clamp
    pctAct = Math.max(pctAnt, Math.min(100, pctAct));
    input.value = pctAct;

    const pctPer   = Math.max(0, pctAct - pctAnt);
    const montoPer = total * pctPer / 100;

    // Actualizar estado en memoria
    const ia = edp.itemsAvance.find(x => x.itemId === itemId);
    if (ia) { ia.pctActual = pctAct; ia.monto = montoPer; }

    // Actualizar fila DOM
    const tr = input.closest('tr');
    if (tr) {
        tr.querySelector('.pct-per').textContent  = `${pctPer}%`;
        tr.querySelector('.monto-edp').textContent = fmt(montoPer);
    }

    // Recalcular total EDP
    const nuevoTotal = edp.itemsAvance.reduce((s, x) => s + (x.monto||0), 0);
    edp.totalEDP = nuevoTotal;
    const disp = document.getElementById('edp-total-display');
    if (disp) disp.textContent = fmt(nuevoTotal);

    // Recalcular subtotal del capítulo
    const capId = input.closest('tr')?.closest('div')?.querySelector('[data-cap]')?.dataset?.cap;
    // (omitido por complejidad DOM — se actualiza al guardar)
}

function guardarEDP(presId, edpId) {
    const p   = presupuestos.find(x => x.id === presId);
    const edp = p?.edps.find(x => x.id === edpId);
    if (!p || !edp) return;
    // Leer todos los inputs del editor
    document.querySelectorAll('#edp-editor .edp-pct-input').forEach(input => {
        const itemId   = input.dataset.itemId;
        const total    = parseFloat(input.dataset.itemTotal) || 0;
        const pctAnt   = parseFloat(input.dataset.pctAnt)    || 0;
        const pctAct   = Math.max(pctAnt, Math.min(100, parseFloat(input.value)||0));
        const monto    = total * Math.max(0, pctAct - pctAnt) / 100;
        const ia = edp.itemsAvance.find(x => x.itemId === itemId);
        if (ia) { ia.pctActual = pctAct; ia.monto = monto; }
    });
    edp.totalEDP = edp.itemsAvance.reduce((s, ia) => s + (ia.monto||0), 0);
    guardarDB();
    renderAdjudicados();
    toast(`EDP ${edp.numero} guardado`, 'success');
}

function cambiarEstadoEDP(presId, edpId, nuevoEstado) {
    guardarEDP(presId, edpId); // guardar primero
    const p   = presupuestos.find(x => x.id === presId);
    const edp = p?.edps.find(x => x.id === edpId);
    if (!p || !edp) return;
    edp.estado = nuevoEstado;
    guardarDB();
    renderEDPPanel(presId);
    renderEDPEditor(presId, edpId);
    renderAdjudicados();
    toast(`EDP → ${nuevoEstado.charAt(0).toUpperCase()+nuevoEstado.slice(1)}`, 'success');
}

// ── Modal comprobante EDP ─────────────────────────────────
function abrirModalComprobante(presId, edpId) {
    compPresId = presId; compEdpId = edpId;
    limpiarCompPreview();
    document.getElementById('comp-factura').value = '';
    document.getElementById('comp-obs').value     = '';
    abrirModal('modal-comprobante');
}

function handleDropComp(e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) procesarArchivoComp(f);
}
function previewComp(e) { const f = e.target.files[0]; if(f) procesarArchivoComp(f); }
function procesarArchivoComp(file) {
    if (!file.type.startsWith('image/')) return toast('Solo imágenes', 'error');
    const r = new FileReader();
    r.onload = ev => {
        document.getElementById('comp-preview-img').src = ev.target.result;
        document.getElementById('comp-preview-wrap').classList.remove('hidden');
        document.getElementById('comp-upload-zona').classList.add('hidden');
    };
    r.readAsDataURL(file);
}
function limpiarCompPreview() {
    document.getElementById('comp-preview-img').src = '';
    document.getElementById('comp-preview-wrap').classList.add('hidden');
    document.getElementById('comp-upload-zona').classList.remove('hidden');
    document.getElementById('comp-file').value = '';
}

function confirmarComprobante() {
    const factura = document.getElementById('comp-factura').value.trim();
    if (!factura) return toast('Ingresa el N° de factura o boleta', 'error');
    const p   = presupuestos.find(x => x.id === compPresId);
    const edp = p?.edps.find(x => x.id === compEdpId);
    if (!p || !edp) return;
    edp.facturaNumero = factura;
    edp.comprobante   = document.getElementById('comp-preview-img').src || null;
    edp.obs           = document.getElementById('comp-obs').value.trim();
    edp.estado        = 'pagado';
    guardarDB();
    cerrarModal('modal-comprobante');
    renderEDPPanel(compPresId);
    renderEDPEditor(compPresId, compEdpId);
    renderAdjudicados();
    toast(`EDP ${edp.numero} registrado como pagado`, 'success');
}

// ════════════════════════════════════════════════════════
// TAB 4 · FIRMA STANDALONE
// ════════════════════════════════════════════════════════
function initFirmaStandalone() {
    fsCanvas = document.getElementById('firma-canvas');
    if (!fsCanvas) return;
    fsCtx = fsCanvas.getContext('2d');
    fsCtx.strokeStyle = '#1e293b'; fsCtx.lineWidth = 2.5;
    fsCtx.lineCap = 'round'; fsCtx.lineJoin = 'round';
    const draw = (e, touch) => {
        if (!fsDibujando) return;
        const pos = getPosCanvas(touch||e, fsCanvas);
        if (!fsUltimoPunto) { fsUltimoPunto = pos; return; }
        fsCtx.beginPath(); fsCtx.moveTo(fsUltimoPunto.x, fsUltimoPunto.y);
        fsCtx.lineTo(pos.x, pos.y); fsCtx.stroke(); fsUltimoPunto = pos;
    };
    fsCanvas.addEventListener('mousedown', e => { fsDibujando=true; fsUltimoPunto=getPosCanvas(e,fsCanvas); });
    fsCanvas.addEventListener('mousemove', e => draw(e));
    fsCanvas.addEventListener('mouseup',   () => { fsDibujando=false; fsUltimoPunto=null; });
    fsCanvas.addEventListener('mouseleave',() => { fsDibujando=false; fsUltimoPunto=null; });
    fsCanvas.addEventListener('touchstart', e => { e.preventDefault(); fsDibujando=true; fsUltimoPunto=getPosCanvas(e.touches[0],fsCanvas); }, {passive:false});
    fsCanvas.addEventListener('touchmove',  e => { e.preventDefault(); draw(null,e.touches[0]); }, {passive:false});
    fsCanvas.addEventListener('touchend',  () => { fsDibujando=false; fsUltimoPunto=null; });
}

function getPosCanvas(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX-r.left)*(canvas.width/r.width), y: (e.clientY-r.top)*(canvas.height/r.height) };
}

function limpiarFirma() {
    if (!fsCtx) return;
    fsCtx.clearRect(0,0,fsCanvas.width,fsCanvas.height);
    firmaDataUrl = null;
    document.getElementById('firma-guardada-ok').classList.add('hidden');
}
function guardarFirma() {
    const data = fsCtx.getImageData(0,0,fsCanvas.width,fsCanvas.height);
    if (!Array.from(data.data).some((v,i)=>i%4===3&&v>0)) return toast('Dibuja la firma primero','error');
    firmaDataUrl = fsCanvas.toDataURL('image/png');
    document.getElementById('firma-img-preview').src = firmaDataUrl;
    document.getElementById('firma-guardada-ok').classList.remove('hidden');
    toast('Firma guardada','success');
}
async function activarCamara() {
    try {
        streamCamara = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
        const vid = document.getElementById('camara-video');
        vid.srcObject = streamCamara;
        vid.classList.remove('hidden');
        document.getElementById('camara-placeholder').classList.add('hidden');
        const btn = document.getElementById('btn-tomar-foto');
        btn.disabled=false; btn.className='flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl text-sm transition-colors';
        document.getElementById('btn-activar-camara').textContent='Detener cámara';
        document.getElementById('btn-activar-camara').onclick=detenerCamara;
    } catch(e) { toast('Sin acceso a cámara: '+e.message,'error'); }
}
function detenerCamara() {
    streamCamara?.getTracks().forEach(t=>t.stop()); streamCamara=null;
    const vid = document.getElementById('camara-video');
    vid.srcObject=null; vid.classList.add('hidden');
    document.getElementById('camara-placeholder').classList.remove('hidden');
    const btn = document.getElementById('btn-tomar-foto');
    btn.disabled=true; btn.className='flex-1 bg-slate-300 text-slate-500 font-bold py-2 px-4 rounded-xl text-sm cursor-not-allowed';
    document.getElementById('btn-activar-camara').textContent='Activar Cámara';
    document.getElementById('btn-activar-camara').onclick=activarCamara;
}
function tomarFoto() {
    const vid=document.getElementById('camara-video'), canvas=document.getElementById('foto-canvas');
    canvas.width=vid.videoWidth; canvas.height=vid.videoHeight;
    canvas.getContext('2d').drawImage(vid,0,0);
    fotoDataUrl=canvas.toDataURL('image/jpeg',0.9);
    canvas.classList.remove('hidden');
    document.getElementById('foto-img-preview').src=fotoDataUrl;
    document.getElementById('foto-ok').classList.remove('hidden');
    detenerCamara(); toast('Foto capturada','success');
}
function descartarFoto() {
    fotoDataUrl=null;
    document.getElementById('foto-canvas').classList.add('hidden');
    document.getElementById('foto-ok').classList.add('hidden');
}
function renderSelectFirma() {
    const sel = document.getElementById('firma-presupuesto-id');
    const sin = presupuestos.filter(p=>!p.firma);
    sel.innerHTML='<option value="">— Seleccione un presupuesto —</option>'+
        sin.map(p=>`<option value="${p.id}">${esc(p.numero)} · ${esc(p.cliente.nombre)}</option>`).join('');
}
function confirmarFirmaCompleta() {
    const id=document.getElementById('firma-presupuesto-id').value;
    if(!id) return toast('Selecciona un presupuesto','error');
    if(!firmaDataUrl) return toast('Guarda la firma primero','error');
    const p=presupuestos.find(x=>x.id===id);
    if(!p) return;
    p.firma={firmaB64:firmaDataUrl, fotoB64:fotoDataUrl||null, fecha:new Date().toISOString()};
    guardarDB(); toast(`Firma asociada a ${p.numero}`,'success'); renderSelectFirma();
}

// ════════════════════════════════════════════════════════
// CATÁLOGO DE SERVICIOS
// ════════════════════════════════════════════════════════
function abrirCatalogo(capId) {
    catCapId = capId;
    catGrupoActual = '';
    document.getElementById('cat-buscar').value = '';
    // Nombre del capítulo activo
    const cap = capId ? document.getElementById(`cap${capId}`) : null;
    const capNombre = cap?.querySelector('.cap-nombre-input')?.value || (capId ? 'capítulo seleccionado' : 'ninguno');
    document.getElementById('cat-cap-nombre').textContent = capId ? capNombre||'sin nombre' : 'Selecciona un capítulo';
    setCatGrupo('', false);
    renderCatalogo();
    abrirModal('modal-catalogo');
}
function setCatGrupo(grupo, doRender=true) {
    catGrupoActual = grupo;
    const m = {
        '':          { id:'cat-btn-todos', on:'bg-slate-800 text-white', off:'bg-slate-100 text-slate-600 hover:bg-slate-200' },
        'SERV.CONST':{ id:'cat-btn-const', on:'bg-blue-700 text-white',  off:'bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700' },
        'SERV.GASF': { id:'cat-btn-gasf',  on:'bg-teal-700 text-white',  off:'bg-slate-100 text-slate-600 hover:bg-teal-100 hover:text-teal-700' },
    };
    Object.entries(m).forEach(([g,cfg])=>{
        const btn=document.getElementById(cfg.id);
        if(btn) btn.className=`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${g===grupo?cfg.on:cfg.off}`;
    });
    if(doRender) renderCatalogo();
}
function renderCatalogo() {
    const buscar=(document.getElementById('cat-buscar')?.value||'').toLowerCase();
    const items=CATALOGO_ITEMS.filter(it=>{
        const mG=!catGrupoActual||it.grupo===catGrupoActual;
        const mB=!buscar||it.codigo.toLowerCase().includes(buscar)||it.descripcion.toLowerCase().includes(buscar);
        return mG&&mB;
    });
    document.getElementById('cat-count').textContent=items.length;
    const C={'SERV.CONST':{fila:'hover:bg-blue-50',badge:'bg-blue-100 text-blue-700 border-blue-200',btn:'bg-blue-600 hover:bg-blue-700'},
             'SERV.GASF' :{fila:'hover:bg-teal-50', badge:'bg-teal-100 text-teal-700 border-teal-200', btn:'bg-teal-600 hover:bg-teal-700'}};
    const tbody=document.getElementById('cat-tbody');
    if(!items.length){
        tbody.innerHTML=`<tr><td colspan="5" class="text-center py-12 text-slate-400"><p class="font-semibold">Sin resultados</p></td></tr>`;
        return;
    }
    tbody.innerHTML=items.map(it=>{
        const c=C[it.grupo]||{fila:'hover:bg-slate-50',badge:'bg-slate-100 text-slate-700 border-slate-200',btn:'bg-slate-600 hover:bg-slate-700'};
        return `<tr class="border-t border-slate-100 ${c.fila} cursor-pointer transition-colors" onclick="insertarDesdeCatalogo('${esc(it.codigo)}')">
            <td class="px-3 py-2.5"><span class="inline-block text-xs font-mono font-bold px-2 py-0.5 rounded-md border ${c.badge}">${esc(it.codigo)}</span></td>
            <td class="px-3 py-2.5 text-sm text-slate-800">${esc(it.descripcion)}</td>
            <td class="px-3 py-2.5 text-center text-xs text-slate-500 font-medium">${esc(it.unidad)}</td>
            <td class="px-3 py-2.5 text-right font-bold text-sm">${fmt(it.precio)}</td>
            <td class="px-3 py-2.5 text-center"><span class="inline-block text-xs px-2.5 py-1 ${c.btn} text-white rounded-lg font-bold pointer-events-none">+ Agregar</span></td>
        </tr>`;
    }).join('');
}
function insertarDesdeCatalogo(codigo) {
    const item=CATALOGO_ITEMS.find(x=>x.codigo===codigo);
    if(!item) return;
    if(!catCapId) return toast('Selecciona primero un capítulo en el formulario','error');
    agregarPartida(catCapId,{
        codigo: item.codigo, descripcion: item.descripcion,
        unidad: item.unidad, cantidad: 1, precioUnit: item.precio,
    });
    cerrarModal('modal-catalogo');
    document.getElementById(`cap${catCapId}`)?.scrollIntoView({behavior:'smooth',block:'nearest'});
    toast(`${item.codigo} agregado al capítulo`,'success');
}

// ════════════════════════════════════════════════════════
// MODALES
// ════════════════════════════════════════════════════════
function abrirModal(id) {
    document.getElementById(id).style.display='flex';
    document.body.style.overflow='hidden';
}
function cerrarModal(id) {
    document.getElementById(id).style.display='none';
    document.body.style.overflow='';
}
document.addEventListener('click', e=>{
    ['modal-contrato','modal-comprobante','modal-catalogo','modal-ot'].forEach(id=>{
        const el=document.getElementById(id);
        if(el && e.target===el) {
            cerrarModal(id);
            if(id==='modal-contrato') detenerCamaraContrato();
            if(id==='modal-ot') detenerCamaraOT();
        }
    });
});

// ════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════
let toastTid;
function toast(msg, tipo='success') {
    const el=document.getElementById('toast'), inner=document.getElementById('toast-inner');
    const estilos={success:'bg-emerald-700 text-white',error:'bg-red-700 text-white',info:'bg-blue-700 text-white'};
    const iconos ={success:'✓',error:'✕',info:'ℹ'};
    inner.className=`flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl min-w-60 max-w-sm ${estilos[tipo]||estilos.info}`;
    document.getElementById('toast-icon').textContent=iconos[tipo]||'•';
    document.getElementById('toast-msg').textContent=msg;
    el.classList.remove('translate-y-20','opacity-0');
    el.classList.add('translate-y-0','opacity-100');
    clearTimeout(toastTid);
    toastTid=setTimeout(()=>{
        el.classList.add('translate-y-20','opacity-0');
        el.classList.remove('translate-y-0','opacity-100');
    }, 3500);
}

// ════════════════════════════════════════════════════════
// GENERAR Y DESCARGAR PDF (html2pdf.js — descarga directa, sin diálogos)
// ════════════════════════════════════════════════════════
function generarPDF(css, bodyHtml, filename) {
    if (typeof html2pdf === 'undefined') {
        return toast('No se pudo cargar el generador de PDF (revisa tu conexión a internet)', 'error');
    }
    toast('Generando PDF…', 'info');

    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // El contenedor visible para html2pdf debe quedar en flujo normal (sin position
    // fixed/absolute): html2pdf.js clona este nodo dentro de su propio wrapper interno
    // (height:auto), y un hijo fuera de flujo no aporta altura, dejando el PDF en blanco.
    // Por eso lo ocultamos desde un wrapper externo de 0x0 con overflow:hidden.
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;';

    const cont = document.createElement('div');
    cont.style.cssText = 'width:816px;background:#fff;';
    cont.innerHTML = bodyHtml;

    wrapper.appendChild(cont);
    document.body.appendChild(wrapper);

    const limpiar = () => { wrapper.remove(); styleEl.remove(); };

    // Página única con alto dinámico según el contenido real: evita que la paginación
    // automática de html2pdf (basada en una imagen rasterizada) corte partidas, tablas
    // o el total a la mitad cuando el contenido queda justo en el borde de una página.
    const anchoIn = 8.5;
    const altoIn  = cont.scrollHeight / 96 + 0.05;

    html2pdf().set({
        margin: 0,
        filename,
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { scale: 2.5, useCORS: true },
        jsPDF: { unit: 'in', format: [anchoIn, altoIn], orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all'] },
    }).from(cont).save().then(() => {
        limpiar();
        toast('PDF descargado', 'success');
    }).catch(err => {
        limpiar();
        toast('Error al generar el PDF: ' + err.message, 'error');
    });
}

// ════════════════════════════════════════════════════════
// EXPORTAR PDF (premium)
// ════════════════════════════════════════════════════════
function exportarPDF(id) {
    const p = presupuestos.find(x => x.id === id);
    if (!p) return toast('Presupuesto no encontrado','error');
    const c = calcPresupuesto(p);
    const h = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const M = n => '$ ' + Math.round(n||0).toLocaleString('es-CL');
    const FL = iso => { if(!iso) return '—'; const ms=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],[y,m,d]=iso.split('-'); return `${parseInt(d)} de ${ms[parseInt(m)-1]} de ${y}`; };
    const rc = [p.cliente.comuna, p.cliente.region].filter(Boolean).join(' — ');

    const capsHtml = p.capitulos.map((cap, ci) => {
        const capTot = cap.items.reduce((s,it)=>s+it.total,0);
        const rows = cap.items.map((it,ii)=>`
            <tr>
                <td class="num">${h(it.numero)}</td>
                <td class="cod">${h(it.codigo)}</td>
                <td>${h(it.descripcion)}</td>
                <td class="cen">${h(it.unidad)}</td>
                <td class="der">${it.cantidad}</td>
                <td class="der">${M(it.precioUnit)}</td>
                <td class="der total-col">${M(it.total)}</td>
            </tr>`).join('');
        return `
            <div class="cap-bloque">
                <div class="cap-hdr"><span>${h(cap.numero)} — ${h(cap.nombre||'Sin nombre')}</span><span>${M(capTot)}</span></div>
                <table>
                    <thead><tr><th class="num">Partida</th><th class="cod">Código</th><th>Descripción</th><th class="cen">Un.</th><th class="der">Cant.</th><th class="der">P.Unit.</th><th class="der">Total</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }).join('');

    const css = `
.pdf-doc{font-family:'Segoe UI',system-ui,Arial,sans-serif;color:#0f172a;background:#fff}
.pdf-doc *{box-sizing:border-box}
.page{display:flex;flex-direction:column}
.stripe-top{height:5px;background:linear-gradient(90deg,#d97706,#f59e0b,#fbbf24)}
.hdr{background:#0a0f1e;padding:26px 38px 22px;display:flex;justify-content:space-between;align-items:flex-start}
.co-name{font-size:14.5pt;font-weight:900;color:#fff;letter-spacing:1px;text-transform:uppercase}
.co-tag{font-size:7.5pt;color:#d97706;letter-spacing:3px;text-transform:uppercase;margin-top:5px;font-weight:600}
.co-info{font-size:7.5pt;color:#64748b;margin-top:10px;line-height:1.9}
.ppto-ref{text-align:right}
.ppto-lbl{font-size:6.5pt;color:#64748b;text-transform:uppercase;letter-spacing:2.5px;font-weight:600}
.ppto-num{font-size:22pt;font-weight:900;color:#d97706;letter-spacing:2px;line-height:1;margin-top:3px}
.ppto-sub{font-size:7.5pt;color:#64748b;margin-top:6px;line-height:1.7}
.body{padding:22px 38px 30px;flex:1}
.titulo-blk{display:flex;align-items:center;gap:14px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #e2e8f0}
.titulo-txt{font-size:22pt;font-weight:900;color:#0a0f1e;letter-spacing:8px;text-transform:uppercase;line-height:1}
.titulo-dot{width:8px;height:8px;background:#d97706;border-radius:50%;flex-shrink:0}
.titulo-ln{flex:1;height:1px;background:linear-gradient(90deg,#e2e8f0,transparent)}
.info-grid{display:grid;grid-template-columns:1.1fr 0.9fr;gap:14px;margin-bottom:18px}
.info-card{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.info-hdr{background:#0a0f1e;padding:7px 14px;display:flex;align-items:center;gap:7px}
.info-hdr span{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#94a3b8}
.info-dot{width:5px;height:5px;background:#d97706;border-radius:50%;flex-shrink:0}
.info-body{padding:10px 14px;display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}
.cl{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8}
.cv{font-size:9.5pt;font-weight:600;color:#0f172a;margin-top:2px}
.cv.big{font-size:11pt;font-weight:700}
.sec-tit{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#64748b;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.sec-tit::after{content:'';flex:1;height:1px;background:#e2e8f0}
.cap-bloque{margin-bottom:14px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}
.cap-hdr{background:#0a0f1e;color:#fff;padding:7px 10px;display:flex;justify-content:space-between;font-size:9pt;font-weight:700}
.cap-hdr span:last-child{color:#d97706}
table{width:100%;border-collapse:collapse;font-size:8.5pt}
thead tr{background:#f1f5f9}
thead th{padding:6px 8px;text-align:left;font-size:7pt;text-transform:uppercase;letter-spacing:.5px;font-weight:700;color:#64748b}
tbody tr{border-bottom:1px solid #f1f5f9}
tbody tr:nth-child(even){background:#fafafa}
tbody td{padding:5px 8px;vertical-align:middle}
.num{width:40px;font-size:7.5pt;font-weight:700;color:#94a3b8}
.cod{width:90px;font-size:7.5pt;font-family:monospace;color:#64748b}
.cen{text-align:center;color:#64748b;font-size:8pt}
.der{text-align:right}.total-col{font-weight:700;color:#0a0f1e}
.notas{background:#fffbeb;border-left:3px solid #d97706;padding:8px 12px;font-size:8pt;color:#92400e;margin-bottom:14px;line-height:1.5;border-radius:0 6px 6px 0}
.notas b{font-size:6pt;text-transform:uppercase;letter-spacing:1.5px;display:block;margin-bottom:3px}
.resumen{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px}
.res-row{display:flex;justify-content:space-between;padding:6px 14px;font-size:9pt;border-bottom:1px solid #f1f5f9}
.res-row.sub{background:#eff6ff;font-weight:700;color:#1e40af}
.res-row span:last-child{font-weight:700}
.res-total{display:flex;justify-content:space-between;align-items:center;background:#0a0f1e;padding:10px 14px;font-size:12pt;font-weight:900}
.res-total span:first-child{color:#fff}
.res-total span:last-child{color:#d97706;font-size:16pt}
.bottom{display:flex;justify-content:flex-end;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:14px}
.firma-box{text-align:center;width:240px}
.firma-lin{border-top:1.5px solid #0a0f1e;margin-bottom:8px}
.firma-emp{font-size:7.5pt;font-weight:900;color:#0a0f1e;text-transform:uppercase;letter-spacing:.5px}
.firma-nom{font-size:9pt;font-weight:600;margin-top:3px}
.firma-car{font-size:7pt;color:#475569;margin-top:2px}
.stripe-bot{height:4px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#d97706)}
.cap-bloque,.resumen,.bottom{page-break-inside:avoid}
`;

    const bodyHtml = `
<div class="pdf-doc"><div class="page">
<div class="stripe-top"></div>
<div class="hdr">
  <div>
    <div class="co-name">Constructora e Instalaciones PHH SpA</div>
    <div class="co-tag">Ingeniería y Construcción</div>
    <div class="co-info">Chimborazo #1037 Dpto. 22 — Santiago &nbsp;·&nbsp; RUT: 77.234.145-8<br>contacto@phhspa.com &nbsp;·&nbsp; +56 9 3918 0369</div>
  </div>
  <div class="ppto-ref">
    <div class="ppto-lbl">N° Presupuesto</div>
    <div class="ppto-num">${h(p.numero)}</div>
    <div class="ppto-sub">Fecha: ${FL(p.fecha)}<br>Validez: ${p.validez} días</div>
  </div>
</div>
<div class="body">
  <div class="titulo-blk"><div class="titulo-txt">Presupuesto</div><div class="titulo-dot"></div><div class="titulo-ln"></div></div>
  <div class="info-grid">
    <div class="info-card">
      <div class="info-hdr"><div class="info-dot"></div><span>Datos del cliente</span></div>
      <div class="info-body">
        <div style="grid-column:1/-1"><div class="cl">Propietario / Empresa</div><div class="cv big">${h(p.cliente.nombre)}</div></div>
        ${p.cliente.rut?`<div><div class="cl">RUT</div><div class="cv">${h(p.cliente.rut)}</div></div>`:'<div></div>'}
        ${p.cliente.telefono?`<div><div class="cl">Teléfono</div><div class="cv">${h(p.cliente.telefono)}</div></div>`:'<div></div>'}
        <div style="grid-column:1/-1"><div class="cl">Dirección</div><div class="cv">${h(p.cliente.direccion)}</div></div>
        <div style="grid-column:1/-1"><div class="cl">Ciudad / Región</div><div class="cv">${h(rc)}</div></div>
      </div>
    </div>
    <div class="info-card">
      <div class="info-hdr"><div class="info-dot"></div><span>Condiciones</span></div>
      <div class="info-body" style="grid-template-columns:1fr;">
        <div><div class="cl">Condición de pago</div><div class="cv big">${h(p.condicion)}</div></div>
        <div><div class="cl">Vigencia</div><div class="cv">${p.validez} días</div></div>
        <div><div class="cl">Fecha de emisión</div><div class="cv">${FL(p.fecha)}</div></div>
      </div>
    </div>
  </div>
  <div class="sec-tit">Detalle de capítulos y partidas</div>
  ${capsHtml}
  ${p.notas?`<div class="notas"><b>Notas y condiciones</b>${h(p.notas)}</div>`:''}
  <div class="resumen">
    <div class="res-row"><span>Total Costo Directo</span><span>${M(c.costoDirecto)}</span></div>
    ${p.usarGGUtil !== false ? `
    <div class="res-row"><span>Gastos Generales (${p.ggPct}%)</span><span>${M(c.gg)}</span></div>
    <div class="res-row"><span>Utilidades (${p.utilPct}%)</span><span>${M(c.util)}</span></div>` : ''}
    <div class="res-row sub"><span>Subtotal Neto</span><span>${M(c.subtotal)}</span></div>
    <div class="res-row"><span>I.V.A. (19%)</span><span>${M(c.iva)}</span></div>
    <div class="res-total"><span>Total General</span><span>${M(c.total)}</span></div>
  </div>
  <div class="bottom">
    <div class="firma-box">
      ${FIRMA_PABLO_B64?`<img src="${FIRMA_PABLO_B64}" alt="Firma" style="height:50px;margin:0 auto 4px;display:block;">`:''}
      <div class="firma-lin"></div>
      <div class="firma-emp">Constructora e Instalaciones PHH SpA</div>
      <div class="firma-nom">Pablo Orlando Huaiquiman Herrera</div>
      <div class="firma-car">Ingeniero Constructor · Ingeniero Civil Industrial</div>
    </div>
  </div>
</div>
<div class="stripe-bot"></div>
</div></div>`;

    generarPDF(css, bodyHtml, `${p.numero}.pdf`);
}

// ════════════════════════════════════════════════════════
// EXPORTAR PDF · ORDEN DE TRABAJO
// ════════════════════════════════════════════════════════
function exportarOTPDF(presId, id) {
    const p  = presupuestos.find(x => x.id === presId);
    const ot = p?.ordenesTrabajo.find(x => x.id === id);
    if (!p || !ot) return toast('Orden de trabajo no encontrada','error');
    const c = calcPresupuesto(p);
    const h = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const M = n => '$ ' + Math.round(n||0).toLocaleString('es-CL');
    const FL = iso => { if(!iso) return '—'; const ms=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],[y,m,d]=iso.split('-'); return `${parseInt(d)} de ${ms[parseInt(m)-1]} de ${y}`; };
    const rc = [p.cliente.comuna, p.cliente.region].filter(Boolean).join(' — ');

    const capsHtml = p.capitulos.map((cap, ci) => {
        const capTot = cap.items.reduce((s,it)=>s+it.total,0);
        const rows = cap.items.map((it,ii)=>`
            <tr>
                <td class="num">${h(it.numero)}</td>
                <td class="cod">${h(it.codigo)}</td>
                <td>${h(it.descripcion)}</td>
                <td class="cen">${h(it.unidad)}</td>
                <td class="der">${it.cantidad}</td>
                <td class="der">${M(it.precioUnit)}</td>
                <td class="der total-col">${M(it.total)}</td>
            </tr>`).join('');
        return `
            <div class="cap-bloque">
                <div class="cap-hdr"><span>${h(cap.numero)} — ${h(cap.nombre||'Sin nombre')}</span><span>${M(capTot)}</span></div>
                <table>
                    <thead><tr><th class="num">Partida</th><th class="cod">Código</th><th>Descripción</th><th class="cen">Un.</th><th class="der">Cant.</th><th class="der">P.Unit.</th><th class="der">Total</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }).join('');

    const css = `
.pdf-doc{font-family:'Segoe UI',system-ui,Arial,sans-serif;color:#0f172a;background:#fff}
.pdf-doc *{box-sizing:border-box}
.page{display:flex;flex-direction:column}
.stripe-top{height:5px;background:linear-gradient(90deg,#4338ca,#6366f1,#818cf8)}
.hdr{background:#0a0f1e;padding:26px 38px 22px;display:flex;justify-content:space-between;align-items:flex-start}
.co-name{font-size:14.5pt;font-weight:900;color:#fff;letter-spacing:1px;text-transform:uppercase}
.co-tag{font-size:7.5pt;color:#818cf8;letter-spacing:3px;text-transform:uppercase;margin-top:5px;font-weight:600}
.co-info{font-size:7.5pt;color:#64748b;margin-top:10px;line-height:1.9}
.ppto-ref{text-align:right}
.ppto-lbl{font-size:6.5pt;color:#64748b;text-transform:uppercase;letter-spacing:2.5px;font-weight:600}
.ppto-num{font-size:19pt;font-weight:900;color:#818cf8;letter-spacing:1px;line-height:1;margin-top:3px}
.ppto-sub{font-size:7.5pt;color:#64748b;margin-top:6px;line-height:1.7}
.body{padding:22px 38px 30px;flex:1}
.titulo-blk{display:flex;align-items:center;gap:14px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #e2e8f0}
.titulo-txt{font-size:19pt;font-weight:900;color:#0a0f1e;letter-spacing:4px;text-transform:uppercase;line-height:1}
.titulo-dot{width:8px;height:8px;background:#4338ca;border-radius:50%;flex-shrink:0}
.titulo-ln{flex:1;height:1px;background:linear-gradient(90deg,#e2e8f0,transparent)}
.info-grid{display:grid;grid-template-columns:1.1fr 0.9fr;gap:14px;margin-bottom:18px}
.info-card{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.info-hdr{background:#0a0f1e;padding:7px 14px;display:flex;align-items:center;gap:7px}
.info-hdr span{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#94a3b8}
.info-dot{width:5px;height:5px;background:#4338ca;border-radius:50%;flex-shrink:0}
.info-body{padding:10px 14px;display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}
.cl{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8}
.cv{font-size:9.5pt;font-weight:600;color:#0f172a;margin-top:2px}
.cv.big{font-size:11pt;font-weight:700}
.sec-tit{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#64748b;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.sec-tit::after{content:'';flex:1;height:1px;background:#e2e8f0}
.cap-bloque{margin-bottom:14px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}
.cap-hdr{background:#0a0f1e;color:#fff;padding:7px 10px;display:flex;justify-content:space-between;font-size:9pt;font-weight:700}
.cap-hdr span:last-child{color:#818cf8}
table{width:100%;border-collapse:collapse;font-size:8.5pt}
thead tr{background:#f1f5f9}
thead th{padding:6px 8px;text-align:left;font-size:7pt;text-transform:uppercase;letter-spacing:.5px;font-weight:700;color:#64748b}
tbody tr{border-bottom:1px solid #f1f5f9}
tbody tr:nth-child(even){background:#fafafa}
tbody td{padding:5px 8px;vertical-align:middle}
.num{width:40px;font-size:7.5pt;font-weight:700;color:#94a3b8}
.cod{width:90px;font-size:7.5pt;font-family:monospace;color:#64748b}
.cen{text-align:center;color:#64748b;font-size:8pt}
.der{text-align:right}.total-col{font-weight:700;color:#0a0f1e}
.resumen{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px}
.res-row{display:flex;justify-content:space-between;padding:6px 14px;font-size:9pt;border-bottom:1px solid #f1f5f9}
.res-row.sub{background:#eef2ff;font-weight:700;color:#4338ca}
.res-row span:last-child{font-weight:700}
.res-total{display:flex;justify-content:space-between;align-items:center;background:#0a0f1e;padding:10px 14px;font-size:12pt;font-weight:900}
.res-total span:first-child{color:#fff}
.res-total span:last-child{color:#818cf8;font-size:16pt}
.bottom{display:flex;justify-content:space-between;gap:20px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:14px}
.firma-box{text-align:center;width:240px}
.firma-lin{border-top:1.5px solid #0a0f1e;margin-bottom:8px}
.firma-emp{font-size:7.5pt;font-weight:900;color:#0a0f1e;text-transform:uppercase;letter-spacing:.5px}
.firma-nom{font-size:9pt;font-weight:600;margin-top:3px}
.firma-car{font-size:7pt;color:#475569;margin-top:2px}
.estado-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:6.5pt;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-top:6px}
.estado-firmada{background:#d1fae5;color:#065f46}
.estado-pendiente{background:#fef3c7;color:#92400e}
.stripe-bot{height:4px;background:linear-gradient(90deg,#818cf8,#6366f1,#4338ca)}
.cap-bloque,.resumen,.bottom{page-break-inside:avoid}
`;

    const bodyHtml = `
<div class="pdf-doc"><div class="page">
<div class="stripe-top"></div>
<div class="hdr">
  <div>
    <div class="co-name">Constructora e Instalaciones PHH SpA</div>
    <div class="co-tag">Ingeniería y Construcción</div>
    <div class="co-info">Chimborazo #1037 Dpto. 22 — Santiago &nbsp;·&nbsp; RUT: 77.234.145-8<br>contacto@phhspa.com &nbsp;·&nbsp; +56 9 3918 0369</div>
  </div>
  <div class="ppto-ref">
    <div class="ppto-lbl">N° Orden de Trabajo</div>
    <div class="ppto-num">${h(ot.numero)}</div>
    <div class="ppto-sub">Fecha: ${FL(ot.fecha)}<br>Presupuesto: ${h(p.numero)}<br><span class="estado-badge ${ot.estado==='firmada'?'estado-firmada':'estado-pendiente'}">${ot.estado==='firmada'?'Firmada':'Pendiente de firma'}</span></div>
  </div>
</div>
<div class="body">
  <div class="titulo-blk"><div class="titulo-txt">Orden de Trabajo</div><div class="titulo-dot"></div><div class="titulo-ln"></div></div>
  <div class="info-grid">
    <div class="info-card">
      <div class="info-hdr"><div class="info-dot"></div><span>Datos del cliente</span></div>
      <div class="info-body">
        <div style="grid-column:1/-1"><div class="cl">Propietario / Empresa</div><div class="cv big">${h(p.cliente.nombre)}</div></div>
        ${p.cliente.rut?`<div><div class="cl">RUT</div><div class="cv">${h(p.cliente.rut)}</div></div>`:'<div></div>'}
        ${p.cliente.telefono?`<div><div class="cl">Teléfono</div><div class="cv">${h(p.cliente.telefono)}</div></div>`:'<div></div>'}
        <div style="grid-column:1/-1"><div class="cl">Dirección</div><div class="cv">${h(p.cliente.direccion)}</div></div>
        <div style="grid-column:1/-1"><div class="cl">Ciudad / Región</div><div class="cv">${h(rc)}</div></div>
      </div>
    </div>
    <div class="info-card">
      <div class="info-hdr"><div class="info-dot"></div><span>Referencia</span></div>
      <div class="info-body" style="grid-template-columns:1fr;">
        <div><div class="cl">Presupuesto asociado</div><div class="cv big">${h(p.numero)}</div></div>
        <div><div class="cl">Condición de pago</div><div class="cv">${h(p.condicion)}</div></div>
        <div><div class="cl">Monto total contrato</div><div class="cv">${M(c.total)}</div></div>
      </div>
    </div>
  </div>
  <div class="sec-tit">Alcance de la obra a ejecutar</div>
  ${capsHtml}
  <div class="resumen">
    <div class="res-row"><span>Total Costo Directo</span><span>${M(c.costoDirecto)}</span></div>
    ${p.usarGGUtil !== false ? `
    <div class="res-row"><span>Gastos Generales (${p.ggPct}%)</span><span>${M(c.gg)}</span></div>
    <div class="res-row"><span>Utilidades (${p.utilPct}%)</span><span>${M(c.util)}</span></div>` : ''}
    <div class="res-row sub"><span>Subtotal Neto</span><span>${M(c.subtotal)}</span></div>
    <div class="res-row"><span>I.V.A. (19%)</span><span>${M(c.iva)}</span></div>
    <div class="res-total"><span>Total Orden de Trabajo</span><span>${M(c.total)}</span></div>
  </div>
  <div class="bottom">
    <div class="firma-box">
      ${FIRMA_PABLO_B64?`<img src="${FIRMA_PABLO_B64}" alt="Firma" style="height:50px;margin:0 auto 4px;display:block;">`:''}
      <div class="firma-lin"></div>
      <div class="firma-emp">Constructora e Instalaciones PHH SpA</div>
      <div class="firma-nom">Pablo Orlando Huaiquiman Herrera</div>
      <div class="firma-car">Ingeniero Constructor · Ingeniero Civil Industrial</div>
    </div>
    <div class="firma-box">
      ${ot.firma?.firmaB64?`<img src="${ot.firma.firmaB64}" alt="Firma cliente" style="height:50px;margin:0 auto 4px;display:block;">`:''}
      <div class="firma-lin"></div>
      <div class="firma-emp">${h(p.cliente.nombre)}</div>
      <div class="firma-nom">&nbsp;</div>
      <div class="firma-car">Recibí conforme — Cliente</div>
    </div>
  </div>
</div>
<div class="stripe-bot"></div>
</div></div>`;

    generarPDF(css, bodyHtml, `${ot.numero}.pdf`);
}
