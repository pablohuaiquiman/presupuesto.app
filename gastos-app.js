/* Gastos Presupuestos Pro: app de terreno para el celular.
   Gastos (caja chica o dinero propio), ingresos recibidos en obra e informes de trabajo con fotos antes/después.
   Usa las mismas tablas que Presupuestos Pro; los permisos reales están en Supabase (202610240001_app_terreno.sql). */
const G = (() => {
    const SUPABASE_URL = 'https://oeqjqfjdswwyyjbgdaxk.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lcWpxZmpkc3d3eXlqYmdkYXhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNTE5ODYsImV4cCI6MjA5OTYyNzk4Nn0.lgD8nfhPSmgNGPwio_fJZhlcnLTOxBemTjx_LKLST7g';
    const supa = typeof supabase !== 'undefined' ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    // Mismas listas que proyectos.js (el concepto admite cualquier texto).
    const CATEGORIAS = { materiales: 'Materiales', mano_obra: 'Mano de obra', generales: 'Gastos generales' };
    const SUBCATEGORIAS = {
        materiales: ['Yeso / volcanita', 'Perfiles metálicos', 'Cemento / hormigón', 'Áridos', 'Fierro', 'Madera', 'Pintura', 'Cerámica / porcelanato', 'Material eléctrico', 'Material sanitario', 'Ferretería y fijaciones', 'Adhesivos y selladores', 'Aislación'],
        mano_obra: ['Maestro', 'Ayudante', 'Jornal', 'Trato / a destajo', 'Subcontrato', 'Horas extra', 'Leyes sociales', 'Bono de producción', 'Finiquito'],
        generales: ['Petróleo', 'Colaciones', 'Peajes', 'Estacionamiento', 'Fletes', 'Movilización', 'Hospedaje', 'Herramientas', 'Arriendo de equipos', 'EPP', 'Retiro de escombros', 'Aseo de obra'],
    };
    const TIPOS_DOC = { boleta: 'Boleta', factura: 'Factura', guia: 'Guía de despacho', sin_documento: 'Sin documento' };
    const ORIGENES = { empresa: 'Caja chica', propio: 'Dinero propio' };
    const MEDIOS = { transferencia_empresa: 'Transferencia a la empresa', transferencia_personal: 'Transferencia a mí', efectivo: 'Efectivo' };
    const ESTADOS = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };
    const COLOR_ESTADO = { pendiente: 'bg-amber-100 text-amber-800', aprobado: 'bg-emerald-100 text-emerald-800', rechazado: 'bg-red-100 text-red-700' };
    const MAX_ADJUNTOS = 10, MAX_FOTOS_LADO = 4;

    let usuario = null, perfil = null, empresa = null, proyectos = [], perfiles = [];
    let gastos = [], ingresos = [], informes = [];
    let pantalla = 'inicio', ocupado = false;
    const pendientes = { gasto: [], ingreso: [] };   // archivos elegidos antes de registrar
    let borrador = null;                              // informe en edición
    let subidosSinGuardar = new Set(), porBorrar = new Set();
    const urls = new Map();                           // path de Storage → URL para mostrar

    const $ = id => document.getElementById(id);
    const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function hoyChile() {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const part = t => parts.find(p => p.type === t).value;
        return `${part('year')}-${part('month')}-${part('day')}`;
    }
    const fecha = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
    const fmtCLP = n => '$ ' + Math.round(n || 0).toLocaleString('es-CL');
    const soloDigitos = v => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0;
    const chip = (texto, color) => `<span class="chip ${color}">${h(texto)}</span>`;
    const nombrePerfil = id => perfiles.find(p => p.id === id)?.nombre || '—';
    const proyectoDe = id => proyectos.find(p => p.id === id) || null;
    const esAdmin = () => perfil?.rol === 'admin';
    const gestiona = pr => !!pr && (esAdmin() || pr.administrador_id === usuario?.id);
    const adjuntosDe = x => x.adjuntos?.length ? x.adjuntos : (x.adjunto_path ? [x.adjunto_path] : []);
    const recordar = (k, v) => { try { localStorage.setItem('gastos-pro:' + k, v); } catch { /* sin almacenamiento */ } };
    const recordado = k => { try { return localStorage.getItem('gastos-pro:' + k); } catch { return null; } };

    let toastTimer = null;
    function toast(msg, tipo = 'info') {
        const el = $('toast');
        el.textContent = msg;
        el.className = `fixed left-1/2 -translate-x-1/2 bottom-6 z-50 max-w-[92vw] px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white ${tipo === 'error' ? 'bg-red-600' : tipo === 'success' ? 'bg-emerald-600' : 'bg-slate-800'}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.add('hidden'), tipo === 'error' ? 6000 : 3000);
    }
    const render = html => { $('app').innerHTML = html; };

    // ── Sesión ────────────────────────────────────────────
    async function iniciar() {
        if (!supa) return render('<p class="p-6 text-center text-red-600">No se pudo conectar. Revisa tu conexión a internet y recarga.</p>');
        supa.auth.onAuthStateChange(evento => { if (evento === 'SIGNED_OUT') { usuario = null; pantallaLogin(); } });
        const { data: { session } } = await supa.auth.getSession();
        if (!session) return pantallaLogin();
        usuario = session.user;
        await cargarTodo();
    }
    function pantallaLogin(error = '') {
        render(`<div class="min-h-screen flex flex-col justify-center px-6 py-10">
            <div class="text-center mb-8">
                <img src="assets/presupuestos-pro-192.png" alt="" class="w-20 h-20 mx-auto rounded-2xl shadow-md">
                <h1 class="text-2xl font-black mt-4">Gastos Presupuestos Pro</h1>
                <p class="text-sm text-slate-500 mt-1">Gastos, ingresos e informes de obra</p>
            </div>
            <form id="form-login" class="bg-white rounded-2xl shadow-sm p-5 space-y-4">
                <div><label class="campo-label" for="login-email">Usuario (correo)</label>
                    <input id="login-email" type="email" autocomplete="username" required class="campo-input" placeholder="nombre@correo.com" value="${h(recordado('email') || '')}"></div>
                <div><label class="campo-label" for="login-pass">Contraseña</label>
                    <div class="relative"><input id="login-pass" type="password" autocomplete="current-password" required class="campo-input pr-14">
                    <button type="button" onclick="G.verClave()" class="absolute inset-y-0 right-0 px-4 text-sm font-bold text-slate-500" id="btn-ver-clave">Ver</button></div></div>
                ${error ? `<p class="text-sm text-red-600 font-semibold">${h(error)}</p>` : ''}
                <button type="submit" id="btn-entrar" class="btn-accion bg-slate-900 text-white">Entrar</button>
                <a href="index.html" class="block text-center text-xs text-slate-500 underline">¿Olvidaste tu contraseña? Recupérala en Presupuestos Pro</a>
            </form></div>`);
        $('form-login').addEventListener('submit', entrar);
    }
    function verClave() {
        const i = $('login-pass'), ver = i.type === 'password';
        i.type = ver ? 'text' : 'password';
        $('btn-ver-clave').textContent = ver ? 'Ocultar' : 'Ver';
    }
    async function entrar(ev) {
        ev.preventDefault();
        const email = $('login-email').value.trim(), password = $('login-pass').value;
        $('btn-entrar').disabled = true; $('btn-entrar').textContent = 'Entrando…';
        const { data, error } = await supa.auth.signInWithPassword({ email, password });
        if (error) return pantallaLogin('Correo o contraseña incorrectos.');
        recordar('email', email);
        usuario = data.user;
        await cargarTodo();
    }
    async function salir() {
        if (!confirm('¿Cerrar sesión?')) return;
        await supa.auth.signOut();
    }

    // ── Datos ─────────────────────────────────────────────
    async function cargarTodo() {
        render('<div class="min-h-screen flex items-center justify-center text-slate-500">Cargando…</div>');
        const { data: p, error } = await supa.from('perfiles').select('*').eq('id', usuario.id).maybeSingle();
        if (error || !p?.empresa_id) {
            await supa.auth.signOut();
            return pantallaLogin(error ? 'No se pudo cargar tu perfil: ' + error.message : 'Tu cuenta no pertenece a ninguna empresa en Presupuestos Pro.');
        }
        perfil = p;
        const [em, pr, pe, ga, ing, inf] = await Promise.all([
            supa.from('empresas').select('id,nombre_comercial,razon_social,rut,direccion,logo_b64').eq('id', p.empresa_id).maybeSingle(),
            supa.from('proyectos').select('*').order('creado_en'),
            supa.from('perfiles').select('id,nombre').eq('empresa_id', p.empresa_id),
            supa.from('proyecto_gastos').select('*').eq('registrado_por', usuario.id).order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(200),
            supa.from('proyecto_ingresos').select('*').eq('registrado_por', usuario.id).order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(200),
            supa.from('proyecto_informes').select('*').order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(100),
        ]);
        const fallo = [em, pr, pe, ga, ing, inf].find(r => r.error);
        if (fallo) toast('Algunos datos no se pudieron cargar: ' + fallo.error.message, 'error');
        empresa = em.data;
        perfiles = pe.data || [];
        // El técnico ve los proyectos activos que tiene asignados. Quien administra ve todos, también los cerrados
        // (puede cargarles gastos e ingresos que llegan después del cierre); los cerrados van al final.
        proyectos = (pr.data || []).filter(x => gestiona(x) || (x.estado === 'activo' && (x.asignados || []).includes(usuario.id)))
            .sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'activo' ? -1 : 1));
        gastos = ga.data || []; ingresos = ing.data || [];
        informes = (inf.data || []).filter(x => proyectoDe(x.proyecto_id) || x.registrado_por === usuario.id);
        ir(pantalla === 'informe' ? 'informes' : pantalla);
    }
    async function refrescar() {
        if (ocupado || !salirDelInforme()) return;
        if (pantalla === 'informe') descartarSubidas();
        await cargarTodo();
    }

    // ── Navegación ────────────────────────────────────────
    const salirDelInforme = () => pantalla !== 'informe' || !borrador || !puedeEditar(borrador) || confirm('¿Salir sin guardar el informe?');
    function ir(nueva) {
        if (pantalla === 'informe' && nueva !== 'informe') {
            if (!salirDelInforme()) return;
            descartarSubidas();
        }
        pantalla = nueva;
        const vistas = { inicio: vistaInicio, gastos: vistaGastos, gasto: vistaGasto, ingresos: vistaIngresos, informes: vistaInformes, informe: vistaInforme };
        render((vistas[nueva] || vistaInicio)());
        if (nueva === 'gastos') { cambiarCategoria('materiales'); pintarPendientes('gasto'); }
        if (nueva === 'gasto') { cambiarCategoria($('g-cat')?.value); despuesDeRespaldos(gastos.find(x => x.id === editandoId)); }
        if (nueva === 'ingresos') pintarPendientes('ingreso');
        if (['gastos', 'ingresos', 'informes'].includes(nueva)) cargarMiniaturasListas();
        window.scrollTo(0, 0);
    }
    function cabecera(titulo, color) {
        return `<header class="safe-top sticky top-0 z-20 ${color} text-white px-4 pb-3 shadow">
            <div class="flex items-center gap-3"><button onclick="G.ir('inicio')" class="w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-2xl hover:bg-white/10" aria-label="Volver">‹</button>
            <h1 class="text-lg font-black flex-1">${h(titulo)}</h1>
            <button onclick="G.refrescar()" class="text-xs font-bold px-3 py-2 rounded-lg bg-white/15">Actualizar</button></div></header>`;
    }
    const sinProyectos = () => `<div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 text-sm">
        No tienes proyectos asignados. Pide al administrador que te asigne en <b>Presupuestos Pro → Proyectos → Configuración → Personal asignado</b>.</div>`;
    function selectorProyecto(id, valor) {
        const sel = valor || recordado('proyecto');
        return `<div><label class="campo-label" for="${id}">Proyecto</label><select id="${id}" required class="campo-input" onchange="G.recordarProyecto(this.value)">
            ${proyectos.length > 1 ? '<option value="">Elige el proyecto…</option>' : ''}
            ${proyectos.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${p.estado === 'cerrado' ? '🔒 ' : ''}${h(p.codigo)} — ${h(p.nombre)}${p.estado === 'cerrado' ? ' (cerrado)' : ''}</option>`).join('')}</select></div>`;
    }
    const opciones = (grupo, items, activo) => Object.entries(items).map(([k, v]) => {
        const [titulo, sub] = Array.isArray(v) ? v : [v, ''];
        return `<button type="button" data-grupo="${grupo}" data-valor="${k}" onclick="G.elegir('${grupo}','${k}')" class="opcion ${k === activo ? 'activa' : ''}">${h(titulo)}${sub ? `<small>${h(sub)}</small>` : ''}</button>`;
    }).join('');
    function elegir(grupo, valor) {
        document.querySelectorAll(`[data-grupo="${grupo}"]`).forEach(b => b.classList.toggle('activa', b.dataset.valor === valor));
        $(grupo).value = valor;
        if (grupo === 'g-cat') cambiarCategoria(valor);
        if (grupo === 'i-medio') $('i-aviso').innerHTML = avisoMedio(valor);
    }
    function formatearMonto(input) {
        const n = soloDigitos(input.value);
        input.value = n ? n.toLocaleString('es-CL') : '';
    }

    // ── Inicio: 3 botones grandes ─────────────────────────
    function vistaInicio() {
        const porReembolsar = gastos.filter(g => g.origen_fondos === 'propio' && g.estado === 'aprobado' && !g.reembolsado_en).reduce((s, g) => s + g.monto, 0);
        const pendientesN = gastos.filter(g => g.estado === 'pendiente').length + ingresos.filter(i => i.estado === 'pendiente').length;
        const icono = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
        return `<div class="safe-top px-4 pb-8">
            <div class="flex items-center gap-3 py-3">
                <div class="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center font-black text-lg">${h((perfil?.nombre || usuario?.email || '?').trim().charAt(0).toUpperCase())}</div>
                <div class="flex-1 min-w-0"><p class="font-black truncate">Hola, ${h(perfil?.nombre || usuario?.email)}</p><p class="text-xs text-slate-500 truncate">${h(empresa?.nombre_comercial || '')}</p></div>
                <button onclick="G.salir()" class="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 text-slate-600">Salir</button>
            </div>
            ${porReembolsar || pendientesN ? `<div class="grid grid-cols-2 gap-3 mb-4">
                <div class="bg-white rounded-2xl p-3 shadow-sm"><p class="text-xs text-slate-500">Por reembolsarte</p><p class="text-lg font-black text-violet-700">${fmtCLP(porReembolsar)}</p></div>
                <div class="bg-white rounded-2xl p-3 shadow-sm"><p class="text-xs text-slate-500">Por aprobar</p><p class="text-lg font-black text-amber-600">${pendientesN} registro(s)</p></div></div>` : ''}
            <div class="space-y-4 mt-2">
                <button onclick="G.ir('gastos')" class="btn-grande bg-gradient-to-br from-emerald-600 to-emerald-700">${icono('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>')}<div><b>Gastos</b><span>Registra una compra con caja chica o con tu dinero</span></div></button>
                <button onclick="G.ir('ingresos')" class="btn-grande bg-gradient-to-br from-blue-600 to-blue-700">${icono('<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>')}<div><b>Ingresos</b><span>Registra un pago recibido de un proyecto</span></div></button>
                <button onclick="G.ir('informes')" class="btn-grande bg-gradient-to-br from-orange-500 to-orange-600">${icono('<path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>')}<div><b>Informe de trabajo</b><span>Fotos del antes y del después, en PDF</span></div></button>
            </div>
            <a href="index.html" class="block text-center text-xs text-slate-400 underline mt-8">Abrir Presupuestos Pro completo</a></div>`;
    }

    // ── Archivos ──────────────────────────────────────────
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
    // Igual que subirArchivo de proyectos.js: {empresa}/{proyecto}/{tipo}/{uuid}.jpg|pdf
    async function subirArchivo(file, pr, tipo) {
        let blob = file, ext = 'pdf', type = 'application/pdf';
        if (file.type === 'application/pdf') {
            if (file.size > 5 * 1024 * 1024) throw new Error('El PDF supera 5 MB');
        } else if (file.type.startsWith('image/')) {
            blob = await comprimirImagen(file); ext = 'jpg'; type = 'image/jpeg';
        } else throw new Error('El respaldo debe ser una foto o un PDF');
        const path = `${pr.empresa_id}/${pr.id}/${tipo}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supa.storage.from('proyectos').upload(path, blob, { contentType: type, upsert: false });
        if (error) throw new Error('No se pudo subir el archivo: ' + error.message);
        if (type.startsWith('image/')) urls.set(path, URL.createObjectURL(blob));
        return path;
    }
    async function subirVarios(archivos, pr, tipo) {
        const paths = [];
        try { for (const f of archivos) paths.push(await subirArchivo(f, pr, tipo)); }
        catch (error) { if (paths.length) supa.storage.from('proyectos').remove(paths); throw error; }
        return paths;
    }
    async function firmarUrls(paths) {
        const faltan = [...new Set(paths)].filter(p => p && !urls.has(p) && !p.endsWith('.pdf'));
        if (!faltan.length) return;
        const { data } = await supa.storage.from('proyectos').createSignedUrls(faltan, 3600);
        (data || []).forEach(x => { if (x.signedUrl) urls.set(x.path, x.signedUrl); });
    }
    async function verArchivo(path) {
        const ventana = window.open('', '_blank');
        const { data, error } = await supa.storage.from('proyectos').createSignedUrl(path, 600);
        if (error) { ventana?.close(); return toast('No se pudo abrir el archivo: ' + error.message, 'error'); }
        if (ventana) ventana.location = data.signedUrl; else location.href = data.signedUrl;
    }
    const botonesArchivo = (tipo, onchange) => `<div class="grid grid-cols-2 gap-2">
        <label class="btn-accion bg-slate-800 text-white text-sm cursor-pointer">📷 Tomar foto<input type="file" accept="image/*" capture="environment" class="hidden" onchange="${onchange}"></label>
        <label class="btn-accion border-2 border-slate-300 text-slate-700 text-sm cursor-pointer">Galería / PDF<input type="file" accept="image/*,application/pdf" multiple class="hidden" onchange="${onchange}"></label></div>`;
    function agregarPendientes(tipo, input) {
        const nuevos = [...(input.files || [])];
        input.value = '';
        if (pendientes[tipo].length + nuevos.length > MAX_ADJUNTOS) return toast(`Máximo ${MAX_ADJUNTOS} respaldos`, 'error');
        nuevos.forEach(f => pendientes[tipo].push({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null }));
        pintarPendientes(tipo);
    }
    function quitarPendiente(tipo, i) {
        const [x] = pendientes[tipo].splice(i, 1);
        if (x?.url) URL.revokeObjectURL(x.url);
        pintarPendientes(tipo);
    }
    function pintarPendientes(tipo) {
        const cont = $(`${tipo}-pendientes`);
        if (!cont) return;
        cont.innerHTML = pendientes[tipo].map((x, i) => `<div class="miniatura" style="${x.url ? `background-image:url('${x.url}')` : ''}">${x.url ? '' : '<div class="pdf">PDF</div>'}<button type="button" onclick="G.quitarPendiente('${tipo}',${i})" aria-label="Quitar">×</button></div>`).join('')
            || '<p class="text-xs text-slate-400">Sin respaldos todavía.</p>';
    }
    function limpiarPendientes(tipo) { pendientes[tipo].forEach(x => x.url && URL.revokeObjectURL(x.url)); pendientes[tipo] = []; }
    // Miniaturas de los respaldos ya guardados en las listas.
    async function cargarMiniaturasListas() {
        const lista = pantalla === 'gastos' ? gastos : pantalla === 'ingresos' ? ingresos : [];
        const paths = lista.flatMap(x => adjuntosDe(x).slice(0, 1));
        if (!paths.length) return;
        await firmarUrls(paths);
        document.querySelectorAll('[data-miniatura]').forEach(el => { const u = urls.get(el.dataset.miniatura); if (u) el.style.backgroundImage = `url('${u}')`; });
    }
    const miniaturaRespaldo = x => {
        const adj = adjuntosDe(x);
        if (!adj.length) return '';
        const pdf = adj[0].endsWith('.pdf');
        return `<button type="button" onclick="G.verArchivo('${h(adj[0])}')" class="miniatura" data-miniatura="${h(adj[0])}">${pdf ? '<div class="pdf">PDF</div>' : ''}${adj.length > 1 ? `<span class="absolute bottom-0 right-0 bg-slate-900/75 text-white text-[10px] font-bold px-1.5 rounded-tl">+${adj.length - 1}</span>` : ''}</button>`;
    };

    // ── Gastos ────────────────────────────────────────────
    function cambiarCategoria(cat) {
        const lista = $('g-subs'), input = $('g-sub');
        if (lista) lista.innerHTML = (SUBCATEGORIAS[cat] || []).map(s => `<option value="${h(s)}">`).join('');
        if (input) input.placeholder = 'Ej: ' + (SUBCATEGORIAS[cat] || []).slice(0, 2).join(', ');
    }
    function vistaGastos() {
        const propios = gastos.filter(g => g.origen_fondos === 'propio');
        const porReembolsar = propios.filter(g => g.estado === 'aprobado' && !g.reembolsado_en).reduce((s, g) => s + g.monto, 0);
        const propiosPend = propios.filter(g => g.estado === 'pendiente').reduce((s, g) => s + g.monto, 0);
        const cajaChica = gastos.filter(g => g.origen_fondos !== 'propio' && g.estado !== 'rechazado').reduce((s, g) => s + g.monto, 0);
        const formulario = proyectos.length ? `<form id="form-gasto" onsubmit="G.registrarGasto(event)" class="bg-white rounded-2xl shadow-sm p-4 space-y-4">
            ${selectorProyecto('g-proyecto')}
            ${camposGasto({})}
            <div><span class="campo-label">Respaldos (boleta, factura, transferencia) <span class="font-normal text-slate-400">— también puedes agregarlos después</span></span>${botonesArchivo('gasto', "G.agregarPendientes('gasto',this)")}
                <div id="gasto-pendientes" class="flex flex-wrap gap-2 mt-2"></div></div>
            <button type="submit" id="g-enviar" class="btn-accion bg-emerald-600 text-white">Registrar gasto</button>
            <p class="text-xs text-slate-500 text-center">Queda pendiente hasta que lo apruebe el administrador del proyecto.</p>
        </form>` : sinProyectos();
        const tarjetas = gastos.map(tarjetaGasto).join('');
        return `${cabecera('Gastos', 'bg-emerald-700')}<main class="p-4 space-y-4 safe-bottom">${formulario}
            <section><h2 class="font-black text-lg mb-2">Mis gastos</h2>
                <div class="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div class="bg-white rounded-xl p-2 shadow-sm"><p class="text-[11px] text-slate-500 leading-tight">Por reembolsarte</p><p class="font-black text-violet-700 text-sm">${fmtCLP(porReembolsar)}</p></div>
                    <div class="bg-white rounded-xl p-2 shadow-sm"><p class="text-[11px] text-slate-500 leading-tight">Propio por aprobar</p><p class="font-black text-amber-600 text-sm">${fmtCLP(propiosPend)}</p></div>
                    <div class="bg-white rounded-xl p-2 shadow-sm"><p class="text-[11px] text-slate-500 leading-tight">Caja chica rendida</p><p class="font-black text-slate-700 text-sm">${fmtCLP(cajaChica)}</p></div></div>
                <div class="space-y-2">${tarjetas || '<p class="text-sm text-slate-400 text-center py-6">Aún no registras gastos.</p>'}</div></section></main>`;
    }
    // Campos del gasto (registrar y editar usan los mismos ids).
    function camposGasto(v) {
        const origen = v.origen_fondos || 'empresa', cat = v.categoria || 'materiales', tipo = v.tipo_doc || 'boleta';
        return `<div><span class="campo-label">¿Con qué dinero pagaste?</span><input type="hidden" id="g-origen" value="${origen}">
                <div class="grid grid-cols-2 gap-2">${opciones('g-origen', { empresa: ['Caja chica empresa', 'Fondos por rendir'], propio: ['Dinero propio', 'Para que te lo devuelvan'] }, origen)}</div></div>
            <div><label class="campo-label" for="g-monto">Monto total (CLP)</label>
                <input id="g-monto" required inputmode="numeric" autocomplete="off" placeholder="0" oninput="G.formatearMonto(this)" class="campo-input text-2xl font-black" value="${v.monto ? v.monto.toLocaleString('es-CL') : ''}"></div>
            <div><label class="campo-label" for="g-fecha">Fecha</label><input id="g-fecha" type="date" required class="campo-input" value="${h(v.fecha || hoyChile())}" max="${hoyChile()}"></div>
            <div><span class="campo-label">Categoría</span><input type="hidden" id="g-cat" value="${cat}">
                <div class="grid grid-cols-3 gap-2">${opciones('g-cat', CATEGORIAS, cat)}</div></div>
            <div><label class="campo-label" for="g-sub">Tipo / concepto</label><input id="g-sub" list="g-subs" maxlength="80" class="campo-input" value="${h(v.subcategoria || '')}"><datalist id="g-subs"></datalist></div>
            <div><label class="campo-label" for="g-desc">Descripción</label><input id="g-desc" required maxlength="300" class="campo-input" placeholder="Qué se compró o pagó" value="${h(v.descripcion || '')}"></div>
            <div><label class="campo-label" for="g-prov">Proveedor</label><input id="g-prov" maxlength="160" class="campo-input" placeholder="Ej: Sodimac, Easy, ferretería" value="${h(v.proveedor || '')}"></div>
            <div class="grid grid-cols-2 gap-2">
                <div><label class="campo-label" for="g-tipodoc">Documento</label><select id="g-tipodoc" class="campo-input">${Object.entries(TIPOS_DOC).map(([k, t]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
                <div><label class="campo-label" for="g-numdoc">N° documento</label><input id="g-numdoc" maxlength="40" inputmode="numeric" class="campo-input" value="${h(v.numero_doc || '')}"></div></div>`;
    }
    const leerCamposGasto = () => ({
        fecha: $('g-fecha').value, categoria: $('g-cat').value, subcategoria: $('g-sub').value.trim() || null, descripcion: $('g-desc').value.trim(),
        proveedor: $('g-prov').value.trim() || null, tipo_doc: $('g-tipodoc').value, numero_doc: $('g-numdoc').value.trim() || null,
        monto: soloDigitos($('g-monto').value), origen_fondos: $('g-origen').value,
    });
    // Igual que el trigger validar_gasto: el autor mientras está pendiente; quien administra el proyecto, siempre.
    const puedeEditarGasto = g => gestiona(proyectoDe(g.proyecto_id)) || (g.registrado_por === usuario?.id && g.estado === 'pendiente');
    function tarjetaGasto(g) {
        const pr = proyectoDe(g.proyecto_id), editable = puedeEditarGasto(g), adj = adjuntosDe(g);
        const reemb = g.origen_fondos === 'propio'
            ? (g.reembolsado_en ? chip('Reembolsado ' + fecha(g.reembolsado_en), 'bg-emerald-600 text-white') : g.estado === 'aprobado' ? chip('Por reembolsar', 'bg-violet-100 text-violet-800') : '') : '';
        const acciones = editable ? `<div class="flex flex-wrap gap-2 mt-2">
                <button onclick="G.editarGasto('${g.id}')" class="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 text-slate-700">Editar</button>
                ${adj.length < MAX_ADJUNTOS ? `<label class="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 text-white cursor-pointer">📷 + Respaldo<input type="file" accept="image/*" capture="environment" class="hidden" onchange="G.agregarRespaldo('${g.id}',this)"></label>
                <label class="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 text-slate-700 cursor-pointer">+ Galería / PDF<input type="file" accept="image/*,application/pdf" multiple class="hidden" onchange="G.agregarRespaldo('${g.id}',this)"></label>` : ''}
                ${g.estado === 'pendiente' ? `<button onclick="G.eliminar('gasto','${g.id}')" class="text-xs font-bold px-2 py-2 text-red-500">Eliminar</button>` : ''}</div>` : '';
        return `<div id="gasto-${g.id}" class="bg-white rounded-2xl shadow-sm p-3 flex gap-3">
            ${miniaturaRespaldo(g)}
            <div class="flex-1 min-w-0">
                <div class="flex justify-between gap-2"><p class="font-bold leading-tight">${h(g.descripcion)}</p><p class="font-black whitespace-nowrap">${fmtCLP(g.monto)}</p></div>
                <p class="text-xs text-slate-500 mt-0.5">${fecha(g.fecha)} · ${h(pr?.codigo || 'Proyecto')} · ${h(g.subcategoria || CATEGORIAS[g.categoria])}</p>
                <div class="flex flex-wrap gap-1 mt-1.5">${chip(ORIGENES[g.origen_fondos] || 'Caja chica', g.origen_fondos === 'propio' ? 'bg-violet-50 text-violet-700 border border-violet-200' : 'bg-slate-100 text-slate-700')}${chip(ESTADOS[g.estado], COLOR_ESTADO[g.estado])}${reemb}${adj.length ? '' : chip('Sin respaldo', 'bg-amber-50 text-amber-700 border border-amber-200')}</div>
                ${g.estado === 'rechazado' && g.motivo_rechazo ? `<p class="text-xs text-red-600 mt-1">Motivo: ${h(g.motivo_rechazo)}</p>` : ''}
                ${acciones}
            </div></div>`;
    }

    // ── Editar un gasto ya registrado ─────────────────────
    let editandoId = null;
    function editarGasto(id) {
        if (!gastos.some(g => g.id === id)) return;
        editandoId = id;
        ir('gasto');
    }
    function vistaGasto() {
        const g = gastos.find(x => x.id === editandoId);
        if (!g) return vistaGastos();
        const pr = proyectoDe(g.proyecto_id);
        return `${cabecera('Editar gasto', 'bg-emerald-700')}<main class="p-4 space-y-4 safe-bottom">
            <form onsubmit="G.guardarGasto(event)" class="bg-white rounded-2xl shadow-sm p-4 space-y-4">
                <div><span class="campo-label">Proyecto</span><p class="font-bold">${h(pr ? pr.codigo + ' — ' + pr.nombre : 'Proyecto')}</p></div>
                ${camposGasto(g)}
                ${g.reembolsado_en ? '<p class="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">Este gasto ya figura como reembolsado. Si lo cambias a caja chica, se quita el reembolso.</p>' : ''}
                <button type="submit" id="g-guardar" class="btn-accion bg-emerald-600 text-white">Guardar cambios</button>
                <button type="button" onclick="G.ir('gastos')" class="btn-accion text-slate-500">Volver sin guardar</button>
            </form>
            <section class="bg-white rounded-2xl shadow-sm p-4"><span class="campo-label">Respaldos (se guardan apenas los subes)</span>
                <div id="edit-respaldos" class="flex flex-wrap gap-2 my-2">${respaldosEdicion(g)}</div>
                ${botonesArchivo('respaldo', `G.agregarRespaldo('${g.id}',this)`)}</section></main>`;
    }
    const respaldosEdicion = g => adjuntosDe(g).map((p, i) => `<div class="miniatura cursor-pointer" data-miniatura="${h(p)}" onclick="G.verArchivo('${h(p)}')">${p.endsWith('.pdf') ? '<div class="pdf">PDF</div>' : ''}<button type="button" onclick="event.stopPropagation();G.quitarRespaldo('${g.id}',${i})" aria-label="Quitar">×</button></div>`).join('')
        || '<p class="text-xs text-slate-400">Sin respaldos todavía.</p>';
    async function guardarGasto(ev) {
        ev.preventDefault();
        const campos = leerCamposGasto();
        if (!(campos.monto > 0)) return toast('Indica un monto mayor que cero', 'error');
        if (ocupado) return;
        ocupado = true;
        const boton = $('g-guardar'); boton.disabled = true; boton.textContent = 'Guardando…';
        const { data, error } = await supa.from('proyecto_gastos').update(campos).eq('id', editandoId).select().single();
        ocupado = false;
        if (error) { boton.disabled = false; boton.textContent = 'Guardar cambios'; return toast('No se pudo guardar: ' + error.message, 'error'); }
        reemplazarGasto(data);
        toast('Gasto actualizado', 'success');
        ir('gastos');
    }
    function reemplazarGasto(fila) { const i = gastos.findIndex(x => x.id === fila.id); if (i >= 0) gastos[i] = fila; }
    // Sube respaldos a un gasto ya registrado (uno a uno o varios) y los guarda de inmediato.
    async function agregarRespaldo(id, input) {
        const archivos = [...(input.files || [])];
        input.value = '';
        const g = gastos.find(x => x.id === id);
        if (!g || !archivos.length || ocupado) return;
        const actuales = adjuntosDe(g);
        if (actuales.length + archivos.length > MAX_ADJUNTOS) return toast(`Máximo ${MAX_ADJUNTOS} respaldos por gasto`, 'error');
        ocupado = true;
        toast(archivos.length > 1 ? `Subiendo ${archivos.length} respaldos…` : 'Subiendo respaldo…');
        let paths = [];
        try {
            paths = await subirVarios(archivos, { id: g.proyecto_id, empresa_id: g.empresa_id }, 'gasto');
            const nuevos = [...actuales, ...paths];
            const { data, error } = await supa.from('proyecto_gastos').update({ adjuntos: nuevos, adjunto_path: nuevos[0] }).eq('id', id).select().single();
            if (error) throw error;
            reemplazarGasto(data);
            toast(paths.length > 1 ? `${paths.length} respaldos agregados` : 'Respaldo agregado', 'success');
            despuesDeRespaldos(data);
        } catch (error) {
            if (paths.length) supa.storage.from('proyectos').remove(paths);
            toast('No se pudo agregar el respaldo: ' + (error.message || error), 'error');
        } finally { ocupado = false; }
    }
    async function quitarRespaldo(id, i) {
        const g = gastos.find(x => x.id === id), actuales = g ? adjuntosDe(g) : [], path = actuales[i];
        if (!path || ocupado || !confirm('¿Quitar este respaldo?')) return;
        ocupado = true;
        const nuevos = actuales.filter((_, k) => k !== i);
        const { data, error } = await supa.from('proyecto_gastos').update({ adjuntos: nuevos, adjunto_path: nuevos[0] || null }).eq('id', id).select().single();
        ocupado = false;
        if (error) return toast('No se pudo quitar: ' + error.message, 'error');
        supa.storage.from('proyectos').remove([path]);
        reemplazarGasto(data);
        toast('Respaldo quitado', 'success');
        despuesDeRespaldos(data);
    }
    // Repinta solo lo que cambió (en la lista no se pierde lo escrito en el formulario de registro).
    async function despuesDeRespaldos(g) {
        if (!g) return;
        if (pantalla === 'gasto') {
            const cont = $('edit-respaldos');
            if (cont) cont.innerHTML = respaldosEdicion(g);
            await firmarUrls(adjuntosDe(g));
            document.querySelectorAll('#edit-respaldos [data-miniatura]').forEach(el => { const u = urls.get(el.dataset.miniatura); if (u) el.style.backgroundImage = `url('${u}')`; });
        } else {
            const el = $('gasto-' + g.id);
            if (el) el.outerHTML = tarjetaGasto(g);
            cargarMiniaturasListas();
        }
    }

    async function registrarGasto(ev) {
        ev.preventDefault();
        const pr = proyectoDe($('g-proyecto').value);
        if (!pr) return toast('Elige el proyecto', 'error');
        const monto = soloDigitos($('g-monto').value);
        if (!(monto > 0)) return toast('Indica un monto mayor que cero', 'error');
        if (ocupado) return;
        ocupado = true;
        const boton = $('g-enviar'); boton.disabled = true; boton.textContent = 'Guardando…';
        let paths = [];
        try {
            paths = await subirVarios(pendientes.gasto.map(x => x.file), pr, 'gasto');
            const { data, error } = await supa.from('proyecto_gastos').insert({
                proyecto_id: pr.id, empresa_id: pr.empresa_id, ...leerCamposGasto(), adjunto_path: paths[0] || null, adjuntos: paths,
            }).select().single();
            if (error) throw error;
            gastos.unshift(data);
            limpiarPendientes('gasto');
            toast('Gasto registrado, pendiente de aprobación', 'success');
            ir('gastos');
        } catch (error) {
            if (paths.length) supa.storage.from('proyectos').remove(paths);
            toast('No se pudo guardar: ' + (error.message || error), 'error');
            boton.disabled = false; boton.textContent = 'Registrar gasto';
        } finally { ocupado = false; }
    }

    // ── Ingresos ──────────────────────────────────────────
    function avisoMedio(medio) {
        if (medio === 'transferencia_personal') return '<div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs"><b>Requiere autorización del encargado del proyecto.</b> Adjunta el comprobante de la transferencia que recibiste.</div>';
        if (medio === 'efectivo') return '<div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs">El encargado del proyecto debe confirmar el efectivo recibido.</div>';
        return '<div class="bg-slate-50 border border-slate-200 text-slate-600 rounded-xl p-3 text-xs">El encargado confirma que la transferencia llegó a la cuenta de la empresa.</div>';
    }
    function vistaIngresos() {
        const enMiPoder = ingresos.filter(i => i.medio !== 'transferencia_empresa' && i.estado !== 'rechazado').reduce((s, i) => s + i.monto, 0);
        const formulario = proyectos.length ? `<form onsubmit="G.registrarIngreso(event)" class="bg-white rounded-2xl shadow-sm p-4 space-y-4">
            ${selectorProyecto('i-proyecto')}
            <div><span class="campo-label">¿Cómo te pagaron?</span><input type="hidden" id="i-medio" value="transferencia_empresa">
                <div class="grid grid-cols-3 gap-2">${opciones('i-medio', { transferencia_empresa: ['Transferencia', 'a la empresa'], transferencia_personal: ['Transferencia', 'a mí'], efectivo: ['Efectivo', 'en mano'] }, 'transferencia_empresa')}</div>
                <div id="i-aviso" class="mt-2">${avisoMedio('transferencia_empresa')}</div></div>
            <div><label class="campo-label" for="i-monto">Monto recibido (CLP)</label>
                <input id="i-monto" required inputmode="numeric" autocomplete="off" placeholder="0" oninput="G.formatearMonto(this)" class="campo-input text-2xl font-black"></div>
            <div><label class="campo-label" for="i-fecha">Fecha</label><input id="i-fecha" type="date" required class="campo-input" value="${hoyChile()}" max="${hoyChile()}"></div>
            <div><label class="campo-label" for="i-pagador">¿Quién pagó?</label><input id="i-pagador" maxlength="160" class="campo-input" placeholder="Cliente o mandante"></div>
            <div><label class="campo-label" for="i-desc">Concepto</label><input id="i-desc" required maxlength="300" class="campo-input" placeholder="Ej: Pago estado de pago 2, adelanto, adicional"></div>
            <div><span class="campo-label">Comprobante</span>${botonesArchivo('ingreso', "G.agregarPendientes('ingreso',this)")}
                <div id="ingreso-pendientes" class="flex flex-wrap gap-2 mt-2"></div></div>
            <button type="submit" id="i-enviar" class="btn-accion bg-blue-600 text-white">Registrar ingreso</button>
        </form>` : sinProyectos();
        const tarjetas = ingresos.map(i => {
            const pr = proyectoDe(i.proyecto_id);
            return `<div class="bg-white rounded-2xl shadow-sm p-3 flex gap-3">${miniaturaRespaldo(i)}
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between gap-2"><p class="font-bold leading-tight">${h(i.descripcion)}</p><p class="font-black whitespace-nowrap text-blue-700">${fmtCLP(i.monto)}</p></div>
                    <p class="text-xs text-slate-500 mt-0.5">${fecha(i.fecha)} · ${h(pr?.codigo || 'Proyecto')}${i.pagador ? ' · ' + h(i.pagador) : ''}</p>
                    <div class="flex flex-wrap gap-1 mt-1.5">${chip(MEDIOS[i.medio], 'bg-blue-50 text-blue-700 border border-blue-200')}${chip(i.estado === 'aprobado' ? 'Autorizado' : ESTADOS[i.estado], COLOR_ESTADO[i.estado])}</div>
                    ${i.estado === 'rechazado' && i.motivo_rechazo ? `<p class="text-xs text-red-600 mt-1">Motivo: ${h(i.motivo_rechazo)}</p>` : ''}
                    ${i.estado === 'pendiente' ? `<button onclick="G.eliminar('ingreso','${i.id}')" class="text-xs font-bold text-red-500 mt-1.5">Eliminar</button>` : ''}
                </div></div>`;
        }).join('');
        return `${cabecera('Ingresos', 'bg-blue-700')}<main class="p-4 space-y-4 safe-bottom">${formulario}
            <section><h2 class="font-black text-lg mb-2">Mis ingresos</h2>
                <div class="bg-white rounded-xl p-3 shadow-sm mb-3 flex justify-between items-center"><span class="text-xs text-slate-500">Recibido por mí (transferencia o efectivo)</span><b class="text-blue-700">${fmtCLP(enMiPoder)}</b></div>
                <div class="space-y-2">${tarjetas || '<p class="text-sm text-slate-400 text-center py-6">Aún no registras ingresos.</p>'}</div></section></main>`;
    }
    async function registrarIngreso(ev) {
        ev.preventDefault();
        const pr = proyectoDe($('i-proyecto').value);
        if (!pr) return toast('Elige el proyecto', 'error');
        const monto = soloDigitos($('i-monto').value);
        if (!(monto > 0)) return toast('Indica un monto mayor que cero', 'error');
        const medio = $('i-medio').value;
        if (medio === 'transferencia_personal' && !pendientes.ingreso.length && !confirm('No adjuntaste el comprobante de la transferencia. ¿Registrar igual?')) return;
        if (ocupado) return;
        ocupado = true;
        const boton = $('i-enviar'); boton.disabled = true; boton.textContent = 'Guardando…';
        let paths = [];
        try {
            paths = await subirVarios(pendientes.ingreso.map(x => x.file), pr, 'ingreso');
            const { data, error } = await supa.from('proyecto_ingresos').insert({
                proyecto_id: pr.id, empresa_id: pr.empresa_id, fecha: $('i-fecha').value, monto, medio,
                pagador: $('i-pagador').value.trim() || null, descripcion: $('i-desc').value.trim(), adjuntos: paths,
            }).select().single();
            if (error) throw error;
            ingresos.unshift(data);
            limpiarPendientes('ingreso');
            toast(medio === 'transferencia_personal' ? 'Ingreso registrado: espera la autorización del encargado' : 'Ingreso registrado', 'success');
            ir('ingresos');
        } catch (error) {
            if (paths.length) supa.storage.from('proyectos').remove(paths);
            toast('No se pudo guardar: ' + (error.message || error), 'error');
            boton.disabled = false; boton.textContent = 'Registrar ingreso';
        } finally { ocupado = false; }
    }
    async function eliminar(tipo, id) {
        const lista = tipo === 'gasto' ? gastos : ingresos;
        const x = lista.find(r => r.id === id);
        if (!x || ocupado || !confirm(`¿Eliminar "${x.descripcion}" por ${fmtCLP(x.monto)}?`)) return;
        ocupado = true;
        const { error } = await supa.from(tipo === 'gasto' ? 'proyecto_gastos' : 'proyecto_ingresos').delete().eq('id', id);
        ocupado = false;
        if (error) return toast('No se pudo eliminar: ' + error.message, 'error');
        const archivos = adjuntosDe(x);
        if (archivos.length) supa.storage.from('proyectos').remove(archivos);
        if (tipo === 'gasto') gastos = gastos.filter(r => r.id !== id); else ingresos = ingresos.filter(r => r.id !== id);
        toast('Eliminado', 'success');
        ir(tipo === 'gasto' ? 'gastos' : 'ingresos');
    }

    // ── Informes de trabajo ───────────────────────────────
    const puedeEditar = inf => !inf.id || inf.registrado_por === usuario.id || gestiona(proyectoDe(inf.proyecto_id));
    function vistaInformes() {
        const tarjetas = informes.map(inf => {
            const pr = proyectoDe(inf.proyecto_id), fotos = (inf.items || []).reduce((s, it) => s + (it.antes?.length || 0) + (it.despues?.length || 0), 0);
            return `<div class="bg-white rounded-2xl shadow-sm p-4">
                <p class="font-bold leading-tight">${h(inf.titulo)}</p>
                <p class="text-xs text-slate-500 mt-0.5">${fecha(inf.fecha)} · ${h(pr?.codigo || 'Proyecto')} · ${(inf.items || []).length} trabajo(s), ${fotos} foto(s)</p>
                <p class="text-xs text-slate-400">Por ${h(nombrePerfil(inf.registrado_por))}</p>
                <div class="grid grid-cols-2 gap-2 mt-3">
                    <button onclick="G.abrirInforme('${inf.id}')" class="btn-accion !min-h-[2.75rem] border-2 border-slate-300 text-slate-700 text-sm">${puedeEditar(inf) ? 'Abrir / editar' : 'Ver'}</button>
                    <button onclick="G.pdfInforme('${inf.id}',this)" class="btn-accion !min-h-[2.75rem] bg-orange-600 text-white text-sm">Descargar PDF</button></div></div>`;
        }).join('');
        return `${cabecera('Informes de trabajo', 'bg-orange-600')}<main class="p-4 space-y-4 safe-bottom">
            ${proyectos.length ? `<button onclick="G.nuevoInforme()" class="btn-accion bg-orange-600 text-white shadow">+ Nuevo informe</button>` : sinProyectos()}
            <div class="space-y-3">${tarjetas || '<p class="text-sm text-slate-400 text-center py-6">Aún no hay informes.</p>'}</div></main>`;
    }
    const bloqueVacio = () => ({ titulo: '', comentario: '', antes: [], despues: [] });
    function nuevoInforme() {
        const pid = proyectos.find(p => p.id === recordado('proyecto'))?.id || proyectos[0]?.id || '';
        borrador = { proyecto_id: pid, fecha: hoyChile(), titulo: '', ubicacion: '', trabajo_realizado: '', observaciones: '', items: [bloqueVacio()] };
        subidosSinGuardar = new Set(); porBorrar = new Set();
        ir('informe');
    }
    async function abrirInforme(id) {
        const inf = informes.find(x => x.id === id);
        if (!inf) return;
        borrador = JSON.parse(JSON.stringify(inf));
        if (!borrador.items?.length) borrador.items = [bloqueVacio()];
        subidosSinGuardar = new Set(); porBorrar = new Set();
        ir('informe');
        await firmarUrls(borrador.items.flatMap(it => [...(it.antes || []), ...(it.despues || [])]));
        if (pantalla === 'informe') pintarInforme();
    }
    function pintarInforme() { const y = window.scrollY; render(vistaInforme()); window.scrollTo(0, y); }
    function vistaInforme() {
        const b = borrador, editable = puedeEditar(b), dis = editable ? '' : 'disabled';
        const fotos = (i, lado) => {
            const lista = b.items[i][lado] || [];
            const minis = lista.map((p, k) => `<div class="miniatura" style="${urls.get(p) ? `background-image:url('${urls.get(p)}')` : ''}">${editable ? `<button type="button" onclick="G.quitarFoto(${i},'${lado}',${k})" aria-label="Quitar">×</button>` : ''}</div>`).join('');
            const agregar = editable && lista.length < MAX_FOTOS_LADO ? `
                <label class="miniatura flex items-center justify-center text-2xl cursor-pointer !bg-white border-dashed border-2 text-slate-500">📷<input type="file" accept="image/*" capture="environment" class="hidden" onchange="G.agregarFotos(${i},'${lado}',this)"></label>
                <label class="miniatura flex items-center justify-center text-[11px] font-bold text-center cursor-pointer !bg-white border-dashed border-2 text-slate-500 leading-tight">Galería<input type="file" accept="image/*" multiple class="hidden" onchange="G.agregarFotos(${i},'${lado}',this)"></label>` : '';
            return `<div class="flex flex-wrap gap-2">${minis}${agregar}${!minis && !agregar ? '<p class="text-xs text-slate-400">Sin fotos</p>' : ''}</div>`;
        };
        const bloques = b.items.map((it, i) => `<div class="bg-white rounded-2xl shadow-sm p-4 space-y-3">
            <div class="flex items-center gap-2"><span class="w-7 h-7 rounded-full bg-orange-600 text-white text-sm font-black flex items-center justify-center shrink-0">${i + 1}</span>
                <input value="${h(it.titulo)}" ${dis} maxlength="120" oninput="G.campoBloque(${i},'titulo',this.value)" class="campo-input" placeholder="Trabajo (ej: Remate muro living)">
                ${editable && b.items.length > 1 ? `<button type="button" onclick="G.quitarBloque(${i})" class="text-red-500 text-xs font-bold px-2">Quitar</button>` : ''}</div>
            <div><p class="text-xs font-black text-red-600 mb-1.5 tracking-wider">ANTES</p>${fotos(i, 'antes')}</div>
            <div><p class="text-xs font-black text-emerald-600 mb-1.5 tracking-wider">DESPUÉS</p>${fotos(i, 'despues')}</div>
            <textarea ${dis} rows="2" maxlength="400" oninput="G.campoBloque(${i},'comentario',this.value)" class="campo-input" placeholder="Comentario del trabajo">${h(it.comentario)}</textarea></div>`).join('');
        return `${cabecera(b.id ? 'Informe de trabajo' : 'Nuevo informe', 'bg-orange-600')}<main class="p-4 space-y-4 safe-bottom">
            <div class="bg-white rounded-2xl shadow-sm p-4 space-y-4">
                ${editable && !b.id ? selectorProyecto('inf-proyecto', b.proyecto_id).replace('onchange="G.recordarProyecto(this.value)"', 'onchange="G.campoInforme(\'proyecto_id\',this.value)"')
                    : `<div><span class="campo-label">Proyecto</span><p class="font-bold">${h(proyectoDe(b.proyecto_id) ? proyectoDe(b.proyecto_id).codigo + ' — ' + proyectoDe(b.proyecto_id).nombre : '—')}</p></div>`}
                <div><label class="campo-label">Título del informe</label><input value="${h(b.titulo)}" ${dis} maxlength="160" oninput="G.campoInforme('titulo',this.value)" class="campo-input" placeholder="Ej: Remates de yeso piso 3"></div>
                <div class="grid grid-cols-2 gap-2">
                    <div><label class="campo-label">Fecha</label><input type="date" value="${h(b.fecha)}" ${dis} max="${hoyChile()}" onchange="G.campoInforme('fecha',this.value)" class="campo-input"></div>
                    <div><label class="campo-label">Ubicación</label><input value="${h(b.ubicacion)}" ${dis} maxlength="160" oninput="G.campoInforme('ubicacion',this.value)" class="campo-input" placeholder="Torre / depto / piso"></div></div>
                <div><label class="campo-label">Trabajo realizado</label><textarea ${dis} rows="3" maxlength="600" oninput="G.campoInforme('trabajo_realizado',this.value)" class="campo-input" placeholder="Resumen de lo que se hizo">${h(b.trabajo_realizado)}</textarea></div>
            </div>
            ${bloques}
            ${editable && b.items.length < 30 ? `<button type="button" onclick="G.agregarBloque()" class="btn-accion border-2 border-dashed border-orange-400 text-orange-700 bg-white">+ Agregar antes / después</button>` : ''}
            <div class="bg-white rounded-2xl shadow-sm p-4"><label class="campo-label">Observaciones</label><textarea ${dis} rows="3" maxlength="2000" oninput="G.campoInforme('observaciones',this.value)" class="campo-input" placeholder="Pendientes, recomendaciones, etc.">${h(b.observaciones)}</textarea></div>
            ${editable ? `<button type="button" id="inf-guardar" onclick="G.guardarInforme(false)" class="btn-accion bg-orange-600 text-white">Guardar informe</button>
                <button type="button" id="inf-guardar-pdf" onclick="G.guardarInforme(true)" class="btn-accion bg-slate-900 text-white">Guardar y descargar PDF</button>`
                : `<button type="button" onclick="G.pdfBorrador(this)" class="btn-accion bg-slate-900 text-white">Descargar PDF</button>`}
            <button type="button" onclick="G.ir('informes')" class="btn-accion text-slate-500">Cancelar</button></main>`;
    }
    function campoInforme(campo, valor) { borrador[campo] = valor; if (campo === 'proyecto_id') recordar('proyecto', valor); }
    function campoBloque(i, campo, valor) { borrador.items[i][campo] = valor; }
    function agregarBloque() { borrador.items.push(bloqueVacio()); pintarInforme(); setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30); }
    function quitarBloque(i) {
        const it = borrador.items[i];
        if (!confirm(`¿Quitar el trabajo ${i + 1}${it.titulo ? ' "' + it.titulo + '"' : ''} y sus fotos?`)) return;
        [...it.antes, ...it.despues].forEach(p => marcarBorrado(p));
        borrador.items.splice(i, 1);
        pintarInforme();
    }
    function marcarBorrado(path) {
        if (subidosSinGuardar.has(path)) { subidosSinGuardar.delete(path); supa.storage.from('proyectos').remove([path]); }
        else porBorrar.add(path);
    }
    async function agregarFotos(i, lado, input) {
        const archivos = [...(input.files || [])];
        input.value = '';
        const pr = proyectoDe(borrador.proyecto_id);
        if (!pr) return toast('Elige primero el proyecto', 'error');
        const lista = borrador.items[i][lado];
        if (lista.length + archivos.length > MAX_FOTOS_LADO) return toast(`Máximo ${MAX_FOTOS_LADO} fotos por lado`, 'error');
        toast(archivos.length > 1 ? `Subiendo ${archivos.length} fotos…` : 'Subiendo foto…');
        try {
            const paths = await subirVarios(archivos, pr, 'informe');
            paths.forEach(p => subidosSinGuardar.add(p));
            lista.push(...paths);
            toast('Foto agregada', 'success');
        } catch (error) { toast(error.message, 'error'); }
        if (pantalla === 'informe') pintarInforme();
    }
    function quitarFoto(i, lado, k) {
        const [path] = borrador.items[i][lado].splice(k, 1);
        if (path) marcarBorrado(path);
        pintarInforme();
    }
    // Al salir sin guardar se borran las fotos subidas en esta edición.
    function descartarSubidas() {
        if (subidosSinGuardar.size) supa.storage.from('proyectos').remove([...subidosSinGuardar]);
        subidosSinGuardar = new Set(); porBorrar = new Set(); borrador = null;
    }
    async function guardarInforme(conPdf) {
        const b = borrador;
        if (!proyectoDe(b.proyecto_id)) return toast('Elige el proyecto', 'error');
        if (!b.titulo.trim()) return toast('Escribe el título del informe', 'error');
        if (ocupado) return;
        ocupado = true;
        document.querySelectorAll('#inf-guardar,#inf-guardar-pdf').forEach(x => x.disabled = true);
        const fila = {
            fecha: b.fecha || hoyChile(), titulo: b.titulo.trim(), ubicacion: b.ubicacion?.trim() || null,
            trabajo_realizado: b.trabajo_realizado?.trim() || null, observaciones: b.observaciones?.trim() || null,
            items: b.items.map(it => ({ titulo: (it.titulo || '').trim(), comentario: (it.comentario || '').trim(), antes: it.antes, despues: it.despues })),
        };
        const consulta = b.id
            ? supa.from('proyecto_informes').update(fila).eq('id', b.id).select().single()
            : supa.from('proyecto_informes').insert({ ...fila, proyecto_id: b.proyecto_id, empresa_id: proyectoDe(b.proyecto_id).empresa_id }).select().single();
        const { data, error } = await consulta;
        ocupado = false;
        if (error) {
            document.querySelectorAll('#inf-guardar,#inf-guardar-pdf').forEach(x => x.disabled = false);
            return toast('No se pudo guardar: ' + error.message, 'error');
        }
        if (porBorrar.size) supa.storage.from('proyectos').remove([...porBorrar]);
        subidosSinGuardar = new Set(); porBorrar = new Set();
        const i = informes.findIndex(x => x.id === data.id);
        if (i >= 0) informes[i] = data; else informes.unshift(data);
        toast('Informe guardado', 'success');
        borrador = null;
        ir('informes');
        if (conPdf) await pdfInforme(data.id);
    }
    async function generarPdf(inf, boton) {
        const texto = boton?.textContent;
        if (boton) { boton.disabled = true; boton.textContent = 'Generando PDF…'; }
        const creadas = [];
        try {
            toast('Generando PDF…');
            const resultado = await InformePDF.generar({
                empresa, proyecto: proyectoDe(inf.proyecto_id), informe: inf, autor: nombrePerfil(inf.registrado_por || usuario.id),
                // Las fotos se descargan como blob local: html2canvas no tiene problemas de CORS con ellas.
                cargarFoto: async path => {
                    const { data, error } = await supa.storage.from('proyectos').download(path);
                    if (error) throw error;
                    const u = URL.createObjectURL(data); creadas.push(u); return u;
                },
            });
            InformePDF.descargar(resultado);
            toast('PDF listo', 'success');
        } catch (error) {
            toast('No se pudo generar el PDF: ' + (error.message || error), 'error');
        } finally {
            creadas.forEach(u => URL.revokeObjectURL(u));
            if (boton && document.body.contains(boton)) { boton.disabled = false; boton.textContent = texto; }
        }
    }
    async function pdfInforme(id, boton) {
        const inf = informes.find(x => x.id === id);
        if (inf) await generarPdf(inf, boton);
    }
    const pdfBorrador = boton => generarPdf(borrador, boton);

    document.addEventListener('DOMContentLoaded', iniciar);
    return {
        ir, salir, verClave, refrescar, elegir, formatearMonto, verArchivo,
        recordarProyecto: v => recordar('proyecto', v),
        agregarPendientes, quitarPendiente, registrarGasto, editarGasto, guardarGasto, agregarRespaldo, quitarRespaldo, registrarIngreso, eliminar,
        nuevoInforme, abrirInforme, campoInforme, campoBloque, agregarBloque, quitarBloque, agregarFotos, quitarFoto,
        guardarInforme, pdfInforme, pdfBorrador,
    };
})();
