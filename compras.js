/* Órdenes de compra por proyecto (centro de costo) y su carga a los gastos del proyecto.
   Los permisos reales se validan en Supabase (202610070002_ordenes_compra.sql). */
const Compras = (() => {
    const ESTADOS = { borrador: 'Borrador', emitida: 'Emitida', recibida: 'Recibida', anulada: 'Anulada' };
    const COLOR = { borrador: 'bg-slate-100 text-slate-700', emitida: 'bg-blue-100 text-blue-800', recibida: 'bg-emerald-100 text-emerald-800', anulada: 'bg-red-100 text-red-700' };
    const FORMAS_PAGO = ['Contado', 'Transferencia anticipada', 'Contra recepción de factura, a 30 días', 'Contra recepción de factura, a 45 días', 'Contra recepción de factura, a 60 días', 'Crédito proveedor'];
    const UNIDADES = ['UN', 'Gl', 'm', 'm2', 'm3', 'ml', 'kg', 'Litro', 'Saco', 'Caja', 'Rollo', 'Tira', 'Plancha', 'Cartucho', 'Día', 'Hr'];

    let disponible = false, ordenes = [], ocupado = false;
    let modo = 'lista', ocId = null, form = null, ctxProyectoId = null;
    let filtroProyecto = '', filtroEstado = '', filtroTexto = '', recibiendoId = null;

    const $ = id => document.getElementById(id);
    const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fecha = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
    const fmtCLP = n => '$ ' + Math.round(n || 0).toLocaleString('es-CL');
    const fmtCant = n => (n || 0).toLocaleString('es-CL', { maximumFractionDigits: 4 });
    const numeroOC = oc => `OC-${String(oc.numero).padStart(4, '0')}`;
    const chip = (texto, clases) => `<span class="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap ${clases}">${h(texto)}</span>`;
    const btn = (texto, accion, estilo = 'bg-blue-700 hover:bg-blue-800 text-white') =>
        `<button type="button" onclick="${accion}" class="text-xs px-3 py-2 rounded-lg font-bold transition-colors ${estilo}">${texto}</button>`;
    const tarjeta = (titulo, cuerpo, extra = '') =>
        `<section class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"><div class="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2"><h3 class="font-bold text-slate-800">${titulo}</h3>${extra}</div><div class="p-5">${cuerpo}</div></section>`;
    const campo = (label, input, clases = '') => `<label class="block ${clases}"><span class="campo-label">${h(label)}</span>${input}</label>`;
    const hoyChile = () => {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const part = t => parts.find(p => p.type === t).value;
        return `${part('year')}-${part('month')}-${part('day')}`;
    };
    // Montos en pesos: "1.234.567" → 1234567.
    const pesos = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
    // Cantidades: "1.380" (miles) → 1380 · "2,5" o "2.5" → 2.5.
    function cantidad(v) {
        let s = String(v ?? '').trim();
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : 0;
    }

    // ── Cálculo ───────────────────────────────────────────
    function calcular(f) {
        const items = f.items.map(it => ({ ...it, total: Math.round((+it.cantidad || 0) * (+it.precio || 0)) }));
        const subtotal = items.reduce((s, it) => s + it.total, 0);
        const descuento = Math.round(+f.descuento || 0), cargos = Math.round(+f.cargos || 0);
        const neto = subtotal - descuento + cargos;
        const iva_pct = +f.iva_pct || 0;
        const iva = Math.round(neto * iva_pct / 100);
        return { items, totales: { subtotal, descuento, cargos, neto, iva_pct, iva, total: neto + iva } };
    }

    // ── Datos ─────────────────────────────────────────────
    const proyectoDe = oc => Proyectos.lista.find(p => p.id === oc.proyecto_id) || null;
    const deProyecto = id => ordenes.filter(o => o.proyecto_id === id);
    const actual = () => ordenes.find(o => o.id === ocId) || null;
    const proyectosActivos = () => Proyectos.lista.filter(p => p.estado === 'activo');
    function reemplazar(fila) {
        const i = ordenes.findIndex(x => x.id === fila.id);
        if (i >= 0) ordenes[i] = fila; else ordenes.push(fila);
    }
    async function ejecutar(promesa, exito) {
        if (ocupado) return null;
        ocupado = true;
        try {
            const { data, error } = await promesa;
            if (error) throw error;
            if (exito) toast(exito, 'success');
            return data ?? true;
        } catch (error) {
            toast('No se pudo guardar: ' + (error.message || error), 'error');
            return null;
        } finally { ocupado = false; }
    }

    async function cargar() {
        disponible = false;
        if (!supa || !empresaActual || !Proyectos.disponible) { $('nav-compras')?.classList.add('hidden'); return; }
        const { data, error } = await supa.from('ordenes_compra').select('*').order('numero', { ascending: false });
        const faltaTabla = error && (['42P01', 'PGRST205', 'PGRST202'].includes(error.code) || /ordenes_compra/.test(error.message || ''));
        disponible = !faltaTabla;
        $('nav-compras')?.classList.toggle('hidden', !disponible);
        if (faltaTabla) return;
        if (error) toast('No se pudieron cargar las órdenes de compra: ' + error.message, 'error');
        ordenes = data || [];
    }

    // ── Render ────────────────────────────────────────────
    function render() {
        const root = $('oc-root');
        if (!root) return;
        ctxProyectoId = null;
        root.innerHTML = disponible ? cuerpo()
            : '<div class="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500"><p class="font-semibold">Módulo de órdenes de compra no disponible</p><p class="text-xs mt-1">Falta aplicar la actualización de base de datos.</p></div>';
    }
    function htmlProyecto(pr) {
        ctxProyectoId = pr.id;
        if (modo === 'ver' && actual()?.proyecto_id !== pr.id) modo = 'lista';
        return cuerpo();
    }
    function cuerpo() {
        if (modo === 'editar' && form) return editorHtml();
        if (modo === 'ver' && actual()) return detalleHtml(actual());
        modo = 'lista';
        return listaHtml();
    }
    function refrescar() {
        if (!$('tab-compras')?.classList.contains('hidden')) render();
        if (!$('tab-proyectos')?.classList.contains('hidden')) Proyectos.render();
    }
    function reiniciar() { modo = 'lista'; ocId = null; form = null; recibiendoId = null; }

    // ── Lista ─────────────────────────────────────────────
    function listaHtml() {
        const enProyecto = !!ctxProyectoId;
        const texto = filtroTexto.toLowerCase();
        const base = enProyecto ? deProyecto(ctxProyectoId) : ordenes;
        const lista = ordenarRecientes(base.filter(o =>
            (enProyecto || !filtroProyecto || o.proyecto_id === filtroProyecto) &&
            (!filtroEstado || o.estado === filtroEstado) &&
            (!texto || numeroOC(o).toLowerCase().includes(texto) || (o.proveedor?.nombre || '').toLowerCase().includes(texto) || (o.numero_externo || '').toLowerCase().includes(texto))
        ), o => o.fecha);
        const suma = f => base.filter(f).reduce((s, o) => s + (o.totales?.total || 0), 0);
        const kpi = (label, valor, nota, tono) => `<div class="rounded-xl border p-3 ${tono}"><p class="text-xs opacity-75 font-medium">${label}</p><p class="text-lg font-black mt-0.5">${valor}</p><p class="text-xs opacity-70 mt-0.5">${nota}</p></div>`;
        const kpis = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            ${kpi('Borradores por emitir', base.filter(o => o.estado === 'borrador').length, fmtCLP(suma(o => o.estado === 'borrador')), 'bg-slate-50 border-slate-200 text-slate-800')}
            ${kpi('Emitidas por recibir', base.filter(o => o.estado === 'emitida').length, fmtCLP(suma(o => o.estado === 'emitida')), 'bg-blue-50 border-blue-200 text-blue-800')}
            ${kpi('Sin cargar a gastos', base.filter(o => ['emitida', 'recibida'].includes(o.estado) && !o.gasto_id).length, fmtCLP(suma(o => ['emitida', 'recibida'].includes(o.estado) && !o.gasto_id)), 'bg-amber-50 border-amber-200 text-amber-800')}
            ${kpi('Cargadas a gastos', base.filter(o => o.gasto_id).length, fmtCLP(suma(o => o.gasto_id)), 'bg-emerald-50 border-emerald-200 text-emerald-800')}
        </div>`;
        const opciones = (obj, sel, vacio) => `<option value="">${vacio}</option>` + Object.entries(obj).map(([k, t]) => `<option value="${h(k)}" ${k === sel ? 'selected' : ''}>${h(t)}</option>`).join('');
        const filtros = `<div class="flex flex-wrap gap-2 mb-3">
            <input type="search" value="${h(filtroTexto)}" oninput="Compras.filtrar('texto',this.value)" placeholder="Buscar N° OC o proveedor…" class="campo-input flex-1 min-w-[180px]">
            ${enProyecto ? '' : `<select onchange="Compras.filtrar('proyecto',this.value)" class="campo-input w-auto">${opciones(Object.fromEntries(Proyectos.lista.map(p => [p.id, `${p.codigo} — ${p.nombre}`])), filtroProyecto, 'Todos los proyectos')}</select>`}
            <select onchange="Compras.filtrar('estado',this.value)" class="campo-input w-auto">${opciones(ESTADOS, filtroEstado, 'Todos los estados')}</select>
        </div>`;
        const filas = lista.map(o => {
            const pr = proyectoDe(o);
            return `<tr class="border-t border-slate-100 cursor-pointer hover:bg-amber-50/50" onclick="Compras.ver('${o.id}')">
                <td class="px-3 py-2.5 font-mono text-xs font-bold text-amber-700 whitespace-nowrap">${numeroOC(o)}${o.numero_externo ? `<span class="block font-sans font-normal text-slate-400">Ext. ${h(o.numero_externo)}</span>` : ''}</td>
                <td class="px-3 py-2.5 whitespace-nowrap text-slate-500">${fecha(o.fecha)}</td>
                ${enProyecto ? '' : `<td class="px-3 py-2.5"><span class="font-semibold text-slate-700">${h(pr?.codigo || '—')}</span><span class="block text-xs text-slate-400 truncate max-w-[220px]">${h(pr?.nombre || '')}</span></td>`}
                <td class="px-3 py-2.5 font-semibold text-slate-800">${h(o.proveedor?.nombre)}</td>
                <td class="px-3 py-2.5 text-right font-bold whitespace-nowrap">${fmtCLP(o.totales?.total)}</td>
                <td class="px-3 py-2.5">${chip(ESTADOS[o.estado], COLOR[o.estado])}${o.gasto_id ? `<span class="block text-xs text-emerald-700 font-semibold mt-1">✔ En gastos</span>` : ''}</td>
            </tr>`;
        }).join('');
        const puedeCrear = enProyecto ? proyectoDe({ proyecto_id: ctxProyectoId })?.estado === 'activo' : proyectosActivos().length > 0;
        const nueva = puedeCrear ? btn('+ Nueva orden de compra', 'Compras.nueva()', 'bg-amber-600 hover:bg-amber-700 text-white') : '';
        const tabla = filas ? `<div class="overflow-x-auto"><table class="w-full text-sm ${enProyecto ? 'min-w-[620px]' : 'min-w-[780px]'}"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr>
                <th class="px-3 py-2 text-left">N° OC</th><th class="px-3 py-2 text-left">Fecha</th>${enProyecto ? '' : '<th class="px-3 py-2 text-left">Proyecto</th>'}<th class="px-3 py-2 text-left">Proveedor</th><th class="px-3 py-2 text-right">Total</th><th class="px-3 py-2 text-left">Estado</th>
            </tr></thead><tbody>${filas}</tbody></table></div>`
            : `<p class="text-sm text-slate-400 py-6 text-center">${base.length ? 'No hay órdenes de compra con estos filtros.' : (puedeCrear ? 'Aún no hay órdenes de compra. Crea la primera con “Nueva orden de compra”.' : 'Abre un centro de costo en Proyectos para emitir órdenes de compra.')}</p>`;
        if (enProyecto) return `<div class="space-y-4">${kpis}${tarjeta('Órdenes de compra del proyecto', filtros + tabla, nueva)}</div>`;
        return `<div class="space-y-5">
            <div class="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl px-6 py-5 flex flex-wrap items-center justify-between gap-3">
                <div><h2 class="text-white text-lg font-bold">Órdenes de Compra</h2><p class="text-slate-300 text-xs mt-0.5">Compras a proveedores asociadas a cada proyecto y cargadas a sus gastos</p></div>${nueva}
            </div>
            ${kpis}
            ${tarjeta('Todas las órdenes de compra', filtros + tabla)}
        </div>`;
    }
    function filtrar(tipo, valor) {
        if (tipo === 'proyecto') filtroProyecto = valor;
        else if (tipo === 'estado') filtroEstado = valor;
        else filtroTexto = valor;
        refrescar();
        if (tipo === 'texto') {
            const input = document.querySelector('input[type="search"][oninput^="Compras.filtrar"]');
            if (input) { input.focus(); input.setSelectionRange(valor.length, valor.length); }
        }
    }

    // ── Editor ────────────────────────────────────────────
    const itemVacio = () => ({ codigo: '', detalle: '', unidad: 'UN', cantidad: 1, precio: 0 });
    function direccionObra(proyectoId) {
        const pr = Proyectos.lista.find(p => p.id === proyectoId);
        const p = pr && Proyectos.presupuestoDe(pr);
        return p ? [p.cliente.direccion, p.cliente.comuna].filter(Boolean).join(', ') : '';
    }
    function nueva() {
        const proyectoId = ctxProyectoId || (filtroProyecto && proyectosActivos().some(p => p.id === filtroProyecto) ? filtroProyecto : (proyectosActivos().length === 1 ? proyectosActivos()[0].id : ''));
        form = {
            id: null, proyecto_id: proyectoId, fecha: hoyChile(), categoria: 'materiales',
            proveedor: { nombre: '', rut: '', direccion: '', ciudad: '', telefono: '', vendedor: '', email: '' },
            forma_pago: '', despacho: { direccion: direccionObra(proyectoId), contacto: miPerfil?.nombre || '', fecha_entrega: '' },
            items: [itemVacio()], descuento: 0, cargos: 0, iva_pct: 19,
            observaciones: '', numero_externo: '', adjunto_path: null, archivo: null,
        };
        modo = 'editar';
        refrescar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function editar(id) {
        const o = ordenes.find(x => x.id === id);
        if (!o) return;
        form = {
            id: o.id, proyecto_id: o.proyecto_id, fecha: o.fecha, categoria: o.categoria,
            proveedor: { nombre: '', rut: '', direccion: '', ciudad: '', telefono: '', vendedor: '', email: '', ...o.proveedor },
            forma_pago: o.forma_pago || '', despacho: { direccion: '', contacto: '', fecha_entrega: '', ...o.despacho },
            items: (o.items || []).map(it => ({ codigo: it.codigo || '', detalle: it.detalle || '', unidad: it.unidad || '', cantidad: +it.cantidad || 0, precio: +it.precio || 0 })),
            descuento: o.totales?.descuento || 0, cargos: o.totales?.cargos || 0, iva_pct: o.totales?.iva_pct ?? 19,
            observaciones: o.observaciones || '', numero_externo: o.numero_externo || '', adjunto_path: o.adjunto_path, archivo: null,
        };
        if (!form.items.length) form.items.push(itemVacio());
        modo = 'editar';
        refrescar();
    }
    function cancelar() {
        modo = form?.id ? 'ver' : 'lista';
        if (form?.id) ocId = form.id;
        form = null;
        refrescar();
    }

    function set(ruta, valor) {
        if (!form) return;
        const [a, b] = ruta.split('.');
        if (b) form[a][b] = valor; else form[a] = valor;
        if (ruta === 'descuento' || ruta === 'cargos') form[ruta] = pesos(valor);
        if (ruta === 'iva_pct') form.iva_pct = +valor;
        if (ruta === 'proyecto_id') {
            if (!form.despacho.direccion) form.despacho.direccion = direccionObra(valor);
            return refrescar();
        }
        if (ruta === 'proveedor.nombre') autocompletarProveedor(valor);
        pintarTotales();
    }
    function setItem(i, clave, valor) {
        const it = form?.items[i];
        if (!it) return;
        it[clave] = clave === 'cantidad' ? cantidad(valor) : clave === 'precio' ? pesos(valor) : valor;
        pintarTotales();
    }
    function agregarItem() { form.items.push(itemVacio()); refrescar(); setTimeout(() => $(`oc-it-det-${form.items.length - 1}`)?.focus(), 30); }
    function quitarItem(i) { if (form.items.length > 1) { form.items.splice(i, 1); refrescar(); } }
    function setArchivo(file) { if (form) form.archivo = file || null; }

    // Proveedores ya usados: al escribir uno conocido se completan sus datos.
    function proveedoresConocidos() {
        const mapa = new Map();
        ordenarRecientes(ordenes, o => o.fecha).forEach(o => {
            const n = (o.proveedor?.nombre || '').trim();
            if (n && !mapa.has(n.toLowerCase())) mapa.set(n.toLowerCase(), { ...o.proveedor, forma_pago: o.forma_pago });
        });
        return mapa;
    }
    function autocompletarProveedor(nombre) {
        const prov = proveedoresConocidos().get(String(nombre).trim().toLowerCase());
        if (!prov || !form) return;
        let cambio = false;
        ['rut', 'direccion', 'ciudad', 'telefono', 'vendedor', 'email'].forEach(k => {
            if (!form.proveedor[k] && prov[k]) { form.proveedor[k] = prov[k]; cambio = true; const el = $(`oc-prov-${k}`); if (el) el.value = prov[k]; }
        });
        if (!form.forma_pago && prov.forma_pago) { form.forma_pago = prov.forma_pago; const el = $('oc-forma-pago'); if (el) el.value = prov.forma_pago; cambio = true; }
        if (cambio) toast('Datos del proveedor completados desde una OC anterior', 'info');
    }

    function totalesHtml(t) {
        const fila = (label, valor, clases = '') => `<div class="flex justify-between px-4 py-2 border-b border-slate-100 text-sm ${clases}"><span>${label}</span><span class="font-semibold">${valor}</span></div>`;
        return `<div class="rounded-xl border border-slate-200 overflow-hidden">
            ${fila('Subtotal', fmtCLP(t.subtotal))}
            ${t.descuento ? fila('Descuentos', '− ' + fmtCLP(t.descuento)) : ''}
            ${t.cargos ? fila('Cargos (flete u otros)', fmtCLP(t.cargos)) : ''}
            ${fila('Neto', fmtCLP(t.neto), 'bg-amber-50 text-amber-900 font-bold')}
            ${fila(t.iva_pct ? `IVA (${t.iva_pct}%)` : 'Exento de IVA', fmtCLP(t.iva))}
            <div class="flex justify-between px-4 py-3 bg-slate-900 text-white font-black"><span>TOTAL</span><span class="text-amber-400">${fmtCLP(t.total)}</span></div>
        </div>`;
    }
    function pintarTotales() {
        if (!form) return;
        const c = calcular(form);
        c.items.forEach((it, i) => { const el = $(`oc-lt-${i}`); if (el) el.textContent = fmtCLP(it.total); });
        const el = $('oc-totales');
        if (el) el.innerHTML = totalesHtml(c.totales);
    }

    function editorHtml() {
        const f = form, c = calcular(f);
        const enProyecto = !!ctxProyectoId;
        const activos = proyectosActivos();
        const inp = (id, ruta, valor, extra = '') => `<input id="${id}" value="${h(valor)}" oninput="Compras.set('${ruta}',this.value)" class="campo-input mt-1" ${extra}>`;
        const filas = f.items.map((it, i) => `<tr class="border-t border-slate-100 align-top">
            <td class="px-2 py-2 text-xs font-bold text-slate-400 pt-4">${i + 1}</td>
            <td class="px-1 py-2"><input value="${h(it.codigo)}" oninput="Compras.setItem(${i},'codigo',this.value)" maxlength="40" class="campo-input text-xs font-mono" placeholder="Opcional"></td>
            <td class="px-1 py-2"><input id="oc-it-det-${i}" value="${h(it.detalle)}" oninput="Compras.setItem(${i},'detalle',this.value)" maxlength="300" required class="campo-input" placeholder="Artículo o servicio"></td>
            <td class="px-1 py-2"><input value="${h(it.unidad)}" list="oc-unidades" oninput="Compras.setItem(${i},'unidad',this.value)" maxlength="20" class="campo-input text-center"></td>
            <td class="px-1 py-2"><input value="${h(String(it.cantidad).replace('.', ','))}" inputmode="decimal" oninput="Compras.setItem(${i},'cantidad',this.value)" class="campo-input text-right"></td>
            <td class="px-1 py-2"><input value="${it.precio ? h(Math.round(it.precio).toLocaleString('es-CL')) : ''}" inputmode="numeric" oninput="Compras.setItem(${i},'precio',this.value)" class="campo-input text-right" placeholder="0"></td>
            <td id="oc-lt-${i}" class="px-2 py-2 pt-4 text-right font-bold whitespace-nowrap">${fmtCLP(c.items[i].total)}</td>
            <td class="px-1 py-2 pt-3">${f.items.length > 1 ? `<button type="button" onclick="Compras.quitarItem(${i})" title="Quitar línea" class="text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50">✕</button>` : ''}</td>
        </tr>`).join('');
        const conocidos = [...proveedoresConocidos().values()];
        return `<form onsubmit="Compras.guardar(event)" class="space-y-4">
            <div class="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div><button type="button" onclick="Compras.cancelar()" class="text-slate-300 hover:text-white text-xs font-semibold">← Volver</button>
                <h2 class="text-white text-lg font-bold">${f.id ? `Editar ${numeroOC(ordenes.find(o => o.id === f.id) || { numero: 0 })}` : 'Nueva orden de compra'}</h2>
                <p class="text-slate-300 text-xs">Se guarda como borrador; el administrador del proyecto la emite.</p></div>
            </div>
            ${tarjeta('Proyecto y condiciones', `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                ${campo('Proyecto (centro de costo)', `<select required onchange="Compras.set('proyecto_id',this.value)" class="campo-input mt-1" ${enProyecto ? 'disabled' : ''}><option value="">— Selecciona —</option>${activos.map(p => `<option value="${p.id}" ${p.id === f.proyecto_id ? 'selected' : ''}>${h(p.codigo)} — ${h(p.nombre)}</option>`).join('')}</select>`, 'sm:col-span-2')}
                ${campo('Fecha', `<input type="date" required value="${h(f.fecha)}" onchange="Compras.set('fecha',this.value)" class="campo-input mt-1">`)}
                ${campo('Se carga en gastos como', `<select onchange="Compras.set('categoria',this.value)" class="campo-input mt-1">${Object.entries(Proyectos.CATEGORIAS).map(([k, t]) => `<option value="${k}" ${k === f.categoria ? 'selected' : ''}>${h(t)}</option>`).join('')}</select>`)}
                ${campo('Forma de pago', `<input id="oc-forma-pago" list="oc-formas" value="${h(f.forma_pago)}" oninput="Compras.set('forma_pago',this.value)" maxlength="160" class="campo-input mt-1" placeholder="Ej: Contra factura a 30 días">`, 'sm:col-span-2')}
                ${campo('N° OC externa (opcional)', inp('oc-externo', 'numero_externo', f.numero_externo, 'maxlength="60" placeholder="Ej: OC del mandante / iConstruye"'))}
                ${campo('Fecha de entrega', `<input type="date" value="${h(f.despacho.fecha_entrega)}" onchange="Compras.set('despacho.fecha_entrega',this.value)" class="campo-input mt-1">`)}
            </div>`)}
            ${tarjeta('Proveedor (adquiérase de)', `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                ${campo('Razón social', `<input id="oc-prov-nombre" required list="oc-proveedores" value="${h(f.proveedor.nombre)}" oninput="Compras.set('proveedor.nombre',this.value)" maxlength="160" class="campo-input mt-1">`, 'sm:col-span-2')}
                ${campo('RUT', inp('oc-prov-rut', 'proveedor.rut', f.proveedor.rut, 'maxlength="20"'))}
                ${campo('Teléfono', inp('oc-prov-telefono', 'proveedor.telefono', f.proveedor.telefono, 'maxlength="40"'))}
                ${campo('Dirección', inp('oc-prov-direccion', 'proveedor.direccion', f.proveedor.direccion, 'maxlength="160"'), 'sm:col-span-2')}
                ${campo('Ciudad', inp('oc-prov-ciudad', 'proveedor.ciudad', f.proveedor.ciudad, 'maxlength="80"'))}
                ${campo('Vendedor', inp('oc-prov-vendedor', 'proveedor.vendedor', f.proveedor.vendedor, 'maxlength="80"'))}
                ${campo('Correo', inp('oc-prov-email', 'proveedor.email', f.proveedor.email, 'type="email" maxlength="120"'), 'sm:col-span-2')}
            </div>`)}
            ${tarjeta('Detalle de artículos', `<div class="overflow-x-auto"><table class="w-full text-sm min-w-[760px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr>
                    <th class="px-2 py-2 text-left w-8">N°</th><th class="px-2 py-2 text-left w-28">Código</th><th class="px-2 py-2 text-left">Detalle</th><th class="px-2 py-2 w-24">Unidad</th><th class="px-2 py-2 text-right w-24">Cantidad</th><th class="px-2 py-2 text-right w-32">Valor unitario</th><th class="px-2 py-2 text-right w-32">Total línea</th><th class="w-10"></th>
                </tr></thead><tbody>${filas}</tbody></table></div>
                <button type="button" onclick="Compras.agregarItem()" class="mt-3 text-sm font-semibold text-amber-700 hover:text-amber-800">+ Agregar línea</button>`)}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                ${tarjeta('Despacho y observaciones', `<div class="space-y-3">
                    ${campo('Despachar a', inp('oc-desp-dir', 'despacho.direccion', f.despacho.direccion, 'maxlength="200"'))}
                    ${campo('Contacto de despacho', inp('oc-desp-contacto', 'despacho.contacto', f.despacho.contacto, 'maxlength="160" placeholder="Nombre y teléfono"'))}
                    ${campo('Observaciones / nota al proveedor', `<textarea rows="3" maxlength="1000" oninput="Compras.set('observaciones',this.value)" class="campo-input mt-1">${h(f.observaciones)}</textarea>`)}
                    ${campo('Respaldo (cotización, OC externa o factura · imagen o PDF)', `<input type="file" accept="image/*,application/pdf" onchange="Compras.setArchivo(this.files[0])" class="campo-input mt-1 text-xs">`)}
                    ${f.adjunto_path ? '<p class="text-xs text-slate-500">Ya tiene un respaldo adjunto; si eliges otro archivo, lo reemplaza.</p>' : ''}
                </div>`)}
                ${tarjeta('Totales', `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    ${campo('Descuento ($)', `<input inputmode="numeric" value="${f.descuento ? h(f.descuento.toLocaleString('es-CL')) : ''}" oninput="Compras.set('descuento',this.value)" class="campo-input mt-1 text-right" placeholder="0">`)}
                    ${campo('Cargos / flete ($)', `<input inputmode="numeric" value="${f.cargos ? h(f.cargos.toLocaleString('es-CL')) : ''}" oninput="Compras.set('cargos',this.value)" class="campo-input mt-1 text-right" placeholder="0">`)}
                    ${campo('Impuesto', `<select onchange="Compras.set('iva_pct',this.value)" class="campo-input mt-1"><option value="19" ${+f.iva_pct === 19 ? 'selected' : ''}>Afecta (IVA 19%)</option><option value="0" ${+f.iva_pct === 0 ? 'selected' : ''}>Exenta</option></select>`)}
                </div><div id="oc-totales">${totalesHtml(c.totales)}</div>`)}
            </div>
            <div class="flex flex-wrap gap-2 justify-end">
                <button type="button" onclick="Compras.cancelar()" class="btn-secondary">Cancelar</button>
                <button type="submit" class="text-sm px-5 py-2.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-700 text-white">Guardar orden de compra</button>
            </div>
            <datalist id="oc-proveedores">${conocidos.map(p => `<option value="${h(p.nombre)}">`).join('')}</datalist>
            <datalist id="oc-formas">${FORMAS_PAGO.map(x => `<option value="${h(x)}">`).join('')}</datalist>
            <datalist id="oc-unidades">${UNIDADES.map(x => `<option value="${h(x)}">`).join('')}</datalist>
        </form>`;
    }

    async function guardar(ev) {
        ev.preventDefault();
        if (!form || ocupado) return;
        const pr = Proyectos.lista.find(p => p.id === form.proyecto_id);
        if (!pr) return toast('Selecciona el proyecto', 'error');
        if (!form.proveedor.nombre.trim()) return toast('Indica el proveedor', 'error');
        form.items = form.items.filter(it => it.detalle.trim() || it.precio || it.codigo.trim());
        if (!form.items.length) { form.items.push(itemVacio()); refrescar(); return toast('Agrega al menos un artículo', 'error'); }
        if (form.items.some(it => !it.detalle.trim() || !(it.cantidad > 0))) { refrescar(); return toast('Cada línea necesita detalle y una cantidad mayor que cero', 'error'); }
        const c = calcular(form);
        if (!(c.totales.total > 0)) { refrescar(); return toast('El total de la orden de compra debe ser mayor que cero', 'error'); }

        let path = form.adjunto_path;
        if (form.archivo) {
            try { path = await Proyectos.subirArchivo(form.archivo, pr, 'oc'); }
            catch (error) { return toast(error.message, 'error'); }
        }
        const recortar = (o, n) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v ?? '').trim().slice(0, n)]));
        const fila = {
            proyecto_id: pr.id, empresa_id: pr.empresa_id, fecha: form.fecha || hoyChile(), categoria: form.categoria,
            proveedor: recortar(form.proveedor, 160), forma_pago: form.forma_pago.trim() || null,
            despacho: recortar(form.despacho, 200),
            items: c.items.map(it => ({ codigo: it.codigo.trim(), detalle: it.detalle.trim(), unidad: it.unidad.trim(), cantidad: it.cantidad, precio: it.precio, total: it.total })),
            totales: c.totales, observaciones: form.observaciones.trim() || null, numero_externo: form.numero_externo.trim() || null, adjunto_path: path,
        };
        const anterior = form.id ? ordenes.find(o => o.id === form.id) : null;
        const consulta = form.id
            ? supa.from('ordenes_compra').update(fila).eq('id', form.id).select().single()
            : supa.from('ordenes_compra').insert(fila).select().single();
        const data = await ejecutar(consulta, form.id ? 'Orden de compra actualizada' : 'Orden de compra creada en borrador');
        if (!data) { if (form.archivo && path) supa.storage.from('proyectos').remove([path]); return; }
        if (form.archivo && anterior?.adjunto_path && anterior.adjunto_path !== path) supa.storage.from('proyectos').remove([anterior.adjunto_path]);
        reemplazar(data);
        form = null; modo = 'ver'; ocId = data.id;
        refrescar();
    }

    // ── Detalle y flujo ───────────────────────────────────
    function detalleHtml(o) {
        const pr = proyectoDe(o), g = pr ? Proyectos.gestiona(pr) : false;
        const propio = o.solicitado_por === miPerfil?.id;
        const t = o.totales || {};
        const acciones = [
            btn('PDF', `Compras.exportarPDF('${o.id}')`, 'bg-red-600 hover:bg-red-700 text-white'),
            o.adjunto_path ? btn('Ver respaldo', `Proyectos.verArchivo('${h(o.adjunto_path)}')`, 'border border-slate-300 text-slate-700 hover:bg-slate-50') : '',
            o.estado === 'borrador' && (g || propio) ? btn('Editar', `Compras.editar('${o.id}')`, 'border border-slate-300 text-slate-700 hover:bg-slate-50') : '',
            o.estado === 'borrador' && g ? btn('Emitir orden de compra', `Compras.cambiarEstado('${o.id}','emitida')`, 'bg-blue-700 hover:bg-blue-800 text-white') : '',
            o.estado === 'emitida' ? btn('Marcar recibida', `Compras.pedirRecepcion('${o.id}')`, 'bg-emerald-600 hover:bg-emerald-700 text-white') : '',
            ['emitida', 'recibida'].includes(o.estado) && !o.gasto_id ? btn('Cargar a gastos del proyecto', `Compras.cargarAGastos('${o.id}')`, 'bg-amber-600 hover:bg-amber-700 text-white') : '',
            o.gasto_id ? btn('Ver en gastos', `Compras.irAGastos('${o.proyecto_id}')`, 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50') : '',
            o.estado === 'recibida' && g ? btn('Volver a emitida', `Compras.cambiarEstado('${o.id}','emitida')`, 'border border-slate-300 text-slate-600 hover:bg-slate-50') : '',
            o.estado === 'emitida' && g && !o.gasto_id ? btn('Volver a borrador', `Compras.cambiarEstado('${o.id}','borrador')`, 'border border-slate-300 text-slate-600 hover:bg-slate-50') : '',
            o.estado !== 'anulada' && o.estado !== 'borrador' && g && !o.gasto_id ? btn('Anular', `Compras.cambiarEstado('${o.id}','anulada')`, 'border border-red-300 text-red-600 hover:bg-red-50') : '',
            o.estado === 'anulada' && g ? btn('Reabrir como borrador', `Compras.cambiarEstado('${o.id}','borrador')`, 'border border-slate-300 text-slate-600 hover:bg-slate-50') : '',
            o.estado === 'borrador' && (g || propio) ? btn('Eliminar', `Compras.eliminar('${o.id}')`, 'text-red-500 hover:bg-red-50') : '',
        ].join('');
        const recepcion = recibiendoId === o.id ? `<div class="flex flex-wrap gap-2 items-end bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            ${campo('N° de factura o guía del proveedor', `<input id="oc-rec-factura" maxlength="40" value="${h(o.factura_numero || '')}" class="campo-input mt-1">`, 'flex-1 min-w-[200px]')}
            ${btn('Confirmar recepción', `Compras.recibir('${o.id}')`, 'bg-emerald-600 hover:bg-emerald-700 text-white')}${btn('Cancelar', `Compras.pedirRecepcion(null)`, 'text-slate-600 hover:bg-white')}</div>` : '';
        const dato = (label, valor) => valor ? `<div><p class="text-xs text-slate-400">${label}</p><p class="font-semibold text-slate-800 break-words">${h(valor)}</p></div>` : '';
        const items = (o.items || []).map((it, i) => `<tr class="border-t border-slate-100">
            <td class="px-3 py-2 text-xs text-slate-400 font-bold">${i + 1}</td><td class="px-3 py-2 font-mono text-xs text-slate-500">${h(it.codigo)}</td>
            <td class="px-3 py-2">${h(it.detalle)}</td><td class="px-3 py-2 text-center text-slate-500">${h(it.unidad)}</td>
            <td class="px-3 py-2 text-right">${fmtCant(it.cantidad)}</td><td class="px-3 py-2 text-right">${fmtCLP(it.precio)}</td><td class="px-3 py-2 text-right font-bold">${fmtCLP(it.total)}</td></tr>`).join('');
        const historial = [
            `Solicitada por <b>${h(Proyectos.nombrePerfil(o.solicitado_por))}</b> el ${fecha(o.creado_en)}`,
            o.aprobado_por ? `Emitida por <b>${h(Proyectos.nombrePerfil(o.aprobado_por))}</b> el ${fecha(o.aprobado_en)}` : '',
            o.factura_numero ? `Documento del proveedor: <b>${h(o.factura_numero)}</b>` : '',
            o.gasto_id ? '<span class="text-emerald-700 font-semibold">Cargada a los gastos del proyecto</span>' : '',
        ].filter(Boolean).map(x => `<li>${x}</li>`).join('');
        return `<div class="space-y-4">
            <div class="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl px-5 py-4">
                <button type="button" onclick="Compras.volver()" class="text-slate-300 hover:text-white text-xs font-semibold">← Órdenes de compra</button>
                <div class="flex flex-wrap items-center gap-3 mt-1"><h2 class="text-white text-xl font-black font-mono">${numeroOC(o)}</h2>${chip(ESTADOS[o.estado], COLOR[o.estado])}</div>
                <p class="text-slate-300 text-xs mt-0.5">${h(pr ? `${pr.codigo} — ${pr.nombre}` : 'Proyecto')} · ${fecha(o.fecha)} · ${h(Proyectos.CATEGORIAS[o.categoria] || '')}</p>
            </div>
            <div class="flex flex-wrap gap-2">${acciones}</div>
            ${recepcion}
            ${o.estado === 'borrador' && !g ? `<p class="text-xs text-slate-500">Pendiente de emisión por el administrador del proyecto (${h(Proyectos.nombrePerfil(pr?.administrador_id))}).</p>` : ''}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                ${tarjeta('Proveedor', `<div class="grid grid-cols-2 gap-3 text-sm">${dato('Razón social', o.proveedor?.nombre)}${dato('RUT', o.proveedor?.rut)}${dato('Dirección', o.proveedor?.direccion)}${dato('Ciudad', o.proveedor?.ciudad)}${dato('Teléfono', o.proveedor?.telefono)}${dato('Vendedor', o.proveedor?.vendedor)}${dato('Correo', o.proveedor?.email)}</div>`)}
                ${tarjeta('Condiciones y despacho', `<div class="grid grid-cols-2 gap-3 text-sm">${dato('Forma de pago', o.forma_pago)}${dato('Fecha de entrega', o.despacho?.fecha_entrega ? fecha(o.despacho.fecha_entrega) : '')}${dato('Despachar a', o.despacho?.direccion)}${dato('Contacto', o.despacho?.contacto)}${dato('N° OC externa', o.numero_externo)}${dato('Observaciones', o.observaciones)}</div>`)}
            </div>
            ${tarjeta('Detalle de artículos', `<div class="overflow-x-auto"><table class="w-full text-sm min-w-[640px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr><th class="px-3 py-2 text-left">N°</th><th class="px-3 py-2 text-left">Código</th><th class="px-3 py-2 text-left">Detalle</th><th class="px-3 py-2">Unidad</th><th class="px-3 py-2 text-right">Cantidad</th><th class="px-3 py-2 text-right">Valor unit.</th><th class="px-3 py-2 text-right">Total línea</th></tr></thead><tbody>${items}</tbody></table></div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4"><ul class="text-xs text-slate-500 space-y-1 list-disc pl-4">${historial}</ul><div>${totalesHtml(t)}</div></div>`)}
        </div>`;
    }
    function ver(id) { ocId = id; modo = 'ver'; recibiendoId = null; refrescar(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    function volver() { reiniciar(); refrescar(); }
    function pedirRecepcion(id) { recibiendoId = id; refrescar(); if (id) setTimeout(() => $('oc-rec-factura')?.focus(), 30); }
    function irAGastos(proyectoId) { mostrarTab('tab-proyectos'); Proyectos.abrir(proyectoId, 'gastos'); }

    async function cambiarEstado(id, estado) {
        const o = ordenes.find(x => x.id === id);
        if (!o) return;
        const textos = {
            emitida: o.estado === 'borrador' ? `¿Emitir ${numeroOC(o)} a ${o.proveedor?.nombre} por ${fmtCLP(o.totales?.total)}? Después no podrás modificar su contenido.` : `¿Devolver ${numeroOC(o)} a emitida?`,
            borrador: `¿Devolver ${numeroOC(o)} a borrador para modificarla?`,
            anulada: `¿Anular ${numeroOC(o)}? Quedará registrada como anulada.`,
        };
        if (!confirm(textos[estado] || '¿Confirmas el cambio?')) return;
        const data = await ejecutar(supa.from('ordenes_compra').update({ estado }).eq('id', id).select().single(),
            { emitida: 'Orden de compra emitida', borrador: 'Orden de compra en borrador', anulada: 'Orden de compra anulada' }[estado]);
        if (!data) return;
        reemplazar(data);
        refrescar();
    }
    async function recibir(id) {
        const factura = $('oc-rec-factura')?.value.trim() || null;
        const data = await ejecutar(supa.from('ordenes_compra').update({ estado: 'recibida', factura_numero: factura }).eq('id', id).select().single(), 'Orden de compra recibida');
        if (!data) return;
        recibiendoId = null;
        reemplazar(data);
        refrescar();
    }
    async function eliminar(id) {
        const o = ordenes.find(x => x.id === id);
        if (!o || !confirm(`¿Eliminar el borrador ${numeroOC(o)}?`)) return;
        const ok = await ejecutar(supa.from('ordenes_compra').delete().eq('id', id), 'Orden de compra eliminada');
        if (!ok) return;
        if (o.adjunto_path) supa.storage.from('proyectos').remove([o.adjunto_path]);
        ordenes = ordenes.filter(x => x.id !== id);
        volver();
    }

    // Crea el gasto del proyecto con el total de la OC y deja ambos enlazados.
    async function cargarAGastos(id) {
        const o = ordenes.find(x => x.id === id), pr = o && proyectoDe(o);
        if (!o || !pr || ocupado) return;
        if (pr.estado !== 'activo') return toast('El proyecto está cerrado', 'error');
        const g = Proyectos.gestiona(pr);
        if (!confirm(`¿Cargar ${numeroOC(o)} por ${fmtCLP(o.totales?.total)} a los gastos de ${pr.codigo} como ${Proyectos.CATEGORIAS[o.categoria]}?${g ? '' : '\nQuedará pendiente de aprobación del administrador del proyecto.'}`)) return;
        ocupado = true;
        try {
            const detalle = (o.items || []).map(it => it.detalle).filter(Boolean).join(', ');
            const { data: gasto, error } = await supa.from('proyecto_gastos').insert({
                proyecto_id: pr.id, empresa_id: pr.empresa_id, fecha: o.fecha > hoyChile() ? hoyChile() : o.fecha,
                categoria: o.categoria, subcategoria: 'Orden de compra',
                descripcion: `${numeroOC(o)}${o.numero_externo ? ` (${o.numero_externo})` : ''} — ${detalle}`.slice(0, 300),
                proveedor: (o.proveedor?.nombre || '').slice(0, 160) || null,
                tipo_doc: o.factura_numero ? 'factura' : 'sin_documento', numero_doc: (o.factura_numero || numeroOC(o)).slice(0, 40),
                monto: Math.round(o.totales?.total || 0),
            }).select().single();
            if (error) throw error;
            let fila = gasto;
            if (g) {
                const { data: aprobado, error: errAprob } = await supa.from('proyecto_gastos').update({ estado: 'aprobado' }).eq('id', gasto.id).select().single();
                if (!errAprob) fila = aprobado;
            }
            const { data: oc, error: errOc } = await supa.from('ordenes_compra').update({ gasto_id: gasto.id }).eq('id', o.id).select().single();
            if (errOc) { await supa.from('proyecto_gastos').delete().eq('id', gasto.id); throw errOc; }
            Proyectos.agregarGasto(fila);
            reemplazar(oc);
            toast(fila.estado === 'aprobado' ? 'Orden de compra cargada a gastos (aprobado)' : 'Orden de compra cargada a gastos, pendiente de aprobación', 'success');
        } catch (error) {
            toast('No se pudo cargar a gastos: ' + (error.message || error), 'error');
        } finally { ocupado = false; }
        refrescar();
    }

    // ── PDF (paleta de la app: azul marino + ámbar; una sola página continua, nunca se corta) ──
    function exportarPDF(id) {
        const o = ordenes.find(x => x.id === id);
        if (!o) return;
        const pr = proyectoDe(o), p = pr && Proyectos.presupuestoDe(pr);
        const emp = empresaActual || {}, t = o.totales || {}, prov = o.proveedor || {}, desp = o.despacho || {};
        const filas = (o.items || []).map((it, i) => `<tr><td class="c n">${i + 1}</td><td class="cod">${h(it.codigo)}</td><td>${h(it.detalle)}</td><td class="c">${h(it.unidad)}</td><td class="r">${fmtCant(it.cantidad)}</td><td class="r">${fmtCLP(it.precio)}</td><td class="r b">${fmtCLP(it.total)}</td></tr>`).join('');
        const dato = (label, valor) => `<div class="dt"><span class="cl">${label}</span><span class="cv">${h(valor || '—')}</span></div>`;
        const firma = (rol, nombre, extra = '') => `<div class="firma"><div class="lin"></div><div class="rol">${rol}</div><div class="nom">${h(nombre || '')}</div>${extra ? `<div class="car">${extra}</div>` : ''}</div>`;
        const linea = (label, valor, cls = '') => `<div class="tr ${cls}"><span>${label}</span><span>${valor}</span></div>`;
        const borrador = o.estado === 'borrador', anulada = o.estado === 'anulada';
        const css = `
.oc{font-family:'Segoe UI',system-ui,Arial,sans-serif;color:#0f172a;background:#fff}
.oc *{box-sizing:border-box}
.oc .st{height:5px;background:linear-gradient(90deg,#d97706,#f59e0b,#fbbf24)}
.oc .hdr{background:#0a0f1e;padding:24px 36px 20px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.oc .logo{max-height:42px;max-width:150px;margin-bottom:8px;display:block}
.oc .co{font-size:14pt;font-weight:900;color:#fff;letter-spacing:1px;text-transform:uppercase}
.oc .tag{font-size:7.5pt;color:#d97706;letter-spacing:3px;text-transform:uppercase;margin-top:4px;font-weight:600}
.oc .inf{font-size:7.5pt;color:#94a3b8;margin-top:8px;line-height:1.8}
.oc .ref{text-align:right;white-space:nowrap}
.oc .lbl{font-size:6.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:2.5px;font-weight:600}
.oc .num{font-size:21pt;font-weight:900;color:#f59e0b;letter-spacing:1px;line-height:1;margin-top:3px}
.oc .sub{font-size:7.5pt;color:#94a3b8;margin-top:6px;line-height:1.7}
.oc .est{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;font-size:6.5pt;font-weight:800;text-transform:uppercase;letter-spacing:1px;background:#fef3c7;color:#92400e}
.oc .est.an{background:#fee2e2;color:#991b1b}
.oc .body{padding:20px 36px 26px}
.oc .tit{display:flex;align-items:center;gap:14px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0}
.oc .tit b{font-size:19pt;font-weight:900;color:#0a0f1e;letter-spacing:5px;text-transform:uppercase;line-height:1}
.oc .dot{width:8px;height:8px;background:#d97706;border-radius:50%}
.oc .ln{flex:1;height:1px;background:linear-gradient(90deg,#e2e8f0,transparent)}
.oc .grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin-bottom:16px}
.oc .card{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.oc .ch{background:#0a0f1e;padding:6px 12px;font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#cbd5e1;display:flex;align-items:center;gap:7px}
.oc .ch i{width:5px;height:5px;background:#d97706;border-radius:50%;display:inline-block}
.oc .cb{padding:8px 12px;display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}
.oc .dt{display:flex;flex-direction:column}
.oc .dt.w{grid-column:1/-1}
.oc .cl{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8}
.oc .cv{font-size:8.5pt;font-weight:600;color:#0f172a;margin-top:1px;word-break:break-word}
.oc table{width:100%;border-collapse:collapse;font-size:8.3pt;border:1px solid #e2e8f0}
.oc thead th{background:#0a0f1e;color:#fff;padding:7px 6px;font-size:6.8pt;text-transform:uppercase;letter-spacing:.5px;font-weight:700;text-align:left}
.oc thead th.r{text-align:right}.oc thead th.c{text-align:center}
.oc tbody tr{border-bottom:1px solid #f1f5f9;page-break-inside:avoid}
.oc tbody tr:nth-child(even){background:#fafafa}
.oc tbody td{padding:5px 6px;vertical-align:top}
.oc .r{text-align:right;white-space:nowrap}.oc .c{text-align:center}.oc .b{font-weight:700}
.oc .n{color:#94a3b8;font-weight:700;width:26px}.oc .cod{font-family:monospace;font-size:7.3pt;color:#64748b;width:80px}
.oc .final{page-break-inside:avoid;break-inside:avoid;margin-top:14px}
.oc .cierre{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}
.oc .nota{border:1px solid #e2e8f0;border-left:3px solid #d97706;border-radius:0 8px 8px 0;padding:9px 12px;font-size:7.8pt;line-height:1.6;color:#334155}
.oc .nota b{color:#0a0f1e}
.oc .nota p{margin:0 0 6px}
.oc .tot{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;align-self:start}
.oc .tr{display:flex;justify-content:space-between;padding:5px 12px;font-size:8.5pt;border-bottom:1px solid #f1f5f9}
.oc .tr span:last-child{font-weight:700}
.oc .tr.neto{background:#fffbeb;color:#92400e;font-weight:700}
.oc .tr.total{background:#0a0f1e;color:#fff;font-size:11pt;font-weight:900;padding:9px 12px;border:0}
.oc .tr.total span:last-child{color:#f59e0b}
.oc .firmas{display:flex;justify-content:space-between;gap:24px;margin-top:46px}
.oc .firma{flex:1;text-align:center}
.oc .firma .lin{border-top:1.5px solid #0a0f1e;margin-bottom:6px}
.oc .rol{font-size:7pt;font-weight:900;color:#0a0f1e;text-transform:uppercase;letter-spacing:.5px}
.oc .nom{font-size:8.5pt;font-weight:600;margin-top:2px;min-height:11px}
.oc .car{font-size:7pt;color:#64748b;margin-top:1px}
.oc .pie{margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:6.5pt;color:#94a3b8;display:flex;justify-content:space-between}
.oc .sb{height:4px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#d97706)}`;
        const html = `<div class="oc"><div class="st"></div>
<div class="hdr">
  <div>${emp.logo_b64 ? `<img src="${emp.logo_b64}" class="logo" alt="Logo">` : ''}
    <div class="co">${h(emp.nombre_comercial || 'Presupuestos Pro')}</div>
    ${emp.razon_social ? `<div class="tag">${h(emp.razon_social)}</div>` : ''}
    <div class="inf">${empresaInfoLineaHtml()}</div></div>
  <div class="ref"><div class="lbl">N° Orden de compra</div><div class="num">${numeroOC(o)}</div>
    <div class="sub">Fecha: ${fecha(o.fecha)}${o.numero_externo ? `<br>Ref. externa: ${h(o.numero_externo)}` : ''}</div>
    ${borrador ? '<span class="est">Borrador — no válida</span>' : anulada ? '<span class="est an">Anulada</span>' : ''}</div>
</div>
<div class="body">
  <div class="tit"><b>Orden de compra</b><div class="dot"></div><div class="ln"></div></div>
  <div class="grid">
    <div class="card"><div class="ch"><i></i>Adquiérase de</div><div class="cb">
      <div class="dt w"><span class="cl">Razón social</span><span class="cv" style="font-size:10pt">${h(prov.nombre)}</span></div>
      ${dato('RUT', prov.rut)}${dato('Teléfono', prov.telefono)}${`<div class="dt w"><span class="cl">Dirección</span><span class="cv">${h([prov.direccion, prov.ciudad].filter(Boolean).join(', ') || '—')}</span></div>`}
      ${dato('Vendedor', prov.vendedor)}${dato('Correo', prov.email)}
    </div></div>
    <div class="card"><div class="ch"><i></i>Obra y condiciones</div><div class="cb">
      <div class="dt w"><span class="cl">Centro de costo</span><span class="cv">${h(pr ? `${pr.codigo} — ${pr.nombre}` : '—')}</span></div>
      ${p ? `<div class="dt w"><span class="cl">Presupuesto / Mandante</span><span class="cv">${h(p.numero)} — ${h(p.cliente.nombre)}</span></div>` : ''}
      <div class="dt w"><span class="cl">Forma de pago</span><span class="cv">${h(o.forma_pago || '—')}</span></div>
      ${dato('Fecha de entrega', desp.fecha_entrega ? fecha(desp.fecha_entrega) : '')}${dato('Imputación', Proyectos.CATEGORIAS[o.categoria])}
    </div></div>
  </div>
  <table><thead><tr><th class="c">N°</th><th>Código</th><th>Detalle de artículos</th><th class="c">Unidad</th><th class="r">Cantidad</th><th class="r">Valor unitario</th><th class="r">Total línea</th></tr></thead><tbody>${filas}</tbody></table>
  <div class="final">
    <div class="cierre">
      <div class="nota">
        ${desp.direccion ? `<p><b>Despachar a:</b> ${h(desp.direccion)}</p>` : ''}
        ${desp.contacto ? `<p><b>Contacto despacho:</b> ${h(desp.contacto)}</p>` : ''}
        ${o.observaciones ? `<p><b>Nota al proveedor:</b> ${h(o.observaciones)}</p>` : ''}
        <p><b>Para recepcionar la factura</b> debe indicar el N° ${numeroOC(o)} y adjuntar la guía de despacho.${emp.email_contacto ? ` Enviar facturas a <b>${h(emp.email_contacto)}</b>.` : ''}</p>
      </div>
      <div class="tot">
        ${linea('Subtotal', fmtCLP(t.subtotal))}${linea('Descuentos', fmtCLP(t.descuento))}${linea('Cargos', fmtCLP(t.cargos))}
        ${linea('Neto', fmtCLP(t.neto), 'neto')}${linea(t.iva_pct ? `I.V.A. ${t.iva_pct}%` : 'Exento de IVA', fmtCLP(t.iva))}
        ${linea('Total', fmtCLP(t.total), 'total')}
      </div>
    </div>
    <div class="firmas">
      ${firma('Solicitado por', Proyectos.nombrePerfil(o.solicitado_por), fecha(o.creado_en))}
      ${firma('Aprobado por', o.aprobado_por ? Proyectos.nombrePerfil(o.aprobado_por) : '', o.aprobado_en ? fecha(o.aprobado_en) : 'Pendiente')}
      ${firma('Gerente general', emp.responsable_nombre, h(emp.responsable_cargo || ''))}
    </div>
    <div class="pie"><span>${h(emp.nombre_comercial || '')}${emp.rut ? ' · RUT ' + h(emp.rut) : ''}</span><span>${numeroOC(o)} · Generado ${fecha(hoyChile())}</span></div>
  </div>
</div><div class="sb"></div></div>`;
        const sufijo = (prov.nombre || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40).trim().replace(/\.+$/, '');
        generarPDF(css, html, `${numeroOC(o)}${sufijo ? ' ' + sufijo : ''}.pdf`);
    }

    return {
        cargar, render, htmlProyecto, reiniciar, deProyecto, filtrar,
        nueva, editar, cancelar, set, setItem, agregarItem, quitarItem, setArchivo, guardar,
        ver, volver, pedirRecepcion, recibir, cambiarEstado, eliminar, cargarAGastos, irAGastos, exportarPDF,
        get disponible() { return disponible; },
        test: { calcular, cantidad, pesos },
    };
})();
