/* Administración de plataforma. Los permisos reales se aplican en Supabase. */
const Plataforma = (() => {
    const etiquetas = {
        pendiente: 'Pendiente', autorizada: 'Autorizada', suspendida: 'Suspendida',
        bloqueada: 'Bloqueada', archivada: 'Archivada', sin_configurar: 'Sin configurar',
        programada: 'Programada', al_dia: 'Al día', en_gracia: 'En gracia',
        vencida: 'Vencida', cancelada: 'Cancelada'
    };
    let disponible = false, acceso = null, modo = 'empresa', empresas = [], suscripciones = [], pagos = [];
    let seleccion = null, consulta = 0, timer = null, iniciado = false;
    const $ = id => document.getElementById(id);
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
    function resumen(e,s,hoy=hoyChile()) {
        const estadoAcceso = e.estado_acceso || (e.aprobada ? 'autorizada' : 'pendiente');
        if (!s) return {estado_pago:'sin_configurar',vencimiento:null,operativo:estadoAcceso === 'autorizada' && e.acceso_transitorio === true};
        const vence = fechaCiclo(s.inicio,s.periodos_pagados);
        let estado = 'vencida';
        if (s.cancelada) estado = 'cancelada';
        else if (hoy < s.inicio) estado = 'programada';
        else if (hoy < vence) estado = 'al_dia';
        else if (hoy < sumarDias(vence,s.dias_gracia)) estado = 'en_gracia';
        const operativo = estadoAcceso === 'autorizada' && hoy >= s.inicio &&
            (hoy < vence || (!s.cancelada && hoy < sumarDias(vence,s.dias_gracia)));
        return {estado_pago:estado,vencimiento:vence,operativo};
    }
    const fecha = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—';
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
        if (!supa || !empresaActual) return;
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
        if (tab === 'tab-superadmin') return !!miPerfil?.es_superadmin;
        if (tab === 'tab-suscripcion') return true;
        return !disponible || puedeOperar();
    }
    async function iniciar() {
        $('pl-switch').classList.toggle('hidden',!miPerfil?.es_superadmin);
        $('nav-superadmin').classList.add('hidden');
        $('nav-suscripcion').classList.toggle('hidden', !disponible);
        $('form-empresa').querySelectorAll('input,button,select,textarea').forEach(el => el.disabled = miPerfil?.rol !== 'admin');
        iniciado=true;
        cambiarModo(miPerfil?.es_superadmin ? 'admin' : 'empresa');
        clearInterval(timer);
        if (disponible) timer=setInterval(() => actualizarAcceso().catch(() => {}),60000);
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
    }
    function cambiarModo(nuevo) {
        if (nuevo === 'admin' && !miPerfil?.es_superadmin) return;
        modo=nuevo;
        ajustarNavegacion();
        mostrarTab(modo === 'admin' ? 'tab-superadmin' : (puedeOperar() || !disponible ? 'tab-nuevo' : 'tab-suscripcion'));
    }
    async function cargarAdmin() {
        if (!miPerfil?.es_superadmin) return;
        const root=$('pl-admin');
        root.innerHTML='<p class="pl-empty" role="status">Cargando empresas…</p>';
        if (!disponible) {
            root.innerHTML='<div class="pl-notice"><h2>Actualización de base de datos pendiente</h2><p>La administración de suscripciones estará disponible cuando se aplique la migración de plataforma. Las empresas existentes mantienen su funcionamiento.</p></div>';
            return;
        }
        try {
            [empresas,suscripciones,pagos]=await Promise.all([filas('empresas','id,nombre_comercial,rut,email_contacto,telefono,estado_acceso,aprobada,acceso_transitorio,limite_usuarios,creado_en,perfiles(count)'),filas('suscripciones'),filas('pagos_suscripcion')]);
            const mes=hoyChile().slice(0,7);
            const recibidos=pagos.filter(p => p.fecha_pago.startsWith(mes)).reduce((sum,p) => sum+p.monto,0);
            const activas=empresas.filter(e => resumen(e,suscripciones.find(s => s.empresa_id===e.id)).operativo).length;
            const vencidas=empresas.filter(e => resumen(e,suscripciones.find(s => s.empresa_id===e.id)).estado_pago === 'vencida').length;
            root.innerHTML='<div class="pl-heading"><div><p class="pl-eyebrow">ADMINISTRACIÓN DE PLATAFORMA</p><h2>Empresas y suscripciones</h2><p>Controla el acceso, los cupos y los pagos mensuales desde un solo lugar.</p></div><button class="pl-button" data-action="refresh">Actualizar</button></div>' +
                '<div class="pl-stats">' + [[empresas.length,'Empresas registradas'],[activas,'Con acceso operativo'],[vencidas,'Suscripciones vencidas'],[clp(recibidos),'Pagos recibidos este mes']].map(([n,label]) => '<div class="pl-stat"><strong>'+h(n)+'</strong><span>'+label+'</span></div>').join('') + '</div>' +
                '<div class="pl-card"><div class="pl-filters"><label class="pl-field">Buscar empresa<input id="pl-search" type="search" placeholder="Nombre, RUT o correo"></label><label class="pl-field">Acceso<select id="pl-filter-access"><option value="">Todos</option>'+estados('')+'</select></label><label class="pl-field">Suscripción<select id="pl-filter-pay"><option value="">Todas</option>'+['sin_configurar','programada','al_dia','en_gracia','vencida','cancelada'].map(s => opcion(s,etiquetas[s],false)).join('')+'</select></label></div><div class="pl-table-wrap"><table class="pl-table"><thead><tr><th>Empresa</th><th>Acceso</th><th>Suscripción</th><th>Usuarios</th><th>Vencimiento</th><th></th></tr></thead><tbody id="pl-companies"></tbody></table></div><p id="pl-result-count" class="pl-footnote" aria-live="polite"></p></div>';
            ['pl-search','pl-filter-access','pl-filter-pay'].forEach(id => $(id).addEventListener('input',renderEmpresas));
            renderEmpresas();
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
                (!accessFilter || e.estado_acceso===accessFilter) && (!payFilter || r.estado_pago===payFilter);
        });
        $('pl-companies').innerHTML=filtradas.map(e => {
            const s=suscripciones.find(s => s.empresa_id===e.id), r=resumen(e,s);
            const nombre=h(e.nombre_comercial), contacto=h(e.rut || e.email_contacto || 'Sin datos de contacto');
            const accesoBadge=badge(e.estado_acceso), pagoBadge=badge(r.estado_pago);
            const plan=h(s?.plan_nombre || (e.acceso_transitorio ? 'Transición sin cobro' : 'Requiere un plan')), usados=e.perfiles?.[0]?.count ?? 0;
            return '<tr><td><strong>'+nombre+'</strong><small>'+contacto+'</small></td><td>'+accesoBadge+'</td><td>'+pagoBadge+'<small>'+plan+'</small></td><td>'+usados+' / '+e.limite_usuarios+'</td><td>'+fecha(r.vencimiento)+'</td><td><button class="pl-button" data-action="detail" data-id="'+h(e.id)+'">Gestionar</button></td></tr>';
        }).join('') || '<tr><td colspan="6" class="pl-empty">No hay empresas que coincidan con los filtros.</td></tr>';
        $('pl-result-count').textContent=filtradas.length+' de '+empresas.length+' empresas · Moneda de suscripciones: CLP';
    }
    function tablaPagos(rows) {
        if (!rows.length) return '<p class="pl-empty">Todavía no hay pagos registrados.</p>';
        return '<div class="pl-table-wrap"><table class="pl-table"><thead><tr><th>Pago</th><th>Período cubierto</th><th>Monto</th><th>Referencia</th></tr></thead><tbody>'+
            rows.map(p => '<tr><td>'+fecha(p.fecha_pago)+'</td><td>'+fecha(p.periodo_inicio)+' → '+fecha(p.periodo_fin)+'<small>Fin exclusivo</small></td><td>'+clp(p.monto)+'</td><td>'+h(p.referencia)+'</td></tr>').join('')+'</tbody></table></div>';
    }
    async function abrirFicha(id) {
        const token=++consulta;
        seleccion=id;
        const dialog=$('pl-dialog');
        $('pl-detail').innerHTML='<p class="pl-empty">Cargando ficha…</p>';
        if (!dialog.open) dialog.showModal();
        try {
            const [er,sr,pr,hr] = await Promise.all([
                supa.from('empresas').select('id,nombre_comercial,rut,email_contacto,telefono,estado_acceso,acceso_transitorio,limite_usuarios').eq('id',id).single(),
                supa.from('suscripciones').select('*').eq('empresa_id',id).maybeSingle(),
                supa.from('pagos_suscripcion').select('*').eq('empresa_id',id).order('registrado_en',{ascending:false}).limit(100),
                supa.from('plataforma_historial').select('*').eq('empresa_id',id).order('creado_en',{ascending:false}).limit(50)
            ]);
            for (const r of [er,sr,pr,hr]) if (r.error) throw r.error;
            if (token!==consulta || !dialog.open) return;
            const e=er.data,s=sr.data,r=resumen(e,s),estadoOpciones=estados(e.estado_acceso);
            const pagoId=crypto.randomUUID();
            const desde=s ? fechaCiclo(s.inicio,s.periodos_pagados) : null;
            const hasta=s ? fechaCiclo(s.inicio,s.periodos_pagados+1) : null;
            const fechaBloqueada=s?.periodos_pagados>0 ? ' readonly' : '';
            let pagoForm='<p class="pl-empty">Configura la suscripción para registrar el primer pago.</p>';
            if (s && s.cancelada) pagoForm='<p class="pl-empty">Reactiva la suscripción para registrar nuevos pagos.</p>';
            else if (s) pagoForm='<form id="pl-payment-form" class="pl-form" data-payment-id="'+pagoId+'" data-period="'+desde+'"><p class="pl-wide">Período: <strong>'+fecha(desde)+' → '+fecha(hasta)+'</strong> · '+clp(s.monto_mensual)+'<br><small>Verifica la transferencia antes de confirmar. Se registra un mes completo; no cambia un bloqueo administrativo.</small></p>'+
                campo('Referencia única de transferencia','pl-reference','text','','required maxlength="160"')+
                campo('Fecha del pago','pl-payment-date','date',hoyChile(),'required min="2020-01-01" max="'+hoyChile()+'"')+
                '<input type="hidden" id="pl-payment-amount" value="'+s.monto_mensual+'"><button class="pl-button pl-primary" type="submit">Confirmar pago recibido</button></form>';
            const eliminar=e.estado_acceso==='archivada' ? '<section class="pl-section"><h3>Eliminar empresa sin actividad</h3><p class="pl-footnote">Solo se permite si no tiene presupuestos, órdenes ni pagos. Se eliminan sus perfiles de empresa; se conserva el historial administrativo y las cuentas de acceso.</p><form id="pl-delete-form" class="pl-form">'+campo('Escribe el nombre exacto de la empresa','pl-delete-name','text','','required')+'<button class="pl-button pl-danger" type="submit">Eliminar definitivamente</button></form></section>' : '';
            $('pl-detail').innerHTML='<p class="pl-eyebrow">FICHA DE EMPRESA</p><h2 id="pl-dialog-title">'+h(e.nombre_comercial)+'</h2><p>'+h([e.rut,e.email_contacto,e.telefono].filter(Boolean).join(' · ') || 'Sin contacto registrado')+'</p>'+
                '<div class="pl-status-line">'+badge(e.estado_acceso)+badge(r.estado_pago)+'</div>'+
                '<section class="pl-section"><h3>Acceso y usuarios</h3><form id="pl-access-form" class="pl-form"><label class="pl-field">Estado de acceso<select id="pl-access">'+estadoOpciones+'</select></label>'+
                campo('Motivo del cambio','pl-reason','text','','required minlength="5" maxlength="500"')+
                '<button class="pl-button" type="submit">Guardar acceso</button></form><p class="pl-footnote">Archivar da de baja la empresa y conserva sus documentos e historial.</p><form id="pl-quota-form" class="pl-inline">'+campo('Cupo de usuarios','pl-quota','number',e.limite_usuarios,'required min="1" max="10000" step="1"')+'<button class="pl-button" type="submit">Guardar cupo</button></form></section>'+
                '<section class="pl-section"><h3>Suscripción mensual</h3><p class="pl-footnote">La primera mensualidad vence en la fecha de inicio. El acceso por deuda se restringe al terminar los días de gracia. Los cambios de precio se aplican al siguiente pago que registres.</p><form id="pl-subscription-form" class="pl-form">'+
                campo('Nombre del plan','pl-plan','text',s?.plan_nombre || 'Mensual','required maxlength="80"')+
                campo('Precio mensual (CLP)','pl-price','number',s?.monto_mensual || '','required min="1" max="2147483647" step="1"')+
                campo('Inicio del ciclo','pl-start','date',s?.inicio || hoyChile(),'required min="2020-01-01"'+fechaBloqueada)+
                campo('Días de gracia','pl-grace','number',s?.dias_gracia ?? 5,'required min="0" max="30" step="1"')+
                '<label class="pl-check"><input id="pl-cancelled" type="checkbox"'+(s?.cancelada ? ' checked' : '')+'> Cancelar renovación (conserva el tiempo pagado)</label><button class="pl-button pl-primary" type="submit">Guardar suscripción</button></form></section>'+
                '<section class="pl-section"><h3>Registrar mensualidad</h3>'+pagoForm+'</section>'+
                '<section class="pl-section"><h3>Últimos 100 pagos</h3>'+tablaPagos(pr.data)+'</section>'+
                '<section class="pl-section"><h3>Últimos 50 movimientos administrativos</h3><ul class="pl-history">'+hr.data.map(x => '<li><strong>'+h(x.accion)+'</strong> · '+fecha(x.creado_en)+'<small>'+h(JSON.stringify(x.detalle))+'</small><small>Administrador: '+h(x.actor)+'</small></li>').join('')+'</ul></section>'+eliminar;
            $('pl-delete-form')?.addEventListener('submit',event => accionFormulario(event,'plataforma_eliminar_empresa',{p_empresa_id:id,p_nombre:$('pl-delete-name').value},true));
            $('pl-access-form').addEventListener('submit',event => accionFormulario(event,'plataforma_cambiar_acceso',{p_empresa_id:id,p_estado:$('pl-access').value,p_motivo:$('pl-reason').value},true));
            $('pl-quota-form').addEventListener('submit',event => accionFormulario(event,'set_limite_usuarios',{p_empresa_id:id,p_limite:Number($('pl-quota').value)}));
            $('pl-subscription-form').addEventListener('submit',event => accionFormulario(event,'plataforma_configurar_suscripcion',{p_empresa_id:id,p_plan:$('pl-plan').value,p_monto:Number($('pl-price').value),p_inicio:$('pl-start').value,p_gracia:Number($('pl-grace').value),p_cancelada:$('pl-cancelled').checked},true));
            $('pl-payment-form')?.addEventListener('submit',event => accionFormulario(event,'plataforma_registrar_pago',{p_id:event.currentTarget.dataset.paymentId,p_empresa_id:id,p_periodo_inicio:event.currentTarget.dataset.period,p_monto:Number($('pl-payment-amount').value),p_referencia:$('pl-reference').value,p_fecha_pago:$('pl-payment-date').value},true));
        } catch(error) {
            if (token===consulta) $('pl-detail').innerHTML='<p role="alert">No se pudo cargar la ficha: '+h(error.message)+'</p>';
        }
    }
    async function accionFormulario(event,rpc,args,confirmar=false) {
        event.preventDefault();
        const form=event.currentTarget;
        if (form.dataset.busy) return;
        if (confirmar && !confirm(rpc==='plataforma_registrar_pago' ? '¿Confirmas que verificaste el pago de '+clp(args.p_monto)+' para el período que inicia el '+fecha(args.p_periodo_inicio)+'?' : (rpc==='plataforma_eliminar_empresa' ? '¿Eliminar definitivamente esta empresa sin actividad? Esta acción no se puede deshacer.' : '¿Confirmas este cambio? Puede modificar el acceso de la empresa.'))) return;
        form.dataset.busy='true';
        form.querySelectorAll('button').forEach(b => b.disabled=true);
        try {
            const {error}=await supa.rpc(rpc,args);
            if (error) throw error;
            if (rpc==='plataforma_eliminar_empresa') $('pl-dialog').close();
            toast('Cambio guardado','success');
            await cargarAdmin();
            if (args.p_empresa_id===empresaActual.id) await actualizarAcceso();
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
                detalle=s ? '<div class="pl-stats"><div class="pl-stat"><strong>'+h(s.plan_nombre)+'</strong><span>Plan actual</span></div><div class="pl-stat"><strong>'+clp(s.monto_mensual)+'</strong><span>Mensualidad</span></div><div class="pl-stat"><strong>'+fecha(acceso.vencimiento)+'</strong><span>Fin del tiempo pagado / próximo vencimiento</span></div></div><p class="pl-footnote">Plazo de gracia: '+s.dias_gracia+' días. Los pagos se verifican y registran manualmente por la administración de la plataforma. Comunícate por el canal con el que contrataste el servicio.</p><h3>Historial de pagos</h3>'+tablaPagos(pr.data) :
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
    });
    return {resolverSesion,iniciar,puedeOperar,navegarPermitido,cambiarModo,cargarAdmin,cargarMiSuscripcion,
        get disponible(){return disponible;},
        test:{fechaCiclo,sumarDias,resumen,hoyChile,h}
    };
})();
