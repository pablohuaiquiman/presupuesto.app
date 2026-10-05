const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
process.chdir(path.resolve(__dirname,'..'));
(async()=>{
const root=process.cwd();
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 const options={headless:true};
 const chrome=process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
 if(fs.existsSync(chrome)) options.executablePath=chrome;
 browser=await chromium.launch(options);
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:route.request().url().includes('supabase')?'window.supabase={createClient:()=>window.mockClient};':''}));
 await page.addInitScript(()=>{
  const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',u='11111111-1111-4111-8111-111111111111';
  const tables={
   empresas:[{id:a,nombre_comercial:'Constructora PHH',rut:'77234145-8',aprobada:true,acceso_transitorio:true,estado_acceso:'autorizada',limite_usuarios:3,perfiles:[{count:1}]},
    {id:b,nombre_comercial:'Empresa de prueba <segura>',email_contacto:'cliente@example.test',aprobada:true,acceso_transitorio:true,estado_acceso:'autorizada',limite_usuarios:2,perfiles:[{count:1}]}],
   perfiles:[{id:u,empresa_id:a,rol:'admin',es_superadmin:true,nombre:'Administrador'}],
   presupuestos:[],suscripciones:[],pagos_suscripcion:[],plataforma_historial:[]
  };
  window.fixture={tables,calls:[],state:{estado_acceso:'autorizada',estado_pago:'sin_configurar',operativo:true,vencimiento:null}};
  function query(table) {
   let filters=[],single=false,range=null,limit=null,mutation=null;
   const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},range(a,b){range=[a,b];return q;},limit(n){limit=n;return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},update(v){mutation=v;return q;},upsert(){return q;},then(resolve,reject){
    let rows=tables[table].filter(r=>filters.every(([k,v])=>r[k]===v));
    if(mutation)rows.forEach(r=>Object.assign(r,mutation));
    if(range)rows=rows.slice(range[0],range[1]+1);
    if(limit)rows=rows.slice(0,limit);
    return Promise.resolve({data:structuredClone(single?rows[0]||null:rows),error:null}).then(resolve,reject);
   }};
   return q;
  }
  window.mockClient={auth:{getSession:async()=>({data:{session:{user:{id:u},access_token:'fixture'}}}),onAuthStateChange(){},signOut:async()=>{}},
   from:query,async rpc(name,args) {
    window.fixture.calls.push({name,args});
    if(name==='estado_servicio')return {data:structuredClone(window.fixture.state),error:null};
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
 });
 const url='http://127.0.0.1:'+server.address().port;
 await page.goto(url,{waitUntil:'networkidle'});
 await page.locator('#pl-companies tr').first().waitFor();
 assert.equal(await page.locator('#pl-companies tr').count(),2);
 assert.equal(await page.locator('#company-nav').isVisible(),false);
 await page.locator('#pl-search').fill('segura');
 assert.equal(await page.locator('#pl-companies tr').count(),1);
 await page.locator('[data-action="detail"]').click();
 await page.locator('#pl-plan').waitFor();
 await page.locator('#pl-price').fill('20000');
 page.on('dialog',dialog=>dialog.accept());
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
 await page.locator('#pl-mode-admin').click();
 await page.locator('#pl-companies').waitFor();
 fs.mkdirSync('tests/artifacts',{recursive:true});
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('tab-superadmin')).opacity==='1');
 await page.evaluate(()=>{document.getElementById('toast').style.display='none';});
 await page.screenshot({path:'tests/artifacts/platform-desktop.png',fullPage:true,animations:"disabled"});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'tests/artifacts/platform-mobile.png',fullPage:true,animations:"disabled"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desbordamiento horizontal en móvil');
 // Permiso de navegación para usuarios normales, usando la misma sesión simulada.
 await page.evaluate(()=>{miPerfil.es_superadmin=false;Plataforma.cambiarModo('empresa');});
 assert.equal(await page.evaluate(()=>Plataforma.navegarPermitido('tab-superadmin')),false);
 assert.deepEqual(errors,[]);
 console.log('Navegador: administración, filtros, ficha, suscripción, pago, bloqueo, vista empresa y móvil correctos. Sin errores JS.');
} finally { if(browser)await browser.close(); await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
