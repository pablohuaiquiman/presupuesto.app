/* Administración de plataforma. Los permisos reales se aplican en Supabase. */
const Plataforma = (() => {
    const etiquetas = {
        pendiente: 'Pendiente', autorizada: 'Autorizada', suspendida: 'Suspendida',
        bloqueada: 'Bloqueada', archivada: 'Archivada', sin_configurar: 'Sin configurar',
        programada: 'Programada', al_dia: 'Al día', en_gracia: 'En gracia',
        vencida: 'Vencida', cancelada: 'Cancelada', cortesia: 'Cortesía',
        opera: 'Puede operar', no_opera: 'Sin acceso operativo', sin_permiso: 'Sin permiso para ver'
    };
    let disponible = false, acceso = null, modo = 'empresa', empresas = [], suscripciones = [], pagos = [], usuariosPorEmpresa = {};
    let seleccion = null, consulta = 0, timer = null, iniciado = false;
    const $ = id => document.getElementById(id);
    // Dueño: todo. Colaborador: ve el panel y actúa según sus permisos (el servidor los vuelve a validar).
    const PERMISOS = {acceso:'Acceso y cupos', suscripciones:'Suscripciones y pagos'};
    const esDueno = () => !!miPerfil?.es_superadmin;
    const esEquipo = () => esDueno() || !!miPerfil?.colaborador_plataforma;
    const puede = permiso => esDueno() || (esEquipo() && (miPerfil.permisos_plataforma || []).includes(permiso));
    const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const clp = value => new Intl.NumberFormat('es-CL', {style:'currency', currency:'CLP', maximumFractionDigits:0}).format(value || 0);
    function hoyChile() {
        const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Santiago', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date());
        const part = type => parts.find(p => p.type === type).value;
        return part('year') + '-' + part('month') + '-' + part('day');
    }
    function fechaCiclo(inicio, meses) {
        const [y,m,d] = inicio.split('-').map(Number);
        const first = new Date(Date.UTC(y,m-1+meses,1));
        const lastDay = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
        first.setUTCDate(Math.min(d,lastDay));
        return first.toISOString().slice(0,10);
    }
    function sumarDias(fecha, dias) {
        const date = new Date(fecha + 'T12:00:00Z');
        date.setUTCDate(date.getUTCDate()+dias);
        return date.toISOString().slice(0,10);
    }
    const fecha = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—';
    function resumen(e,s,hoy=hoyChile()) {
        const estadoAcceso = e.estado_acceso || (e.aprobada ? 'autorizada' : 'pendiente');
        const autorizada = estadoAcceso === 'autorizada';
        // Por qué NO puede operar, en palabras: «Autorizada» en la lista no basta si la suscripción no da acceso.
        const conMotivo = (r,porPago) => ({...r,motivo:r.operativo ? '' : (!autorizada ? 'El acceso está «'+(etiquetas[estadoAcceso] || estadoAcceso).toLowerCase()+'».' : porPago)});
        if (!s) return conMotivo({estado_pago:'sin_configurar',vencimiento:null,operativo:autorizada && e.acceso_transitorio === true},'Falta asignarle un plan o marcarla como cortesía.');
        if (s.cortesia) {
            const estadoCortesia = s.cancelada ? 'cancelada' : (hoy < s.inicio ? 'programada' : 'cortesia');
            return conMotivo({estado_pago:estadoCortesia,vencimiento:null,operativo:autorizada && hoy >= s.inicio && !s.cancelada},
                s.cancelada ? 'La cortesía está cancelada.' : 'La cortesía rige desde el '+fecha(s.inicio)+'.');
        }
        const vence = fechaCiclo(s.inicio,s.periodos_pagados);
        let estado = 'vencida';
        if (s.cancelada) estado = 'cancelada';
        else if (hoy < s.inicio) estado = 'programada';
        else if (hoy < vence) estado = 'al_dia';
        else if (hoy < sumarDias(vence,s.dias_gracia)) estado = 'en_gracia';
        const operativo = autorizada && hoy >= s.inicio &&
            (hoy < vence || (!s.cancelada && hoy < sumarDias(vence,s.dias_gracia)));
        return conMotivo({estado_pago:estado,vencimiento:vence,operativo},
            hoy < s.inicio ? 'El plan rige desde el '+fecha(s.inicio)+'.'
            : s.cancelada ? (s.periodos_pagados ? 'La renovación está cancelada y el tiempo pagado terminó el '+fecha(vence)+'.' : 'La renovación está cancelada y no tiene ningún período pagado.')
            : 'La mensualidad venció el '+fecha(vence)+' y terminó el plazo de gracia.');
    }
    const badge = estado => '<span class="pl-badge pl-' + h(estado) + '">' + h(etiquetas[estado] || estado) + '</span>';
    const campo = (label,id,type,value,extra='') => '<label class="pl-field">' + h(label) +
        '<input id="' + id + '" name="' + id + '" type="' + type + '" value="' + h(value) + '" ' + extra + '></label>';
    const opcion = (value,label,selected) => '<option value="' + value + '"' + (selected ? ' selected' : '') + '>' + h(label) + '</option>';
    const estados = selected => ['pendiente','autorizada','suspendida','bloqueada','archivada'].map(s => opcion(s,etiquetas[s],selected === s)).join('');

    async function filas(tabla, columnas='*') {
        let result = [];
        for (let offset=0; ; offset+=1000) {
            const {data,error} = await supa.from(tabla).select(columnas).order(tabla === 'suscripciones' ? 'empresa_id' : 'id').range(offset,offset+999);
            if (error) throw error;
            result = result.concat(data);
            if (data.length < 1000) return result;
        }
    }
    async function resolverSesion() {
        if (!supa) return;
        if (!empresaActual) {
            // Colaborador sin empresa: solo existe si la migración de plataforma está aplicada.
            disponible=esEquipo();
            acceso={operativo:false};
            return;
        }
        const {data,error} = await supa.rpc('estado_servicio',{p_empresa_id:empresaActual.id});
        if (error) {
            if (!disponible && ['PGRST202','42883'].includes(error.code)) {
                disponible=false;
                acceso={operativo:!!empresaActual.aprobada};
                return;
            }
            throw new Error('No se pudo verificar el acceso: ' + error.message);
        }
        const reactivada=iniciado && acceso?.operativo === false && data.operativo === true;
        disponible=true;
        acceso=data;
        if (reactivada) {
            await cargarDB();
            actualizarListaClientes();
            actualizarBadges();
        }
    }
    function puedeOperar() { return acceso?.operativo === true; }
    function navegarPermitido(tab) {
        if (tab === 'tab-superadmin') return esEquipo();
        if (!empresaActual) return false;
        if (tab === 'tab-suscripcion') return true;
        return !disponible || puedeOperar();
    }
    async function iniciar() {
        $('pl-switch').classList.toggle('hidden',!esEquipo() || !empresaActual);
        $('nav-superadmin').classList.add('hidden');
        $('nav-suscripcion').classList.toggle('hidden', !disponible);
        $('form-empresa').querySelectorAll('input,button,select,textarea').forEach(el => el.disabled = miPerfil?.rol !== 'admin');
        iniciado=true;
        cambiarModo(esEquipo() ? 'admin' : 'empresa');
        clearInterval(timer);
        if (disponible && empresaActual) timer=setInterval(() => actualizarAcceso().catch(() => {}),60000);
        if (disponible && empresaActual) retornoMercadoPago();
    }
    async function actualizarAcceso() {
        try {
            await resolverSesion();
            ajustarNavegacion();
            if (!puedeOperar() && modo === 'empresa') mostrarTab('tab-suscripcion');
        } catch (error) {
            acceso={operativo:false,estado_pago:'error',estado_acceso:'error'};
            ajustarNavegacion();
            if (modo === 'empresa') mostrarTab('tab-suscripcion');
            toast(error.message,'error');
        }
    }
    function ajustarNavegacion() {
        $('company-nav').classList.toggle('hidden',modo === 'admin');
        $('pl-banner').classList.toggle('hidden',modo === 'admin' || !disponible || puedeOperar());
        $('pl-banner').textContent='La operación de la empresa está restringida. Consulta el estado de tu cuenta.';
        document.querySelectorAll('#company-nav .tab-btn').forEach(el => {
            el.disabled=disponible && !puedeOperar() && el.dataset.tab !== 'tab-suscripcion';
        });
        $('pl-mode-admin').classList.toggle('pl-selected',modo === 'admin');
        $('pl-mode-empresa').classList.toggle('pl-selected',modo === 'empresa');
        aplicarBranding();
    }
    function cambiarModo(nuevo) {
        if (nuevo === 'admin' && !esEquipo()) return;
        if (nuevo === 'empresa' && !empresaActual) return;
        modo=nuevo;
        ajustarNavegacion();
        mostrarTab(modo === 'admin' ? 'tab-superadmin' : (puedeOperar() || !disponible ? 'tab-nuevo' : 'tab-suscripcion'));
    }
    async function cargarAdmin() {
        if (!esEquipo()) return;
        const root=$('pl-admin');
        root.innerHTML='<p class="pl-empty" role="status">Cargando empresas…</p>';
        if (disponible && !esDueno()) {
            // Los permisos pueden haber cambiado desde que inició sesión.
            const {data}=await supa.from('perfiles').select('colaborador_plataforma,permisos_plataforma').eq('id',miPerfil.id).maybeSingle();
            Object.assign(miPerfil,data || {colaborador_plataforma:false,permisos_plataforma:[]});
            if (!esEquipo()) { root.innerHTML='<div class="pl-notice" role="alert">Ya no tienes acceso a la administración de la plataforma.</div>'; return; }
        }
        if (!disponible) {
            root.innerHTML='<div class="pl-notice"><h2>Actualización de base de datos pendiente</h2><p>La administración de suscripciones estará disponible cuando se aplique la migración de plataforma. Las empresas existentes mantienen su funcionamiento.</p></div>';
            return;
        }
        try {
            // Suscripciones y pagos solo se piden con el permiso «Suscripciones y pagos»: la base tampoco los entrega sin él.
            const verDinero=puede('suscripciones');
            const conteo=await supa.rpc('plataforma_usuarios_por_empresa');
            // Si la base aún no tiene la actualización de permisos, el conteo sale del modo anterior.
            const conteoViejo=!!conteo.error && ['PGRST202','42883'].includes(conteo.error.code);
            if (conteo.error && !conteoViejo) throw conteo.error;
            [empresas,suscripciones,pagos]=await Promise.all([filas('empresas','id,nombre_comercial,rut,email_contacto,telefono,estado_acceso,aprobada,acceso_transitorio,limite_usuarios,creado_en'+(conteoViejo ? ',perfiles(count)' : '')),
                verDinero ? filas('suscripciones') : [],verDinero ? filas('pagos_suscripcion') : []]);
            usuariosPorEmpresa=conteoViejo ? Object.fromEntries(empresas.map(e => [e.id,e.perfiles?.[0]?.count ?? 0])) : Object.fromEntries((conteo.data || []).map(f => [f.empresa_id,f.usuarios]));
            const mes=hoyChile().slice(0,7);
            const recibidos=verDinero ? clp(pagos.filter(p => p.fecha_pago.startsWith(mes)).reduce((sum,p) => sum+p.monto,0)) : '—';
            const activas=verDinero ? empresas.filter(e => resumen(e,suscripciones.find(s => s.empresa_id===e.id)).operativo).length : '—';
            const vencidas=verDinero ? empresas.filter(e => resumen(e,suscripciones.find(s => s.empresa_id===e.id)).estado_pago === 'vencida').length : '—';
            root.innerHTML='<div class="pl-heading"><div><p class="pl-eyebrow">ADMINISTRACIÓN DE PLATAFORMA</p><h2>Empresas y suscripciones</h2><p>Controla el acceso, los cupos y los pagos mensuales desde un solo lugar.</p></div><button class="pl-button" data-action="refresh">Actualizar</button></div>' +
                '<div class="pl-stats">' + [[empresas.length,'Empresas registradas'],[activas,'Con acceso operativo'],[vencidas,'Suscripciones vencidas'],[recibidos,'Pagos recibidos este mes']].map(([n,label]) => '<div class="pl-stat"><strong>'+h(n)+'</strong><span>'+label+'</span></div>').join('') + '</div>' +
                '<div class="pl-card"><div class="pl-filters"><label class="pl-field">Buscar empresa<input id="pl-search" type="search" placeholder="Nombre, RUT o correo"></label><label class="pl-field">Acceso<select id="pl-filter-access"><option value="">Todos</option>'+estados('')+'</select></label><label class="pl-field">Suscripción<select id="pl-filter-pay"><option value="">Todas</option>'+['sin_configurar','programada','al_dia','en_gracia','vencida','cancelada','cortesia'].map(s => opcion(s,etiquetas[s],false)).join('')+'</select></label></div><div class="pl-table-wrap"><table class="pl-table pl-table-cards"><thead><tr><th>Empresa</th><th>Acceso</th><th>Suscripción</th><th>Usuarios</th><th>Vencimiento</th><th></th></tr></thead><tbody id="pl-companies"></tbody></table></div><p id="pl-result-count" class="pl-footnote" aria-live="polite"></p></div>';
            ['pl-search','pl-filter-access','pl-filter-pay'].forEach(id => $(id).addEventListener('input',renderEmpresas));
            renderEmpresas();
            if (esDueno()) {
                root.insertAdjacentHTML('beforeend','<div class="pl-card pl-padding pl-team"><div class="pl-heading"><div><h3>Colaboradores de la plataforma</h3><p>Personas que te ayudan a administrar. Todas pueden ver las empresas; marca qué más pueden hacer. Solo tú eliminas empresas y gestionas colaboradores.</p></div></div><div id="pl-team-list"><p class="pl-empty">Cargando colaboradores…</p></div>'+
                    '<form id="pl-team-form" class="pl-form">'+campo('Correo del colaborador','pl-team-email','email','','required maxlength="254"')+campo('Nombre (opcional)','pl-team-name','text','','maxlength="120"')+
                    '<div class="pl-wide pl-perms">'+casillas('pl-team-new',[])+'</div><button class="pl-button pl-primary" type="submit">Agregar colaborador</button></form></div>');
                $('pl-team-form').addEventListener('submit',agregarColaborador);
                cargarColaboradores();
            } else {
                const mios=(miPerfil.permisos_plataforma || []).map(p => PERMISOS[p]).join(' · ') || 'Solo lectura';
                root.insertAdjacentHTML('afterbegin','<p class="pl-notice pl-mine">Eres colaborador de la plataforma. Tus permisos: <strong>'+h(mios)+'</strong>.</p>');
            }
        } catch(error) {
            root.innerHTML='<div class="pl-notice" role="alert">No se pudo cargar la administración: '+h(error.message)+' <button class="pl-button" data-action="refresh">Reintentar</button></div>';
        }
    }
    function renderEmpresas() {
        const query=$('pl-search').value.trim().toLocaleLowerCase('es');
        const accessFilter=$('pl-filter-access').value, payFilter=$('pl-filter-pay').value;
        const filtradas=empresas.filter(e => {
            const r=resumen(e,suscripciones.find(s => s.empresa_id === e.id));
            return [e.nombre_comercial,e.rut,e.email_contacto].join(' ').toLocaleLowerCase('es').includes(query) &&
                (!accessFilter || e.estado_acceso===accessFilter) && (!payFilter || !puede('suscripciones') || r.estado_pago===payFilter);
        });
        $('pl-companies').innerHTML=filtradas.map(e => {
            const s=suscripciones.find(s => s.empresa_id===e.id), r=resumen(e,s);
            const nombre=h(e.nombre_comercial), contacto=h(e.rut || e.email_contacto || 'Sin datos de contacto');
            const verDinero=puede('suscripciones');
            // «Autorizada» sola no dice si la empresa puede trabajar: debajo va si opera y, si no, el motivo.
            const accesoBadge=badge(e.estado_acceso)+(verDinero ? ' '+badge(r.operativo ? 'opera' : 'no_opera')+(r.motivo ? '<small>'+h(r.motivo)+'</small>' : '') : '');
            const pagoBadge=verDinero ? badge(r.estado_pago) : badge('sin_permiso');
            const plan=verDinero ? h(s?.plan_nombre || (e.acceso_transitorio ? 'Transición sin cobro' : 'Requiere un plan')) : '', usados=usuariosPorEmpresa[e.id] ?? 0;
            const vencimiento=!verDinero ? '—' : (s?.cortesia ? 'Sin vencimiento' : fecha(r.vencimiento));
            return '<tr><td data-label="Empresa"><strong>'+nombre+'</strong><small>'+contacto+'</small></td><td data-label="Acceso">'+accesoBadge+'</td><td data-label="Suscripción">'+pagoBadge+'<small>'+plan+'</small></td><td data-label="Usuarios">'+usados+' / '+e.limite_usuarios+'</td><td data-label="Vencimiento">'+vencimiento+'</td><td class="pl-actions"><button class="pl-button" data-action="detail" data-id="'+h(e.id)+'">Gestionar</button></td></tr>';
        }).join('') || '<tr><td colspan="6" class="pl-empty">No hay empresas que coincidan con los filtros.</td></tr>';
        $('pl-result-count').textContent=filtradas.length+' de '+empresas.length+' empresas · Moneda de suscripciones: CLP';
    }
    const casillas = (prefijo,activos) => Object.entries(PERMISOS).map(([valor,label]) =>
        '<label class="pl-check"><input type="checkbox" name="'+prefijo+'" value="'+valor+'"'+(activos.includes(valor) ? ' checked' : '')+'> '+h(label)+'</label>').join('');
    const marcados = scope => [...scope.querySelectorAll('input[type=checkbox]:checked')].map(el => el.value);
    async function cargarColaboradores() {
        const lista=$('pl-team-list');
        const {data:filas,error}=await supa.rpc('plataforma_listar_colaboradores');
        if (!lista) return;
        if (error) { lista.innerHTML='<p class="pl-notice" role="alert">No se pudieron cargar los colaboradores: '+h(error.message)+'</p>'; return; }
        const data=filas || [];
        lista.innerHTML=data.length ? '<div class="pl-table-wrap"><table class="pl-table pl-table-cards"><thead><tr><th>Colaborador</th><th>Permisos</th><th></th></tr></thead><tbody>'+
            data.map(c => '<tr data-id="'+h(c.id)+'"><td data-label="Colaborador"><strong>'+h(c.nombre || c.email)+'</strong><small>'+h(c.email)+(c.empresa ? ' · '+h(c.empresa) : ' · Sin empresa')+'</small></td>'+
                '<td data-label="Permisos"><div class="pl-perms"><span class="pl-badge">Ver empresas</span>'+casillas('pl-perm-'+h(c.id),c.permisos || [])+'</div></td>'+
                '<td class="pl-actions"><button class="pl-button" data-action="team-save" data-id="'+h(c.id)+'">Guardar permisos</button> <button class="pl-button pl-danger" data-action="team-remove" data-id="'+h(c.id)+'" data-name="'+h(c.nombre || c.email)+'">Quitar</button></td></tr>').join('')+
            '</tbody></table></div>' : '<p class="pl-empty">Todavía no tienes colaboradores.</p>';
    }
    async function agregarColaborador(event) {
        event.preventDefault();
        const form=event.currentTarget;
        if (form.dataset.busy) return;
        const email=$('pl-team-email').value.trim(), nombre=$('pl-team-name').value.trim(), permisos=marcados(form);
        form.dataset.busy='true';
        form.querySelectorAll('button').forEach(b => b.disabled=true);
        try {
            const {data,error}=await supa.rpc('plataforma_agregar_colaborador',{p_email:email,p_permisos:permisos});
            if (error) throw error;
            if (data==='sin_cuenta') {
                const r=await supa.functions.invoke('invitar-usuario',{body:{email,nombre,colaborador:true,permisos}});
                if (r.error || r.data?.error) throw new Error(r.data?.error || r.error.message);
                toast('Invitación enviada a '+email,'success');
            } else toast(email+' ahora es colaborador','success');
            form.reset();
            await cargarColaboradores();
        } catch(error) { toast('No se pudo agregar: '+error.message,'error'); }
        finally { delete form.dataset.busy; form.querySelectorAll('button').forEach(b => b.disabled=false); }
    }
    async function accionColaborador(button) {
        const id=button.dataset.id, fila=button.closest('tr');
        const quitar=button.dataset.action==='team-remove';
        if (quitar && !confirm('¿Quitar a '+button.dataset.name+' como colaborador? Perderá el acceso a la administración de la plataforma.')) return;
        button.disabled=true;
        const {error}=quitar
            ? await supa.rpc('plataforma_quitar_colaborador',{p_usuario:id})
            : await supa.rpc('plataforma_permisos_colaborador',{p_usuario:id,p_permisos:marcados(fila)});
        button.disabled=false;
        if (error) return toast('No se pudo guardar: '+error.message,'error');
        toast(quitar ? 'Colaborador quitado' : 'Permisos actualizados','success');
        await cargarColaboradores();
    }
    function tablaPagos(rows) {
        if (!rows.length) return '<p class="pl-empty">Todavía no hay pagos registrados.</p>';
        return '<div class="pl-table-wrap"><table class="pl-table"><thead><tr><th>Pago</th><th>Período cubierto</th><th>Monto</th><th>Referencia</th></tr></thead><tbody>'+
            rows.map(p => '<tr><td>'+fecha(p.fecha_pago)+'</td><td>'+fecha(p.periodo_inicio)+' → '+fecha(p.periodo_fin)+'<small>Fin exclusivo</small></td><td>'+clp(p.monto)+'</td><td>'+h(p.referencia)+(p.origen==='mercadopago' ? '<small>Mercado Pago</small>' : '')+'</td></tr>').join('')+'</tbody></table></div>';
    }
    // Historial en palabras: qué se hizo y quién, en vez del JSON y el identificador.
    const ACCIONES = {acceso:'Acceso',cupo:'Cupo de usuarios',suscripcion:'Suscripción',pago:'Pago registrado',pago_revision:'Pago en revisión',colaborador:'Colaboradores',eliminacion:'Eliminación'};
    function describirMovimiento(x) {
        const d=x.detalle || {}, et=v => (etiquetas[v] || v || '—').toLowerCase();
        if (x.accion==='acceso') return 'De «'+et(d.anterior)+'» a «'+et(d.nuevo)+'»'+(d.motivo ? '. Motivo: '+d.motivo : '');
        if (x.accion==='cupo') return 'De '+d.anterior+' a '+d.nuevo+' usuarios';
        if (x.accion==='suscripcion') return 'Plan «'+(d.plan || '—')+'»'+(d.cortesia ? ' · cuenta de cortesía, sin cobro' : ' · '+clp(d.monto)+' al mes')+' · inicio '+fecha(d.inicio)+(d.cortesia ? '' : ' · '+d.gracia+' días de gracia')+(d.cancelada ? ' · '+(d.cortesia ? 'cortesía cancelada' : 'renovación cancelada') : '');
        if (x.accion==='pago') return clp(d.monto)+' · período '+fecha(d.desde)+' → '+fecha(d.hasta)+(d.origen==='mercadopago' ? ' · Mercado Pago' : ' · transferencia');
        if (x.accion==='pago_revision') return clp(d.monto)+' recibido por Mercado Pago que no coincide con la suscripción vigente. Hay que revisarlo y registrarlo a mano.';
        if (x.accion==='colaborador') return ({agregar:'Se agregó a ',permisos:'Cambio de permisos de ',quitar:'Se quitó a '}[d.cambio] || '')+(d.email || 'un colaborador');
        if (x.accion==='eliminacion') return 'Se eliminó «'+(d.nombre || 'la empresa')+'» con '+(d.presupuestos ?? 0)+' presupuestos, '+(d.proyectos ?? 0)+' proyectos y '+(d.usuarios ?? 0)+' usuarios';
        return Object.entries(d).map(([k,v]) => k+': '+(typeof v==='object' ? JSON.stringify(v) : v)).join(' · ');
    }
    const quienMovio = x => x.actor_nombre ? 'Por '+x.actor_nombre : (x.actor ? 'Por un administrador' : 'Automático (Mercado Pago)');
    const ESTADOS_MP = {creado:'Iniciado',pendiente:'Pendiente',aplicado:'Acreditado',rechazado:'Rechazado',revision:'Requiere revisión'};
    function tablaCobrosMp(rows) {
        if (!rows.length) return '<p class="pl-empty">Sin cobros en línea.</p>';
        return '<div class="pl-table-wrap"><table class="pl-table"><thead><tr><th>Iniciado</th><th>Período</th><th>Monto</th><th>Estado</th><th>Pago MP</th></tr></thead><tbody>'+
            rows.map(c => '<tr><td>'+fecha(c.creado_en)+'</td><td>'+fecha(c.periodo_inicio)+'</td><td>'+clp(c.monto)+'</td><td>'+h(ESTADOS_MP[c.estado] || c.estado)+'</td><td>'+h(c.mp_payment_id || '—')+'</td></tr>').join('')+'</tbody></table></div>';
    }
    async function pagarMercadoPago(button) {
        if (button.dataset.busy) return;
        button.dataset.busy = 'true';
        button.disabled = true;
        button.textContent = 'Conectando con Mercado Pago…';
        try {
            const {data,error} = await supa.functions.invoke('mercadopago',{body:{accion:'crear'}});
            if (error || data?.error || !data?.url) throw new Error(data?.error || error?.message || 'No se pudo iniciar el pago');
            location.href = data.url;
        } catch(error) {
            toast(error.message,'error');
            delete button.dataset.busy;
            button.disabled = false;
            button.textContent = 'Pagar con Mercado Pago';
        }
    }
    // Al volver de Mercado Pago, el webhook puede tardar unos segundos en acreditar el pago.
    function retornoMercadoPago() {
        const params = new URLSearchParams(location.search);
        const estado = params.get('mp');
        if (!estado) return;
        params.delete('mp');
        ['collection_id','collection_status','payment_id','status','external_reference','payment_type','merchant_order_id','preference_id','site_id','processing_mode','merchant_account_id'].forEach(k => params.delete(k));
        history.replaceState(null,'',location.pathname+(params.toString() ? '?'+params : '')+location.hash);
        const mensajes = {aprobado:['Pago recibido. Lo estamos acreditando en tu suscripción…','success'],pendiente:['Tu pago quedó pendiente de confirmación en Mercado Pago.','info'],rechazado:['El pago no se completó. Puedes intentarlo nuevamente.','error']};
        const [texto,tipo] = mensajes[estado] || mensajes.pendiente;
        toast(texto,tipo);
        cambiarModo('empresa');
        mostrarTab('tab-suscripcion');
        if (estado !== 'rechazado') [4000,10000,20000].forEach(ms => setTimeout(() => { if (!$('tab-suscripcion').classList.contains('hidden')) cargarMiSuscripcion(); }, ms));
    }
    async function abrirFicha(id) {
        const token=++consulta;
        seleccion=id;
        const dialog=$('pl-dialog');
        $('pl-detail').innerHTML='<p class="pl-empty">Cargando ficha…</p>';
        if (!dialog.open) dialog.showModal();
        try {
            const [er,sr,pr,hr,cr] = await Promise.all([
                supa.from('empresas').select('id,nombre_comercial,rut,email_contacto,telefono,estado_acceso,acceso_transitorio,limite_usuarios').eq('id',id).single(),
                supa.from('suscripciones').select('*').eq('empresa_id',id).maybeSingle(),
                supa.from('pagos_suscripcion').select('*').eq('empresa_id',id).order('registrado_en',{ascending:false}).limit(100),
                supa.rpc('plataforma_historial_legible',{p_empresa_id:id,p_limite:50}),
                supa.from('cobros_mp').select('*').eq('empresa_id',id).order('creado_en',{ascending:false}).limit(20)
            ]);
            // Sin la actualización de permisos en la base, el historial sale del modo anterior (sin nombres).
            let historial=hr;
            if (hr.error && ['PGRST202','42883'].includes(hr.error.code)) historial=await supa.from('plataforma_historial').select('*').eq('empresa_id',id).order('creado_en',{ascending:false}).limit(50);
            for (const r of [er,sr,pr,historial]) if (r.error) throw r.error;
            const cobros=cr.error ? [] : cr.data;
            const revision=cobros.filter(c => c.estado==='revision').length;
            if (token!==consulta || !dialog.open) return;
            const e=er.data,s=sr.data,r=resumen(e,s),estadoOpciones=estados(e.estado_acceso);
            const pagoId=crypto.randomUUID();
            const desde=s ? fechaCiclo(s.inicio,s.periodos_pagados) : null;
            const hasta=s ? fechaCiclo(s.inicio,s.periodos_pagados+1) : null;
            const fechaBloqueada=s?.periodos_pagados>0 ? ' readonly' : '';
            let pagoForm='<p class="pl-empty">Configura la suscripción para registrar el primer pago.</p>';
            if (s && s.cortesia) pagoForm='<p class="pl-empty">Cuenta de cortesía: no tiene mensualidades que registrar.</p>';
            else if (s && s.cancelada) pagoForm='<p class="pl-empty">Reactiva la suscripción para registrar nuevos pagos.</p>';
            else if (s) pagoForm='<form id="pl-payment-form" class="pl-form" data-payment-id="'+pagoId+'" data-period="'+desde+'"><p class="pl-wide">Período: <strong>'+fecha(desde)+' → '+fecha(hasta)+'</strong> · '+clp(s.monto_mensual)+'<br><small>Verifica la transferencia antes de confirmar. Se registra un mes completo; no cambia un bloqueo administrativo.</small></p>'+
                campo('Referencia única de transferencia','pl-reference','text','','required maxlength="160"')+
                campo('Fecha del pago','pl-payment-date','date',hoyChile(),'required min="2020-01-01" max="'+hoyChile()+'"')+
                '<input type="hidden" id="pl-payment-amount" value="'+s.monto_mensual+'"><button class="pl-button pl-primary" type="submit">Confirmar pago recibido</button></form>';
            const sinPermiso='<p class="pl-empty">No tienes permiso para modificar esta sección.</p>';
            const eliminar=esDueno() && e.id!==empresaActual?.id ? '<section class="pl-section"><h3>Eliminar empresa</h3><p class="pl-footnote">Borra definitivamente la empresa con todos sus presupuestos, órdenes de trabajo, proyectos, archivos, suscripción y pagos. Sus usuarios conservan su cuenta y pueden volver a crear la empresa desde cero. Queda registro en el historial administrativo. <strong>No se puede deshacer.</strong></p><form id="pl-delete-form" class="pl-form">'+campo('Escribe el nombre exacto de la empresa','pl-delete-name','text','','required autocomplete="off"')+'<button class="pl-button pl-danger" type="submit">Eliminar definitivamente</button></form></section>' : '';
            const accesoForm=puede('acceso') ? '<form id="pl-access-form" class="pl-form"><label class="pl-field">Estado de acceso<select id="pl-access">'+estadoOpciones+'</select></label>'+
                campo('Motivo del cambio','pl-reason','text','','required minlength="5" maxlength="500"')+
                '<button class="pl-button" type="submit">Guardar acceso</button></form><p class="pl-footnote">Archivar da de baja la empresa y conserva sus documentos e historial.</p><form id="pl-quota-form" class="pl-inline">'+campo('Cupo de usuarios','pl-quota','number',e.limite_usuarios,'required min="1" max="10000" step="1"')+'<button class="pl-button" type="submit">Guardar cupo</button></form>'
                : '<p>Cupo de usuarios: <strong>'+h(e.limite_usuarios)+'</strong></p>'+sinPermiso;
            const suscripcionForm=puede('suscripciones') ? '<form id="pl-subscription-form" class="pl-form">'+
                campo('Nombre del plan','pl-plan','text',s?.plan_nombre || 'Mensual','required maxlength="80"')+
                '<label class="pl-check pl-wide"><input id="pl-courtesy" type="checkbox"'+(s?.cortesia ? ' checked' : '')+'> Cuenta de cortesía: sin cobro y sin vencimiento (socios, cuentas de regalo, pruebas)</label>'+
                campo('Precio mensual (CLP)','pl-price','number',s?.cortesia ? '' : (s?.monto_mensual || ''),(s?.cortesia ? 'disabled' : 'required')+' min="1" max="2147483647" step="1"')+
                campo('Inicio del ciclo','pl-start','date',s?.inicio || hoyChile(),'required min="2020-01-01"'+fechaBloqueada)+
                campo('Días de gracia','pl-grace','number',s?.dias_gracia ?? 5,'required min="0" max="30" step="1"')+
                '<label class="pl-check"><input id="pl-cancelled" type="checkbox"'+(s?.cancelada ? ' checked' : '')+'> Cancelar renovación (conserva el tiempo pagado; en una cortesía, la deja sin acceso)</label><button class="pl-button pl-primary" type="submit">Guardar suscripción</button></form>'
                : sinPermiso;
            if (!puede('suscripciones')) pagoForm=sinPermiso;
            $('pl-detail').innerHTML='<p class="pl-eyebrow">FICHA DE EMPRESA</p><h2 id="pl-dialog-title">'+h(e.nombre_comercial)+'</h2><p>'+h([e.rut,e.email_contacto,e.telefono].filter(Boolean).join(' · ') || 'Sin contacto registrado')+'</p>'+
                '<div class="pl-status-line">'+badge(e.estado_acceso)+(puede('suscripciones') ? badge(r.estado_pago)+badge(r.operativo ? 'opera' : 'no_opera') : badge('sin_permiso'))+'</div>'+
                (puede('suscripciones') && r.motivo ? '<p class="pl-notice" role="status">Esta empresa <strong>no puede operar</strong>: '+h(r.motivo)+'</p>' : '')+
                '<section class="pl-section"><h3>Acceso y usuarios</h3>'+accesoForm+'</section>'+
                '<section class="pl-section"><h3>Suscripción mensual</h3><p class="pl-footnote">La primera mensualidad vence en la fecha de inicio. El acceso por deuda se restringe al terminar los días de gracia. Los cambios de precio se aplican al siguiente pago que registres. Para no cobrar, usa la cuenta de cortesía en vez de registrar pagos que no existieron.</p>'+suscripcionForm+'</section>'+
                '<section class="pl-section"><h3>Registrar mensualidad</h3>'+pagoForm+'</section>'+
                '<section class="pl-section"><h3>Últimos 100 pagos</h3>'+tablaPagos(pr.data)+'</section>'+
                '<section class="pl-section"><h3>Cobros con Mercado Pago</h3>'+(revision ? '<p class="pl-notice" role="alert">'+revision+' pago(s) aprobados en Mercado Pago no coinciden con la suscripción vigente. Verifícalos y regístralos manualmente si corresponde.</p>' : '')+tablaCobrosMp(cobros)+'</section>'+
                '<section class="pl-section"><h3>Últimos 50 movimientos administrativos</h3><ul class="pl-history">'+((historial.data || []).map(x => '<li><strong>'+h(ACCIONES[x.accion] || x.accion)+'</strong> · '+fecha(x.creado_en)+'<small>'+h(describirMovimiento(x))+'</small><small>'+h(quienMovio(x))+'</small></li>').join('') || '<li class="pl-empty">No hay movimientos que puedas ver.</li>')+'</ul></section>'+eliminar;
            $('pl-delete-form')?.addEventListener('submit',event => accionFormulario(event,'plataforma_eliminar_empresa',{p_empresa_id:id,p_nombre:$('pl-delete-name').value},true));
            $('pl-access-form')?.addEventListener('submit',event => accionFormulario(event,'plataforma_cambiar_acceso',{p_empresa_id:id,p_estado:$('pl-access').value,p_motivo:$('pl-reason').value},true));
            $('pl-quota-form')?.addEventListener('submit',event => accionFormulario(event,'set_limite_usuarios',{p_empresa_id:id,p_limite:Number($('pl-quota').value)}));
            // La cortesía solo viaja cuando está marcada: así una base sin la actualización sigue aceptando el formulario de siempre.
            $('pl-courtesy')?.addEventListener('change',event => { const precio=$('pl-price'); precio.disabled=event.target.checked; precio.required=!event.target.checked; if (event.target.checked) precio.value=''; });
            $('pl-subscription-form')?.addEventListener('submit',event => { const cortesia=$('pl-courtesy').checked; accionFormulario(event,'plataforma_configurar_suscripcion',{p_empresa_id:id,p_plan:$('pl-plan').value,p_monto:cortesia ? 0 : Number($('pl-price').value),p_inicio:$('pl-start').value,p_gracia:Number($('pl-grace').value),p_cancelada:$('pl-cancelled').checked,...(cortesia ? {p_cortesia:true} : {})},true); });
            $('pl-payment-form')?.addEventListener('submit',event => accionFormulario(event,'plataforma_registrar_pago',{p_id:event.currentTarget.dataset.paymentId,p_empresa_id:id,p_periodo_inicio:event.currentTarget.dataset.period,p_monto:Number($('pl-payment-amount').value),p_referencia:$('pl-reference').value,p_fecha_pago:$('pl-payment-date').value},true));
        } catch(error) {
            if (token===consulta) $('pl-detail').innerHTML='<p role="alert">No se pudo cargar la ficha: '+h(error.message)+'</p>';
        }
    }
    async function accionFormulario(event,rpc,args,confirmar=false) {
        event.preventDefault();
        const form=event.currentTarget;
        if (form.dataset.busy) return;
        if (confirmar && !confirm(rpc==='plataforma_registrar_pago' ? '¿Confirmas que verificaste el pago de '+clp(args.p_monto)+' para el período que inicia el '+fecha(args.p_periodo_inicio)+'?' : (rpc==='plataforma_eliminar_empresa' ? '¿Eliminar definitivamente "'+args.p_nombre+'" con TODOS sus presupuestos, órdenes, proyectos y pagos? Esta acción no se puede deshacer.' : '¿Confirmas este cambio? Puede modificar el acceso de la empresa.'))) return;
        form.dataset.busy='true';
        form.querySelectorAll('button').forEach(b => b.disabled=true);
        try {
            const {error}=await supa.rpc(rpc,args);
            if (error) throw error;
            if (rpc==='plataforma_eliminar_empresa') $('pl-dialog').close();
            toast('Cambio guardado','success');
            await cargarAdmin();
            if (empresaActual && args.p_empresa_id===empresaActual.id) await actualizarAcceso();
            if ($('pl-dialog').open && seleccion===args.p_empresa_id) await abrirFicha(args.p_empresa_id);
        } catch(error) { toast('No se pudo guardar: '+error.message,'error'); }
        finally { delete form.dataset.busy; form.querySelectorAll('button').forEach(b => b.disabled=false); }
    }
    async function cargarMiSuscripcion() {
        const root=$('pl-subscription');
        root.innerHTML='<p class="pl-empty" role="status">Cargando tu suscripción…</p>';
        if (!disponible) { root.innerHTML='<p class="pl-empty">La administración de suscripciones todavía no está habilitada.</p>'; return; }
        try {
            await resolverSesion();
            ajustarNavegacion();
            const estado=acceso.estado_pago;
            let detalle='<p>Consulta con el administrador de tu empresa para revisar pagos y condiciones.</p>';
            if (miPerfil.rol==='admin' || miPerfil.es_superadmin) {
                const [sr,pr]=await Promise.all([
                    supa.from('suscripciones').select('*').eq('empresa_id',empresaActual.id).maybeSingle(),
                    supa.from('pagos_suscripcion').select('*').eq('empresa_id',empresaActual.id).order('registrado_en',{ascending:false}).limit(100)
                ]);
                if (sr.error || pr.error) throw sr.error || pr.error;
                const s=sr.data;
                const pagoEnLinea=s && !s.cortesia && !s.cancelada && acceso.estado_acceso==='autorizada' && miPerfil.rol==='admin'
                    ? '<div class="pl-pay"><div><strong>Próxima mensualidad: '+clp(s.monto_mensual)+'</strong><small>Período '+fecha(fechaCiclo(s.inicio,s.periodos_pagados))+' → '+fecha(fechaCiclo(s.inicio,s.periodos_pagados+1))+' · tarjeta de crédito, débito o saldo Mercado Pago. Se acredita automáticamente al aprobarse.</small></div><button class="pl-button pl-primary" data-action="mp-pagar">Pagar con Mercado Pago</button></div>'
                    : '';
                detalle=s?.cortesia ? '<div class="pl-stats"><div class="pl-stat"><strong>'+h(s.plan_nombre)+'</strong><span>Plan actual</span></div><div class="pl-stat"><strong>Sin cobro</strong><span>Cuenta de cortesía</span></div><div class="pl-stat"><strong>Sin vencimiento</strong><span>Mientras la plataforma la mantenga</span></div></div><p class="pl-footnote">Tu empresa tiene una cuenta de cortesía: no hay mensualidades que pagar.</p>' : s ? '<div class="pl-stats"><div class="pl-stat"><strong>'+h(s.plan_nombre)+'</strong><span>Plan actual</span></div><div class="pl-stat"><strong>'+clp(s.monto_mensual)+'</strong><span>Mensualidad</span></div><div class="pl-stat"><strong>'+fecha(acceso.vencimiento)+'</strong><span>Fin del tiempo pagado / próximo vencimiento</span></div></div>'+pagoEnLinea+'<p class="pl-footnote">Plazo de gracia: '+s.dias_gracia+' días. También puedes pagar por transferencia; esos pagos los registra la administración de la plataforma.</p><h3>Historial de pagos</h3>'+tablaPagos(pr.data) :
                    (empresaActual.acceso_transitorio ? '<p>Tu empresa está en transición y aún no tiene un plan asignado. No se aplican vencimientos hasta configurar la suscripción.</p>' : '<p>Tu empresa necesita un plan asignado para comenzar a operar. Contacta con la administración de la plataforma.</p>');
            }
            root.innerHTML='<div class="pl-heading"><div><p class="pl-eyebrow">MI EMPRESA</p><h2>Mi suscripción</h2><p>'+h(empresaActual.nombre_comercial)+'</p></div><button class="pl-button" data-action="subscription-refresh">Actualizar estado</button></div><div class="pl-card pl-padding"><div class="pl-status-line">'+badge(acceso.estado_acceso)+badge(estado)+'</div><p>'+(puedeOperar() ? 'Tu empresa tiene acceso operativo.' : 'Tu empresa no tiene acceso operativo. Revisa el estado de acceso y de suscripción con la administración.')+'</p>'+detalle+'</div>';
        } catch(error) {
            acceso={operativo:false};
            ajustarNavegacion();
            root.innerHTML='<div class="pl-notice" role="alert">'+h(error.message)+' <button class="pl-button" data-action="subscription-refresh">Reintentar</button></div>';
        }
    }
    document.addEventListener('click',event => {
        const button=event.target.closest('[data-action]');
        if (!button || !button.closest('.pl-platform')) return;
        const action=button.dataset.action;
        if (action==='refresh') cargarAdmin();
        if (action==='detail') abrirFicha(button.dataset.id);
        if (action==='subscription-refresh') cargarMiSuscripcion();
        if (action==='mp-pagar') pagarMercadoPago(button);
        if (action==='team-save' || action==='team-remove') accionColaborador(button);
    });
    return {resolverSesion,iniciar,puedeOperar,navegarPermitido,cambiarModo,cargarAdmin,cargarMiSuscripcion,
        get disponible(){return disponible;},
        get modo(){return modo;},
        test:{fechaCiclo,sumarDias,resumen,hoyChile,h}
    };
})();
