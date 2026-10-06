// ═══════════════════════════════════════════════════════════
// app.js — Presupuestos Pro  (arquitectura Itemizar, multiempresa)
// Capítulos → Partidas; la ejecución (estados de pago, gastos) vive en proyectos.js
// ═══════════════════════════════════════════════════════════

// ── Estado global ────────────────────────────────────────
const DB_KEY = 'phh_presupuestos_v3';
let presupuestos    = [];
let editandoId      = null;   // ID presupuesto en edición (tab Nuevo Presupuesto)
let contratoActualId= null;   // ID presupuesto en modal contrato
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


// ── Firma remota (Supabase) ──────────────────────────────
// anon/public key en Settings → API de tu proyecto Supabase (NO la service_role).
// Es seguro que esta clave quede visible en el código: el acceso real lo controlan
// las funciones RPC con seguridad a nivel de fila definidas en supabase_schema.sql.
const SUPABASE_URL      = 'https://oeqjqfjdswwyyjbgdaxk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lcWpxZmpkc3d3eXlqYmdkYXhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNTE5ODYsImV4cCI6MjA5OTYyNzk4Nn0.lgD8nfhPSmgNGPwio_fJZhlcnLTOxBemTjx_LKLST7g';
const supa = (typeof supabase !== 'undefined' && /^eyJ/.test(SUPABASE_ANON_KEY))
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
let rfCanvas, rfCtx, rfDibujando = false, rfUltimoPunto = null;
let streamRF = null, rfOtId = null, rfOtCache = null;

// ── Autenticación / multiempresa ──────────────────────────
let currentUserId = null;
let empresaActual  = null;   // fila de la tabla `empresas`
let miPerfil       = null;   // fila de la tabla `perfiles`

// ── Arranque ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const idFirmaRemota = new URLSearchParams(location.search).get('firmar');
    if (idFirmaRemota) { iniciarVistaFirmaRemota(idFirmaRemota); return; }
    document.getElementById('login-form').addEventListener('submit', onSubmitLogin);
    document.getElementById('signup-form').addEventListener('submit', onSubmitSignup);
    document.getElementById('onboarding-form').addEventListener('submit', onSubmitOnboarding);
    document.getElementById('form-empresa').addEventListener('submit', onSubmitEmpresa);
    document.getElementById('form-invitar').addEventListener('submit', onSubmitInvitar);
    document.getElementById('recuperar-form').addEventListener('submit', onSubmitRecuperar);
    document.getElementById('nueva-password-form').addEventListener('submit', onSubmitNuevaPassword);
    iniciarApp();
});

async function iniciarApp() {
    if (!supa) { await arrancarAppPrincipal(); return; }

    // El link del correo de recuperación vuelve con #type=recovery en la URL.
    // Se detecta directo del hash (no dependemos del timing de onAuthStateChange).
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hashParams.get('type') === 'recovery') {
        mostrarBloque('nueva-password');
        mostrarSoloGate('login-gate');
        return;
    }
    supa.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            mostrarBloque('nueva-password');
            mostrarSoloGate('login-gate');
        }
    });

    const { data: { session } } = await supa.auth.getSession();
    if (!session) { mostrarLogin(); return; }
    currentUserId = session.user.id;
    await resolverSesion();
}

// Muestra una sola de las 3 pantallas raíz: login/registro, pendiente de
// aprobación, o la app completa.
function mostrarSoloGate(id) {
    ['login-gate', 'pending-gate', 'app-shell'].forEach(g => {
        document.getElementById(g).classList.toggle('hidden', g !== id);
    });
}

function mostrarBloque(which) {
    ['login', 'signup', 'onboarding', 'recuperar', 'nueva-password'].forEach(b => {
        document.getElementById('bloque-' + b).classList.toggle('hidden', b !== which);
    });
}

function mostrarLogin() {
    mostrarBloque('login');
    mostrarSoloGate('login-gate');
}

// Muestra/oculta el texto de un campo de contraseña y alterna el ícono de ojo.
function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    const verActualmente = input.type === 'password';
    input.type = verActualmente ? 'text' : 'password';
    btn.querySelector('.ojo-abierto').classList.toggle('hidden', verActualmente);
    btn.querySelector('.ojo-cerrado').classList.toggle('hidden', !verActualmente);
}

// Se llama después de cualquier inicio de sesión exitoso (login, registro
// con sesión inmediata, o vuelta desde confirmación de correo). Decide qué
// pantalla mostrar según si el usuario tiene empresa y si está aprobada.
async function resolverSesion() {
    const { data: perfil, error: perfilErr } = await supa.from('perfiles').select('*').eq('id', currentUserId).maybeSingle();
    if (perfilErr) { toast('Error cargando tu perfil: ' + perfilErr.message, 'error'); return; }
    if (!perfil) { mostrarBloque('onboarding'); mostrarSoloGate('login-gate'); return; }
    miPerfil = perfil;

    const { data: empresa, error: empresaErr } = await supa.from('empresas').select('*').eq('id', perfil.empresa_id).maybeSingle();
    if (empresaErr || !empresa) { toast('No se pudo cargar tu empresa', 'error'); return; }
    empresaActual = empresa;

    try { await Plataforma.resolverSesion(); }
    catch (error) { toast(error.message, 'error'); mostrarLogin(); return; }
    if (!Plataforma.disponible && !empresa.aprobada && !perfil.es_superadmin) {
        document.getElementById('pending-empresa-nombre').textContent = empresa.nombre_comercial;
        mostrarSoloGate('pending-gate');
        return;
    }
    await arrancarAppPrincipal();
}

async function onSubmitLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) { errorEl.textContent = 'Correo o contraseña incorrectos.'; errorEl.classList.remove('hidden'); return; }
    currentUserId = data.user.id;
    await resolverSesion();
}

async function onSubmitSignup(e) {
    e.preventDefault();
    const nombreEmpresa = document.getElementById('signup-empresa').value.trim();
    const nombreUsuario = document.getElementById('signup-nombre').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errorEl = document.getElementById('signup-error');
    errorEl.className = 'text-xs text-red-600 hidden';

    const { data, error } = await supa.auth.signUp({ email, password });
    if (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); return; }

    if (!data.session) {
        errorEl.className = 'text-xs text-emerald-600';
        errorEl.textContent = 'Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.';
        errorEl.classList.remove('hidden');
        return;
    }
    currentUserId = data.user.id;
    const { error: rpcErr } = await supa.rpc('crear_empresa_y_admin', { p_nombre_comercial: nombreEmpresa, p_nombre_usuario: nombreUsuario });
    if (rpcErr) { errorEl.textContent = rpcErr.message; errorEl.classList.remove('hidden'); return; }
    await resolverSesion();
}

async function onSubmitOnboarding(e) {
    e.preventDefault();
    const nombreEmpresa = document.getElementById('onb-empresa').value.trim();
    const nombreUsuario = document.getElementById('onb-nombre').value.trim();
    const errorEl = document.getElementById('onboarding-error');
    errorEl.classList.add('hidden');
    const { error } = await supa.rpc('crear_empresa_y_admin', { p_nombre_comercial: nombreEmpresa, p_nombre_usuario: nombreUsuario });
    if (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); return; }
    await resolverSesion();
}

async function onSubmitRecuperar(e) {
    e.preventDefault();
    const email = document.getElementById('recuperar-email').value.trim();
    const msgEl = document.getElementById('recuperar-msg');
    msgEl.className = 'text-xs hidden';
    const { error } = await supa.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
    });
    msgEl.classList.remove('hidden');
    if (error) {
        msgEl.className = 'text-xs text-red-600';
        msgEl.textContent = error.message;
        return;
    }
    msgEl.className = 'text-xs text-emerald-600';
    msgEl.textContent = 'Listo, revisa tu correo y sigue el link para elegir una contraseña nueva.';
}

async function onSubmitNuevaPassword(e) {
    e.preventDefault();
    const password = document.getElementById('nueva-password').value;
    const errorEl = document.getElementById('nueva-password-error');
    errorEl.classList.add('hidden');
    const { data, error } = await supa.auth.updateUser({ password });
    if (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); return; }
    // Limpia el #type=recovery de la URL para no volver a caer en este formulario al recargar.
    history.replaceState(null, '', location.pathname + location.search);
    currentUserId = data.user.id;
    toast('Contraseña actualizada', 'success');
    await resolverSesion();
}

async function cerrarSesion() {
    if (supa) await supa.auth.signOut();
    location.reload();
}

async function arrancarAppPrincipal() {
    if (!Plataforma.disponible || Plataforma.puedeOperar()) { await cargarDB(); await Proyectos.cargar(); }
    else presupuestos = [];
    initFecha();
    initRegiones();
    actualizarListaClientes();
    initFirmaContrato();
    initFirmaStandalone();
    initFirmaOT();
    agregarCapitulo();        // empieza con un capítulo vacío
    actualizarBadges();
    actualizarNumeroFormulario();
    aplicarBranding();
    cargarFormularioEmpresa();
    cargarEquipo();
    mostrarSoloGate('app-shell');
    await Plataforma.iniciar();
}

// ════════════════════════════════════════════════════════
// PERSISTENCIA
// ════════════════════════════════════════════════════════
async function cargarDB() {
    if (supa && empresaActual) {
        const { data, error } = await supa.from('presupuestos').select('data').eq('empresa_id', empresaActual.id);
        presupuestos = error ? [] : (data || []).map(row => row.data);
        if (error) toast('No se pudo cargar desde Supabase: ' + error.message, 'error');
    } else {
        try { presupuestos = JSON.parse(localStorage.getItem(DB_KEY)) || []; }
        catch { presupuestos = []; }
    }
    presupuestos.forEach(p => {
        if (!p.ordenesTrabajo) p.ordenesTrabajo = [];
        if (typeof p.usarGGUtil !== 'boolean') p.usarGGUtil = true;
    });
}
function guardarDB() {
    if (Plataforma.disponible && !Plataforma.puedeOperar()) { toast('La empresa no tiene acceso operativo', 'error'); return; }
    if (supa && empresaActual) {
        const rows = presupuestos.map(p => ({ id: p.id, empresa_id: empresaActual.id, data: p, updated_at: new Date().toISOString() }));
        if (rows.length) {
            supa.from('presupuestos').upsert(rows).then(({ error }) => {
                if (error) toast('No se pudo guardar en Supabase: ' + error.message, 'error');
            });
        }
        return;
    }
    localStorage.setItem(DB_KEY, JSON.stringify(presupuestos));
}

// ════════════════════════════════════════════════════════
// MI EMPRESA — branding, equipo, invitaciones
// ════════════════════════════════════════════════════════
const APP_NOMBRE = 'PRESUPUESTOS PRO';
const APP_LOGO = 'assets/presupuestos-pro-192.png';

// En modo "Administrar plataforma" se muestra la marca de la app; al trabajar en la empresa, la de la empresa.
function aplicarBranding() {
    const modoAdmin = typeof Plataforma !== 'undefined' && Plataforma.modo === 'admin';
    const nombre = modoAdmin ? APP_NOMBRE : (empresaActual?.nombre_comercial || 'Presupuestos Pro');
    document.getElementById('header-empresa-nombre').textContent = nombre;
    document.getElementById('header-subtitulo').textContent = modoAdmin
        ? 'Administración de empresas y suscripciones'
        : 'Cotizaciones, órdenes de trabajo y firma digital';
    document.title = modoAdmin ? 'Presupuestos Pro · Administración' : nombre;

    const logo  = modoAdmin ? APP_LOGO : empresaActual?.logo_b64;
    const img   = document.getElementById('header-logo-img');
    const badge = document.getElementById('header-logo-badge');
    if (logo) {
        img.src = logo;
        img.classList.remove('hidden');
        badge.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        badge.classList.remove('hidden');
        document.getElementById('header-logo-letra').textContent = nombre.trim().charAt(0).toUpperCase() || 'P';
    }
}

function empresaInfoLineaHtml() {
    const e = empresaActual || {};
    const l1 = [e.direccion, e.rut ? ('RUT: ' + e.rut) : null].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
    const l2 = [e.email_contacto, e.telefono].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
    return [l1, l2].filter(Boolean).join('<br>');
}

// undefined = sin cambios al logo; null = se quitó; string = logo nuevo (dataURL)
let logoB64Pendiente;

function cargarFormularioEmpresa() {
    const e = empresaActual || {};
    document.getElementById('emp-nombre-comercial').value = e.nombre_comercial || '';
    document.getElementById('emp-razon-social').value = e.razon_social || '';
    document.getElementById('emp-rut').value = e.rut || '';
    document.getElementById('emp-direccion').value = e.direccion || '';
    document.getElementById('emp-telefono').value = e.telefono || '';
    document.getElementById('emp-email').value = e.email_contacto || '';
    document.getElementById('emp-responsable-nombre').value = e.responsable_nombre || '';
    document.getElementById('emp-responsable-cargo').value = e.responsable_cargo || '';
    logoB64Pendiente = undefined;
    document.getElementById('emp-logo-file').value = '';
    mostrarPreviewLogo(e.logo_b64 || null);
}

function mostrarPreviewLogo(src) {
    const img      = document.getElementById('emp-logo-preview');
    const vacio    = document.getElementById('emp-logo-vacio');
    const btnQuitar = document.getElementById('emp-logo-quitar');
    if (src) {
        img.src = src;
        img.classList.remove('hidden');
        vacio.classList.add('hidden');
        btnQuitar.classList.remove('hidden');
    } else {
        img.src = '';
        img.classList.add('hidden');
        vacio.classList.remove('hidden');
        btnQuitar.classList.add('hidden');
    }
}

// Lee la imagen elegida, la reduce a un tamaño razonable (máx. 320px) y la
// deja lista en memoria como dataURL; se guarda recién al enviar el form.
function previewLogoEmpresa(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Selecciona un archivo de imagen', 'error');
    const reader = new FileReader();
    reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
            const maxDim = 320;
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                const ratio = Math.min(maxDim / width, maxDim / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            logoB64Pendiente = canvas.toDataURL('image/png');
            mostrarPreviewLogo(logoB64Pendiente);
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function quitarLogoEmpresa() {
    logoB64Pendiente = null;
    document.getElementById('emp-logo-file').value = '';
    mostrarPreviewLogo(null);
}

async function onSubmitEmpresa(e) {
    e.preventDefault();
    const datos = {
        nombre_comercial: document.getElementById('emp-nombre-comercial').value.trim(),
        razon_social: document.getElementById('emp-razon-social').value.trim(),
        rut: document.getElementById('emp-rut').value.trim(),
        direccion: document.getElementById('emp-direccion').value.trim(),
        telefono: document.getElementById('emp-telefono').value.trim(),
        email_contacto: document.getElementById('emp-email').value.trim(),
        responsable_nombre: document.getElementById('emp-responsable-nombre').value.trim(),
        responsable_cargo: document.getElementById('emp-responsable-cargo').value.trim(),
        logo_b64: logoB64Pendiente !== undefined ? logoB64Pendiente : (empresaActual.logo_b64 || null),
    };
    const { error } = await supa.from('empresas').update(datos).eq('id', empresaActual.id);
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    Object.assign(empresaActual, datos);
    logoB64Pendiente = undefined;
    aplicarBranding();
    toast('Datos de la empresa guardados', 'success');
}

async function cargarEquipo() {
    const { data, error } = await supa.from('perfiles').select('*').eq('empresa_id', empresaActual.id).order('creado_en');
    const lista = document.getElementById('equipo-lista');
    if (error) { lista.innerHTML = `<p class="text-xs text-red-500">${esc(error.message)}</p>`; return; }
    document.getElementById('equipo-cupos').textContent = `${data.length} de ${empresaActual.limite_usuarios} cupo(s) usados`;
    lista.innerHTML = data.map(m => `
        <div class="py-2.5 flex items-center justify-between">
            <div>
                <p class="text-sm font-semibold text-slate-700">${esc(m.nombre || '(sin nombre)')}</p>
                <p class="text-xs text-slate-400">${m.rol === 'admin' ? 'Administrador' : 'Miembro'}</p>
            </div>
        </div>`).join('');
    document.getElementById('form-invitar').classList.toggle('hidden', miPerfil?.rol !== 'admin');
}

async function onSubmitInvitar(e) {
    e.preventDefault();
    const email = document.getElementById('inv-email').value.trim();
    const nombre = document.getElementById('inv-nombre').value.trim();
    const msgEl = document.getElementById('invitar-msg');
    msgEl.classList.add('hidden');

    const { data: { session } } = await supa.auth.getSession();
    const { data, error } = await supa.functions.invoke('invitar-usuario', {
        body: { email, nombre },
        headers: { Authorization: `Bearer ${session.access_token}` },
    });

    msgEl.classList.remove('hidden');
    if (error || data?.error) {
        msgEl.className = 'text-xs text-red-600';
        msgEl.textContent = data?.error || error.message;
        return;
    }
    msgEl.className = 'text-xs text-emerald-600';
    msgEl.textContent = `Invitación enviada a ${email}.`;
    document.getElementById('inv-email').value = '';
    document.getElementById('inv-nombre').value = '';
    cargarEquipo();
}

// ════════════════════════════════════════════════════════
// EMPRESAS (panel superadmin)
// ════════════════════════════════════════════════════════
async function cargarSuperadmin() { return Plataforma.cargarAdmin(); }

// ════════════════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════════════════
function uid() { return `_${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`; }

// Moneda / decimales usados por fmt() en el render/formulario actualmente activo.
let monedaFmt    = 'CLP';
let decimalesFmt = 0;

function fmt(n) {
    n = n || 0;
    const numStr = n.toLocaleString('es-CL', { minimumFractionDigits: decimalesFmt, maximumFractionDigits: decimalesFmt });
    return monedaFmt === 'UF' ? numStr + ' UF' : '$ ' + numStr;
}

// Decimales por defecto sugeridos según la moneda (el usuario puede cambiarlos).
function decimalesPorDefecto(moneda) { return moneda === 'UF' ? 2 : 0; }

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
    if (!Plataforma.navegarPermitido(tabId)) { toast('Tu cuenta no tiene acceso a esta sección', 'error'); return; }
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
        if (activo && btn.offsetParent) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });

    // Renderizar contenido del tab destino
    if (tabId === 'tab-enviados')    renderEnviados();
    if (tabId === 'tab-adjudicados') renderAdjudicados();
    if (tabId === 'tab-ot')          renderOrdenesTrabajo();
    if (tabId === 'tab-proyectos')   Proyectos.render();
    if (tabId === 'tab-firma')       renderSelectFirma();
    if (tabId === 'tab-empresa')     cargarEquipo();
    if (tabId === 'tab-superadmin')  cargarSuperadmin();
    if (tabId === 'tab-suscripcion') Plataforma.cargarMiSuscripcion();
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
// AUTOCOMPLETAR CLIENTE (recuerda clientes ya cotizados antes)
// ════════════════════════════════════════════════════════
function normRut(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Un cliente por nombre y uno por RUT, quedándose con los datos del
// presupuesto más reciente en que aparece cada uno.
function clientesUnicos() {
    const porNombre = new Map();
    const porRut = new Map();
    presupuestos.forEach(p => {
        const c = p.cliente;
        if (!c || !c.nombre) return;
        porNombre.set(c.nombre.trim().toLowerCase(), c);
        if (c.rut && c.rut.trim()) porRut.set(normRut(c.rut), c);
    });
    return { porNombre, porRut };
}

// Refresca las sugerencias (datalist) de nombre y RUT con los clientes
// de presupuestos anteriores, para que el navegador los ofrezca al escribir.
function actualizarListaClientes() {
    const { porNombre, porRut } = clientesUnicos();
    document.getElementById('lista-clientes-nombres').innerHTML =
        [...porNombre.values()].map(c => `<option value="${esc(c.nombre)}">`).join('');
    document.getElementById('lista-clientes-ruts').innerHTML =
        [...porRut.values()].map(c => `<option value="${esc(c.rut)}">`).join('');
}

// Si el nombre o RUT ingresado coincide con un cliente ya cotizado antes,
// completa el resto de sus datos automáticamente.
function autocompletarCliente(origen) {
    if (editandoId) return; // no pisar datos al editar un presupuesto existente
    const { porNombre, porRut } = clientesUnicos();
    let c = null;
    if (origen === 'nombre') {
        const v = document.getElementById('cli-nombre').value.trim().toLowerCase();
        if (v) c = porNombre.get(v);
    } else {
        const v = normRut(document.getElementById('cli-rut').value);
        if (v) c = porRut.get(v);
    }
    if (!c) return;

    document.getElementById('cli-nombre').value    = c.nombre || '';
    document.getElementById('cli-rut').value       = c.rut || '';
    document.getElementById('cli-telefono').value  = c.telefono || '';
    document.getElementById('cli-direccion').value = c.direccion || '';
    document.getElementById('cli-region').value    = c.region || '';
    filtrarComunas();
    document.getElementById('cli-comuna').value    = c.comuna || '';
    toast('Datos del cliente autocompletados', 'success');
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
        moneda: document.getElementById('p-moneda').value || 'CLP',
        decimales: parseInt(document.getElementById('p-decimales').value) || 0,
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
        actualizarListaClientes();
        toast(`Presupuesto ${p.numero} actualizado`, 'success');
        limpiarFormulario();
        mostrarTab('tab-enviados');
        return;
    }

    const p = {
        id: uid(), numero: document.getElementById('p-numero').value,
        ...datos,
        estado: 'enviado', firma: null, ordenesTrabajo: [],
    };

    presupuestos.push(p);
    guardarDB();
    actualizarBadges();
    actualizarListaClientes();
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
    document.getElementById('p-moneda').value = 'CLP';
    document.getElementById('p-decimales').value = '0';
    monedaFmt = 'CLP';
    decimalesFmt = 0;
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

// Cambia la moneda usada por fmt() en el formulario y refresca los montos ya escritos.
function onCambioMoneda() {
    monedaFmt = document.getElementById('p-moneda').value || 'CLP';
    // Sugiere decimales acordes a la moneda elegida (el usuario puede cambiarlos después).
    document.getElementById('p-decimales').value = decimalesPorDefecto(monedaFmt);
    decimalesFmt = decimalesPorDefecto(monedaFmt);
    refrescarMontosFormulario();
}

function onCambioDecimales() {
    decimalesFmt = parseInt(document.getElementById('p-decimales').value) || 0;
    refrescarMontosFormulario();
}

function refrescarMontosFormulario() {
    document.querySelectorAll('#capitulos-container .item-cant').forEach(inp => {
        recalcularFila(inp, inp.closest('tr')?.dataset.capId);
    });
    recalcularResumen();
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
        monedaFmt = p.moneda || 'CLP';
        decimalesFmt = p.decimales ?? decimalesPorDefecto(p.moneda || 'CLP');
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
    document.getElementById('p-moneda').value    = p.moneda || 'CLP';
    document.getElementById('p-decimales').value = p.decimales ?? decimalesPorDefecto(p.moneda || 'CLP');
    monedaFmt = p.moneda || 'CLP';
    decimalesFmt = p.decimales ?? decimalesPorDefecto(p.moneda || 'CLP');

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
    monedaFmt = p.moneda || 'CLP';
    decimalesFmt = p.decimales ?? decimalesPorDefecto(p.moneda || 'CLP');
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
        monedaFmt = p.moneda || 'CLP';
        decimalesFmt = p.decimales ?? decimalesPorDefecto(p.moneda || 'CLP');
        const c           = calcPresupuesto(p);
        const proy        = Proyectos.resumenPresupuesto(p.id);
        const cobrado     = proy?.cobrado || 0;
        const avancePct   = Math.min(proy?.avancePct || 0, 100);
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden group">
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
                        <span>Avance estados de pago</span><span class="font-bold text-emerald-700">${avancePct.toFixed(1)}%</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div class="h-2 rounded-full bg-gradient-to-r from-blue-400 to-emerald-500 transition-all" style="width:${avancePct}%"></div>
                    </div>
                </div>
                <div class="flex items-center justify-between pt-1">
                    <span class="text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-100 text-emerald-700">
                        Adjudicado ${fmtFecha(p.fechaAdjudicacion)}
                    </span>
                    <span class="text-xs text-slate-400">${proy ? esc(proy.proyecto.codigo) : 'Sin centro de costo'}</span>
                </div>
                ${Proyectos.disponible ? `<button onclick="Proyectos.abrirDesdePresupuesto('${p.id}')"
                    class="w-full text-xs px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold transition-colors">
                    ${proy ? 'Abrir proyecto en ejecución' : 'Pasar a ejecución (centro de costo)'}
                </button>` : ''}
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

function revertirAdjudicacion(id) {
    const p = presupuestos.find(x => x.id === id);
    if (!p) return;
    if (Proyectos.existePara(id)) return toast(`${p.numero} tiene un proyecto en ejecución; no se puede revertir la adjudicación`, 'error');
    if (!confirm(`¿Revocar la adjudicación de ${p.numero}? Volverá a "Enviados" y se perderá la firma del cliente registrada.`)) return;

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
                    ${Proyectos.disponible && p.estado === 'adjudicado'
                        ? `<button onclick="Proyectos.abrirDesdePresupuesto('${p.id}')"
                            class="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold transition-colors">${Proyectos.existePara(p.id) ? 'Proyecto' : 'Pasar a ejecución'}</button>`
                        : ''}
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

    const { error: guardarError } = await supa.from('presupuestos').upsert([{ id: p.id, empresa_id: empresaActual.id, data: p, updated_at: new Date().toISOString() }]);
    if (guardarError) return toast('No se pudo guardar la orden antes de publicar: ' + guardarError.message, 'error');
    toast('Publicando…', 'info');
    const { error } = await supa.rpc('publicar_ot', {
        p_id: ot.id, p_numero: ot.numero, p_presupuesto_numero: p.numero,
        p_empresa_nombre: empresaActual?.nombre_comercial || null,
        p_moneda: p.moneda || 'CLP',
        p_decimales: p.decimales ?? decimalesPorDefecto(p.moneda || 'CLP'),
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
    mostrarLinkFirma(link);
    toast('Link generado', 'success');
}

function mostrarLinkFirma(link) {
    document.getElementById('link-firma-input').value = link;
    document.getElementById('link-firma-abrir').href = link;
    abrirModal('modal-link-firma');
}

async function copiarLinkFirma() {
    const input = document.getElementById('link-firma-input');
    try {
        await navigator.clipboard.writeText(input.value);
        toast('Link copiado', 'success');
    } catch {
        input.select();
        document.execCommand('copy');
        toast('Link copiado', 'success');
    }
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
    document.getElementById('app-shell').classList.add('hidden');
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
    monedaFmt = ot.moneda || 'CLP';
    decimalesFmt = ot.decimales ?? decimalesPorDefecto(ot.moneda || 'CLP');

    document.getElementById('rf-empresa-nombre').textContent = ot.empresa_nombre || 'Orden de Trabajo';
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
    ['modal-contrato','modal-catalogo','modal-ot','modal-link-firma'].forEach(id=>{
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
    const M = n => {
        const dec = p.decimales ?? decimalesPorDefecto(p.moneda || 'CLP');
        const numStr = (n||0).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        return p.moneda === 'UF' ? numStr + ' UF' : '$ ' + numStr;
    };
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
.co-logo{max-height:42px;max-width:150px;margin-bottom:8px;display:block}
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
    ${empresaActual?.logo_b64?`<img src="${empresaActual.logo_b64}" alt="Logo" class="co-logo">`:''}
    <div class="co-name">${esc(empresaActual?.nombre_comercial || 'Presupuestos Pro')}</div>
    <div class="co-tag">${esc(empresaActual?.razon_social || '')}</div>
    <div class="co-info">${empresaInfoLineaHtml()}</div>
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
      ${empresaActual?.firma_b64?`<img src="${empresaActual.firma_b64}" alt="Firma" style="height:50px;margin:0 auto 4px;display:block;">`:''}
      <div class="firma-lin"></div>
      <div class="firma-emp">${esc(empresaActual?.nombre_comercial || '')}</div>
      <div class="firma-nom">${esc(empresaActual?.responsable_nombre || '')}</div>
      <div class="firma-car">${esc(empresaActual?.responsable_cargo || '')}</div>
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
    const M = n => {
        const dec = p.decimales ?? decimalesPorDefecto(p.moneda || 'CLP');
        const numStr = (n||0).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        return p.moneda === 'UF' ? numStr + ' UF' : '$ ' + numStr;
    };
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
.co-logo{max-height:42px;max-width:150px;margin-bottom:8px;display:block}
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
    ${empresaActual?.logo_b64?`<img src="${empresaActual.logo_b64}" alt="Logo" class="co-logo">`:''}
    <div class="co-name">${esc(empresaActual?.nombre_comercial || 'Presupuestos Pro')}</div>
    <div class="co-tag">${esc(empresaActual?.razon_social || '')}</div>
    <div class="co-info">${empresaInfoLineaHtml()}</div>
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
      ${empresaActual?.firma_b64?`<img src="${empresaActual.firma_b64}" alt="Firma" style="height:50px;margin:0 auto 4px;display:block;">`:''}
      <div class="firma-lin"></div>
      <div class="firma-emp">${esc(empresaActual?.nombre_comercial || '')}</div>
      <div class="firma-nom">${esc(empresaActual?.responsable_nombre || '')}</div>
      <div class="firma-car">${esc(empresaActual?.responsable_cargo || '')}</div>
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
