/* Ejecución de proyectos: centro de costo, estados de pago, cobranza y gastos.
   Los permisos reales se validan en Supabase (202610060001_proyectos.sql). */
const Proyectos = (() => {
    const CATEGORIAS = { materiales: 'Materiales', mano_obra: 'Mano de obra', arriendos: 'Arriendos', generales: 'Gastos generales' };
    // Conceptos sugeridos según la categoría del gasto (el campo admite cualquier texto).
    const SUBCATEGORIAS = {
        materiales: ['Yeso / volcanita', 'Perfiles metálicos', 'Cemento / hormigón', 'Áridos', 'Fierro', 'Madera', 'Pintura', 'Cerámica / porcelanato', 'Material eléctrico', 'Material sanitario', 'Ferretería y fijaciones', 'Adhesivos y selladores', 'Aislación'],
        mano_obra: ['Maestro', 'Ayudante', 'Jornal', 'Trato / a destajo', 'Subcontrato', 'Horas extra', 'Leyes sociales', 'Bono de producción', 'Finiquito'],
        arriendos: ['Arriendo de equipos', 'Andamios', 'Maquinaria', 'Herramientas eléctricas', 'Contenedor / bodega', 'Vehículo / camioneta', 'Baño químico'],
        generales: ['Petróleo', 'Colaciones', 'Peajes', 'Estacionamiento', 'Fletes', 'Movilización', 'Hospedaje', 'Herramientas', 'EPP', 'Retiro de escombros', 'Aseo de obra'],
    };
    const opcionesConcepto = cat => (SUBCATEGORIAS[cat] || []).map(s => `<option value="${h(s)}">`).join('');
    const ejemploConcepto = cat => 'Ej: ' + (SUBCATEGORIAS[cat] || []).slice(0, 2).join(', ');
    // Al cambiar la categoría se cambian las sugerencias del concepto.
    function cambiarCategoriaGasto(cat) {
        const lista = $('pr-g-subs'), input = $('pr-g-sub');
        if (lista) lista.innerHTML = opcionesConcepto(cat);
        if (input) input.placeholder = ejemploConcepto(cat);
    }
    const DOCUMENTOS = { factura: 'Factura (suma IVA)', boleta_honorarios: 'Boleta de honorarios (resta retención)', exenta: 'Factura exenta (sin impuesto)' };
    const TASA_DEFECTO = { factura: 19, boleta_honorarios: 15.25, exenta: 0 };
    const TIPOS_DOC = { boleta: 'Boleta', factura: 'Factura', guia: 'Guía de despacho', sin_documento: 'Sin documento' };
    const ESTADOS_EDP = { borrador: 'Borrador', presentado: 'Presentado', aprobado: 'Aprobado', pagado: 'Pagado' };
    const COLOR_EDP = { borrador: 'bg-slate-100 text-slate-700', presentado: 'bg-amber-100 text-amber-800', aprobado: 'bg-blue-100 text-blue-800', pagado: 'bg-emerald-100 text-emerald-800' };
    const ESTADOS_GASTO = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };
    const COLOR_GASTO = { pendiente: 'bg-amber-100 text-amber-800', aprobado: 'bg-emerald-100 text-emerald-800', rechazado: 'bg-red-100 text-red-700' };
    const LINEAS = ['cd', 'gg', 'util', 'sub', 'anticipo', 'retencion', 'descuento', 'neto'];
    // App de terreno (gastos.html): origen del dinero del gasto, ingresos recibidos en obra e informes de trabajo.
    const ORIGENES = { empresa: 'Caja chica', propio: 'Dinero propio' };
    const MEDIOS = { transferencia_empresa: 'Transferencia a la empresa', transferencia_personal: 'Transferencia al trabajador', efectivo: 'Efectivo' };

    let disponible = false, proyectos = [], edps = [], gastos = [], perfiles = [], ingresos = [], informes = [];
    let conTerreno = true; // se apaga si la migración 202610240001_app_terreno.sql aún no está aplicada
    let actualId = null, vista = 'resumen', edpSelId = null, cantidades = null, ajusteEdp = null, anticipoPctEdp = 0;
    let filtroCat = '', filtroEstado = '', rechazandoId = null, ocupado = false;
    // Varios respaldos por gasto (columna proyecto_gastos.adjuntos). Se apaga si la migración aún no está aplicada.
    const MAX_ADJUNTOS = 10;
    const AVISO_MIGRACION = 'Para varios respaldos por gasto falta aplicar la migración 202610190001_gastos_adjuntos.sql.';
    let conAdjuntos = true;
    const adjuntosDe = x => x.adjuntos?.length ? x.adjuntos : (x.adjunto_path ? [x.adjunto_path] : []);
    const faltaColumnaAdjuntos = error => error.code === 'PGRST204' || /adjuntos/.test(error.message || '');

    const $ = id => document.getElementById(id);
    const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ── Fechas y formatos ─────────────────────────────────
    function hoyChile() {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const part = t => parts.find(p => p.type === t).value;
        return `${part('year')}-${part('month')}-${part('day')}`;
    }
    function diasEntre(desde, hasta) {
        const ms = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
        return Math.round((ms(hasta) - ms(desde)) / 86400000);
    }
    const fecha = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
    const decimales = p => p.decimales ?? (p.moneda === 'UF' ? 2 : 0);
    function redondear(n, dec) { const f = 10 ** dec; return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f; }
    function fmtM(n, p) {
        const dec = decimales(p);
        const s = (n || 0).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        return p.moneda === 'UF' ? `${s} UF` : `$ ${s}`;
    }
    const fmtCLP = n => '$ ' + Math.round(n || 0).toLocaleString('es-CL');
    const fmtNum = n => (n || 0).toLocaleString('es-CL', { maximumFractionDigits: 4 });
    const fmtPct = n => `${(n || 0).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
    const numero = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
    const numeroDecimal = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

    // ── Cálculo del estado de pago ────────────────────────
    // Columnas como la plantilla: contrato, acumulado, anterior (EP previo congelado) y período.
    // ajuste: descuento neto que aplica el mandante en este EP (multas, trabajos no aceptados, etc.).
    // Se acumula como el anticipo y la retención, así el EP siguiente lo arrastra en "anterior".
    function calcularEDP(p, config, previo, cants, ajuste = null) {
        const dec = decimales(p), r = n => redondear(n, dec);
        const descuento = r(Math.max(0, +ajuste?.monto || 0));
        const prevItems = new Map((previo?.items || []).map(i => [i.itemId, i]));
        const items = [];
        p.capitulos.forEach(cap => cap.items.forEach(it => {
            const cant = +it.cantidad || 0, pu = +it.precioUnit || 0;
            const total = r(+it.total || cant * pu);
            const ant = prevItems.get(it.id);
            const cantAnt = ant?.cantAcum || 0;
            const pedido = cants && cants.has(it.id) ? +cants.get(it.id) : cantAnt;
            const cantAcum = Math.round(Math.min(Math.max(pedido, cantAnt), Math.max(cant, cantAnt)) * 10000) / 10000;
            const montoDe = c => (cant > 0 && c >= cant) ? total : r(c * pu);
            const montoAcum = montoDe(cantAcum), montoAnt = ant ? ant.montoAcum : 0;
            items.push({
                itemId: it.id, capId: cap.id, capNumero: cap.numero, capNombre: cap.nombre || '',
                numero: it.numero || '', detalle: it.descripcion || '', unidad: it.unidad || '',
                cant, pu, total, cantAnt, cantAcum, montoAcum, montoAnt, montoPeriodo: r(montoAcum - montoAnt),
            });
        }));
        const usar = p.usarGGUtil !== false;
        const ggPct = usar ? +p.ggPct || 0 : 0, utilPct = usar ? +p.utilPct || 0 : 0;
        const columna = cd => { const gg = r(cd * ggPct / 100), util = r(cd * utilPct / 100); return { cd, gg, util, sub: r(cd + gg + util) }; };
        const contratoBase = columna(r(items.reduce((s, i) => s + i.total, 0)));
        const anticipo = r(+config?.anticipo_monto || 0);
        const retPct = +config?.retencion_pct || 0;
        const amortizar = sub => contratoBase.sub <= 0 ? 0 : (sub >= contratoBase.sub ? anticipo : r(anticipo * sub / contratoBase.sub));
        const cerrar = l => ({ ...l, neto: r(l.sub - l.anticipo - l.retencion - l.descuento) });
        const contrato = cerrar({ ...contratoBase, anticipo, retencion: r(contratoBase.sub * retPct / 100), descuento: 0 });
        const acumBase = columna(r(items.reduce((s, i) => s + i.montoAcum, 0)));
        const acum = cerrar({ ...acumBase, anticipo: amortizar(acumBase.sub), retencion: r(acumBase.sub * retPct / 100),
            descuento: r((previo?.totales?.acum?.descuento || 0) + descuento) });
        const ant = Object.fromEntries(LINEAS.map(k => [k, previo?.totales?.acum?.[k] || 0]));
        const per = Object.fromEntries(LINEAS.map(k => [k, r(acum[k] - ant[k])]));
        return { items, totales: cierreTributario({ contrato, acum, ant, per, ggPct, utilPct, retPct, anticipoMonto: anticipo,
            descuentoMotivo: descuento ? String(ajuste?.motivo || '').trim().slice(0, 200) : '',
            pctAvance: contratoBase.sub > 0 ? acumBase.sub / contratoBase.sub * 100 : 0, moneda: p.moneda || 'CLP', decimales: dec }, config, dec) };
    }
    // Devolución de las retenciones acumuladas al terminar la obra.
    function calcularDevolucion(p, config, ultimo) {
        const dec = decimales(p);
        const retenido = ultimo?.totales?.acum?.retencion || 0;
        const cero = Object.fromEntries(LINEAS.map(k => [k, 0]));
        return { items: [], totales: cierreTributario({ contrato: cero, acum: cero, ant: cero, per: { ...cero, neto: retenido }, devolucion: true,
            pctAvance: 100, moneda: p.moneda || 'CLP', decimales: dec }, config, dec) };
    }
    // Solicitud de anticipo: % del subtotal neto del contrato (con GG y utilidad), sin retención.
    // Su neto pasa a ser config.anticipo_monto, que los EP de avance amortizan según el avance.
    function calcularSolicitudAnticipo(p, config, pct) {
        const dec = decimales(p);
        const porcentaje = Math.min(100, Math.max(0, +pct || 0));
        const base = calcularEDP(p, config, null, null).totales.contrato.sub;
        const cero = Object.fromEntries(LINEAS.map(k => [k, 0]));
        return { items: [], totales: cierreTributario({ contrato: cero, acum: cero, ant: cero, per: { ...cero, neto: redondear(base * porcentaje / 100, dec) },
            solicitudAnticipo: true, anticipoPct: porcentaje, baseAnticipo: base, pctAvance: 0, moneda: p.moneda || 'CLP', decimales: dec }, config, dec) };
    }
    function cierreTributario(t, config, dec) {
        const documento = DOCUMENTOS[config?.documento] ? config.documento : 'factura';
        const tasa = documento === 'exenta' ? 0 : (Number.isFinite(+config?.tasa) && config?.tasa !== '' && config?.tasa != null ? +config.tasa : TASA_DEFECTO[documento]);
        const impuesto = redondear(t.per.neto * tasa / 100, dec);
        const aPagar = redondear(documento === 'boleta_honorarios' ? t.per.neto - impuesto : t.per.neto + impuesto, dec);
        return { ...t, documento, tasa, impuesto, aPagar };
    }

    // ── Datos ─────────────────────────────────────────────
    const actual = () => proyectos.find(x => x.id === actualId) || null;
    const presupuestoDe = pr => presupuestos.find(p => p.id === pr.presupuesto_id) || null;
    const edpsDe = id => edps.filter(e => e.proyecto_id === id).sort((a, b) => a.numero - b.numero);
    const gastosDe = id => gastos.filter(g => g.proyecto_id === id).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creado_en || '').localeCompare(a.creado_en || ''));
    const porFecha = (a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creado_en || '').localeCompare(a.creado_en || '');
    const ingresosDe = id => ingresos.filter(x => x.proyecto_id === id).sort(porFecha);
    const informesDe = id => informes.filter(x => x.proyecto_id === id).sort(porFecha);
    const esAdminEmpresa = () => miPerfil?.rol === 'admin';
    const gestiona = pr => esAdminEmpresa() || (!!pr.administrador_id && pr.administrador_id === miPerfil?.id);
    const nombrePerfil = id => perfiles.find(x => x.id === id)?.nombre || '—';
    const previoDe = (pr, e) => edpsDe(pr.id).filter(x => x.tipo === 'avance' && x.estado !== 'borrador' && x.numero < e.numero).at(-1) || null;
    function diasAtraso(e, hoy = hoyChile()) {
        if (e.estado !== 'aprobado' || !e.fecha_pago_estimada) return null;
        return diasEntre(e.fecha_pago_estimada, hoy);
    }

    async function cargar() {
        if (!supa || !empresaActual) return;
        const [pr, ed, ga, pe, ing, inf] = await Promise.all([
            supa.from('proyectos').select('*').order('creado_en'),
            supa.from('proyecto_edps').select('*').order('numero'),
            supa.from('proyecto_gastos').select('*').order('fecha', { ascending: false }),
            supa.from('perfiles').select('id,nombre,rol').eq('empresa_id', empresaActual.id),
            supa.from('proyecto_ingresos').select('*').order('fecha', { ascending: false }),
            supa.from('proyecto_informes').select('*').order('fecha', { ascending: false }),
        ]);
        conTerreno = !ing.error && !inf.error;
        ingresos = ing.data || []; informes = inf.data || [];
        const faltaTabla = pr.error && (['42P01', 'PGRST205', 'PGRST202'].includes(pr.error.code) || /proyectos/.test(pr.error.message || ''));
        disponible = !faltaTabla;
        $('nav-proyectos')?.classList.toggle('hidden', !disponible);
        if (faltaTabla) return;
        const error = pr.error || ed.error || ga.error || pe.error;
        if (error) toast('No se pudieron cargar los proyectos: ' + error.message, 'error');
        proyectos = pr.data || []; edps = ed.data || []; gastos = ga.data || []; perfiles = pe.data || [];
        if (gastos.length) conAdjuntos = 'adjuntos' in gastos[0];
        actualizarBadge();
    }
    function actualizarBadge() {
        const n = edps.filter(e => (diasAtraso(e) || 0) > 0).length;
        const b = $('badge-proyectos');
        if (b) { b.textContent = n; b.classList.toggle('hidden', n === 0); }
    }
    function reemplazar(lista, fila) {
        const i = lista.findIndex(x => x.id === fila.id);
        if (i >= 0) lista[i] = fila; else lista.push(fila);
    }

    function resumen(pr) {
        const p = presupuestoDe(pr);
        const lista = edpsDe(pr.id);
        const avances = lista.filter(e => e.tipo === 'avance' && e.estado !== 'borrador');
        const ultimo = avances.at(-1) || null;
        const t = ultimo?.totales;
        const sumar = f => lista.filter(f).reduce((s, e) => s + (e.totales?.aPagar || 0), 0);
        const devuelto = lista.filter(e => e.tipo === 'devolucion_retencion' && e.estado !== 'borrador').reduce((s, e) => s + (e.totales?.per?.neto || 0), 0);
        const g = gastosDe(pr.id), aprobados = g.filter(x => x.estado === 'aprobado');
        const porCat = Object.fromEntries(Object.keys(CATEGORIAS).map(k => [k, aprobados.filter(x => x.categoria === k).reduce((s, x) => s + x.monto, 0)]));
        return {
            p, ultimo, contrato: p ? calcularEDP(p, pr.config, null, null).totales.contrato : null,
            avancePct: t?.pctAvance || 0, ejecutadoNeto: t?.acum?.sub || 0,
            cobrado: sumar(e => e.estado === 'pagado'), porCobrar: sumar(e => e.estado === 'aprobado'), enRevision: sumar(e => e.estado === 'presentado'),
            anticipoAmortizado: t?.acum?.anticipo || 0, retenido: Math.max(0, (t?.acum?.retencion || 0) - devuelto),
            gastosAprobados: aprobados.reduce((s, x) => s + x.monto, 0), gastosPendientes: g.filter(x => x.estado === 'pendiente').length, porCat,
            atrasados: lista.filter(e => (diasAtraso(e) || 0) > 0).length,
            abierto: lista.find(e => e.estado === 'borrador' || e.estado === 'presentado') || null,
            devolucion: lista.find(e => e.tipo === 'devolucion_retencion') || null,
        };
    }
    // Montos del presupuesto expresados en CLP para compararlos con los gastos.
    function aCLP(monto, p, pr) {
        if (p.moneda !== 'UF') return monto;
        const uf = +pr.config?.valor_uf_ref || 0;
        return uf > 0 ? monto * uf : null;
    }

    // ── API para app.js ───────────────────────────────────
    const existePara = presId => proyectos.some(x => x.presupuesto_id === presId);
    function resumenPresupuesto(presId) {
        const pr = proyectos.find(x => x.presupuesto_id === presId);
        return pr ? { proyecto: pr, ...resumen(pr) } : null;
    }
    async function abrirDesdePresupuesto(presId) {
        if (!disponible) return toast('El módulo de proyectos requiere aplicar la actualización de base de datos', 'error');
        let pr = proyectos.find(x => x.presupuesto_id === presId);
        if (!pr) {
            const p = presupuestos.find(x => x.id === presId);
            if (!p) return;
            if (!esAdminEmpresa()) return toast('Solo el administrador de la empresa puede abrir un centro de costo', 'error');
            if (!confirm(`¿Abrir el centro de costo de ${p.numero} — ${p.cliente.nombre}?`)) return;
            const { data, error } = await supa.from('proyectos').insert({
                empresa_id: empresaActual.id, presupuesto_id: p.id, codigo: `CC-${p.numero}`,
                nombre: [p.cliente.nombre, p.cliente.comuna].filter(Boolean).join(' — ').slice(0, 160) || p.numero,
                administrador_id: miPerfil.id,
                config: { anticipo_monto: 0, retencion_pct: 5, documento: 'factura', tasa: 19,
                    firmantes: { gerencia_proyecto: miPerfil.nombre || '', gerente_general: empresaActual.responsable_nombre || '' } },
            }).select().single();
            if (error) return toast('No se pudo crear el proyecto: ' + error.message, 'error');
            proyectos.push(data);
            pr = data;
            toast(`Centro de costo ${data.codigo} creado`, 'success');
        }
        actualId = pr.id; vista = 'resumen'; edpSelId = null; cantidades = null;
        mostrarTab('tab-proyectos');
    }

    // ── Render principal ──────────────────────────────────
    function render() {
        const root = $('pr-root');
        if (!root) return;
        if (!disponible) {
            root.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500"><p class="font-semibold">Módulo de proyectos no disponible</p><p class="text-xs mt-1">Falta aplicar la actualización de base de datos.</p></div>';
            return;
        }
        const pr = actual();
        root.innerHTML = pr ? fichaHtml(pr) : listaHtml();
    }
    const tonos = {
        blue: 'bg-blue-50 border-blue-200 text-blue-800', emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        amber: 'bg-amber-50 border-amber-200 text-amber-800', red: 'bg-red-50 border-red-200 text-red-800',
        slate: 'bg-slate-50 border-slate-200 text-slate-800', purple: 'bg-purple-50 border-purple-200 text-purple-800',
    };
    const kpi = (label, valor, tono = 'slate', nota = '') =>
        `<div class="rounded-xl border p-3 ${tonos[tono]}"><p class="text-xs opacity-75 font-medium">${h(label)}</p><p class="text-lg font-black mt-0.5 break-words">${valor}</p>${nota ? `<p class="text-xs opacity-70 mt-0.5">${nota}</p>` : ''}</div>`;
    const chip = (texto, clases) => `<span class="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap ${clases}">${h(texto)}</span>`;
    const tarjeta = (titulo, cuerpo, extra = '') =>
        `<section class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"><div class="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2"><h3 class="font-bold text-slate-800">${titulo}</h3>${extra}</div><div class="p-5">${cuerpo}</div></section>`;
    const btn = (texto, accion, estilo = 'bg-blue-700 hover:bg-blue-800 text-white', extra = '') =>
        `<button type="button" onclick="${accion}" class="text-xs px-3 py-2 rounded-lg font-bold transition-colors ${estilo}" ${extra}>${texto}</button>`;
    const campo = (label, input) => `<label class="block"><span class="campo-label">${h(label)}</span>${input}</label>`;
    const barra = pct => `<div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden"><div class="h-2 rounded-full bg-gradient-to-r from-blue-500 to-emerald-500" style="width:${Math.min(100, Math.max(0, pct))}%"></div></div>`;
    function atrasoChip(e) {
        if (e.estado === 'pagado') return chip(`Pagado ${fecha(e.fecha_pago_real)}`, COLOR_EDP.pagado);
        if (e.estado !== 'aprobado') return '';
        const d = diasAtraso(e);
        if (d === null) return chip('Sin fecha estimada', 'bg-slate-100 text-slate-600');
        if (d > 0) return chip(`${d} día${d === 1 ? '' : 's'} de atraso`, 'bg-red-100 text-red-700');
        if (d === 0) return chip('Vence hoy', 'bg-amber-100 text-amber-800');
        return chip(`Vence en ${-d} día${d === -1 ? '' : 's'}`, 'bg-blue-50 text-blue-700');
    }

    function listaHtml() {
        const cobranza = edps.filter(e => e.estado === 'aprobado')
            .map(e => ({ e, pr: proyectos.find(x => x.id === e.proyecto_id) })).filter(x => x.pr)
            .sort((a, b) => (diasAtraso(b.e) ?? -1e9) - (diasAtraso(a.e) ?? -1e9));
        const sinProyecto = ordenarRecientes(presupuestos.filter(p => p.estado === 'adjudicado' && !existePara(p.id)), p => p.fechaAdjudicacion);
        const ordenados = [...proyectos].sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'activo' ? -1 : 1)
            || (b.creado_en || '').localeCompare(a.creado_en || ''));
        const cards = ordenados.map(pr => {
            const r = resumen(pr), p = r.p;
            if (!p) return '';
            return `<button type="button" onclick="Proyectos.abrir('${pr.id}')" class="text-left bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden${pr.estado === 'cerrado' ? ' opacity-75' : ''}">
                <div class="bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-3">
                    <div class="flex items-center justify-between gap-2"><p class="text-slate-300 text-xs font-mono">${h(pr.codigo)} · ${h(p.numero)}</p>${pr.estado === 'cerrado'
                        ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">🔒 CERRADO</span>'
                        : '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-400 text-emerald-950">EN EJECUCIÓN</span>'}</div>
                    <p class="text-white font-bold text-sm mt-0.5 truncate">${h(pr.nombre)}</p>
                    <p class="text-slate-400 text-xs">Adm.: ${h(nombrePerfil(pr.administrador_id))}</p>
                </div>
                <div class="p-4 space-y-2 text-sm">
                    <div class="flex justify-between"><span class="text-slate-500">Contrato neto</span><span class="font-bold">${fmtM(r.contrato?.sub, p)}</span></div>
                    <div class="flex justify-between"><span class="text-slate-500">Cobrado</span><span class="font-bold text-emerald-700">${fmtM(r.cobrado, p)}</span></div>
                    <div class="flex justify-between"><span class="text-slate-500">Por cobrar</span><span class="font-bold text-blue-700">${fmtM(r.porCobrar, p)}</span></div>
                    <div class="flex justify-between"><span class="text-slate-500">Gastos aprobados</span><span class="font-bold text-red-700">${fmtCLP(r.gastosAprobados)}</span></div>
                    <div><div class="flex justify-between text-xs text-slate-500 mb-1"><span>Avance estados de pago</span><span class="font-bold">${fmtPct(r.avancePct)}</span></div>${barra(r.avancePct)}</div>
                    <div class="flex flex-wrap gap-1.5 pt-1">${r.atrasados ? chip(`${r.atrasados} cobro(s) atrasado(s)`, 'bg-red-100 text-red-700') : ''}${r.gastosPendientes ? chip(`${r.gastosPendientes} gasto(s) por aprobar`, 'bg-amber-100 text-amber-800') : ''}</div>
                </div></button>`;
        }).join('');
        const cobranzaHtml = cobranza.length ? tarjeta('Cobranza: estados de pago aprobados por cobrar', `<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="text-xs text-slate-500 uppercase"><tr><th class="text-left py-2 pr-3">Proyecto</th><th class="text-left py-2 pr-3">EP</th><th class="text-left py-2 pr-3">Factura</th><th class="text-right py-2 pr-3">A pagar</th><th class="text-left py-2 pr-3">Pago estimado</th><th class="text-left py-2">Estado</th></tr></thead><tbody>${cobranza.map(({ e, pr }) => {
            const p = presupuestoDe(pr) || { moneda: 'CLP' };
            return `<tr class="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onclick="Proyectos.abrir('${pr.id}','edps','${e.id}')"><td class="py-2 pr-3 font-semibold">${h(pr.nombre)}</td><td class="py-2 pr-3 font-mono">N° ${String(e.numero).padStart(2, '0')}</td><td class="py-2 pr-3">${h(e.factura_numero || '—')}</td><td class="py-2 pr-3 text-right font-bold">${fmtM(e.totales?.aPagar, p)}</td><td class="py-2 pr-3">${fecha(e.fecha_pago_estimada)}</td><td class="py-2">${atrasoChip(e)}</td></tr>`;
        }).join('')}</tbody></table></div>`) : '';
        const pendientes = sinProyecto.length ? tarjeta('Adjudicados sin centro de costo', `<div class="flex flex-wrap gap-2">${sinProyecto.map(p =>
            `<button type="button" onclick="Proyectos.abrirDesdePresupuesto('${p.id}')" class="text-xs px-3 py-2 rounded-lg border border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-semibold">${h(p.numero)} — ${h(p.cliente.nombre)}</button>`).join('')}</div><p class="text-xs text-slate-400 mt-2">${esAdminEmpresa() ? 'Haz clic para abrir el centro de costo y pasarlo a ejecución.' : 'El administrador de la empresa abre los centros de costo.'}</p>`) : '';
        return `<div class="space-y-5">
            <div class="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl px-6 py-5 flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-white text-lg font-bold">Ejecución de proyectos</h2><p class="text-slate-300 text-xs mt-0.5">Centros de costo, estados de pago, cobranza y gastos de obra.</p></div>
                ${conTerreno ? '<a href="gastos.html" target="_blank" class="text-xs font-bold px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white">📱 App de terreno (gastos, ingresos, informes)</a>' : ''}</div>
            ${cobranzaHtml}
            ${cards ? `<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">${cards}</div>` : '<div class="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400"><p class="font-semibold">Sin proyectos en ejecución</p><p class="text-xs mt-1">Abre un centro de costo desde un presupuesto adjudicado o una orden de trabajo.</p></div>'}
            ${pendientes}
        </div>`;
    }

    function fichaHtml(pr) {
        const p = presupuestoDe(pr);
        if (!p) return `<div class="bg-white rounded-2xl border p-8 text-center"><p class="font-semibold">No se encontró el presupuesto de este proyecto.</p>${btn('Volver', 'Proyectos.volver()', 'bg-slate-700 text-white mt-3')}</div>`;
        const conCompras = typeof Compras !== 'undefined' && Compras.disponible;
        const pendIng = ingresosDe(pr.id).filter(x => x.estado === 'pendiente').length;
        const pestañas = [['resumen', 'Resumen'], ['presupuesto', 'Presupuesto y OT'], ['edps', 'Estados de pago'], ['gastos', 'Gastos'],
            ...(conTerreno ? [['ingresos', pendIng ? `Ingresos (${pendIng})` : 'Ingresos'], ['informes', 'Informes']] : []),
            ...(conCompras ? [['compras', 'Órdenes de compra']] : []), ['config', 'Configuración']];
        const cuerpo = { resumen: resumenHtml, presupuesto: presupuestoHtml, edps: edpsHtml, gastos: gastosHtml, config: configHtml,
            ingresos: conTerreno ? ingresosHtml : null, informes: conTerreno ? informesHtml : null,
            compras: conCompras ? pr => Compras.htmlProyecto(pr) : null }[vista] || resumenHtml;
        return `<div class="space-y-4">
            <div class="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3 justify-between">
                <div class="min-w-0"><button type="button" onclick="Proyectos.volver()" class="text-slate-300 hover:text-white text-xs font-semibold">← Todos los proyectos</button>
                    <h2 class="text-white text-lg font-bold truncate">${h(pr.nombre)}</h2>
                    <p class="text-slate-300 text-xs">${h(pr.codigo)} · ${h(p.numero)} · ${h(p.cliente.nombre)} · ${pr.estado === 'cerrado' ? 'Proyecto cerrado' : 'En ejecución'}</p></div>
            </div>
            <div class="flex gap-1 overflow-x-auto bg-white rounded-xl border border-slate-200 p-1">${pestañas.map(([id, t]) =>
                `<button type="button" onclick="Proyectos.vista('${id}')" class="flex-shrink-0 text-sm font-semibold px-3 py-2 rounded-lg ${vista === id ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100'}">${t}</button>`).join('')}</div>
            ${cuerpo(pr, p)}
        </div>`;
    }

    function resumenHtml(pr, p) {
        const r = resumen(pr);
        const cdCLP = aCLP(r.contrato.cd, p, pr), ejecutadoCLP = aCLP(r.ejecutadoNeto, p, pr);
        const usoCD = cdCLP ? r.gastosAprobados / cdCLP * 100 : null;
        const margen = ejecutadoCLP != null ? ejecutadoCLP - r.gastosAprobados : null;
        const notaUF = p.moneda === 'UF' && !(+pr.config?.valor_uf_ref > 0) ? '<p class="text-xs text-amber-700 mt-2">El presupuesto está en UF: indica un valor UF de referencia en Configuración para comparar con los gastos en pesos.</p>' : '';
        return `<div class="space-y-4">
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                ${kpi('Contrato neto', fmtM(r.contrato.sub, p), 'blue', `Total con IVA ${fmtM(r.contrato.sub * 1.19, p)}`)}
                ${kpi('Avance cobrado en EP', fmtPct(r.avancePct), 'purple', `Neto ejecutado ${fmtM(r.ejecutadoNeto, p)}`)}
                ${kpi('Cobrado (pagado)', fmtM(r.cobrado, p), 'emerald')}
                ${kpi('Por cobrar (aprobado)', fmtM(r.porCobrar, p), r.atrasados ? 'red' : 'amber', r.atrasados ? `${r.atrasados} con atraso` : (r.enRevision ? `En revisión ${fmtM(r.enRevision, p)}` : ''))}
                ${kpi('Anticipo', fmtM(r.contrato.anticipo, p), 'slate', `Amortizado ${fmtM(r.anticipoAmortizado, p)} · Pendiente ${fmtM(r.contrato.anticipo - r.anticipoAmortizado, p)}`)}
                ${kpi(`Retenciones (${fmtPct(+pr.config?.retencion_pct || 0)})`, fmtM(r.retenido, p), 'slate', r.devolucion ? `Devolución: EP N° ${r.devolucion.numero}` : 'Retenido por el mandante')}
                ${kpi('Gastos aprobados', fmtCLP(r.gastosAprobados), 'red', r.gastosPendientes ? `${r.gastosPendientes} por aprobar` : '')}
                ${kpi('Margen real', margen == null ? '—' : fmtCLP(margen), margen == null ? 'slate' : margen >= 0 ? 'emerald' : 'red', 'Neto ejecutado menos gastos')}
            </div>
            ${tarjeta('Gastos vs costo directo presupuestado', `<div class="overflow-x-auto"><table class="w-full text-sm"><tbody>
                ${Object.entries(CATEGORIAS).map(([k, t]) => `<tr class="border-t border-slate-100"><td class="py-2">${t}</td><td class="py-2 text-right font-semibold">${fmtCLP(r.porCat[k])}</td></tr>`).join('')}
                <tr class="border-t-2 border-slate-300 font-bold"><td class="py-2">Total gastos aprobados</td><td class="py-2 text-right">${fmtCLP(r.gastosAprobados)}</td></tr>
                <tr class="border-t border-slate-100"><td class="py-2">Costo directo presupuestado</td><td class="py-2 text-right">${fmtM(r.contrato.cd, p)}${p.moneda === 'UF' && cdCLP ? ` <span class="text-slate-400">(${fmtCLP(cdCLP)})</span>` : ''}</td></tr>
            </tbody></table></div>
            ${usoCD != null ? `<div class="mt-3"><div class="flex justify-between text-xs text-slate-500 mb-1"><span>Costo directo consumido</span><span class="font-bold ${usoCD > 100 ? 'text-red-700' : ''}">${fmtPct(usoCD)}</span></div>${barra(usoCD)}</div>` : ''}${notaUF}`)}
        </div>`;
    }

    function presupuestoHtml(pr, p) {
        const c = calcPresupuesto(p);
        const caps = p.capitulos.map(cap => `<tbody><tr class="bg-slate-800 text-white"><td colspan="6" class="px-3 py-2 font-bold">${h(cap.numero)} — ${h(cap.nombre || 'Sin nombre')}</td></tr>${cap.items.map(it =>
            `<tr class="border-t border-slate-100"><td class="px-3 py-2 text-xs font-mono text-slate-400">${h(it.numero)}</td><td class="px-3 py-2">${h(it.descripcion)}</td><td class="px-3 py-2 text-center">${h(it.unidad)}</td><td class="px-3 py-2 text-right">${fmtNum(it.cantidad)}</td><td class="px-3 py-2 text-right">${fmtM(it.precioUnit, p)}</td><td class="px-3 py-2 text-right font-semibold">${fmtM(it.total, p)}</td></tr>`).join('')}</tbody>`).join('');
        const linea = (t, v, f = '') => `<div class="flex justify-between py-1 ${f}"><span>${t}</span><span>${fmtM(v, p)}</span></div>`;
        const ots = p.ordenesTrabajo || [];
        return `<div class="space-y-4">
            ${tarjeta(`Presupuesto ${h(p.numero)}`, `<div class="overflow-x-auto"><table class="w-full text-sm min-w-[640px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr><th class="px-3 py-2 text-left">N°</th><th class="px-3 py-2 text-left">Descripción</th><th class="px-3 py-2">Un</th><th class="px-3 py-2 text-right">Cant.</th><th class="px-3 py-2 text-right">P. unitario</th><th class="px-3 py-2 text-right">Total</th></tr></thead>${caps}</table></div>
                <div class="mt-4 ml-auto max-w-sm text-sm">${linea('Costo directo', c.costoDirecto)}${p.usarGGUtil !== false ? linea(`Gastos generales (${p.ggPct || 0}%)`, c.gg) + linea(`Utilidad (${p.utilPct || 0}%)`, c.util) : ''}${linea('Subtotal neto', c.subtotal, 'font-bold border-t')}${linea(etiquetaIva(c.ivaPct, true), c.iva)}${linea('Total', c.total, 'font-black border-t')}</div>`,
                btn('PDF', `exportarPDF('${p.id}')`, 'bg-red-600 hover:bg-red-700 text-white'))}
            ${tarjeta('Órdenes de trabajo', ots.length ? `<div class="divide-y divide-slate-100">${ots.map(ot =>
                `<div class="py-2 flex flex-wrap items-center justify-between gap-2"><div><span class="font-mono font-bold text-indigo-700">${h(ot.numero)}</span> <span class="text-xs text-slate-500">${fecha(ot.fecha)}</span> ${chip(ot.aprobacionCliente ? 'Aprobada con OC' : ot.estado === 'firmada' ? 'Firmada' : 'Pendiente firma', ot.aprobacionCliente ? 'bg-teal-100 text-teal-800' : ot.estado === 'firmada' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}</div>${btn('PDF', `exportarOTPDF('${p.id}','${ot.id}')`, 'bg-red-600 hover:bg-red-700 text-white')}</div>`).join('')}</div>` : '<p class="text-sm text-slate-400">Sin órdenes de trabajo. Genéralas desde Adjudicados.</p>')}
        </div>`;
    }

    // ── Estados de pago ───────────────────────────────────
    function edpsHtml(pr, p) {
        const lista = edpsDe(pr.id), r = resumen(pr), g = gestiona(pr);
        const activo = pr.estado === 'activo';
        const completo = r.avancePct >= 99.9999;
        const acciones = [
            g && activo && !lista.length ? btn('Solicitud de anticipo', `Proyectos.nuevoEdp('anticipo')`, 'bg-amber-500 hover:bg-amber-600 text-white', 'title="Primer estado de pago: cobra un % del contrato como anticipo"') : '',
            g && activo && !r.abierto && !completo ? btn('+ Nuevo estado de pago', `Proyectos.nuevoEdp('avance')`, 'bg-emerald-600 hover:bg-emerald-700 text-white') : '',
            g && activo && !r.abierto && completo && r.retenido > 0 && !r.devolucion ? btn('Solicitar devolución de retención', `Proyectos.nuevoEdp('devolucion_retencion')`, 'bg-purple-600 hover:bg-purple-700 text-white') : '',
        ].join(' ');
        const filas = [...lista].reverse().map(e => `<tr class="border-t border-slate-100 cursor-pointer ${e.id === edpSelId ? 'bg-blue-50' : 'hover:bg-slate-50'}" onclick="Proyectos.seleccionarEdp('${e.id}')">
            <td class="px-3 py-2 font-mono font-bold">N° ${String(e.numero).padStart(2, '0')}${e.tipo === 'devolucion_retencion' ? '<span class="block text-xs font-sans font-normal text-purple-700">Devolución retención</span>' : ''}${e.tipo === 'anticipo' ? `<span class="block text-xs font-sans font-normal text-amber-700">Anticipo ${fmtPct(e.totales?.anticipoPct)}</span>` : ''}</td>
            <td class="px-3 py-2">${fecha(e.fecha_presentacion)}</td>
            <td class="px-3 py-2 text-right">${e.tipo === 'avance' ? fmtPct(e.totales?.pctAvance) : '—'}</td>
            <td class="px-3 py-2 text-right">${fmtM(e.totales?.per?.neto, p)}</td>
            <td class="px-3 py-2 text-right font-bold">${fmtM(e.totales?.aPagar, p)}</td>
            <td class="px-3 py-2">${h(e.factura_numero || '—')}</td>
            <td class="px-3 py-2">${chip(ESTADOS_EDP[e.estado], COLOR_EDP[e.estado])}</td>
            <td class="px-3 py-2">${atrasoChip(e)}</td></tr>`).join('');
        const sel = lista.find(e => e.id === edpSelId);
        const nota = r.abierto && g ? `<p class="text-xs text-slate-500 mt-3">Para crear el siguiente estado de pago, primero debe aprobarse el N° ${r.abierto.numero}.</p>` : '';
        return `<div class="space-y-4">
            ${tarjeta('Estados de pago', (lista.length ? `<div class="overflow-x-auto"><table class="w-full text-sm min-w-[760px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr><th class="px-3 py-2 text-left">EP</th><th class="px-3 py-2 text-left">Presentado</th><th class="px-3 py-2 text-right">Avance</th><th class="px-3 py-2 text-right">Neto EP</th><th class="px-3 py-2 text-right">A pagar</th><th class="px-3 py-2 text-left">Factura</th><th class="px-3 py-2 text-left">Estado</th><th class="px-3 py-2 text-left">Pago</th></tr></thead><tbody>${filas}</tbody></table></div>`
                : '<p class="text-sm text-slate-400">Todavía no hay estados de pago.</p>') + nota, acciones)}
            ${sel ? detalleEdpHtml(pr, p, sel) : ''}
        </div>`;
    }

    function calculoVigente(pr, p, e) {
        if (e.estado !== 'borrador') return { items: e.items || [], totales: e.totales || {} };
        if (e.tipo === 'devolucion_retencion') {
            const ultimo = edpsDe(pr.id).filter(x => x.tipo === 'avance' && x.estado !== 'borrador').at(-1);
            return calcularDevolucion(p, pr.config, ultimo);
        }
        if (e.tipo === 'anticipo') return calcularSolicitudAnticipo(p, pr.config, anticipoPctEdp);
        return calcularEDP(p, pr.config, previoDe(pr, e), cantidades, ajusteEdp);
    }

    function detalleEdpHtml(pr, p, e) {
        const editable = e.estado === 'borrador' && gestiona(pr);
        const calc = calculoVigente(pr, p, e);
        const t = calc.totales;
        const tabla = e.tipo === 'avance' ? itemsHtml(p, calc.items, editable)
            : e.tipo === 'anticipo' ? anticipoHtml(p, t, editable)
            : '<p class="text-sm text-slate-600">Devolución de las retenciones acumuladas del contrato.</p>';
        const titulo = `${e.tipo === 'anticipo' ? 'Solicitud de anticipo · ' : ''}Estado de pago N° ${String(e.numero).padStart(2, '0')} ${chip(ESTADOS_EDP[e.estado], COLOR_EDP[e.estado])}`;
        const exportar = `<div class="flex flex-wrap gap-2">${btn('Excel', `Proyectos.exportarExcel('${e.id}')`, 'bg-emerald-700 hover:bg-emerald-800 text-white')}${btn('PDF', `Proyectos.exportarPDF('${e.id}')`, 'bg-red-600 hover:bg-red-700 text-white')}</div>`;
        return tarjeta(titulo, `
            ${encabezadoEdpHtml(pr, e, editable)}
            <div class="mt-4">${tabla}</div>
            <div id="pr-edp-resumen" class="mt-4">${resumenEdpHtml(p, t)}</div>
            <div class="mt-4 pt-4 border-t border-slate-200">${accionesEdpHtml(pr, p, e)}</div>`, exportar);
    }

    function encabezadoEdpHtml(pr, e, editable) {
        const dis = editable ? '' : 'disabled';
        return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${campo('Fecha de presentación', `<input id="pr-edp-fecha" type="date" class="campo-input mt-1" value="${h(e.fecha_presentacion || hoyChile())}" ${dis}>`)}
            ${campo('N° OC', `<input id="pr-edp-oc" class="campo-input mt-1" maxlength="40" value="${h(e.oc_numero ?? pr.config?.oc_numero ?? '')}" ${dis}>`)}
            ${campo('N° HES', `<input id="pr-edp-hes" class="campo-input mt-1" maxlength="40" value="${h(e.hes_numero || '')}" ${dis}>`)}
            ${campo('Observaciones', `<input id="pr-edp-obs" class="campo-input mt-1" maxlength="300" value="${h(e.obs || '')}" ${dis}>`)}
            ${e.tipo === 'avance' ? `${campo('Descuento del mandante (neto)', `<input id="pr-edp-desc" inputmode="decimal" placeholder="0" class="campo-input mt-1" value="${h(editable ? (ajusteEdp?.monto || '') : (e.totales?.per?.descuento || ''))}" oninput="Proyectos.editarDescuento()" ${dis}>`)}
            <div class="sm:col-span-1 lg:col-span-3">${campo('Motivo del descuento', `<input id="pr-edp-desc-motivo" maxlength="200" placeholder="Ej: multa por atraso, partida no aceptada" class="campo-input mt-1" value="${h(editable ? (ajusteEdp?.motivo || '') : (e.totales?.descuentoMotivo || ''))}" oninput="Proyectos.editarDescuento()" ${dis}>`)}</div>` : ''}
        </div>
        ${e.estado === 'presentado' ? '<p class="text-xs text-slate-500 mt-2">Si el mandante descuenta o corrige algo, usa "Devolver a borrador", ajusta los montos o el descuento y vuelve a presentarlo.</p>' : ''}`;
    }
    function editarDescuento() {
        const pr = actual(), p = pr && presupuestoDe(pr), e = edps.find(x => x.id === edpSelId);
        if (!p || !e || e.estado !== 'borrador') return;
        const leer = p.moneda === 'UF' ? numeroDecimal : numero; // en $ el punto es separador de miles
        ajusteEdp = { monto: Math.max(0, leer($('pr-edp-desc')?.value)), motivo: $('pr-edp-desc-motivo')?.value || '' };
        $('pr-edp-resumen').innerHTML = resumenEdpHtml(p, calculoVigente(pr, p, e).totales);
    }

    function itemsHtml(p, items, editable) {
        let capActual = null;
        const filas = items.map(i => {
            const cab = i.capId !== capActual ? `<tr class="bg-slate-800 text-white"><td colspan="11" class="px-3 py-1.5 font-bold text-xs">${h(i.capNumero)} — ${h(i.capNombre || 'Sin nombre')}</td></tr>` : '';
            capActual = i.capId;
            const pct = i.cant > 0 ? i.cantAcum / i.cant * 100 : 0;
            const inputs = editable
                ? `<td class="px-2 py-1.5"><input data-item="${h(i.itemId)}" data-modo="cant" inputmode="decimal" value="${i.cantAcum}" oninput="Proyectos.editarAvance(this)" onchange="Proyectos.refrescarEdp(this)" class="w-20 text-right border border-slate-300 rounded-lg px-1.5 py-1 text-xs font-bold focus:ring-2 focus:ring-emerald-400 outline-none"></td>
                   <td class="px-2 py-1.5"><input data-item="${h(i.itemId)}" data-modo="pct" inputmode="decimal" value="${redondear(pct, 2)}" oninput="Proyectos.editarAvance(this)" onchange="Proyectos.refrescarEdp(this)" class="w-16 text-right border border-slate-300 rounded-lg px-1.5 py-1 text-xs font-bold focus:ring-2 focus:ring-emerald-400 outline-none"></td>`
                : `<td class="px-3 py-1.5 text-right font-bold">${fmtNum(i.cantAcum)}</td><td class="px-3 py-1.5 text-right">${fmtPct(pct)}</td>`;
            return `${cab}<tr class="border-t border-slate-100" data-fila="${h(i.itemId)}">
                <td class="px-3 py-1.5 text-xs">${h(i.numero)} ${h(i.detalle)}</td><td class="px-3 py-1.5 text-center text-xs">${h(i.unidad)}</td>
                <td class="px-3 py-1.5 text-right">${fmtNum(i.cant)}</td><td class="px-3 py-1.5 text-right">${fmtM(i.pu, p)}</td><td class="px-3 py-1.5 text-right">${fmtM(i.total, p)}</td>
                <td class="px-3 py-1.5 text-right text-slate-400">${fmtNum(i.cantAnt)}</td>${inputs}
                <td class="px-3 py-1.5 text-right" data-c="acum">${fmtM(i.montoAcum, p)}</td><td class="px-3 py-1.5 text-right text-slate-500" data-c="ant">${fmtM(i.montoAnt, p)}</td>
                <td class="px-3 py-1.5 text-right font-bold text-emerald-700" data-c="per">${fmtM(i.montoPeriodo, p)}</td></tr>`;
        }).join('');
        return `${editable ? '<p class="text-xs text-slate-500 mb-2">Ingresa el avance acumulado a la fecha en unidades o en %. El anterior se toma del estado de pago previo.</p>' : ''}
            <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full text-sm min-w-[1080px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr>
            <th class="px-3 py-2 text-left">Detalle</th><th class="px-3 py-2">Un</th><th class="px-3 py-2 text-right">Cant. inicial</th><th class="px-3 py-2 text-right">P. unitario</th><th class="px-3 py-2 text-right">Precio total</th>
            <th class="px-3 py-2 text-right">Avance ant.</th><th class="px-3 py-2 text-right">Avance un</th><th class="px-3 py-2 text-right">Avance %</th>
            <th class="px-3 py-2 text-right">EP actual</th><th class="px-3 py-2 text-right">EP anterior</th><th class="px-3 py-2 text-right">Total a pago</th></tr></thead><tbody>${filas}</tbody></table></div>`;
    }

    function anticipoHtml(p, t, editable) {
        return `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end bg-amber-50 border border-amber-200 rounded-xl p-4">
            ${campo('Porcentaje de anticipo (%)', `<input id="pr-edp-ant-pct" inputmode="decimal" placeholder="Ej: 20" class="campo-input mt-1 font-bold" value="${h(editable ? (anticipoPctEdp || '') : (t.anticipoPct ?? ''))}" oninput="Proyectos.editarAnticipo()" ${editable ? '' : 'disabled'}>`)}
            <div class="text-sm"><span class="campo-label">Subtotal neto del contrato</span><p class="mt-2 font-semibold">${fmtM(t.baseAnticipo, p)}</p></div>
            <div class="text-sm"><span class="campo-label">Anticipo neto</span><p id="pr-edp-ant-neto" class="mt-2 font-black text-amber-700">${fmtM(t.per?.neto, p)}</p></div>
            <p class="sm:col-span-3 text-xs text-slate-600">Este monto queda como anticipo del proyecto y se descuenta en los estados de pago de avance en proporción al avance; el que completa el 100 % descuenta el saldo.</p>
        </div>`;
    }
    function editarAnticipo() {
        const pr = actual(), p = pr && presupuestoDe(pr), e = edps.find(x => x.id === edpSelId);
        if (!p || !e || e.tipo !== 'anticipo' || e.estado !== 'borrador') return;
        anticipoPctEdp = Math.min(100, Math.max(0, numeroDecimal($('pr-edp-ant-pct')?.value)));
        const t = calculoVigente(pr, p, e).totales;
        $('pr-edp-ant-neto').textContent = fmtM(t.per.neto, p);
        $('pr-edp-resumen').innerHTML = resumenEdpHtml(p, t);
    }

    function resumenEdpHtml(p, t) {
        if (!t?.per) return '';
        const fila = (label, k, fuerte = false) => `<tr class="border-t border-slate-100 ${fuerte ? 'font-bold' : ''}"><td class="px-3 py-1.5">${label}</td>${['contrato', 'acum', 'ant', 'per'].map(c => `<td class="px-3 py-1.5 text-right">${fmtM(t[c]?.[k], p)}</td>`).join('')}</tr>`;
        const conGG = (t.ggPct || 0) + (t.utilPct || 0) > 0;
        const cuerpo = t.devolucion ? fila('Devolución de retenciones', 'neto', true)
            : t.solicitudAnticipo ? fila(`Anticipo solicitado (${fmtPct(t.anticipoPct)} de ${fmtM(t.baseAnticipo, p)})`, 'neto', true) : [
            fila('Costo directo', 'cd'),
            conGG ? fila(`Gastos generales (${fmtPct(t.ggPct)})`, 'gg') + fila(`Utilidad (${fmtPct(t.utilPct)})`, 'util') : '',
            fila('Subtotal neto', 'sub', true),
            fila('Descuento anticipo', 'anticipo'),
            fila(`Retención (${fmtPct(t.retPct)})`, 'retencion'),
            t.acum?.descuento ? fila(`Descuento mandante${t.descuentoMotivo ? `<span class="block text-xs text-slate-400">${h(t.descuentoMotivo)}</span>` : ''}`, 'descuento') : '',
            fila('Total neto', 'neto', true),
        ].join('');
        const imp = t.documento === 'exenta' ? '' : `<div class="flex justify-between py-1"><span>${t.documento === 'boleta_honorarios' ? 'Retención boleta' : 'IVA'} (${fmtPct(t.tasa)})</span><span>${t.documento === 'boleta_honorarios' ? '− ' : ''}${fmtM(t.impuesto, p)}</span></div>`;
        return `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="lg:col-span-2 overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full text-sm min-w-[560px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr><th class="px-3 py-2 text-left"></th><th class="px-3 py-2 text-right">Contrato</th><th class="px-3 py-2 text-right">Acumulado</th><th class="px-3 py-2 text-right">Anterior</th><th class="px-3 py-2 text-right">Este EP</th></tr></thead><tbody>${cuerpo}</tbody></table></div>
            <div class="bg-slate-900 text-white rounded-xl p-4 text-sm">
                <div class="flex justify-between py-1"><span>Avance acumulado</span><span class="font-bold">${fmtPct(t.pctAvance)}</span></div>
                <div class="flex justify-between py-1"><span>Neto este EP</span><span>${fmtM(t.per.neto, p)}</span></div>${imp}
                <div class="flex justify-between pt-2 mt-1 border-t border-slate-600 text-base font-black"><span>A pagar</span><span class="text-amber-400">${fmtM(t.aPagar, p)}</span></div>
            </div></div>`;
    }

    function accionesEdpHtml(pr, p, e) {
        const g = gestiona(pr);
        const archivo = (path, texto) => path ? btn(texto, `Proyectos.verArchivo('${h(path)}')`, 'border border-slate-300 text-slate-700 hover:bg-slate-50') : '';
        if (!g) return `<div class="flex flex-wrap gap-2 items-center text-sm text-slate-500">Solo el administrador del proyecto gestiona los estados de pago. ${archivo(e.factura_path, 'Ver factura')} ${archivo(e.comprobante_path, 'Ver comprobante')}</div>`;
        if (e.estado === 'borrador') return `<div class="flex flex-wrap gap-2 justify-between">
            ${btn('Eliminar borrador', `Proyectos.eliminarEdp('${e.id}')`, 'border border-red-300 text-red-600 hover:bg-red-50')}
            <div class="flex flex-wrap gap-2">${btn('Guardar borrador', `Proyectos.guardarEdp('${e.id}')`, 'bg-slate-700 hover:bg-slate-800 text-white')}${btn('Presentar al mandante', `Proyectos.guardarEdp('${e.id}','presentado')`, 'bg-amber-500 hover:bg-amber-600 text-white')}</div></div>`;
        if (e.estado === 'presentado') return `<div class="flex flex-wrap gap-3 items-end justify-between">
            ${btn('Devolver a borrador', `Proyectos.cambiarEstado('${e.id}','borrador')`, 'border border-slate-300 text-slate-700 hover:bg-slate-50')}
            <div class="flex flex-wrap gap-2 items-end">${campo('Fecha de aprobación', `<input id="pr-edp-aprobacion" type="date" class="campo-input mt-1" value="${hoyChile()}">`)}${btn('Aprobado por el mandante', `Proyectos.aprobarEdp('${e.id}')`, 'bg-blue-700 hover:bg-blue-800 text-white')}</div></div>`;
        const facturacion = `<form onsubmit="Proyectos.guardarFacturacion(event,'${e.id}')" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            ${campo('N° factura / boleta', `<input id="pr-fac-numero" class="campo-input mt-1" maxlength="40" value="${h(e.factura_numero || '')}" ${e.estado === 'pagado' ? 'disabled' : ''}>`)}
            ${campo('Fecha emisión', `<input id="pr-fac-fecha" type="date" class="campo-input mt-1" value="${h(e.factura_fecha || '')}" ${e.estado === 'pagado' ? 'disabled' : ''}>`)}
            ${campo('Fecha de pago estimada', `<input id="pr-fac-estimada" type="date" class="campo-input mt-1" value="${h(e.fecha_pago_estimada || '')}" ${e.estado === 'pagado' ? 'disabled' : ''}>`)}
            ${e.estado === 'pagado' ? '' : campo('Archivo factura (PDF o foto)', `<input id="pr-fac-archivo" type="file" accept="application/pdf,image/*" class="campo-input mt-1 text-xs">`)}
            ${e.estado === 'pagado' ? '' : `<div class="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-2 justify-end"><button type="submit" class="text-xs px-3 py-2 rounded-lg font-bold bg-slate-700 hover:bg-slate-800 text-white">Guardar facturación</button></div>`}
        </form>`;
        if (e.estado === 'aprobado') return `<div class="space-y-4">
            <div class="flex flex-wrap items-center gap-2"><span class="text-sm font-bold text-slate-700">Aprobado el ${fecha(e.fecha_aprobacion)}</span>${atrasoChip(e)}${archivo(e.factura_path, 'Ver factura')}</div>
            ${facturacion}
            <form onsubmit="Proyectos.registrarPago(event,'${e.id}')" class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                ${campo('Fecha de pago', `<input id="pr-pago-fecha" type="date" required class="campo-input mt-1" value="${hoyChile()}" max="${hoyChile()}">`)}
                ${campo('Comprobante (PDF o foto)', `<input id="pr-pago-archivo" type="file" accept="application/pdf,image/*" class="campo-input mt-1 text-xs">`)}
                <button type="submit" class="text-sm px-3 py-2.5 rounded-lg font-bold bg-emerald-600 hover:bg-emerald-700 text-white">Marcar como pagado</button>
            </form>
        </div>`;
        return `<div class="space-y-3">
            <div class="flex flex-wrap items-center gap-2">${atrasoChip(e)}<span class="text-sm text-slate-600">Factura ${h(e.factura_numero || '—')} · aprobado ${fecha(e.fecha_aprobacion)} · estimado ${fecha(e.fecha_pago_estimada)}${e.fecha_pago_estimada && e.fecha_pago_real ? ` · ${diasEntre(e.fecha_pago_estimada, e.fecha_pago_real) > 0 ? `pagado con ${diasEntre(e.fecha_pago_estimada, e.fecha_pago_real)} día(s) de atraso` : 'pagado a tiempo'}` : ''}</span></div>
            <div class="flex flex-wrap gap-2">${archivo(e.factura_path, 'Ver factura')}${archivo(e.comprobante_path, 'Ver comprobante')}${btn('Revertir pago', `Proyectos.cambiarEstado('${e.id}','aprobado')`, 'border border-red-300 text-red-600 hover:bg-red-50')}</div></div>`;
    }

    function seleccionarEdp(id) {
        const pr = actual(), e = edps.find(x => x.id === id);
        if (!pr || !e) return;
        edpSelId = id;
        cantidades = e.estado === 'borrador' && e.tipo === 'avance'
            ? new Map((e.items?.length ? e.items : calcularEDP(presupuestoDe(pr), pr.config, previoDe(pr, e), null).items).map(i => [i.itemId, i.cantAcum]))
            : null;
        ajusteEdp = { monto: e.totales?.per?.descuento || 0, motivo: e.totales?.descuentoMotivo || '' };
        anticipoPctEdp = e.totales?.anticipoPct || 0;
        render();
        setTimeout(() => document.getElementById('pr-edp-resumen')?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    }
    function editarAvance(input) {
        const pr = actual(), p = pr && presupuestoDe(pr), e = edps.find(x => x.id === edpSelId);
        if (!p || !e || !cantidades) return;
        const itemId = input.dataset.item;
        const item = p.capitulos.flatMap(c => c.items).find(i => i.id === itemId);
        if (!item) return;
        const v = numeroDecimal(input.value);
        cantidades.set(itemId, input.dataset.modo === 'pct' ? (+item.cantidad || 0) * v / 100 : v);
        const calc = calcularEDP(p, pr.config, previoDe(pr, e), cantidades, ajusteEdp);
        const i = calc.items.find(x => x.itemId === itemId);
        const fila = document.querySelector(`[data-fila="${CSS.escape(itemId)}"]`);
        if (fila && i) {
            const otro = fila.querySelector(`input[data-modo="${input.dataset.modo === 'pct' ? 'cant' : 'pct'}"]`);
            if (otro) otro.value = input.dataset.modo === 'pct' ? i.cantAcum : redondear(i.cant > 0 ? i.cantAcum / i.cant * 100 : 0, 2);
            fila.querySelector('[data-c="acum"]').textContent = fmtM(i.montoAcum, p);
            fila.querySelector('[data-c="per"]').textContent = fmtM(i.montoPeriodo, p);
        }
        $('pr-edp-resumen').innerHTML = resumenEdpHtml(p, calc.totales);
    }
    // Al salir del campo muestra el valor ya acotado (entre el anterior y el contrato) sin redibujar la tabla.
    function refrescarEdp(input) {
        const pr = actual(), e = edps.find(x => x.id === edpSelId);
        if (!pr || !e || !cantidades) return;
        const i = calcularEDP(presupuestoDe(pr), pr.config, previoDe(pr, e), cantidades).items.find(x => x.itemId === input.dataset.item);
        if (!i) return;
        cantidades.set(i.itemId, i.cantAcum);
        const fila = input.closest('tr');
        fila.querySelector('input[data-modo="cant"]').value = i.cantAcum;
        fila.querySelector('input[data-modo="pct"]').value = redondear(i.cant > 0 ? i.cantAcum / i.cant * 100 : 0, 2);
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
            const sinMigracion = /proyecto_edps_tipo_check/.test(error.message || '');
            toast(sinMigracion ? 'Para la solicitud de anticipo falta aplicar la migración 202610210001_edp_anticipo.sql' : 'No se pudo guardar: ' + (error.message || error), 'error');
            return null;
        } finally { ocupado = false; }
    }
    // El neto de la solicitud de anticipo es el anticipo que amortizan los EP de avance.
    async function fijarAnticipo(pr, monto, fechaAnticipo) {
        const config = { ...(pr.config || {}), anticipo_monto: monto, anticipo_fecha: fechaAnticipo || pr.config?.anticipo_fecha || null };
        const { data, error } = await supa.from('proyectos').update({ config }).eq('id', pr.id).select().single();
        if (error) return toast('No se pudo actualizar el anticipo del proyecto: ' + error.message, 'error');
        reemplazar(proyectos, data);
    }

    async function nuevoEdp(tipo) {
        const pr = actual(), p = pr && presupuestoDe(pr);
        if (!p || !gestiona(pr)) return;
        if (tipo === 'anticipo' && edpsDe(pr.id).length) return toast('La solicitud de anticipo debe ser el primer estado de pago del proyecto', 'error');
        const ultimo = edpsDe(pr.id).filter(x => x.tipo === 'avance' && x.estado !== 'borrador').at(-1) || null;
        const calc = tipo === 'devolucion_retencion' ? calcularDevolucion(p, pr.config, ultimo)
            : tipo === 'anticipo' ? calcularSolicitudAnticipo(p, pr.config, 0)
            : calcularEDP(p, pr.config, ultimo, null);
        const data = await ejecutar(supa.from('proyecto_edps').insert({ proyecto_id: pr.id, tipo, items: calc.items, totales: calc.totales, oc_numero: pr.config?.oc_numero || null }).select().single(),
            'Estado de pago creado en borrador');
        if (!data) return;
        edps.push(data);
        seleccionarEdp(data.id);
    }
    async function guardarEdp(id, nuevoEstado) {
        const pr = actual(), p = pr && presupuestoDe(pr), e = edps.find(x => x.id === id);
        if (!p || !e) return;
        const calc = calculoVigente(pr, p, e);
        if (nuevoEstado === 'presentado') {
            if (e.tipo === 'anticipo' && !(calc.totales.per?.neto > 0)) return toast('Indica el porcentaje de anticipo', 'error');
            if (!(calc.totales.per?.neto > 0) && !(calc.totales.per?.sub > 0)) return toast('El estado de pago no tiene avance en este período', 'error');
            if (!confirm(`¿Presentar el estado de pago N° ${e.numero} por ${fmtM(calc.totales.aPagar, p)}? Mientras el mandante no lo apruebe podrás devolverlo a borrador para corregir montos o descuentos.`)) return;
        }
        if ((calc.totales.per?.neto || 0) < 0) return toast('El descuento del mandante supera el neto de este estado de pago', 'error');
        if ((calc.totales.per?.descuento || 0) > 0 && !calc.totales.descuentoMotivo) return toast('Indica el motivo del descuento del mandante', 'error');
        const cambios = { items: calc.items, totales: calc.totales, fecha_presentacion: $('pr-edp-fecha')?.value || null,
            oc_numero: $('pr-edp-oc')?.value.trim() || null, hes_numero: $('pr-edp-hes')?.value.trim() || null, obs: $('pr-edp-obs')?.value.trim() || null };
        if (nuevoEstado) cambios.estado = nuevoEstado;
        const data = await ejecutar(supa.from('proyecto_edps').update(cambios).eq('id', id).select().single(), nuevoEstado ? 'Estado de pago presentado' : 'Borrador guardado');
        if (!data) return;
        reemplazar(edps, data);
        if (e.tipo === 'anticipo') await fijarAnticipo(pr, calc.totales.per.neto, cambios.fecha_presentacion);
        if (nuevoEstado) cantidades = null;
        render();
    }
    async function cambiarEstado(id, estado) {
        const e = edps.find(x => x.id === id);
        if (!e) return;
        const textos = { borrador: '¿Devolver a borrador para corregirlo?', aprobado: '¿Revertir el pago? Se borrarán la fecha y el comprobante registrados.', presentado: '¿Devolver a presentado?' };
        if (!confirm(textos[estado] || '¿Confirmas el cambio?')) return;
        const data = await ejecutar(supa.from('proyecto_edps').update({ estado }).eq('id', id).select().single(), 'Estado actualizado');
        if (!data) return;
        reemplazar(edps, data);
        if (estado === 'borrador') return seleccionarEdp(id);
        render();
    }
    async function aprobarEdp(id) {
        const fechaAprob = $('pr-edp-aprobacion')?.value || hoyChile();
        const data = await ejecutar(supa.from('proyecto_edps').update({ estado: 'aprobado', fecha_aprobacion: fechaAprob }).eq('id', id).select().single(), 'Estado de pago aprobado. Adjunta la factura y la fecha estimada de pago.');
        if (!data) return;
        reemplazar(edps, data);
        render();
        actualizarBadge();
    }
    async function eliminarEdp(id) {
        if (!confirm('¿Eliminar este borrador?')) return;
        const e = edps.find(x => x.id === id), pr = actual();
        const ok = await ejecutar(supa.from('proyecto_edps').delete().eq('id', id), 'Borrador eliminado');
        if (!ok) return;
        if (e?.tipo === 'anticipo' && pr) await fijarAnticipo(pr, 0, null);
        edps = edps.filter(x => x.id !== id);
        edpSelId = null; cantidades = null;
        render();
    }
    async function guardarFacturacion(ev, id) {
        ev.preventDefault();
        const pr = actual(), e = edps.find(x => x.id === id);
        if (!pr || !e) return;
        let path = e.factura_path;
        try { path = (await subirArchivo($('pr-fac-archivo')?.files[0], pr, 'factura')) || path; }
        catch (error) { return toast(error.message, 'error'); }
        const data = await ejecutar(supa.from('proyecto_edps').update({
            factura_numero: $('pr-fac-numero').value.trim() || null, factura_fecha: $('pr-fac-fecha').value || null,
            fecha_pago_estimada: $('pr-fac-estimada').value || null, factura_path: path,
        }).eq('id', id).select().single(), 'Facturación guardada');
        if (!data) return;
        reemplazar(edps, data);
        render();
        actualizarBadge();
    }
    async function registrarPago(ev, id) {
        ev.preventDefault();
        const pr = actual(), p = pr && presupuestoDe(pr), e = edps.find(x => x.id === id);
        if (!p || !e) return;
        const fechaPago = $('pr-pago-fecha').value;
        if (!fechaPago) return toast('Indica la fecha de pago', 'error');
        if (!confirm(`¿Confirmas que el mandante pagó ${fmtM(e.totales?.aPagar, p)} el ${fecha(fechaPago)}?`)) return;
        let path = null;
        try { path = await subirArchivo($('pr-pago-archivo')?.files[0], pr, 'comprobante'); }
        catch (error) { return toast(error.message, 'error'); }
        const data = await ejecutar(supa.from('proyecto_edps').update({ estado: 'pagado', fecha_pago_real: fechaPago, comprobante_path: path }).eq('id', id).select().single(), 'Pago registrado');
        if (!data) return;
        reemplazar(edps, data);
        render();
        actualizarBadge();
    }

    // ── Gastos ────────────────────────────────────────────
    function gastosHtml(pr) {
        const g = gestiona(pr), lista = gastosDe(pr.id);
        const filtrados = lista.filter(x => (!filtroCat || x.categoria === filtroCat) && (!filtroEstado || x.estado === filtroEstado));
        const totalAprob = filtrados.filter(x => x.estado === 'aprobado').reduce((s, x) => s + x.monto, 0);
        const totalPend = filtrados.filter(x => x.estado === 'pendiente').reduce((s, x) => s + x.monto, 0);
        const opciones = (obj, sel, vacio) => (vacio ? `<option value="">${vacio}</option>` : '') + Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${h(t)}</option>`).join('');
        const formulario = pr.estado === 'activo' || g ? tarjeta(pr.estado === 'activo' ? 'Registrar gasto' : 'Registrar gasto (proyecto cerrado)', `<form onsubmit="Proyectos.registrarGasto(event)" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${campo('Fecha', `<input id="pr-g-fecha" type="date" required class="campo-input mt-1" value="${hoyChile()}" max="${hoyChile()}">`)}
            ${campo('Categoría', `<select id="pr-g-cat" required onchange="Proyectos.cambiarCategoriaGasto(this.value)" class="campo-input mt-1">${opciones(CATEGORIAS, 'materiales')}</select>`)}
            ${campo('Tipo / concepto', `<input id="pr-g-sub" list="pr-g-subs" maxlength="80" placeholder="${h(ejemploConcepto('materiales'))}" class="campo-input mt-1"><datalist id="pr-g-subs">${opcionesConcepto('materiales')}</datalist>`)}
            ${campo('Monto total (CLP)', `<input id="pr-g-monto" required inputmode="numeric" placeholder="0" class="campo-input mt-1">`)}
            <div class="sm:col-span-2">${campo('Descripción', `<input id="pr-g-desc" required maxlength="300" class="campo-input mt-1" placeholder="Qué se compró o pagó">`)}</div>
            ${campo('Proveedor', `<input id="pr-g-prov" maxlength="160" class="campo-input mt-1">`)}
            ${campo('Documento', `<select id="pr-g-tipodoc" class="campo-input mt-1">${opciones(TIPOS_DOC, 'boleta')}</select>`)}
            ${campo('N° documento', `<input id="pr-g-numdoc" maxlength="40" class="campo-input mt-1">`)}
            ${conTerreno ? campo('Pagado con', `<select id="pr-g-origen" class="campo-input mt-1">${opciones(ORIGENES, 'empresa')}</select>`) : ''}
            <div class="sm:col-span-2">${campo(`Respaldos (fotos de boleta/factura/transferencia o PDF, hasta ${MAX_ADJUNTOS})`, `<input id="pr-g-archivo" type="file" multiple accept="image/*,application/pdf" class="campo-input mt-1 text-xs">`)}</div>
            <div class="flex items-end"><button type="submit" class="w-full text-sm px-3 py-2.5 rounded-lg font-bold bg-emerald-600 hover:bg-emerald-700 text-white">Registrar gasto</button></div>
            <p class="sm:col-span-2 lg:col-span-4 text-xs text-slate-500">${pr.estado === 'activo' ? '' : '<b class="text-slate-700">Proyecto cerrado:</b> solo su administrador puede cargarle gastos. '}Queda pendiente hasta que lo apruebe el administrador del proyecto (${h(nombrePerfil(pr.administrador_id))}).</p>
        </form>`) : '';
        const filas = filtrados.map(x => {
            const propio = x.registrado_por === miPerfil?.id;
            const editable = g || (propio && x.estado === 'pendiente'); // igual que el trigger validar_gasto
            const adj = adjuntosDe(x);
            const respaldos = adj.map((path, i) => `<span class="inline-flex items-stretch">${btn(adj.length > 1 ? `Respaldo ${i + 1}` : 'Respaldo', `Proyectos.verArchivo('${h(path)}')`, `border border-slate-300 text-slate-700 hover:bg-slate-50${editable ? ' rounded-r-none' : ''}`)}${editable
                ? `<button type="button" title="Quitar este respaldo" onclick="Proyectos.quitarRespaldo('${x.id}',${i})" class="text-xs px-2 rounded-r-lg border border-l-0 border-slate-300 text-slate-400 hover:text-red-600 hover:bg-red-50">×</button>` : ''}</span>`).join('');
            const agregar = editable && (pr.estado === 'activo' || g) && adj.length < MAX_ADJUNTOS
                ? `<label class="text-xs px-3 py-2 rounded-lg font-bold transition-colors border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 cursor-pointer">+ Respaldo<input type="file" multiple accept="image/*,application/pdf" class="hidden" onchange="Proyectos.agregarRespaldos('${x.id}',this)"></label>` : '';
            const cambiarOrigen = editable && conTerreno && x.origen_fondos
                ? btn(x.origen_fondos === 'propio' ? 'Pasar a caja chica' : 'Pasar a dinero propio', `Proyectos.cambiarOrigen('${x.id}')`, 'border border-violet-300 text-violet-700 hover:bg-violet-50') : '';
            const acciones = [
                respaldos, agregar, cambiarOrigen,
                g && x.estado === 'pendiente' ? btn('Aprobar', `Proyectos.revisarGasto('${x.id}','aprobado')`, 'bg-emerald-600 hover:bg-emerald-700 text-white') : '',
                g && x.estado === 'pendiente' ? btn('Rechazar', `Proyectos.pedirRechazo('${x.id}')`, 'border border-red-300 text-red-600 hover:bg-red-50') : '',
                g && x.origen_fondos === 'propio' && x.estado === 'aprobado' ? (x.reembolsado_en
                    ? btn('Deshacer reembolso', `Proyectos.reembolsarGasto('${x.id}',false)`, 'border border-slate-300 text-slate-600 hover:bg-slate-50')
                    : btn('Marcar reembolsado', `Proyectos.reembolsarGasto('${x.id}',true)`, 'bg-violet-600 hover:bg-violet-700 text-white')) : '',
                g && x.estado !== 'pendiente' ? btn('Reabrir', `Proyectos.revisarGasto('${x.id}','pendiente')`, 'border border-slate-300 text-slate-600 hover:bg-slate-50') : '',
                (g || (propio && x.estado === 'pendiente')) ? btn('Eliminar', `Proyectos.eliminarGasto('${x.id}')`, 'text-red-500 hover:bg-red-50') : '',
            ].join('');
            const rechazo = rechazandoId === x.id ? `<tr><td colspan="7" class="px-3 pb-3"><div class="flex flex-wrap gap-2 items-center bg-red-50 rounded-lg p-2"><input id="pr-g-motivo" maxlength="200" placeholder="Motivo del rechazo" class="campo-input flex-1 min-w-[200px]">${btn('Confirmar rechazo', `Proyectos.revisarGasto('${x.id}','rechazado')`, 'bg-red-600 hover:bg-red-700 text-white')}${btn('Cancelar', 'Proyectos.pedirRechazo(null)', 'text-slate-600 hover:bg-white')}</div></td></tr>` : '';
            return `<tr class="border-t border-slate-100 align-top">
                <td class="px-3 py-2 whitespace-nowrap">${fecha(x.fecha)}</td>
                <td class="px-3 py-2">${h(CATEGORIAS[x.categoria])}${x.subcategoria ? `<span class="block text-xs text-slate-400">${h(x.subcategoria)}</span>` : ''}</td>
                <td class="px-3 py-2">${h(x.descripcion)}<span class="block text-xs text-slate-400">${h([x.proveedor, TIPOS_DOC[x.tipo_doc] + (x.numero_doc ? ' N° ' + x.numero_doc : '')].filter(Boolean).join(' · '))}</span></td>
                <td class="px-3 py-2 text-right font-bold whitespace-nowrap">${fmtCLP(x.monto)}</td>
                <td class="px-3 py-2"><div class="flex flex-wrap gap-1">${chip(ESTADOS_GASTO[x.estado], COLOR_GASTO[x.estado])}${x.origen_fondos === 'propio' ? chip(ORIGENES.propio, 'bg-violet-100 text-violet-800') : x.origen_fondos ? chip(ORIGENES.empresa, 'bg-slate-100 text-slate-700') : ''}${x.reembolsado_en ? chip('Reembolsado ' + fecha(x.reembolsado_en), 'bg-emerald-600 text-white') : ''}</div>${x.estado === 'rechazado' && x.motivo_rechazo ? `<span class="block text-xs text-red-600 mt-1">${h(x.motivo_rechazo)}</span>` : ''}</td>
                <td class="px-3 py-2 text-xs text-slate-500">${h(nombrePerfil(x.registrado_por))}${x.revisado_por ? `<span class="block">Revisó: ${h(nombrePerfil(x.revisado_por))}</span>` : ''}</td>
                <td class="px-3 py-2"><div class="flex flex-wrap gap-1 justify-end">${acciones}</div></td></tr>${rechazo}`;
        }).join('');
        return `<div class="space-y-4">${formulario}
            ${tarjeta('Gastos del proyecto', `<div class="flex flex-wrap gap-3 mb-3">
                <select onchange="Proyectos.filtrarGastos('cat',this.value)" class="campo-input w-auto">${opciones(CATEGORIAS, filtroCat, 'Todas las categorías')}</select>
                <select onchange="Proyectos.filtrarGastos('estado',this.value)" class="campo-input w-auto">${opciones(ESTADOS_GASTO, filtroEstado, 'Todos los estados')}</select></div>
                ${filas ? `<div class="overflow-x-auto"><table class="w-full text-sm min-w-[860px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr><th class="px-3 py-2 text-left">Fecha</th><th class="px-3 py-2 text-left">Categoría</th><th class="px-3 py-2 text-left">Detalle</th><th class="px-3 py-2 text-right">Monto</th><th class="px-3 py-2 text-left">Estado</th><th class="px-3 py-2 text-left">Registró</th><th class="px-3 py-2"></th></tr></thead><tbody>${filas}</tbody></table></div>`
                    : '<p class="text-sm text-slate-400">No hay gastos con estos filtros.</p>'}
                <div class="flex flex-wrap gap-4 justify-end text-sm mt-3"><span>Aprobados: <b>${fmtCLP(totalAprob)}</b></span><span>Pendientes: <b>${fmtCLP(totalPend)}</b></span></div>`)}
            ${porReembolsarHtml(lista)}
        </div>`;
    }
    // Gastos pagados con dinero propio, aprobados y aún no devueltos, por persona.
    function porReembolsarHtml(lista) {
        const deudas = new Map();
        lista.filter(x => x.origen_fondos === 'propio' && x.estado === 'aprobado' && !x.reembolsado_en)
            .forEach(x => deudas.set(x.registrado_por, (deudas.get(x.registrado_por) || 0) + x.monto));
        if (!deudas.size) return '';
        return tarjeta('Por reembolsar al personal', `<div class="divide-y divide-slate-100">${[...deudas].map(([id, monto]) =>
            `<div class="flex justify-between py-2 text-sm"><span>${h(nombrePerfil(id))}</span><b class="text-violet-700">${fmtCLP(monto)}</b></div>`).join('')}</div>
            <p class="text-xs text-slate-500 mt-2">Gastos aprobados pagados con dinero propio. Al devolver el dinero, usa "Marcar reembolsado" en cada gasto.</p>`);
    }
    // Corrige con qué dinero se pagó (mismo permiso que editar el gasto; si deja de ser propio, se quita el reembolso).
    async function cambiarOrigen(id) {
        const x = gastos.find(g => g.id === id);
        if (!x) return;
        const nuevo = x.origen_fondos === 'propio' ? 'empresa' : 'propio';
        if (!confirm(`¿Marcar "${x.descripcion}" como pagado con ${ORIGENES[nuevo].toLowerCase()}?${x.reembolsado_en ? ' Se quitará el reembolso registrado.' : ''}`)) return;
        const data = await ejecutar(supa.from('proyecto_gastos').update({ origen_fondos: nuevo }).eq('id', id).select().single(), 'Origen del dinero actualizado');
        if (!data) return;
        reemplazar(gastos, data);
        render();
    }
    async function reembolsarGasto(id, marcar) {
        const x = gastos.find(g => g.id === id);
        if (!x) return;
        let fechaReembolso = null;
        if (marcar) {
            fechaReembolso = prompt(`Fecha en que se devolvió ${fmtCLP(x.monto)} a ${nombrePerfil(x.registrado_por)} (AAAA-MM-DD):`, hoyChile());
            if (fechaReembolso == null) return;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaReembolso.trim())) return toast('Escribe la fecha como AAAA-MM-DD', 'error');
            fechaReembolso = fechaReembolso.trim();
        } else if (!confirm('¿Deshacer el reembolso de este gasto?')) return;
        const data = await ejecutar(supa.from('proyecto_gastos').update({ reembolsado_en: fechaReembolso }).eq('id', id).select().single(),
            marcar ? 'Reembolso registrado' : 'Reembolso deshecho');
        if (!data) return;
        reemplazar(gastos, data);
        render();
    }

    // ── Ingresos recibidos en obra (desde la app de terreno o aquí) ──
    function ingresosHtml(pr) {
        const g = gestiona(pr), lista = ingresosDe(pr.id);
        const aprob = lista.filter(x => x.estado === 'aprobado'), pend = lista.filter(x => x.estado === 'pendiente');
        const filas = lista.map(x => {
            const acciones = [
                ...adjuntosDe(x).map((path, i, a) => btn(a.length > 1 ? `Comprobante ${i + 1}` : 'Comprobante', `Proyectos.verArchivo('${h(path)}')`, 'border border-slate-300 text-slate-700 hover:bg-slate-50')),
                g && x.estado === 'pendiente' ? btn('Autorizar', `Proyectos.revisarIngreso('${x.id}','aprobado')`, 'bg-emerald-600 hover:bg-emerald-700 text-white') : '',
                g && x.estado === 'pendiente' ? btn('Rechazar', `Proyectos.pedirRechazo('${x.id}')`, 'border border-red-300 text-red-600 hover:bg-red-50') : '',
                g && x.estado !== 'pendiente' ? btn('Reabrir', `Proyectos.revisarIngreso('${x.id}','pendiente')`, 'border border-slate-300 text-slate-600 hover:bg-slate-50') : '',
                (g || (x.registrado_por === miPerfil?.id && x.estado === 'pendiente')) ? btn('Eliminar', `Proyectos.eliminarIngreso('${x.id}')`, 'text-red-500 hover:bg-red-50') : '',
            ].join('');
            const rechazo = rechazandoId === x.id ? `<tr><td colspan="6" class="px-3 pb-3"><div class="flex flex-wrap gap-2 items-center bg-red-50 rounded-lg p-2"><input id="pr-g-motivo" maxlength="200" placeholder="Motivo del rechazo" class="campo-input flex-1 min-w-[200px]">${btn('Confirmar rechazo', `Proyectos.revisarIngreso('${x.id}','rechazado')`, 'bg-red-600 hover:bg-red-700 text-white')}${btn('Cancelar', 'Proyectos.pedirRechazo(null)', 'text-slate-600 hover:bg-white')}</div></td></tr>` : '';
            return `<tr class="border-t border-slate-100 align-top">
                <td class="px-3 py-2 whitespace-nowrap">${fecha(x.fecha)}</td>
                <td class="px-3 py-2">${h(x.descripcion)}<span class="block text-xs text-slate-400">${h([MEDIOS[x.medio], x.pagador].filter(Boolean).join(' · '))}</span></td>
                <td class="px-3 py-2 text-right font-bold whitespace-nowrap text-blue-700">${fmtCLP(x.monto)}</td>
                <td class="px-3 py-2">${chip(x.estado === 'aprobado' ? 'Autorizado' : ESTADOS_GASTO[x.estado], COLOR_GASTO[x.estado])}${x.estado === 'rechazado' && x.motivo_rechazo ? `<span class="block text-xs text-red-600 mt-1">${h(x.motivo_rechazo)}</span>` : ''}</td>
                <td class="px-3 py-2 text-xs text-slate-500">${h(nombrePerfil(x.registrado_por))}${x.revisado_por ? `<span class="block">Revisó: ${h(nombrePerfil(x.revisado_por))}</span>` : ''}</td>
                <td class="px-3 py-2"><div class="flex flex-wrap gap-1 justify-end">${acciones}</div></td></tr>${rechazo}`;
        }).join('');
        // Dinero de la obra que quedó en manos del personal (transferencia personal o efectivo autorizados).
        const enPersonal = aprob.filter(x => x.medio !== 'transferencia_empresa').reduce((s, x) => s + x.monto, 0);
        return tarjeta('Ingresos recibidos en obra', `${filas ? `<div class="overflow-x-auto"><table class="w-full text-sm min-w-[760px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr><th class="px-3 py-2 text-left">Fecha</th><th class="px-3 py-2 text-left">Detalle</th><th class="px-3 py-2 text-right">Monto</th><th class="px-3 py-2 text-left">Estado</th><th class="px-3 py-2 text-left">Registró</th><th class="px-3 py-2"></th></tr></thead><tbody>${filas}</tbody></table></div>`
                : '<p class="text-sm text-slate-400">No hay ingresos registrados. El personal los registra desde la app de terreno (gastos.html).</p>'}
            <div class="flex flex-wrap gap-4 justify-end text-sm mt-3"><span>Autorizados: <b>${fmtCLP(aprob.reduce((s, x) => s + x.monto, 0))}</b></span><span>Por autorizar: <b>${fmtCLP(pend.reduce((s, x) => s + x.monto, 0))}</b></span>${enPersonal ? `<span>Recibido por el personal: <b>${fmtCLP(enPersonal)}</b></span>` : ''}</div>
            ${g ? '' : '<p class="text-xs text-slate-500 mt-2">Solo el encargado del proyecto autoriza los ingresos.</p>'}`);
    }
    async function revisarIngreso(id, estado) {
        const cambios = { estado };
        if (estado === 'rechazado') {
            cambios.motivo_rechazo = $('pr-g-motivo')?.value.trim() || '';
            if (cambios.motivo_rechazo.length < 3) return toast('Indica el motivo del rechazo', 'error');
        }
        const data = await ejecutar(supa.from('proyecto_ingresos').update(cambios).eq('id', id).select().single(),
            { aprobado: 'Ingreso autorizado', rechazado: 'Ingreso rechazado', pendiente: 'Ingreso reabierto' }[estado]);
        if (!data) return;
        rechazandoId = null;
        reemplazar(ingresos, data);
        render();
    }
    async function eliminarIngreso(id) {
        const x = ingresos.find(g => g.id === id);
        if (!x || !confirm(`¿Eliminar el ingreso "${x.descripcion}" por ${fmtCLP(x.monto)}?`)) return;
        const ok = await ejecutar(supa.from('proyecto_ingresos').delete().eq('id', id), 'Ingreso eliminado');
        if (!ok) return;
        if (adjuntosDe(x).length) supa.storage.from('proyectos').remove(adjuntosDe(x));
        ingresos = ingresos.filter(g => g.id !== id);
        render();
    }

    // ── Informes de trabajo (se crean desde la app de terreno) ──
    function informesHtml(pr) {
        const lista = informesDe(pr.id);
        const filas = lista.map(x => {
            const fotos = (x.items || []).reduce((s, it) => s + (it.antes?.length || 0) + (it.despues?.length || 0), 0);
            return `<tr class="border-t border-slate-100 align-top">
                <td class="px-3 py-2 whitespace-nowrap">${fecha(x.fecha)}</td>
                <td class="px-3 py-2 font-semibold">${h(x.titulo)}${x.ubicacion ? `<span class="block text-xs text-slate-400 font-normal">${h(x.ubicacion)}</span>` : ''}</td>
                <td class="px-3 py-2 text-xs text-slate-500">${(x.items || []).length} trabajo(s) · ${fotos} foto(s)</td>
                <td class="px-3 py-2 text-xs text-slate-500">${h(nombrePerfil(x.registrado_por))}</td>
                <td class="px-3 py-2"><div class="flex flex-wrap gap-1 justify-end">${btn('Descargar PDF', `Proyectos.pdfInforme('${x.id}',this)`, 'bg-orange-600 hover:bg-orange-700 text-white')}${gestiona(pr) || x.registrado_por === miPerfil?.id ? btn('Editar', `Proyectos.editarInforme('${x.id}')`, 'border border-slate-300 text-slate-700 hover:bg-slate-50') + btn('Eliminar', `Proyectos.eliminarInforme('${x.id}')`, 'text-red-500 hover:bg-red-50') : ''}</div></td></tr>`;
        }).join('');
        return tarjeta('Informes de trabajo', `${filas ? `<div class="overflow-x-auto"><table class="w-full text-sm min-w-[700px]"><thead class="text-xs text-slate-500 uppercase bg-slate-50"><tr><th class="px-3 py-2 text-left">Fecha</th><th class="px-3 py-2 text-left">Informe</th><th class="px-3 py-2 text-left">Contenido</th><th class="px-3 py-2 text-left">Responsable</th><th class="px-3 py-2"></th></tr></thead><tbody>${filas}</tbody></table></div>`
            : '<p class="text-sm text-slate-400">Aún no hay informes.</p>'}
            <p class="text-xs text-slate-500 mt-3">Los informes con fotos del antes y del después se crean desde el celular en <a href="gastos.html" target="_blank" class="underline text-blue-700">la app de terreno (gastos.html)</a>.</p>`);
    }
    async function pdfInforme(id, boton) {
        const inf = informes.find(x => x.id === id), pr = inf && proyectos.find(p => p.id === inf.proyecto_id);
        if (!inf || typeof InformePDF === 'undefined') return;
        const texto = boton?.textContent, creadas = [];
        if (boton) { boton.disabled = true; boton.textContent = 'Generando…'; }
        try {
            const resultado = await InformePDF.generar({
                empresa: empresaActual, proyecto: pr, informe: inf, autor: nombrePerfil(inf.registrado_por),
                cargarFoto: async path => {
                    const { data, error } = await supa.storage.from('proyectos').download(path);
                    if (error) throw error;
                    const u = URL.createObjectURL(data); creadas.push(u); return u;
                },
            });
            InformePDF.descargar(resultado);
        } catch (error) {
            toast('No se pudo generar el PDF: ' + (error.message || error), 'error');
        } finally {
            creadas.forEach(u => URL.revokeObjectURL(u));
            if (boton && document.body.contains(boton)) { boton.disabled = false; boton.textContent = texto; }
        }
    }
    // El informe se edita en la app de terreno (fotos, bloques antes/después); al volver a esta pestaña se recargan.
    let esperandoInforme = false;
    function editarInforme(id) {
        window.open('gastos.html?informe=' + encodeURIComponent(id), '_blank');
        if (esperandoInforme) return;
        esperandoInforme = true;
        window.addEventListener('focus', async () => {
            esperandoInforme = false;
            const { data, error } = await supa.from('proyecto_informes').select('*').order('fecha', { ascending: false });
            if (error) return;
            informes = data || [];
            if (vista === 'informes') render();
        }, { once: true });
    }
    async function eliminarInforme(id) {
        const x = informes.find(g => g.id === id);
        if (!x || !confirm(`¿Eliminar el informe "${x.titulo}" y sus fotos?`)) return;
        const ok = await ejecutar(supa.from('proyecto_informes').delete().eq('id', id), 'Informe eliminado');
        if (!ok) return;
        const fotos = (x.items || []).flatMap(it => [...(it.antes || []), ...(it.despues || [])]);
        if (fotos.length) supa.storage.from('proyectos').remove(fotos);
        informes = informes.filter(g => g.id !== id);
        render();
    }
    function filtrarGastos(tipo, valor) { if (tipo === 'cat') filtroCat = valor; else filtroEstado = valor; render(); }
    function pedirRechazo(id) { rechazandoId = id; render(); setTimeout(() => $('pr-g-motivo')?.focus(), 20); }
    async function registrarGasto(ev) {
        ev.preventDefault();
        const pr = actual();
        if (!pr) return;
        const monto = Math.round(numero($('pr-g-monto').value));
        if (!(monto > 0)) return toast('Indica un monto mayor que cero', 'error');
        const archivos = [...$('pr-g-archivo').files];
        if (archivos.length > MAX_ADJUNTOS) return toast(`Máximo ${MAX_ADJUNTOS} respaldos por gasto`, 'error');
        if (ocupado) return;
        let paths;
        try { paths = await subirVarios(archivos, pr); }
        catch (error) { return toast(error.message, 'error'); }
        const base = {
            proyecto_id: pr.id, empresa_id: pr.empresa_id, fecha: $('pr-g-fecha').value, categoria: $('pr-g-cat').value,
            subcategoria: $('pr-g-sub').value.trim() || null, descripcion: $('pr-g-desc').value.trim(),
            proveedor: $('pr-g-prov').value.trim() || null, tipo_doc: $('pr-g-tipodoc').value,
            numero_doc: $('pr-g-numdoc').value.trim() || null, monto, adjunto_path: paths[0] || null,
            ...($('pr-g-origen') ? { origen_fondos: $('pr-g-origen').value } : {}),
        };
        const data = await escribirGasto(conAdj => supa.from('proyecto_gastos').insert(conAdj ? { ...base, adjuntos: paths } : base).select().single(),
            'Gasto registrado, pendiente de aprobación');
        if (!data) { if (paths.length) supa.storage.from('proyectos').remove(paths); return; }
        descartarSinColumna(paths, data);
        gastos.push(data);
        render();
    }
    // Agrega respaldos a un gasto ya registrado (por ejemplo, la segunda transferencia de un mismo pago).
    async function agregarRespaldos(id, input) {
        const x = gastos.find(g => g.id === id), pr = x && proyectos.find(p => p.id === x.proyecto_id);
        const archivos = [...(input?.files || [])];
        if (input) input.value = '';
        if (!x || !pr || !archivos.length || ocupado) return;
        const actuales = adjuntosDe(x);
        if (actuales.length + archivos.length > MAX_ADJUNTOS) return toast(`Máximo ${MAX_ADJUNTOS} respaldos por gasto`, 'error');
        if (!conAdjuntos && actuales.length) return toast(AVISO_MIGRACION, 'error');
        let paths;
        try { paths = await subirVarios(archivos, pr); }
        catch (error) { return toast(error.message, 'error'); }
        const nuevos = [...actuales, ...paths];
        const data = await escribirGasto(conAdj => supa.from('proyecto_gastos')
            .update(conAdj ? { adjuntos: nuevos, adjunto_path: nuevos[0] } : { adjunto_path: nuevos[0] }).eq('id', id).select().single(),
            paths.length > 1 ? `${paths.length} respaldos agregados` : 'Respaldo agregado');
        if (!data) { supa.storage.from('proyectos').remove(paths); return; }
        descartarSinColumna(paths, data);
        reemplazar(gastos, data);
        render();
    }
    async function quitarRespaldo(id, indice) {
        const x = gastos.find(g => g.id === id);
        const actuales = x ? adjuntosDe(x) : [];
        const path = actuales[indice];
        if (!path || ocupado || !confirm(`¿Quitar el respaldo${actuales.length > 1 ? ' ' + (indice + 1) : ''} del gasto "${x.descripcion}"?`)) return;
        const nuevos = actuales.filter((_, i) => i !== indice);
        if (!conAdjuntos && nuevos.length) return toast(AVISO_MIGRACION, 'error');
        const data = await escribirGasto(conAdj => supa.from('proyecto_gastos')
            .update(conAdj ? { adjuntos: nuevos, adjunto_path: nuevos[0] || null } : { adjunto_path: null }).eq('id', id).select().single(), 'Respaldo quitado');
        if (!data) return;
        supa.storage.from('proyectos').remove([path]);
        reemplazar(gastos, data);
        render();
    }
    // Inserta o actualiza un gasto. Si la columna "adjuntos" aún no existe (migración 202610190001 pendiente),
    // reintenta guardando solo adjunto_path, que es como funcionaba antes.
    async function escribirGasto(consulta, exito) {
        if (ocupado) return null;
        ocupado = true;
        try {
            let { data, error } = await consulta(conAdjuntos);
            if (error && conAdjuntos && faltaColumnaAdjuntos(error)) {
                conAdjuntos = false;
                ({ data, error } = await consulta(false));
            }
            if (error) throw error;
            if (exito) toast(exito, 'success');
            return data;
        } catch (error) {
            toast('No se pudo guardar: ' + (error.message || error), 'error');
            return null;
        } finally { ocupado = false; }
    }
    // Sin la columna solo queda guardado el primer respaldo: borra los demás archivos subidos y avisa.
    function descartarSinColumna(paths, fila) {
        if (conAdjuntos) return;
        const sobrantes = paths.filter(p => p !== fila.adjunto_path);
        if (!sobrantes.length) return;
        supa.storage.from('proyectos').remove(sobrantes);
        toast('Solo se guardó el primer respaldo. ' + AVISO_MIGRACION, 'error');
    }
    async function subirVarios(archivos, pr) {
        const paths = [];
        try {
            for (const archivo of archivos) paths.push(await subirArchivo(archivo, pr, 'gasto'));
        } catch (error) {
            if (paths.length) supa.storage.from('proyectos').remove(paths);
            throw error;
        }
        return paths;
    }
    async function revisarGasto(id, estado) {
        const cambios = { estado };
        if (estado === 'rechazado') {
            cambios.motivo_rechazo = $('pr-g-motivo')?.value.trim() || '';
            if (cambios.motivo_rechazo.length < 3) return toast('Indica el motivo del rechazo', 'error');
        }
        const data = await ejecutar(supa.from('proyecto_gastos').update(cambios).eq('id', id).select().single(),
            { aprobado: 'Gasto aprobado', rechazado: 'Gasto rechazado', pendiente: 'Gasto reabierto' }[estado]);
        if (!data) return;
        rechazandoId = null;
        reemplazar(gastos, data);
        render();
    }
    async function eliminarGasto(id) {
        const x = gastos.find(g => g.id === id);
        if (!x || !confirm(`¿Eliminar el gasto "${x.descripcion}" por ${fmtCLP(x.monto)}?`)) return;
        const ok = await ejecutar(supa.from('proyecto_gastos').delete().eq('id', id), 'Gasto eliminado');
        if (!ok) return;
        const archivos = adjuntosDe(x);
        if (archivos.length) supa.storage.from('proyectos').remove(archivos);
        gastos = gastos.filter(g => g.id !== id);
        render();
    }

    // ── Archivos (Supabase Storage) ───────────────────────
    async function comprimirImagen(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = url; });
            const k = Math.min(1, 1600 / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.75));
        } finally { URL.revokeObjectURL(url); }
    }
    async function subirArchivo(file, pr, tipo) {
        if (!file) return null;
        let blob = file, ext = 'pdf', type = 'application/pdf';
        if (file.type === 'application/pdf') {
            if (file.size > 5 * 1024 * 1024) throw new Error('El PDF supera 5 MB');
        } else if (file.type.startsWith('image/')) {
            blob = await comprimirImagen(file); ext = 'jpg'; type = 'image/jpeg';
        } else throw new Error('El respaldo debe ser una imagen o un PDF');
        const path = `${pr.empresa_id}/${pr.id}/${tipo}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supa.storage.from('proyectos').upload(path, blob, { contentType: type, upsert: false });
        if (error) throw new Error('No se pudo subir el archivo: ' + error.message);
        return path;
    }
    async function verArchivo(path) {
        const ventana = window.open('', '_blank');
        const { data, error } = await supa.storage.from('proyectos').createSignedUrl(path, 600);
        if (error) { ventana?.close(); return toast('No se pudo abrir el archivo: ' + error.message, 'error'); }
        if (ventana) ventana.location = data.signedUrl; else location.href = data.signedUrl;
    }

    // ── Configuración ─────────────────────────────────────
    function configHtml(pr, p) {
        const g = gestiona(pr), c = pr.config || {}, f = c.firmantes || {};
        const dis = g ? '' : 'disabled';
        const lista = edpsDe(pr.id), vacio = !lista.length && !gastosDe(pr.id).length && !ingresosDe(pr.id).length && !informesDe(pr.id).length
            && !(typeof Compras !== 'undefined' && Compras.deProyecto(pr.id).length);
        const solicitud = lista.find(e => e.tipo === 'anticipo');
        const disAnt = solicitud ? 'disabled' : dis; // lo define la solicitud de anticipo
        return tarjeta('Configuración del proyecto', `<form onsubmit="Proyectos.guardarConfig(event)" class="space-y-5">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                ${campo('Nombre / obra', `<input id="pr-c-nombre" required maxlength="160" class="campo-input mt-1" value="${h(pr.nombre)}" ${dis}>`)}
                ${campo('Código centro de costo', `<input id="pr-c-codigo" required maxlength="40" class="campo-input mt-1" value="${h(pr.codigo)}" ${dis}>`)}
                ${campo('Especialidad (para el EP)', `<input id="pr-c-especialidad" maxlength="120" class="campo-input mt-1" value="${h(c.especialidad || '')}" ${dis}>`)}
                ${campo('Administrador del proyecto', `<select id="pr-c-admin" class="campo-input mt-1" ${esAdminEmpresa() ? '' : 'disabled'}><option value="">— Sin designar —</option>${perfiles.map(x => `<option value="${x.id}" ${x.id === pr.administrador_id ? 'selected' : ''}>${h(x.nombre || '(sin nombre)')}${x.rol === 'admin' ? ' (admin)' : ''}</option>`).join('')}</select>`)}
                ${campo('N° OC del mandante', `<input id="pr-c-oc" maxlength="40" class="campo-input mt-1" value="${h(c.oc_numero || '')}" ${dis}>`)}
                ${campo('Estado del proyecto', `<select id="pr-c-estado" class="campo-input mt-1" ${dis}><option value="activo" ${pr.estado === 'activo' ? 'selected' : ''}>En ejecución</option><option value="cerrado" ${pr.estado === 'cerrado' ? 'selected' : ''}>Cerrado</option></select>`)}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                ${campo(`Anticipo neto (${p.moneda === 'UF' ? 'UF' : '$'})`, `<input id="pr-c-anticipo" inputmode="decimal" class="campo-input mt-1" value="${h(c.anticipo_monto || 0)}" ${disAnt}>`)}
                ${campo('Fecha del anticipo', `<input id="pr-c-anticipo-fecha" type="date" class="campo-input mt-1" value="${h(c.anticipo_fecha || '')}" ${disAnt}>`)}
                ${campo('Retención (%)', `<input id="pr-c-retencion" inputmode="decimal" class="campo-input mt-1" value="${h(c.retencion_pct ?? 5)}" ${dis}>`)}
                ${campo('Documento tributario', `<select id="pr-c-documento" onchange="document.getElementById('pr-c-tasa').value={factura:19,boleta_honorarios:15.25,exenta:0}[this.value]" class="campo-input mt-1" ${dis}>${Object.entries(DOCUMENTOS).map(([k, t]) => `<option value="${k}" ${k === (c.documento || 'factura') ? 'selected' : ''}>${h(t)}</option>`).join('')}</select>`)}
                ${campo('Tasa del documento (%)', `<input id="pr-c-tasa" inputmode="decimal" class="campo-input mt-1" value="${h(c.tasa ?? TASA_DEFECTO[c.documento || 'factura'])}" ${dis}>`)}
                ${p.moneda === 'UF' ? campo('Valor UF de referencia ($)', `<input id="pr-c-uf" inputmode="decimal" class="campo-input mt-1" value="${h(c.valor_uf_ref || '')}" ${dis}>`) : ''}
            </div>
            <p class="text-xs text-slate-500">El anticipo se descuenta en cada estado de pago en proporción al avance; el que completa el 100 % descuenta el saldo exacto. Los cambios se aplican a los estados de pago que aún no se presentan.${solicitud ? ` El monto lo define la solicitud de anticipo (EP N° ${String(solicitud.numero).padStart(2, '0')}, ${fmtPct(solicitud.totales?.anticipoPct)}).` : ''}</p>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                ${campo('VºBº Cliente (nombre)', `<input id="pr-c-f-cliente" maxlength="120" class="campo-input mt-1" value="${h(f.cliente || '')}" ${dis}>`)}
                <div>${campo('VºBº Gerencia de proyecto', `<input id="pr-c-f-gerencia" maxlength="120" class="campo-input mt-1" value="${h(f.gerencia_proyecto || '')}" ${dis}>`)}
                    <label class="flex items-center gap-2 mt-1.5 text-xs text-slate-600"><input id="pr-c-f-gerencia-ver" type="checkbox" ${f.mostrar_gerencia ? 'checked' : ''} ${dis}> Incluir esta firma en el estado de pago</label></div>
                ${campo('VºBº Gerente general', `<input id="pr-c-f-general" maxlength="120" class="campo-input mt-1" value="${h(f.gerente_general || '')}" ${dis}>`)}
            </div>
            ${conTerreno ? `<div><span class="campo-label">Personal asignado (app de terreno)</span>
                <div class="flex flex-wrap gap-x-5 gap-y-2 mt-1">${perfiles.map(x => `<label class="flex items-center gap-2 text-sm"><input type="checkbox" class="pr-c-asignado" value="${x.id}" ${(pr.asignados || []).includes(x.id) ? 'checked' : ''} ${dis}> ${h(x.nombre || '(sin nombre)')}</label>`).join('')}</div>
                <p class="text-xs text-slate-500 mt-1">Pueden registrar gastos, ingresos e informes de este proyecto desde el celular en <a href="gastos.html" target="_blank" class="underline text-blue-700">gastos.html</a>. El administrador de la empresa y el del proyecto siempre pueden.</p></div>` : ''}
            ${g ? `<div class="flex flex-wrap gap-2 justify-between">${esAdminEmpresa() && vacio ? btn('Eliminar proyecto', 'Proyectos.eliminarProyecto()', 'border border-red-300 text-red-600 hover:bg-red-50') : '<span></span>'}<button type="submit" class="text-sm px-4 py-2.5 rounded-lg font-bold bg-blue-700 hover:bg-blue-800 text-white">Guardar configuración</button></div>` : '<p class="text-xs text-slate-500">Solo el administrador del proyecto puede modificar la configuración.</p>'}
        </form>`);
    }
    async function guardarConfig(ev) {
        ev.preventDefault();
        const pr = actual();
        if (!pr) return;
        const retencion = numeroDecimal($('pr-c-retencion').value), tasa = numeroDecimal($('pr-c-tasa').value);
        if (retencion < 0 || retencion > 30) return toast('La retención debe estar entre 0 y 30 %', 'error');
        if (tasa < 0 || tasa > 40) return toast('Revisa la tasa del documento', 'error');
        const config = { ...pr.config,
            especialidad: $('pr-c-especialidad').value.trim(), oc_numero: $('pr-c-oc').value.trim(),
            ...(edpsDe(pr.id).some(e => e.tipo === 'anticipo') ? {} : {
                anticipo_monto: Math.max(0, numeroDecimal($('pr-c-anticipo').value)), anticipo_fecha: $('pr-c-anticipo-fecha').value || null }),
            retencion_pct: retencion, documento: $('pr-c-documento').value, tasa,
            firmantes: { cliente: $('pr-c-f-cliente').value.trim(), gerencia_proyecto: $('pr-c-f-gerencia').value.trim(), mostrar_gerencia: $('pr-c-f-gerencia-ver').checked, gerente_general: $('pr-c-f-general').value.trim() },
        };
        if ($('pr-c-uf')) config.valor_uf_ref = numeroDecimal($('pr-c-uf').value) || null;
        const data = await ejecutar(supa.from('proyectos').update({
            nombre: $('pr-c-nombre').value.trim(), codigo: $('pr-c-codigo').value.trim(), estado: $('pr-c-estado').value,
            administrador_id: $('pr-c-admin').value || null, config,
            ...(conTerreno ? { asignados: [...document.querySelectorAll('.pr-c-asignado:checked')].map(x => x.value) } : {}),
        }).eq('id', pr.id).select().single(), 'Configuración guardada');
        if (!data) return;
        reemplazar(proyectos, data);
        render();
    }
    async function eliminarProyecto() {
        const pr = actual();
        if (!pr || !confirm(`¿Eliminar el centro de costo ${pr.codigo}? El presupuesto no se modifica.`)) return;
        const ok = await ejecutar(supa.from('proyectos').delete().eq('id', pr.id), 'Proyecto eliminado');
        if (!ok) return;
        proyectos = proyectos.filter(x => x.id !== pr.id);
        volver();
    }

    // ── Exportación ───────────────────────────────────────
    let excelJsCarga = null;
    function cargarExcelJS() {
        if (window.ExcelJS) return Promise.resolve();
        return excelJsCarga ||= new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            const falla = () => { excelJsCarga = null; s.remove(); rej(new Error('No se pudo cargar el generador de Excel (revisa tu conexión)')); };
            s.onload = () => window.ExcelJS ? res() : falla();
            s.onerror = falla;
            document.head.appendChild(s);
        });
    }
    function datosExport(id) {
        const e = edps.find(x => x.id === id), pr = e && proyectos.find(x => x.id === e.proyecto_id), p = pr && presupuestoDe(pr);
        if (!p) return null;
        const calc = calculoVigente(pr, p, e);
        const historial = edpsDe(pr.id).filter(x => x.numero <= e.numero && (x.estado !== 'borrador' || x.id === e.id))
            .map(x => x.id === e.id ? { ...x, totales: calc.totales } : x);
        return { e, pr, p, items: calc.items, t: calc.totales, historial, emp: empresaActual || {} };
    }
    // Datos para transferencia de Mi Empresa (empresas.datos_bancarios), solo los que tienen valor.
    const datosTransferencia = emp => {
        const b = emp.datos_bancarios || {};
        return [['Titular', b.titular], ['RUT', b.rut], ['Banco', b.nombre], ['Tipo de cuenta', b.tipo], ['N° de cuenta', b.numero], ['Correo', b.email]].filter(([, v]) => v);
    };
    function nombreArchivo(d, ext) {
        const limpio = s => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
        return `EEPP N°${String(d.e.numero).padStart(2, '0')} ${limpio(d.pr.codigo)} ${limpio(d.pr.nombre)}`.slice(0, 120) + '.' + ext;
    }

    async function exportarExcel(id) {
        const d = datosExport(id);
        if (!d) return;
        try { await cargarExcelJS(); } catch (error) { return toast(error.message, 'error'); }
        toast('Generando Excel…', 'info');
        const { e, pr, p, items, t, historial, emp } = d;
        const dec = t.decimales ?? decimales(p);
        // Retención del historial: el avance retiene, la devolución la devuelve y el anticipo no retiene.
        const retencionHist = x => x.tipo === 'avance' ? (x.totales?.per?.retencion || 0) : x.tipo === 'devolucion_retencion' ? -(x.totales?.per?.neto || 0) : 0;
        const nf = dec > 0 ? `#,##0.${'0'.repeat(dec)}` : '#,##0';
        const wb = new ExcelJS.Workbook();
        wb.creator = emp.nombre_comercial || 'Presupuestos Pro';
        wb.calcProperties.fullCalcOnLoad = true;
        const ws = wb.addWorksheet(`EEPP N°${e.numero}`, { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }, views: [{ showGridLines: false }] });
        ws.columns = [7, 16, 14, 14, 7, 10, 13, 15, 10, 9, 15, 15, 15].map(w => ({ width: w }));
        const borde = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const gris = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        const oscuro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        const set = (ref, value, style = {}) => { const c = ws.getCell(ref); c.value = value; Object.assign(c, style); return c; };
        const dinero = (ref, value) => set(ref, value, { numFmt: nf, border: borde });
        const formula = (ref, f, result, fmt = nf) => set(ref, { formula: f, result }, { numFmt: fmt, border: borde });
        const aFecha = iso => { if (!iso) return null; const [y, m, dd] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };

        if (emp.logo_b64?.startsWith('data:image/')) {
            const ext = emp.logo_b64.includes('image/png') ? 'png' : 'jpeg';
            ws.addImage(wb.addImage({ base64: emp.logo_b64, extension: ext }), { tl: { col: 0, row: 0 }, ext: { width: 110, height: 110 } });
        }
        set('C2', emp.razon_social || emp.nombre_comercial || '', { font: { bold: true, size: 14 } });
        set('C3', [emp.rut ? `RUT ${emp.rut}` : '', 'Empresa Constructora'].filter(Boolean).join(' · '), { font: { size: 10 } });
        ws.mergeCells('K2:L2'); set('K2', t.devolucion ? 'DEVOLUCIÓN RETENCIONES · EP Nº' : t.solicitudAnticipo ? 'SOLICITUD DE ANTICIPO · EP Nº' : 'ESTADO DE PAGO Nº',{ font: { bold: true, size: 12 }, alignment: { horizontal: 'right' } });
        set('M2', String(e.numero).padStart(2, '0'), { font: { bold: true, size: 14 }, alignment: { horizontal: 'center' }, border: borde });
        if (e.estado === 'borrador') set('M3', 'BORRADOR', { font: { bold: true, color: { argb: 'FFDC2626' } }, alignment: { horizontal: 'center' } });
        const cab = [['K4', 'Obra :', pr.nombre], ['K5', 'Ubicación :', [p.cliente.direccion, p.cliente.comuna, p.cliente.region].filter(Boolean).join(', ')], ['K6', 'Mandante :', p.cliente.nombre], ['K7', 'OC :', e.oc_numero || pr.config?.oc_numero || 'pendiente']];
        cab.forEach(([ref, label, valor]) => { const row = ref.slice(1); set(ref, label, { font: { bold: true }, alignment: { horizontal: 'right' } }); ws.mergeCells(`L${row}:M${row}`); set(`L${row}`, valor || '', { alignment: { wrapText: true } }); });
        set('A8', 'Contratista :', { font: { bold: true } }); set('C8', emp.nombre_comercial || '');
        set('A9', 'Especialidad :', { font: { bold: true } }); set('C9', pr.config?.especialidad || pr.nombre);
        set('A10', 'Presupuesto :', { font: { bold: true } }); set('C10', `${p.numero} · Centro de costo ${pr.codigo}`);
        set('K8', 'Fecha Presentación :', { font: { bold: true }, alignment: { horizontal: 'right' } }); ws.mergeCells('L8:M8'); set('L8', aFecha(e.fecha_presentacion || hoyChile()), { numFmt: 'dd-mm-yyyy', alignment: { horizontal: 'center' } });
        set('K9', 'Fecha de Pago :', { font: { bold: true }, alignment: { horizontal: 'right' } }); ws.mergeCells('L9:M9'); set('L9', aFecha(e.fecha_pago_real || e.fecha_pago_estimada), { numFmt: 'dd-mm-yyyy', alignment: { horizontal: 'center' } });

        let fila = 12;
        const encabezados = [['A', 'Ítem'], ['B', 'Detalle'], ['E', 'Un'], ['F', 'Cant. inicial'], ['G', 'Precio Unitario'], ['H', 'Precio Total'], ['I', 'Avance Un'], ['J', 'Avance %'], ['K', 'Estado de Pago Actual'], ['L', 'Estado de Pago Anterior'], ['M', 'Total a Pago']];
        ws.mergeCells(`B${fila}:D${fila}`);
        encabezados.forEach(([col, texto]) => set(`${col}${fila}`, texto, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: oscuro, border: borde, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } }));
        ws.getRow(fila).height = 30;
        fila += 1;
        set(`A${fila}`, t.devolucion ? 'DEVOLUCIÓN' : t.solicitudAnticipo ? 'ANTICIPO' : 'CONTRATO', { font: { bold: true } });
        fila += 1;
        const primera = fila;
        let capActual = null;
        items.forEach(i => {
            if (i.capId !== capActual) {
                capActual = i.capId;
                ws.mergeCells(`A${fila}:M${fila}`);
                set(`A${fila}`, `${i.capNumero} ${i.capNombre}`.trim(), { font: { bold: true }, fill: gris });
                fila += 1;
            }
            set(`A${fila}`, i.numero, { border: borde, alignment: { horizontal: 'center' } });
            ws.mergeCells(`B${fila}:D${fila}`);
            set(`B${fila}`, i.detalle, { border: borde, alignment: { wrapText: true, vertical: 'middle' } });
            set(`E${fila}`, i.unidad, { border: borde, alignment: { horizontal: 'center' } });
            set(`F${fila}`, i.cant, { border: borde, numFmt: '#,##0.####' });
            dinero(`G${fila}`, i.pu);
            formula(`H${fila}`, `ROUND(F${fila}*G${fila},${dec})`, i.total);
            set(`I${fila}`, i.cantAcum, { border: borde, numFmt: '#,##0.####', font: { bold: true } });
            formula(`J${fila}`, `IF(F${fila}=0,0,I${fila}/F${fila})`, i.cant > 0 ? i.cantAcum / i.cant : 0, '0.0%');
            formula(`K${fila}`, `IF(AND(F${fila}>0,I${fila}>=F${fila}),H${fila},ROUND(I${fila}*G${fila},${dec}))`, i.montoAcum);
            dinero(`L${fila}`, i.montoAnt);
            formula(`M${fila}`, `K${fila}-L${fila}`, i.montoPeriodo);
            fila += 1;
        });
        const ultima = fila - 1;
        fila += 1;
        const columnas = ['H', 'K', 'L', 'M'], claves = ['contrato', 'acum', 'ant', 'per'];
        const filaResumen = (label, k, fn, extra) => {
            ws.mergeCells(`E${fila}:G${fila}`);
            set(`E${fila}`, label, { font: { bold: !!extra?.bold }, alignment: { horizontal: 'right' }, border: borde });
            columnas.forEach((col, ci) => {
                const valor = t[claves[ci]]?.[k] || 0;
                if (col === 'L') dinero(`L${fila}`, valor);
                else if (col === 'M') formula(`M${fila}`, `K${fila}-L${fila}`, t.per?.[k] || 0);
                else fn ? formula(`${col}${fila}`, fn(col), valor) : dinero(`${col}${fila}`, valor);
                if (extra?.bold) ws.getCell(`${col}${fila}`).font = { bold: true };
            });
            return fila++;
        };
        let rNeto;
        if (t.devolucion) {
            ws.mergeCells(`E${fila}:L${fila}`);
            set(`E${fila}`, 'Devolución de retenciones acumuladas', { font: { bold: true }, alignment: { horizontal: 'right' }, border: borde });
            dinero(`M${fila}`, t.per.neto).font = { bold: true };
            rNeto = fila++;
        } else if (t.solicitudAnticipo) {
            ws.mergeCells(`E${fila}:L${fila}`);
            set(`E${fila}`, 'Subtotal neto del contrato', { alignment: { horizontal: 'right' }, border: borde });
            dinero(`M${fila}`, t.baseAnticipo || 0); const rBase = fila++;
            ws.mergeCells(`E${fila}:K${fila}`);
            set(`E${fila}`, 'Porcentaje de anticipo', { alignment: { horizontal: 'right' }, border: borde });
            set(`L${fila}`, (t.anticipoPct || 0) / 100, { numFmt: '0.00%', border: borde, alignment: { horizontal: 'center' } }); const rPct = fila;
            formula(`M${fila}`, `ROUND(M${rBase}*L${rPct},${dec})`, t.per.neto).font = { bold: true };
            rNeto = fila++;
        } else {
            const rCD = filaResumen('Costo directo', 'cd', col => `SUM(${col}${primera}:${col}${ultima})`);
            let rSub = rCD;
            if ((t.ggPct || 0) + (t.utilPct || 0) > 0) {
                const rGG = filaResumen(`Gastos generales ${t.ggPct}%`, 'gg', col => `ROUND(${col}${rCD}*${t.ggPct / 100},${dec})`);
                const rUt = filaResumen(`Utilidad ${t.utilPct}%`, 'util', col => `ROUND(${col}${rCD}*${t.utilPct / 100},${dec})`);
                rSub = filaResumen('Sub Total Neto $', 'sub', col => `${col}${rCD}+${col}${rGG}+${col}${rUt}`, { bold: true });
            } else {
                ws.getCell(`E${rCD}`).value = 'Sub Total Neto $';
                ws.getCell(`E${rCD}`).font = { bold: true };
            }
            set(`A${rSub}`, '% Avance', { font: { bold: true } });
            formula(`B${rSub}`, `IF(H${rSub}=0,0,K${rSub}/H${rSub})`, (t.pctAvance || 0) / 100, '0.0%');
            const ant = t.anticipoMonto || 0;
            const rAnt = filaResumen('Anticipo', 'anticipo', col => col === 'H' ? `${ant}` : `IF(H${rSub}=0,0,IF(K${rSub}>=H${rSub},${ant},ROUND(${ant}*K${rSub}/H${rSub},${dec})))`);
            const rRet = filaResumen(`Retención ${t.retPct}%`, 'retencion', col => `ROUND(${col}${rSub}*${(t.retPct || 0) / 100},${dec})`);
            const rDesc = t.acum?.descuento ? filaResumen(`Descuento mandante${t.descuentoMotivo ? ` (${t.descuentoMotivo})` : ''}`, 'descuento') : null;
            rNeto = filaResumen('Total Neto $', 'neto', col => `${col}${rSub}-${col}${rAnt}-${col}${rRet}${rDesc ? `-${col}${rDesc}` : ''}`, { bold: true });
            set(`A${rNeto}`, 'x Pagar Neto', { font: { bold: true } });
            formula(`B${rNeto}`, `H${rNeto}-K${rNeto}`, (t.contrato?.neto || 0) - (t.acum?.neto || 0));
        }
        fila += 1;
        const docTexto = { factura: 'Factura', boleta_honorarios: 'Boleta', exenta: 'Exenta' }[t.documento] || 'Factura';
        ws.mergeCells(`I${fila}:L${fila}`); set(`I${fila}`, `Neto a facturar (${docTexto})`, { font: { bold: true }, alignment: { horizontal: 'right' } });
        formula(`M${fila}`, `M${rNeto}`, t.per.neto); const rFac = fila++;
        if (t.documento !== 'exenta') {
            ws.mergeCells(`I${fila}:K${fila}`); set(`I${fila}`, t.documento === 'boleta_honorarios' ? 'Retención boleta' : 'Impuesto IVA', { alignment: { horizontal: 'right' } });
            set(`L${fila}`, (t.tasa || 0) / 100, { numFmt: '0.00%', alignment: { horizontal: 'center' } });
            formula(`M${fila}`, `ROUND(M${rFac}*L${fila},${dec})`, t.impuesto); fila++;
        }
        ws.mergeCells(`I${fila}:L${fila}`); set(`I${fila}`, 'A Pagar $', { font: { bold: true, size: 12 }, alignment: { horizontal: 'right' } });
        formula(`M${fila}`, t.documento === 'exenta' ? `M${rFac}` : `M${rFac}${t.documento === 'boleta_honorarios' ? '-' : '+'}M${fila - 1}`, t.aPagar).font = { bold: true, size: 12 };
        // Datos para transferencia a la izquierda de los totales.
        const banco = datosTransferencia(emp);
        if (banco.length) {
            ws.mergeCells(`A${rFac}:F${rFac}`); set(`A${rFac}`, 'DATOS PARA TRANSFERENCIA', { font: { bold: true }, fill: gris });
            banco.forEach(([k, v], n) => {
                const r = rFac + 1 + n;
                set(`A${r}`, k + ' :', { font: { bold: true } }); ws.mergeCells(`B${r}:F${r}`); set(`B${r}`, v);
            });
            fila = Math.max(fila, rFac + banco.length);
        }
        fila += 4;

        const f = pr.config?.firmantes || {};
        // La firma de gerencia de proyecto es opcional (Configuración del proyecto).
        [['B', 'D', 'VºBº Cliente', f.cliente, false], f.mostrar_gerencia ? ['F', 'I', 'VºBº Gerencia de proyecto', f.gerencia_proyecto, true] : null, ['K', 'M', 'VºBº Gerente General', f.gerente_general, true]].filter(Boolean).forEach(([a, b, titulo, nombre, propia]) => {
            // Firma registrada sobre la línea (no en borrador ni la del cliente)
            const img = propia && e.estado !== 'borrador' && typeof firmaRegistrada === 'function' ? firmaRegistrada(nombre) : null;
            if (img) ws.addImage(wb.addImage({ base64: img, extension: 'png' }), { tl: { col: a.charCodeAt(0) - 65 + 0.4, row: fila - 4 }, ext: { width: 150, height: 58 } });
            ws.mergeCells(`${a}${fila}:${b}${fila}`); set(`${a}${fila}`, titulo, { font: { bold: true }, alignment: { horizontal: 'center' }, border: { top: { style: 'thin' } } });
            ws.mergeCells(`${a}${fila + 1}:${b}${fila + 1}`); set(`${a}${fila + 1}`, nombre || '', { alignment: { horizontal: 'center' } });
        });
        fila += 4;

        set(`A${fila}`, 'DATOS CONTRATISTA', { font: { bold: true }, fill: gris });
        ws.mergeCells(`A${fila}:E${fila}`);
        [['F', 'EP Nº'], ['G', 'Fecha Presentación'], ['H', 'Monto Neto EP'], ['I', 'HES'], ['J', 'Retención'], ['K', 'Factura N°'], ['L', 'OC N°'], ['M', 'Estado']].forEach(([col, texto]) =>
            set(`${col}${fila}`, texto, { font: { bold: true }, fill: gris, border: borde, alignment: { horizontal: 'center', wrapText: true } }));
        ws.getRow(fila).height = 28;
        const contratista = [['Nombre', emp.razon_social || emp.nombre_comercial], ['Rut', emp.rut], ['Dirección', emp.direccion], ['Teléfono', emp.telefono], ['Correo', emp.email_contacto], ['Contacto', emp.responsable_nombre]];
        const inicioHist = fila + 1;
        const filasHist = Math.max(historial.length, contratista.length);
        for (let k = 0; k < filasHist; k++) {
            const r = inicioHist + k, x = historial[k], dato = contratista[k];
            if (dato) { set(`A${r}`, dato[0] + ' :', { font: { bold: true } }); ws.mergeCells(`B${r}:E${r}`); set(`B${r}`, dato[1] || ''); }
            if (x) {
                set(`F${r}`, x.numero, { border: borde, alignment: { horizontal: 'center' } });
                set(`G${r}`, aFecha(x.fecha_presentacion), { border: borde, numFmt: 'dd-mm-yyyy', alignment: { horizontal: 'center' } });
                dinero(`H${r}`, x.totales?.per?.neto || 0);
                set(`I${r}`, x.hes_numero || '', { border: borde });
                dinero(`J${r}`, retencionHist(x));
                set(`K${r}`, x.factura_numero || '', { border: borde });
                set(`L${r}`, x.oc_numero || '', { border: borde });
                set(`M${r}`, ESTADOS_EDP[x.estado], { border: borde });
            }
        }
        const finHist = inicioHist + filasHist - 1;
        const rTot = finHist + 1;
        set(`G${rTot}`, 'Totales', { font: { bold: true }, alignment: { horizontal: 'right' } });
        const sumaNeto = historial.reduce((s, x) => s + (x.totales?.per?.neto || 0), 0);
        const sumaRet = historial.reduce((s, x) => s + retencionHist(x), 0);
        formula(`H${rTot}`, `SUM(H${inicioHist}:H${finHist})`, sumaNeto).font = { bold: true };
        formula(`J${rTot}`, `SUM(J${inicioHist}:J${finHist})`, sumaRet).font = { bold: true };
        ws.mergeCells(`F${rTot + 2}:K${rTot + 2}`); set(`F${rTot + 2}`, 'Total contrato neto menos estados de pago (por pagar)', { alignment: { horizontal: 'right' }, font: { bold: true } });
        ws.mergeCells(`L${rTot + 2}:M${rTot + 2}`);
        const contratoNeto = t.solicitudAnticipo ? calcularEDP(p, pr.config, null, null).totales.contrato.neto : (t.contrato?.neto || 0);
        dinero(`L${rTot + 2}`, t.devolucion ? 0 : Math.max(0, contratoNeto - historial.filter(x => x.tipo === 'avance').reduce((s, x) => s + (x.totales?.per?.neto || 0), 0))).font = { bold: true };
        ws.pageSetup.printArea = `A1:M${rTot + 2}`;

        const buffer = await wb.xlsx.writeBuffer();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        a.download = nombreArchivo(d, 'xlsx');
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Excel descargado', 'success');
    }

    function exportarPDF(id) {
        const d = datosExport(id);
        if (!d) return;
        const { e, pr, p, items, t, emp } = d;
        const M = n => fmtM(n, p);
        let capActual = null;
        const filas = items.map(i => {
            const cab = i.capId !== capActual ? `<tr class="cap"><td colspan="9">${h(i.capNumero)} ${h(i.capNombre)}</td></tr>` : '';
            capActual = i.capId;
            return `${cab}<tr><td><div style="max-width:340px">${h(i.numero)} ${h(i.detalle)}</div></td><td class="c">${h(i.unidad)}</td><td class="r">${fmtNum(i.cant)}</td><td class="r">${M(i.pu)}</td><td class="r">${M(i.total)}</td><td class="r">${fmtNum(i.cantAcum)}</td><td class="r">${fmtPct(i.cant > 0 ? i.cantAcum / i.cant * 100 : 0)}</td><td class="r">${M(i.montoAcum)}</td><td class="r b">${M(i.montoPeriodo)}</td></tr>`;
        }).join('');
        const lin = (label, k, b = '') => `<tr class="${b}"><td>${label}</td>${['contrato', 'acum', 'ant', 'per'].map(c => `<td class="r">${M(t[c]?.[k])}</td>`).join('')}</tr>`;
        const conGG = (t.ggPct || 0) + (t.utilPct || 0) > 0;
        const resumenFilas = t.devolucion ? lin('Devolución de retenciones', 'neto', 'b')
            : t.solicitudAnticipo ? `<tr><td>Subtotal neto del contrato</td><td class="r" colspan="4">${M(t.baseAnticipo)}</td></tr><tr><td>Porcentaje de anticipo</td><td class="r" colspan="4">${fmtPct(t.anticipoPct)}</td></tr><tr class="b"><td>Anticipo neto</td><td class="r" colspan="4">${M(t.per.neto)}</td></tr>` :
            lin('Costo directo', 'cd') + (conGG ? lin(`Gastos generales ${t.ggPct}%`, 'gg') + lin(`Utilidad ${t.utilPct}%`, 'util') : '') + lin('Subtotal neto', 'sub', 'b') + lin('Descuento anticipo', 'anticipo') + lin(`Retención ${t.retPct}%`, 'retencion')
            + (t.acum?.descuento ? lin(`Descuento mandante${t.descuentoMotivo ? ` (${h(t.descuentoMotivo)})` : ''}`, 'descuento') : '') + lin('Total neto', 'neto', 'b');
        const f = pr.config?.firmantes || {};
        const css = `.edp{font-family:Arial,sans-serif;color:#0f172a;padding:28px;font-size:10px;box-sizing:border-box;width:max-content;min-width:100%}.edp *{box-sizing:border-box}.edp td.r,.edp th{white-space:nowrap}.edp h1{font-size:16px;margin:0}.edp .titulo{background:#1e293b;color:#fff;border-radius:6px;padding:10px 14px;margin:0 0 14px;display:flex;justify-content:space-between;align-items:center;gap:16px}.edp .titulo h1{font-size:18px;letter-spacing:.5px}.edp .titulo span{font-size:11px;color:#cbd5e1}.edp table{width:100%;border-collapse:collapse;margin-top:10px}.edp td,.edp th{border:1px solid #cbd5e1;padding:3px 5px}.edp th{background:#1e293b;color:#fff;font-size:9px}.edp .r{text-align:right}.edp .c{text-align:center}.edp .b{font-weight:bold}.edp .cap td{background:#e2e8f0;font-weight:bold}.edp .top{display:flex;justify-content:space-between;gap:16px}.edp .firmas{display:flex;justify-content:space-between;margin-top:24px;text-align:center}.edp .firmas .caja{width:30%}.edp .firmas .linea{border-top:1px solid #0f172a;padding-top:4px}.edp .firmas .firma-img{display:block;height:60px;max-width:100%;margin:0 auto 2px;object-fit:contain}.edp .firmas.dos{justify-content:space-around}.edp .firmas.dos .caja{width:34%}.edp .pagar{background:#0f172a;color:#fff;font-size:13px}.edp .pie{display:flex;gap:16px;align-items:flex-start;margin-top:10px}.edp .pie .totales{width:45%;margin:0 0 0 auto}.edp .banco{flex:1;max-width:50%;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;line-height:1.5}.edp .banco p{margin:0 0 4px;font-weight:bold;font-size:10px;letter-spacing:.5px;color:#1e293b}.edp .banco span{display:inline-block;min-width:88px;color:#475569}`;
        const banco = datosTransferencia(emp);
        const totalEdps = edpsDe(pr.id).length;
        // Firma registrada sobre la línea; nunca en borrador ni la del cliente (la pone el mandante).
        const caja = (titulo, nombre, propia = true) => {
            const img = propia && e.estado !== 'borrador' && typeof firmaRegistrada === 'function' ? firmaRegistrada(nombre) : null;
            return `<div class="caja">${img ? `<img src="${img}" alt="Firma" class="firma-img">` : '<div class="firma-img"></div>'}<div class="linea">${titulo}<br>${h(nombre || '')}</div></div>`;
        };
        const html = `<div class="edp">
            <div class="titulo"><h1>${t.devolucion ? 'DEVOLUCIÓN DE RETENCIONES' : t.solicitudAnticipo ? 'SOLICITUD DE ANTICIPO · ESTADO DE PAGO' : 'ESTADO DE PAGO'} Nº ${String(e.numero).padStart(2, '0')}${e.estado === 'borrador' ? ' (BORRADOR)' : ''}</h1>
                <span>Proyecto ${h(pr.codigo)} · ${h(pr.nombre)} · Correlativo Nº ${e.numero} de ${totalEdps} del proyecto · ${h(ESTADOS_EDP[e.estado] || e.estado)}</span></div>
            <div class="top"><div>${emp.logo_b64 ? `<img src="${emp.logo_b64}" style="height:56px">` : ''}<h1>${h(emp.razon_social || emp.nombre_comercial)}</h1><div>${h(emp.rut ? 'RUT ' + emp.rut : '')}</div><div><b>Especialidad:</b> ${h(pr.config?.especialidad || pr.nombre)}</div></div>
            <div style="text-align:right"><div><b>Centro de costo:</b> ${h(pr.codigo)}</div><div><b>Obra:</b> ${h(pr.nombre)}</div><div><b>Mandante:</b> ${h(p.cliente.nombre)}</div><div><b>OC:</b> ${h(e.oc_numero || pr.config?.oc_numero || 'pendiente')} · <b>HES:</b> ${h(e.hes_numero || '—')}</div><div><b>Fecha presentación:</b> ${fecha(e.fecha_presentacion || hoyChile())}</div></div></div>
            ${items.length ? `<table><thead><tr><th>Detalle</th><th>Un</th><th>Cant.</th><th>P. unitario</th><th>Precio total</th><th>Avance un</th><th>Avance %</th><th>EP actual</th><th>Total a pago</th></tr></thead><tbody>${filas}</tbody></table>` : ''}
            <table><thead><tr><th></th><th>Contrato</th><th>Acumulado</th><th>Anterior</th><th>Este EP</th></tr></thead><tbody>${resumenFilas}</tbody></table>
            <div class="pie">${banco.length ? `<div class="banco"><p>DATOS PARA TRANSFERENCIA</p>${banco.map(([k, v]) => `<div><span>${k}:</span> <b>${h(v)}</b></div>`).join('')}</div>` : ''}
            <table class="totales"><tbody><tr><td>Neto este EP</td><td class="r">${M(t.per.neto)}</td></tr>${t.documento === 'exenta' ? '' : `<tr><td>${t.documento === 'boleta_honorarios' ? 'Retención boleta' : 'IVA'} ${t.tasa}%</td><td class="r">${M(t.impuesto)}</td></tr>`}<tr class="pagar b"><td>A PAGAR</td><td class="r">${M(t.aPagar)}</td></tr></tbody></table></div>
            <div class="firmas${f.mostrar_gerencia ? '' : ' dos'}">${caja('VºBº Cliente', f.cliente, false)}${f.mostrar_gerencia ? caja('VºBº Gerencia de proyecto', f.gerencia_proyecto) : ''}${caja('VºBº Gerente General', f.gerente_general)}</div></div>`;
        generarPDF(css, html, nombreArchivo(d, 'pdf'));
    }

    // ── Navegación ────────────────────────────────────────
    function abrir(id, nuevaVista = 'resumen', edpId = null) {
        actualId = id; vista = nuevaVista; edpSelId = null; cantidades = null; rechazandoId = null;
        if (nuevaVista === 'compras') Compras.reiniciar();
        if (edpId) return seleccionarEdp(edpId);
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function cambiarVista(v) {
        vista = v; rechazandoId = null;
        if (v === 'compras') Compras.reiniciar();
        render();
    }
    function volver() { actualId = null; edpSelId = null; cantidades = null; render(); }

    return {
        cargar, render, abrir, volver, vista: cambiarVista, abrirDesdePresupuesto, existePara, resumenPresupuesto,
        seleccionarEdp, editarAvance, editarDescuento, editarAnticipo, refrescarEdp, nuevoEdp, guardarEdp, cambiarEstado, aprobarEdp, eliminarEdp,
        guardarFacturacion, registrarPago, registrarGasto, cambiarCategoriaGasto, agregarRespaldos, quitarRespaldo, revisarGasto, pedirRechazo, eliminarGasto, filtrarGastos,
        guardarConfig, eliminarProyecto, verArchivo, exportarExcel, exportarPDF,
        reembolsarGasto, cambiarOrigen, revisarIngreso, eliminarIngreso, pdfInforme, editarInforme, eliminarInforme,
        // Para el módulo de órdenes de compra (compras.js)
        gestiona, nombrePerfil, presupuestoDe, subirArchivo, CATEGORIAS,
        agregarGasto: fila => reemplazar(gastos, fila),
        get lista() { return proyectos; },
        get perfiles() { return perfiles; },
        get disponible() { return disponible; },
        test: { calcularEDP, calcularDevolucion, calcularSolicitudAnticipo, diasEntre, redondear },
    };
})();
