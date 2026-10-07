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
  suscripciones:(opts.suscripciones||[]).map(s=>({empresa_id:a,...s})),pagos_suscripcion:[],plataforma_historial:[],cobros_mp:[],proyectos:[],proyecto_edps:[],proyecto_gastos:[],ordenes_compra:[]
 };
 window.fixture={tables,colaboradores:[],calls:[],uploads:[],state:{estado_acceso:'autorizada',estado_pago:'sin_configurar',operativo:true,vencimiento:null}};
 const hoy=()=>new Date().toISOString().slice(0,10);
 function alta(table,r){
  const base={id:crypto.randomUUID(),creado_en:new Date().toISOString(),...r};
  if(table==='proyecto_edps')Object.assign(base,{numero:tables.proyecto_edps.filter(e=>e.proyecto_id===r.proyecto_id).length+1,estado:'borrador'});
  if(table==='proyecto_gastos')Object.assign(base,{estado:'pendiente',registrado_por:u});
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
  functions:{invoke:async(name,o)=>{window.fixture.calls.push({name,args:o?.body});return name==='mercadopago'?{data:{url:location.origin+'/?mp=aprobado&payment_id=1&status=approved'},error:null}:{data:null,error:null};}},
  storage:{from:()=>({upload:async(p)=>{window.fixture.uploads.push(p);return{error:null};},createSignedUrl:async()=>({data:{signedUrl:'about:blank'},error:null}),remove:async()=>({error:null})})},
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
  res.end(file.endsWith('index.html')?data.toString().replace(/ integrity="[^"]*" crossorigin="anonymous"/g,''):data);});
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
 async function abrirPagina(presupuestos,suscripciones=[],perfil=null){
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  page.errores=[];
  page.on('pageerror',e=>page.errores.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route('**/cdn.jsdelivr.net/**',route=>{
   const u=route.request().url();
   route.fulfill({contentType:'text/javascript',body:u.includes('supabase')?'window.supabase={createClient:()=>window.mockClient};':u.includes('exceljs')?excelJs:''});
  });
  await page.addInitScript(mock,{presupuestos,suscripciones,perfil});
  await page.goto(url,{waitUntil:'networkidle'});
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
 await pp.getByRole('button',{name:'Pasar a ejecución (centro de costo)'}).click();
 await pp.getByText('Gastos vs costo directo presupuestado').waitFor();
 assert.equal(await pp.evaluate(()=>window.fixture.tables.proyectos.length),1);
 await pp.getByRole('button',{name:'Estados de pago',exact:true}).click();
 await pp.getByRole('button',{name:'+ Nuevo estado de pago'}).click();
 await pp.locator('input[data-item="a"][data-modo="cant"]').fill('2');
 await pp.locator('input[data-item="b"][data-modo="pct"]').fill('25');
 await pp.locator('#pr-edp-resumen').getByText('$ 1.984.028').waitFor();
 assert.equal(await pp.locator('input[data-item="b"][data-modo="cant"]').inputValue(),'2');
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
 await pp.locator('#pr-pago-fecha').fill(new Date().toISOString().slice(0,10));
 await pp.getByRole('button',{name:'Marcar como pagado'}).click();
 await pp.waitForFunction(()=>window.fixture.tables.proyecto_edps[0].estado==='pagado');
 assert.equal(await pp.locator('#badge-proyectos').isHidden(),true);
 await pp.getByRole('button',{name:'Gastos',exact:true}).click();
 await pp.locator('#pr-g-cat').selectOption('generales');
 await pp.locator('#pr-g-sub').fill('Petróleo');
 await pp.locator('#pr-g-monto').fill('45.000');
 await pp.locator('#pr-g-desc').fill('Petróleo camioneta');
 await pp.locator('#pr-g-archivo').setInputFiles({name:'boleta.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 prueba')});
 await pp.getByRole('button',{name:'Registrar gasto'}).click();
 await pp.getByText('Petróleo camioneta').waitFor();
 const gasto=await pp.evaluate(()=>window.fixture.tables.proyecto_gastos[0]);
 assert.equal(gasto.monto,45000);
 assert.match(gasto.adjunto_path,/^aaaaaaaa-.*\/gasto\/.*\.pdf$/);
 await pp.getByRole('button',{name:'Aprobar',exact:true}).click();
 await pp.waitForFunction(()=>window.fixture.tables.proyecto_gastos[0].estado==='aprobado');
 await pp.getByRole('button',{name:'Resumen',exact:true}).click();
 await pp.getByText('$ 45.000').first().waitFor();
 await pp.evaluate(()=>{document.getElementById('toast').style.display='none';});
 await pp.screenshot({path:'tests/artifacts/proyecto-desktop.png',fullPage:true,animations:"disabled"});
 await pp.getByRole('button',{name:'Estados de pago',exact:true}).click();
 await pp.locator('tbody tr').first().click();
 await pp.setViewportSize({width:390,height:844});
 await pp.screenshot({path:'tests/artifacts/proyecto-mobile.png',fullPage:true,animations:"disabled"});
 assert.equal(await pp.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desbordamiento horizontal en móvil (proyectos)');
 assert.deepEqual(pp.errores,[]);
 await pp.close();

 // ── Pago de mensualidad con Mercado Pago ──
 const pm=await abrirPagina([],[{plan_nombre:'Mensual',monto_mensual:25000,inicio:'2026-10-01',dias_gracia:5,periodos_pagados:0,cancelada:false}]);
 await pm.locator('#pl-mode-empresa').click();
 await pm.locator('#nav-suscripcion').click();
 await pm.getByText(/Próxima mensualidad: \$\s?25\.000/).waitFor();
 await Promise.all([pm.waitForURL(/mp=aprobado/),pm.getByRole('button',{name:'Pagar con Mercado Pago'}).click()]);
 await pm.getByText('Pago recibido',{exact:false}).waitFor();
 await pm.waitForFunction(()=>location.search==='' && !document.getElementById('tab-suscripcion').classList.contains('hidden'));
 assert.deepEqual(pm.errores,[]);
 console.log('Navegador: plataforma, ejecución de proyecto (EP, aprobación, atraso, Excel, pago, gastos) y pago con Mercado Pago correctos en escritorio y móvil. Sin errores JS.');
} finally { if(browser)await browser.close(); await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
