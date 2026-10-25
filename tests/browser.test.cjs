const {chromium}=require('playwright');
const ExcelJS=require('exceljs');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
process.chdir(path.resolve(__dirname,'..'));

// Supabase simulado: tablas en memoria, RPC de plataforma y Storage.
function mock(opts){
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',u='11111111-1111-4111-8111-111111111111';
 const tables={
  empresas:[{id:a,nombre_comercial:'Constructora PHH',razon_social:'CONSTRUCTORA E INSTALACIONES PHH SPA',rut:'77234145-8',aprobada:true,acceso_transitorio:true,estado_acceso:'autorizada',limite_usuarios:3,perfiles:[{count:1}]},
   {id:b,nombre_comercial:'Empresa de prueba <segura>',email_contacto:'cliente@example.test',aprobada:true,acceso_transitorio:true,estado_acceso:'autorizada',limite_usuarios:2,perfiles:[{count:1}]}],
  perfiles:[opts.perfil||{id:u,empresa_id:a,rol:'admin',es_superadmin:true,nombre:'Administrador'}],
  presupuestos:opts.presupuestos.map(p=>({id:p.id,empresa_id:a,data:p})),
  suscripciones:(opts.suscripciones||[]).map(s=>({empresa_id:a,...s})),pagos_suscripcion:[],plataforma_historial:[],cobros_mp:[],proyectos:opts.proyectos||[],proyecto_edps:[],proyecto_gastos:[],proyecto_ingresos:[],proyecto_informes:[],ordenes_compra:[]
 };
 window.fixture={tables,colaboradores:[],calls:[],uploads:[],state:{estado_acceso:'autorizada',estado_pago:'sin_configurar',operativo:true,vencimiento:null}};
 const hoy=()=>new Date().toISOString().slice(0,10);
 function alta(table,r){
  const base={id:crypto.randomUUID(),creado_en:new Date().toISOString(),...r};
  if(table==='proyecto_edps')Object.assign(base,{numero:tables.proyecto_edps.filter(e=>e.proyecto_id===r.proyecto_id).length+1,estado:'borrador'});
  if(table==='proyecto_gastos'||table==='proyecto_ingresos')Object.assign(base,{estado:'pendiente',registrado_por:u});
  if(table==='proyecto_informes')base.registrado_por=u;
  if(table==='proyectos')base.estado='activo';
  return base;
 }
 function query(table) {
  let filters=[],single=false,range=null,limit=null,mutation=null,nuevos=null,borrar=false;
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},range(a,b){range=[a,b];return q;},limit(n){limit=n;return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},
   update(v){mutation=v;return q;},upsert(){return q;},insert(v){nuevos=(Array.isArray(v)?v:[v]).map(r=>alta(table,r));return q;},delete(){borrar=true;return q;},
   then(resolve,reject){
    let rows;
    if(nuevos){tables[table].push(...nuevos);rows=nuevos;}
    else{
     rows=tables[table].filter(r=>filters.every(([k,v])=>r[k]===v));
     if(mutation)rows.forEach(r=>{Object.assign(r,mutation);if(table==='proyecto_edps'&&r.estado==='presentado'&&!r.fecha_presentacion)r.fecha_presentacion=hoy();});
     if(borrar)tables[table]=tables[table].filter(r=>!rows.includes(r));
    }
    if(range)rows=rows.slice(range[0],range[1]+1);
    if(limit)rows=rows.slice(0,limit);
    return Promise.resolve({data:structuredClone(single?rows[0]||null:rows),error:null}).then(resolve,reject);
   }};
  return q;
 }
 window.mockClient={auth:{getSession:async()=>({data:{session:{user:{id:u},access_token:'fixture'}}}),onAuthStateChange(){},signOut:async()=>{}},
  from:query,
  functions:{invoke:async(name,o)=>{window.fixture.calls.push({name,args:o?.body});if(name==='leer-boleta')return {data:{datos:{legible:true,tipo_doc:'factura',numero_doc:'48213',fecha:'2026-10-20',proveedor:'Sodimac S.A.',rut_proveedor:'96.792.430-K',monto_total:45990,descripcion:'Pasta muro y lijas',categoria:'materiales',subcategoria:'Pintura',observacion:null}},error:null};
   return name==='mercadopago'?{data:{url:location.origin+'/?mp=aprobado&payment_id=1&status=approved'},error:null}:{data:null,error:null};}},
  storage:{from:()=>({upload:async(p)=>{window.fixture.uploads.push(p);return{error:null};},createSignedUrls:async ps=>({data:ps.map(p=>({path:p,signedUrl:'about:blank'})),error:null}),download:async()=>({data:new Blob(['x'],{type:'image/jpeg'}),error:null}),createSignedUrl:async()=>({data:{signedUrl:'about:blank'},error:null}),remove:async()=>({error:null})})},
  async rpc(name,args) {
   window.fixture.calls.push({name,args});
   if(name==='estado_servicio')return {data:structuredClone(window.fixture.state),error:null};
   if(name==='plataforma_listar_colaboradores')return {data:structuredClone(window.fixture.colaboradores),error:null};
   if(name==='plataforma_agregar_colaborador'){window.fixture.colaboradores.push({id:crypto.randomUUID(),email:args.p_email,nombre:null,empresa:null,permisos:args.p_permisos});return {data:'agregado',error:null};}
   if(name==='plataforma_permisos_colaborador')window.fixture.colaboradores.find(c=>c.id===args.p_usuario).permisos=args.p_permisos;
   if(name==='plataforma_configurar_suscripcion'){
    let s=tables.suscripciones.find(s=>s.empresa_id===args.p_empresa_id);
    if(!s){s={empresa_id:args.p_empresa_id,periodos_pagados:0};tables.suscripciones.push(s);}
    Object.assign(s,{inicio:args.p_inicio,plan_nombre:args.p_plan,monto_mensual:args.p_monto,dias_gracia:args.p_gracia,cancelada:args.p_cancelada});
   }
   if(name==='plataforma_cambiar_acceso'){
    const e=tables.empresas.find(e=>e.id===args.p_empresa_id);
    e.estado_acceso=args.p_estado;e.aprobada=args.p_estado==='autorizada';
   }
   if(name==='plataforma_registrar_pago'){
    const s=tables.suscripciones.find(s=>s.empresa_id===args.p_empresa_id);
    s.periodos_pagados++;
    tables.pagos_suscripcion.push({id:args.p_id,empresa_id:args.p_empresa_id,periodo_inicio:args.p_periodo_inicio,periodo_fin:args.p_periodo_inicio,monto:args.p_monto,referencia:args.p_referencia,fecha_pago:args.p_fecha_pago});
   }
   return {data:null,error:null};
  }};
}

const presupuesto={id:'pre-1',numero:'PRE-101',fecha:'2026-09-01',estado:'adjudicado',fechaAdjudicacion:'2026-09-10',moneda:'CLP',decimales:0,usarGGUtil:false,ggPct:0,utilPct:0,firma:null,
 cliente:{nombre:'Inmobiliaria Las Dalias',rut:'',telefono:'',direccion:'Las Dalias 225',region:'Libertador Bernardo O’Higgins',comuna:'Requínoa'},
 capitulos:[{id:'c1',numero:'1.0',nombre:'Remates de yeso',items:[
  {id:'a',numero:'1.1',codigo:'',descripcion:'DPTO TIPO A',unidad:'DPTO',cantidad:8,precioUnit:422500,total:3380000},
  {id:'b',numero:'1.2',codigo:'',descripcion:'DPTO TIPO B',unidad:'DPTO',cantidad:8,precioUnit:455000,total:3640000}]}],
 ordenesTrabajo:[{id:'ot1',numero:'OT-101-01',fecha:'2026-09-11',estado:'firmada',firma:null}]};

(async()=>{
const root=process.cwd();
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  // Las librerías externas se reemplazan por dobles de prueba: se quita la verificación de integridad solo aquí.
  res.end(file.endsWith('.html')?data.toString().replace(/ integrity="[^"]*" crossorigin="anonymous"/g,''):data);});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const excelJs=fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'),'utf8');
let browser;
try {
 const options={headless:true};
 const chrome=process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
 if(fs.existsSync(chrome)) options.executablePath=chrome;
 browser=await chromium.launch(options);
 async function abrirPagina(presupuestos,suscripciones=[],perfil=null,extra={}){
  const page=await browser.newPage({viewport:extra.viewport||{width:1440,height:1000},acceptDownloads:true});
  page.errores=[];
  page.on('pageerror',e=>page.errores.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route('**/cdn.jsdelivr.net/**',route=>{
   const u=route.request().url();
   route.fulfill({contentType:'text/javascript',body:u.includes('supabase')?'window.supabase={createClient:()=>window.mockClient};':u.includes('exceljs')?excelJs:''});
  });
  await page.addInitScript(mock,{presupuestos,suscripciones,perfil,proyectos:extra.proyectos});
  await page.goto(url+(extra.ruta||''),{waitUntil:'networkidle'});
  return page;
 }
 fs.mkdirSync('tests/artifacts',{recursive:true});

 // ── Plataforma ──
 const page=await abrirPagina([]);
 await page.locator('#pl-companies tr').first().waitFor();
 assert.equal(await page.locator('#pl-companies tr').count(),2);
 assert.equal(await page.locator('#company-nav').isVisible(),false);
 // Colaboradores: el dueño agrega y edita permisos.
 await page.locator('#pl-team-email').fill('colab@example.test');
 await page.locator('#pl-team-form input[value="suscripciones"]').check();
 await page.locator('#pl-team-form button').click();
 await page.locator('#pl-team-list [data-action="team-save"]').waitFor();
 assert.deepEqual(await page.evaluate(()=>window.fixture.colaboradores[0].permisos),['suscripciones']);
 await page.locator('#pl-team-list input[value="acceso"]').check();
 await page.locator('#pl-team-list [data-action="team-save"]').click();
 await page.waitForFunction(()=>window.fixture.colaboradores[0].permisos.length===2);
 await page.locator('#pl-search').fill('segura');
 assert.equal(await page.locator('#pl-companies tr').count(),1);
 await page.locator('[data-action="detail"]').click();
 await page.locator('#pl-plan').waitFor();
 await page.locator('#pl-price').fill('20000');
 await page.locator('#pl-subscription-form button').click();
 await page.locator('#pl-payment-form').waitFor();
 await page.locator('#pl-reference').fill('BANCO-001');
 await page.locator('#pl-payment-form button').click();
 await page.waitForFunction(()=>window.fixture.tables.pagos_suscripcion.length===1);
 await page.waitForFunction(()=>!document.querySelector('#pl-payment-form')?.dataset.busy && !!document.querySelector('#pl-payment-form'));
 await page.locator('#pl-access').selectOption('bloqueada');
 await page.locator('#pl-reason').fill('Bloqueo de prueba');
 await page.locator('#pl-access-form button').click();
 await page.waitForFunction(()=>window.fixture.tables.empresas[1].estado_acceso==='bloqueada');
 await page.locator('.pl-dialog-close').click();
 await page.locator('#pl-mode-empresa').click();
 assert.equal(await page.locator('#company-nav').isVisible(),true);
 await page.locator('#nav-suscripcion').click();
 await page.getByText('Tu empresa está en transición', {exact:false}).waitFor();
 await page.evaluate(()=>{window.fixture.state={estado_acceso:'suspendida',estado_pago:'vencida',operativo:false};});
 await page.locator('[data-action="subscription-refresh"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-tab="tab-nuevo"]').disabled);
 assert.equal(await page.locator('[data-tab="tab-proyectos"]').isDisabled(),true);
 await page.locator('#pl-mode-admin').click();
 await page.locator('#pl-companies').waitFor();
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('tab-superadmin')).opacity==='1');
 await page.evaluate(()=>{document.getElementById('toast').style.display='none';});
 await page.screenshot({path:'tests/artifacts/platform-desktop.png',fullPage:true,animations:"disabled"});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'tests/artifacts/platform-mobile.png',fullPage:true,animations:"disabled"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desbordamiento horizontal en móvil');
 await page.evaluate(()=>{miPerfil.es_superadmin=false;Plataforma.cambiarModo('empresa');});
 assert.equal(await page.evaluate(()=>Plataforma.navegarPermitido('tab-superadmin')),false);
 assert.deepEqual(page.errores,[]);
 await page.close();

 // ── Colaborador sin empresa: solo el panel, con formularios según sus permisos ──
 const pc=await abrirPagina([],[],{id:'11111111-1111-4111-8111-111111111111',empresa_id:null,rol:'miembro',es_superadmin:false,colaborador_plataforma:true,permisos_plataforma:['suscripciones']});
 await pc.locator('#pl-companies tr').first().waitFor();
 assert.equal(await pc.locator('#pl-switch').isVisible(),false);
 assert.equal(await pc.locator('#company-nav').isVisible(),false);
 assert.equal(await pc.locator('#pl-team-form').count(),0);
 await pc.locator('.pl-mine').getByText('Suscripciones y pagos').waitFor();
 await pc.locator('[data-action="detail"]').last().click();
 await pc.locator('#pl-subscription-form').waitFor();
 assert.equal(await pc.locator('#pl-access-form').count(),0);
 assert.equal(await pc.locator('#pl-delete-form').count(),0);
 assert.equal(await pc.evaluate(()=>Plataforma.navegarPermitido('tab-nuevo')),false);
 assert.deepEqual(pc.errores,[]);
 await pc.close();

 // ── Ejecución de proyecto ──
 const pp=await abrirPagina([presupuesto]);
 await pp.locator('#pl-mode-empresa').click();
 await pp.locator('[data-tab="tab-adjudicados"]').click();
 // Aprobación sin firma con la OC del cliente
 await pp.getByRole('button',{name:'📄 Aprobado con OC del cliente (sin firma)'}).click();
 await pp.locator('#aprob-oc-numero').fill('OC-CLI-778');
 await pp.locator('#aprob-oc-fecha').fill('2026-09-12');
 await pp.getByRole('button',{name:'Registrar aprobación'}).click();
 await pp.getByText('✔ Aprobado con OC del cliente N° OC-CLI-778').waitFor();
 assert.equal(await pp.getByRole('button',{name:'Firmar aquí'}).count(),0);
 assert.deepEqual(await pp.evaluate(()=>{const a=presupuestos.find(x=>x.id==='pre-1').aprobacionCliente;return [a.tipo,a.numeroOC,a.fecha,a.adjuntoPath];}),['orden_compra','OC-CLI-778','2026-09-12',null]);
 // La OT nueva también se aprueba con la OC (viene precargada desde el contrato)
 await pp.evaluate(()=>generarOrdenTrabajo('pre-1'));
 await pp.locator('[data-tab="tab-ot"]').click();
 await pp.getByRole('button',{name:'📄 Aprobada con OC'}).click();
 assert.equal(await pp.locator('#aprob-oc-numero').inputValue(),'OC-CLI-778');
 await pp.getByRole('button',{name:'Registrar aprobación'}).click();
 await pp.locator('#ot-tbody').getByText('Aprobada con OC').waitFor();
 assert.deepEqual(await pp.evaluate(()=>{const ot=presupuestos.find(x=>x.id==='pre-1').ordenesTrabajo.at(-1);return [ot.estado,ot.aprobacionCliente.numeroOC];}),['firmada','OC-CLI-778']);
 assert.equal(await pp.locator('#ot-tbody').getByRole('button',{name:'Firmar',exact:true}).count(),0);
 await pp.locator('[data-tab="tab-adjudicados"]').click();
 await pp.getByRole('button',{name:'Pasar a ejecución (centro de costo)'}).click();
 await pp.getByText('Gastos vs costo directo presupuestado').waitFor();
 assert.equal(await pp.evaluate(()=>window.fixture.tables.proyectos.length),1);
 await pp.getByRole('button',{name:'Estados de pago',exact:true}).click();
 await pp.getByRole('button',{name:'+ Nuevo estado de pago'}).click();
 await pp.locator('input[data-item="a"][data-modo="cant"]').fill('2');
 await pp.locator('input[data-item="b"][data-modo="pct"]').fill('25');
 await pp.locator('#pr-edp-resumen').getByText('$ 1.984.028').waitFor();
 assert.equal(await pp.locator('input[data-item="b"][data-modo="cant"]').inputValue(),'2');
 // Descuento del mandante: se refleja en el resumen y se puede volver a cero
 await pp.locator('#pr-edp-desc').fill('100.000');
 await pp.locator('#pr-edp-desc-motivo').fill('Multa por atraso');
 await pp.locator('#pr-edp-resumen').getByText('Multa por atraso').waitFor();
 await pp.locator('#pr-edp-resumen').getByText('$ 1.865.028').waitFor();
 await pp.locator('#pr-edp-desc').fill('');
 await pp.locator('#pr-edp-resumen').getByText('$ 1.984.028').waitFor();
 await pp.locator('#pr-edp-oc').fill('OC-5521');
 await pp.getByRole('button',{name:'Presentar al mandante'}).click();
 await pp.waitForFunction(()=>window.fixture.tables.proyecto_edps[0]?.estado==='presentado');
 const ep=await pp.evaluate(()=>window.fixture.tables.proyecto_edps[0]);
 assert.equal(ep.totales.aPagar,1984028);
 assert.equal(ep.oc_numero,'OC-5521');
 await pp.getByRole('button',{name:'Aprobado por el mandante'}).click();
 await pp.locator('#pr-fac-numero').waitFor();
 await pp.locator('#pr-fac-numero').fill('F-1234');
 const atrasada=new Date(Date.now()-10*864e5).toISOString().slice(0,10);
 await pp.locator('#pr-fac-estimada').fill(atrasada);
 await pp.getByRole('button',{name:'Guardar facturación'}).click();
 await pp.getByText(/días de atraso/).first().waitFor();
 assert.equal(await pp.locator('#badge-proyectos').textContent(),'1');
 const [descarga]=await Promise.all([pp.waitForEvent('download'),pp.getByRole('button',{name:'Excel',exact:true}).click()]);
 const xlsx='tests/artifacts/estado-de-pago.xlsx';
 await descarga.saveAs(xlsx);
 const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsx);
 const ws=wb.worksheets[0];
 assert.equal(ws.name,'EEPP N°1');
 assert.equal(ws.getCell('M2').value,'01');
 const celdas=[];ws.eachRow(r=>r.eachCell(c=>celdas.push(c)));
 const aPagar=celdas.find(c=>c.value==='A Pagar $');
 assert.equal(ws.getCell('M'+aPagar.row).value.result,1984028);
 assert.ok(celdas.some(c=>c.value?.formula?.startsWith('IF(AND(F')),'Faltan fórmulas de avance');
 assert.ok(celdas.some(c=>c.value==='F-1234'),'Falta la factura en el historial');
 assert.ok(celdas.some(c=>c.value==='VºBº Gerente General')&&!celdas.some(c=>c.value==='VºBº Gerencia de proyecto'),'El Excel no debe traer la firma de gerencia de proyecto por defecto');
 // PDF del EP: título con N° correlativo y hoja tan ancha como el contenido (nada cortado)
 const pdf=await pp.evaluate(async()=>{
  let opciones,ancho,texto,desborde;
  const lienzo=document.createElement('canvas');lienzo.width=20;lienzo.height=20;
  window.html2pdf=()=>{const api={set(o){opciones=o;return api;},from(el){ancho=el.getBoundingClientRect().width;texto=el.innerText;desborde=[...el.querySelectorAll('*')].some(x=>x.getBoundingClientRect().right>el.getBoundingClientRect().right+1);return api;},
   toCanvas(){return api;},get:async()=>lienzo,toPdf(){return api;},output:async()=>new Blob(['%PDF-1.4'],{type:'application/pdf'})};return api;};
  Proyectos.exportarPDF(window.fixture.tables.proyecto_edps[0].id);
  await new Promise(r=>setTimeout(r,100));
  return {formato:opciones.jsPDF.format,orientacion:opciones.jsPDF.orientation,ancho,texto,desborde};
 });
 assert.match(pdf.texto,/ESTADO DE PAGO Nº 01/);
 assert.match(pdf.texto,/Correlativo Nº 1 de 1 del proyecto/);
 // Por defecto solo firman el cliente y el gerente general
 assert.match(pdf.texto,/VºBº Cliente/);
 assert.match(pdf.texto,/VºBº Gerente General/);
 assert.doesNotMatch(pdf.texto,/Gerencia de proyecto/);
 assert.equal(pdf.desborde,false,'El PDF del EP tiene contenido cortado a la derecha');
 assert.ok(Math.abs(pdf.formato[0]-pdf.ancho/96)<0.01);
 assert.equal(pdf.orientacion,pdf.formato[0]>pdf.formato[1]?'landscape':'portrait');
 // Vista previa antes de descargar
 await pp.locator('#modal-pdf').waitFor();
 assert.match(await pp.locator('#pdf-vista-titulo').textContent(),/^EEPP N°01 .*\.pdf$/);
 assert.match(await pp.locator('#pdf-vista-descargar').getAttribute('href'),/^blob:/);
 assert.match(await pp.locator('#pdf-vista-descargar').getAttribute('download'),/\.pdf$/);
 await pp.getByRole('button',{name:'Cerrar',exact:true}).click();
 assert.equal(await pp.locator('#modal-pdf').isHidden(),true);
 // El campo admite hasta "hoy" en Chile; la fecha UTC puede ser el día siguiente de noche.
 await pp.locator('#pr-pago-fecha').fill(await pp.locator('#pr-pago-fecha').getAttribute('max'));
 await pp.getByRole('button',{name:'Marcar como pagado'}).click();
 await pp.waitForFunction(()=>window.fixture.tables.proyecto_edps[0].estado==='pagado');
 assert.equal(await pp.locator('#badge-proyectos').isHidden(),true);
 await pp.getByRole('button',{name:'Gastos',exact:true}).click();
 // Las sugerencias del concepto dependen de la categoría
 const conceptos=()=>pp.locator('#pr-g-subs option').evaluateAll(o=>o.map(x=>x.value));
 assert.ok((await conceptos()).includes('Yeso / volcanita'));
 assert.ok(!(await conceptos()).includes('Petróleo'));
 await pp.locator('#pr-g-cat').selectOption('mano_obra');
 assert.ok((await conceptos()).includes('Maestro'));
 await pp.locator('#pr-g-cat').selectOption('generales');
 assert.ok((await conceptos()).includes('Petróleo'));
 assert.match(await pp.locator('#pr-g-sub').getAttribute('placeholder'),/Petróleo/);
 await pp.locator('#pr-g-sub').fill('Petróleo');
 await pp.locator('#pr-g-monto').fill('45.000');
 await pp.locator('#pr-g-desc').fill('Petróleo camioneta');
 await pp.locator('#pr-g-archivo').setInputFiles([
  {name:'boleta.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 prueba')},
  {name:'transferencia1.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 t1')}]);
 await pp.getByRole('button',{name:'Registrar gasto'}).click();
 await pp.getByText('Petróleo camioneta').waitFor();
 const gasto=await pp.evaluate(()=>window.fixture.tables.proyecto_gastos[0]);
 assert.equal(gasto.monto,45000);
 assert.match(gasto.adjunto_path,/^aaaaaaaa-.*\/gasto\/.*\.pdf$/);
 assert.equal(gasto.adjuntos.length,2);
 assert.equal(gasto.adjuntos[0],gasto.adjunto_path);
 // Agregar un respaldo después de registrado y quitar otro
 await pp.locator('#pr-root input[type=file][onchange*="agregarRespaldos"]').setInputFiles({name:'transferencia2.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 t2')});
 await pp.getByRole('button',{name:'Respaldo 3'}).waitFor();
 assert.equal(await pp.evaluate(()=>window.fixture.tables.proyecto_gastos[0].adjuntos.length),3);
 await pp.getByRole('button',{name:'×'}).first().click();
 await pp.waitForFunction(()=>window.fixture.tables.proyecto_gastos[0].adjuntos.length===2);
 assert.notEqual(await pp.evaluate(()=>window.fixture.tables.proyecto_gastos[0].adjunto_path),gasto.adjunto_path);
 await pp.getByRole('button',{name:'Aprobar',exact:true}).click();
 await pp.waitForFunction(()=>window.fixture.tables.proyecto_gastos[0].estado==='aprobado');
 await pp.getByRole('button',{name:'Resumen',exact:true}).click();
 await pp.getByText('$ 45.000').first().waitFor();
 await pp.evaluate(()=>{document.getElementById('toast').style.display='none';});
 await pp.screenshot({path:'tests/artifacts/proyecto-desktop.png',fullPage:true,animations:"disabled"});
 await pp.getByRole('button',{name:'Estados de pago',exact:true}).click();
 await pp.locator('#pr-root tbody tr').first().click();
 await pp.setViewportSize({width:390,height:844});
 await pp.screenshot({path:'tests/artifacts/proyecto-mobile.png',fullPage:true,animations:"disabled"});
 assert.equal(await pp.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desbordamiento horizontal en móvil (proyectos)');
 assert.deepEqual(pp.errores,[]);
 await pp.close();

 // ── Solicitud de anticipo como primer estado de pago ──
 // (en esta misma página se revisa que cada botón PDF abra la vista previa y no descargue)
 const pa=await abrirPagina([presupuesto,{...presupuesto,id:'pre-2',numero:'PRE-102',estado:'enviado',fechaAdjudicacion:undefined,ordenesTrabajo:[]}]);
 let descargas=0; pa.on('download',()=>descargas++);
 await pa.evaluate(()=>{const lienzo=document.createElement('canvas');lienzo.width=lienzo.height=10;
  window.html2pdf=()=>{const api={set(){return api;},from(){return api;},toCanvas(){return api;},get:async()=>lienzo,toPdf(){return api;},output:async()=>new Blob(['%PDF-1.4'],{type:'application/pdf'})};return api;};});
 const verPDF=async(boton,nombre)=>{
  await boton.click();
  await pa.locator('#modal-pdf').waitFor();
  assert.match(await pa.locator('#pdf-vista-titulo').textContent(),nombre);
  await pa.locator('#modal-pdf').getByRole('button',{name:'Cerrar'}).click();
  await pa.locator('#modal-pdf').waitFor({state:'hidden'});
 };
 await pa.locator('#pl-mode-empresa').click();
 await pa.locator('[data-tab="tab-enviados"]').click();
 await verPDF(pa.locator('#tab-enviados').getByRole('button',{name:'PDF',exact:true}).first(),/^PRE-102\.pdf$/);
 await pa.locator('[data-tab="tab-adjudicados"]').click();
 await verPDF(pa.locator('#tab-adjudicados').getByRole('button',{name:'PDF',exact:true}).first(),/^PRE-101\.pdf$/);
 await pa.locator('[data-tab="tab-ot"]').click();
 await verPDF(pa.locator('#ot-tbody').getByRole('button',{name:'PDF',exact:true}).first(),/^OT-101-01\.pdf$/);
 // El botón "Descargar PDF" de la vista previa sí descarga
 await pa.locator('#ot-tbody').getByRole('button',{name:'PDF',exact:true}).first().click();
 await pa.locator('#modal-pdf').waitFor();
 await Promise.all([pa.waitForEvent('download'),pa.locator('#pdf-vista-descargar').click()]);
 assert.equal(descargas,1);
 await pa.locator('#modal-pdf').getByRole('button',{name:'Cerrar'}).click();
 await pa.locator('[data-tab="tab-adjudicados"]').click();
 await pa.locator('[data-tab="tab-adjudicados"]').click();
 await pa.getByRole('button',{name:'Pasar a ejecución (centro de costo)'}).click();
 await pa.getByText('Gastos vs costo directo presupuestado').waitFor();
 await pa.getByRole('button',{name:'Presupuesto y OT',exact:true}).click();
 await verPDF(pa.locator('#pr-root').getByRole('button',{name:'PDF',exact:true}).first(),/^PRE-101\.pdf$/);
 // Orden de compra del proyecto
 await pa.evaluate(async()=>{const pr=window.fixture.tables.proyectos[0];
  window.fixture.tables.ordenes_compra.push({id:'oc-1',proyecto_id:pr.id,empresa_id:pr.empresa_id,numero:1,estado:'emitida',fecha:'2026-10-01',categoria:'materiales',
   proveedor:{nombre:'Ferretería'},items:[{detalle:'Yeso',unidad:'un',cantidad:2,precio:1000,total:2000}],totales:{neto:2000,iva:380,total:2380}});
  await Compras.cargar();});
 await pa.evaluate(()=>Compras.exportarPDF('oc-1'));
 await pa.locator('#modal-pdf').waitFor();
 assert.match(await pa.locator('#pdf-vista-titulo').textContent(),/\.pdf$/);
 await pa.locator('#modal-pdf').getByRole('button',{name:'Cerrar'}).click();
 await pa.getByRole('button',{name:'Estados de pago',exact:true}).click();
 await pa.getByRole('button',{name:'Solicitud de anticipo'}).click();
 await pa.locator('#pr-edp-ant-pct').fill('20');
 await pa.locator('#pr-edp-ant-neto').getByText('$ 1.404.000').waitFor();
 await pa.locator('#pr-edp-resumen').getByText('$ 1.670.760').waitFor();
 await verPDF(pa.locator('#pr-root').getByRole('button',{name:'PDF',exact:true}).last(),/^EEPP N°01 .*\.pdf$/);
 assert.equal(descargas,1,'Algún botón PDF descargó sin pasar por la vista previa');
 await pa.getByRole('button',{name:'Presentar al mandante'}).click();
 await pa.waitForFunction(()=>window.fixture.tables.proyecto_edps[0]?.estado==='presentado');
 const sol=await pa.evaluate(()=>[window.fixture.tables.proyecto_edps[0].tipo,window.fixture.tables.proyecto_edps[0].totales.aPagar,window.fixture.tables.proyectos[0].config.anticipo_monto]);
 assert.deepEqual(sol,['anticipo',1670760,1404000]);
 assert.equal(await pa.getByRole('button',{name:'Solicitud de anticipo'}).count(),0);
 await pa.getByRole('button',{name:'Aprobado por el mandante'}).click();
 await pa.waitForFunction(()=>window.fixture.tables.proyecto_edps[0]?.estado==='aprobado');
 // El EP de avance siguiente amortiza el anticipo
 await pa.getByRole('button',{name:'+ Nuevo estado de pago'}).click();
 await pa.locator('input[data-item="a"][data-modo="cant"]').fill('2');
 await pa.locator('input[data-item="b"][data-modo="cant"]').fill('2');
 await pa.locator('#pr-edp-resumen').getByText('$ 351.000').first().waitFor();
 // La firma de gerencia de proyecto se activa desde Configuración
 await pa.getByRole('button',{name:'Configuración',exact:true}).click();
 assert.equal(await pa.locator('#pr-c-f-gerencia-ver').isChecked(),false);
 await pa.locator('#pr-c-f-gerencia-ver').check();
 await pa.getByRole('button',{name:'Guardar configuración'}).click();
 await pa.waitForFunction(()=>window.fixture.tables.proyectos[0].config.firmantes.mostrar_gerencia===true);
 // Firmas registradas: se suben en Mi Empresa y se estampan en el EP cuando coincide el nombre
 const imgFirma=Buffer.from((await pa.evaluate(()=>{const c=document.createElement('canvas');c.width=300;c.height=120;const x=c.getContext('2d');
  x.fillStyle='#fff';x.fillRect(0,0,300,120);x.strokeStyle='#1d4ed8';x.lineWidth=4;x.beginPath();x.moveTo(20,90);x.bezierCurveTo(80,10,160,110,280,30);x.stroke();return c.toDataURL('image/png');})).split(',')[1],'base64');
 await pa.locator('[data-tab="tab-empresa"]').click();
 await pa.locator('#firma-nombre').fill('Héctor Castro');
 await pa.locator('#firma-cargo').fill('Gerente general');
 await pa.locator('#firma-archivo').setInputFiles({name:'firma.png',mimeType:'image/png',buffer:imgFirma});
 await pa.getByRole('button',{name:'Agregar firma'}).click();
 await pa.locator('#firmas-lista').getByText('Héctor Castro').waitFor();
 const firmas=await pa.evaluate(()=>window.fixture.tables.empresas[0].firmas);
 assert.equal(firmas.length,1);
 assert.match(firmas[0].firma_b64,/^data:image\/png;base64,/);
 assert.ok(await pa.evaluate(()=>!!firmaRegistrada('HECTOR CASTRO ESPINOZA')&&!firmaRegistrada('Nicole Venegas')));
 await pa.locator('[data-tab="tab-proyectos"]').click();
 await pa.evaluate(()=>Proyectos.abrir(window.fixture.tables.proyectos[0].id,'config'));
 await pa.locator('#pr-c-f-general').fill('HÉCTOR CASTRO');
 await pa.locator('#pr-c-f-cliente').fill('Héctor Castro'); // aunque coincida, la del cliente nunca se estampa
 await pa.getByRole('button',{name:'Guardar configuración'}).click();
 await pa.waitForFunction(()=>window.fixture.tables.proyectos[0].config.firmantes.gerente_general==='HÉCTOR CASTRO');
 const htmlEp=await pa.evaluate(async()=>{let html;const lienzo=document.createElement('canvas');lienzo.width=lienzo.height=10;
  window.html2pdf=()=>{const api={set(){return api;},from(el){html=el.innerHTML;return api;},toCanvas(){return api;},get:async()=>lienzo,toPdf(){return api;},output:async()=>new Blob(['%PDF'])};return api;};
  Proyectos.exportarPDF(window.fixture.tables.proyecto_edps.find(x=>x.tipo==='anticipo').id);await new Promise(r=>setTimeout(r,50));return html;});
 const cajas=htmlEp.split('class="caja"').slice(1);
 assert.equal(cajas.length,3);
 assert.doesNotMatch(cajas[0],/<img/,'La firma del cliente no debe estamparse');
 assert.match(cajas[2],/<img src="data:image\/png/,'Falta la firma del gerente general');
 assert.deepEqual(pa.errores,[]);
 await pa.close();

 // ── Pago de mensualidad con Mercado Pago ──
 const pm=await abrirPagina([],[{plan_nombre:'Mensual',monto_mensual:25000,inicio:'2026-10-01',dias_gracia:5,periodos_pagados:0,cancelada:false}]);
 await pm.locator('#pl-mode-empresa').click();
 await pm.locator('#nav-suscripcion').click();
 await pm.getByText(/Próxima mensualidad: \$\s?25\.000/).waitFor();
 await Promise.all([pm.waitForURL(/mp=aprobado/),pm.getByRole('button',{name:'Pagar con Mercado Pago'}).click()]);
 await pm.getByText('Pago recibido',{exact:false}).waitFor();
 await pm.waitForFunction(()=>location.search==='' && !document.getElementById('tab-suscripcion').classList.contains('hidden'));
 assert.deepEqual(pm.errores,[]);

 // ── App de terreno (gastos.html) en celular: gasto con dinero propio, ingreso por transferencia personal e informe ──
 const asignado={id:'99999999-9999-4999-8999-999999999999',empresa_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',presupuesto_id:'pre-1',codigo:'CC-101',nombre:'Edificio Las Dalias',estado:'activo',administrador_id:null,asignados:['11111111-1111-4111-8111-111111111111'],config:{}};
 const ajeno={...asignado,id:'98989898-9898-4989-8989-989898989898',codigo:'CC-999',nombre:'Obra ajena',asignados:[]};
 const pt=await abrirPagina([],[],{id:'11111111-1111-4111-8111-111111111111',empresa_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',rol:'miembro',nombre:'Técnico'},
  {ruta:'/gastos.html',viewport:{width:390,height:844},proyectos:[asignado,ajeno]});
 await pt.locator('.btn-grande').first().waitFor();
 assert.equal(await pt.locator('.btn-grande').count(),3);
 await pt.locator('.btn-grande',{hasText:'Gastos'}).click();
 assert.deepEqual(await pt.locator('#g-proyecto option').allTextContents(),['CC-101 — Edificio Las Dalias'],'Solo los proyectos asignados');
 await pt.locator('[data-grupo="g-origen"][data-valor="propio"]').click();
 await pt.locator('#g-monto').fill('15000');
 assert.equal(await pt.locator('#g-monto').inputValue(),'15.000');
 await pt.locator('[data-grupo="g-cat"][data-valor="generales"]').click();
 await pt.locator('#g-desc').fill('Petróleo camioneta');
 await pt.locator('#form-gasto input[type=file]:not([capture])').setInputFiles({name:'boleta.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 boleta')});
 await pt.locator('#gasto-pendientes .miniatura').waitFor();
 await pt.locator('#g-enviar').click();
 await pt.waitForFunction(()=>window.fixture.tables.proyecto_gastos.length===1);
 const gt=await pt.evaluate(()=>window.fixture.tables.proyecto_gastos[0]);
 assert.equal(gt.origen_fondos,'propio'); assert.equal(gt.monto,15000); assert.equal(gt.categoria,'generales'); assert.equal(gt.adjuntos.length,1);
 assert.match(gt.adjuntos[0],/\/gasto\//);
 await pt.getByText('Mis gastos').waitFor();
 assert.ok(await pt.evaluate(()=>document.documentElement.scrollWidth<=390),'Sin scroll horizontal en el celular');
 assert.match(await pt.locator('#mis-gastos summary').first().innerText(),/CC-101[\s\S]*\$\s?15\.000[\s\S]*1 por aprobar/);
 await pt.screenshot({path:'tests/artifacts/gastos-movil.png',fullPage:true});
 // Respaldos después de registrar (uno a uno) y corrección del origen del dinero.
 await pt.locator('#gasto-'+gt.id+' input[type=file]:not([capture])').setInputFiles({name:'transferencia.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 t')});
 await pt.waitForFunction(()=>window.fixture.tables.proyecto_gastos[0].adjuntos.length===2);
 await pt.locator('#gasto-'+gt.id).getByRole('button',{name:'Editar'}).click();
 assert.equal(await pt.locator('#g-desc').inputValue(),'Petróleo camioneta');
 assert.equal(await pt.locator('#g-monto').inputValue(),'15.000');
 await pt.locator('#edit-respaldos .miniatura').nth(1).waitFor();
 await pt.locator('[data-grupo="g-origen"][data-valor="empresa"]').click();
 await pt.locator('#g-monto').fill('16500');
 await pt.locator('#g-guardar').click();
 await pt.waitForFunction(()=>window.fixture.tables.proyecto_gastos[0].origen_fondos==='empresa');
 assert.equal(await pt.evaluate(()=>window.fixture.tables.proyecto_gastos[0].monto),16500);
 await pt.getByText('Mis gastos').waitFor();
 await pt.locator('button[aria-label="Volver"]').click();
 await pt.locator('.btn-grande',{hasText:'Ingresos'}).click();
 await pt.locator('[data-grupo="i-medio"][data-valor="transferencia_personal"]').click();
 await pt.getByText('Requiere autorización del encargado').waitFor();
 await pt.locator('#i-monto').fill('80000');
 await pt.locator('#i-desc').fill('Adelanto del cliente');
 await pt.locator('#i-enviar').click(); // sin comprobante: el diálogo de confirmación se acepta
 await pt.waitForFunction(()=>window.fixture.tables.proyecto_ingresos.length===1);
 assert.equal(await pt.evaluate(()=>window.fixture.tables.proyecto_ingresos[0].medio),'transferencia_personal');
 await pt.locator('button[aria-label="Volver"]').click();
 // Leer boleta con la cámara: llena los campos para revisar y deja la foto como respaldo.
 const pngBoleta=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
 await pt.locator('.btn-grande',{hasText:'Gastos'}).click();
 await pt.locator('#g-leer input[type=file]').setInputFiles({name:'boleta.png',mimeType:'image/png',buffer:pngBoleta});
 await pt.getByText('Revisa que los datos estén correctos').waitFor();
 assert.equal(await pt.locator('#g-monto').inputValue(),'45.990');
 assert.equal(await pt.locator('#g-fecha').inputValue(),'2026-10-20');
 assert.equal(await pt.locator('#g-tipodoc').inputValue(),'factura');
 assert.equal(await pt.locator('#g-prov').inputValue(),'Sodimac S.A. · 96.792.430-K');
 assert.ok(await pt.locator('#g-monto').evaluate(el=>el.classList.contains('revisar')),'El monto queda marcado para revisar');
 assert.equal(await pt.locator('#gasto-pendientes .miniatura').count(),1,'La foto queda como respaldo');
 assert.ok(await pt.evaluate(()=>window.fixture.calls.some(c=>c.name==='leer-boleta'&&c.args.imagen.length>50)));
 await pt.locator('#g-monto').fill('46990'); // el técnico corrige
 assert.equal(await pt.locator('#g-monto').evaluate(el=>el.classList.contains('revisar')),false);
 await pt.locator('#g-enviar').click();
 await pt.waitForFunction(()=>window.fixture.tables.proyecto_gastos.length===2);
 const leido=await pt.evaluate(()=>window.fixture.tables.proyecto_gastos[1]);
 assert.equal(leido.monto,46990); assert.equal(leido.numero_doc,'48213'); assert.equal(leido.subcategoria,'Pintura'); assert.equal(leido.adjuntos.length,1);
 await pt.getByText('Mis gastos').waitFor();
 await pt.locator('button[aria-label="Volver"]').click();
 await pt.locator('.btn-grande',{hasText:'Informe'}).click();
 await pt.getByRole('button',{name:'+ Nuevo informe'}).click();
 await pt.locator('input[placeholder^="Ej: Remates"]').fill('Remates piso 3');
 await pt.locator('input[placeholder^="Trabajo"]').fill('Muro living');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
 await pt.locator("input[onchange*=antes][multiple]").setInputFiles({name:'antes.png',mimeType:'image/png',buffer:png});
 await pt.waitForFunction(()=>window.fixture.uploads.some(p=>p.includes('/informe/')));
 await pt.locator("input[onchange*=despues][multiple]").waitFor({state:'attached'});
 await pt.locator("input[onchange*=despues][multiple]").setInputFiles({name:'despues.png',mimeType:'image/png',buffer:png});
 await pt.waitForFunction(()=>window.fixture.uploads.filter(p=>p.includes('/informe/')).length===2);
 await pt.locator('.miniatura').nth(1).waitFor();
 await pt.evaluate(()=>{window.hojasPdf=0;window.html2pdf=()=>{const api={set(){return api;},from(){window.hojasPdf++;return api;},toPdf(){return api;},toContainer(){return api;},toCanvas(){return api;},
  get(){return api;},then(fn){fn({addPage(){}});return api;},output:async()=>new Blob(['%PDF-1.4'],{type:'application/pdf'})};return api;};});
 await pt.locator('#inf-guardar-pdf').click();
 await pt.waitForFunction(()=>window.fixture.tables.proyecto_informes.length===1 && window.hojasPdf>0);
 const inf=await pt.evaluate(()=>window.fixture.tables.proyecto_informes[0]);
 assert.equal(inf.titulo,'Remates piso 3'); assert.equal(inf.items[0].titulo,'Muro living');
 assert.equal(inf.items[0].antes.length,1); assert.equal(inf.items[0].despues.length,1);
 await pt.getByText('PDF listo').waitFor();
 assert.deepEqual(pt.errores,[]);
 await pt.close();
 console.log('Navegador: plataforma, ejecución de proyecto (EP, aprobación, atraso, Excel, pago, gastos), app de terreno (gastos, ingresos, informe) y pago con Mercado Pago correctos en escritorio y móvil. Sin errores JS.');
} finally { if(browser)await browser.close(); await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
