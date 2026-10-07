const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
process.chdir(path.resolve(__dirname,'..'));
(async()=>{
const db=new PGlite();
const admin='11111111-1111-4111-8111-111111111111', client='22222222-2222-4222-8222-222222222222', member='33333333-3333-4333-8333-333333333333';
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth,public to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;");
await db.exec('alter default privileges in schema public grant all on tables to authenticated,anon;');
// Esquema mínimo equivalente al de Supabase Storage.
await db.exec("create schema storage; create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid); create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$; alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated; grant select,insert,delete on storage.objects to authenticated;");
const base=fs.readFileSync('supabase_schema.sql','utf8');
await db.exec(base.slice(0,base.indexOf('-- PASO 2')));
await db.exec("insert into auth.users values ('"+admin+"','admin@test.local'),('"+client+"','cliente@test.local'),('"+member+"','miembro@test.local'); insert into public.empresas(id,nombre_comercial,aprobada,limite_usuarios) values ('"+a+"','Plataforma',true,3),('"+b+"','Cliente',true,3); insert into public.perfiles(id,empresa_id,rol,es_superadmin) values ('"+admin+"','"+a+"','admin',true),('"+client+"','"+b+"','admin',false),('"+member+"','"+b+"','miembro',false); insert into public.presupuestos(id,empresa_id,data) values ('p1','"+a+"','{}'),('p2','"+b+"','{}');");
await db.exec(fs.readFileSync('supabase/migrations/202610050001_plataforma.sql','utf8'));
async function as(user,role='authenticated'){ await db.exec("reset role; set role "+role+"; select set_config('request.jwt.claim.sub','"+user+"',false);"); }
async function value(sql){return (await db.query(sql)).rows[0].v;}
async function rejects(sql,pattern){await assert.rejects(db.exec(sql),pattern);}
await as(client);
assert.equal(await value("select (public.estado_servicio('"+b+"')->>'operativo')::boolean v"),true);
assert.equal(await value("select count(*)::int v from public.presupuestos"),1);
await rejects("select public.plataforma_cambiar_acceso('"+a+"','autorizada','ataque')",/No autorizado/);
await rejects("update public.empresas set estado_acceso='autorizada' where id='"+b+"'",/permission denied/);
await rejects("update public.perfiles set es_superadmin=true where id='"+client+"'",/permission denied/);
await as(admin);
await db.exec("select public.plataforma_configurar_suscripcion('"+b+"','Mensual',20000,(now() at time zone 'America/Santiago')::date,0,false)");
await as(client);
assert.equal(await value("select (public.estado_servicio('"+b+"')->>'operativo')::boolean v"),false);
assert.equal(await value("select count(*)::int v from public.presupuestos"),0);
await rejects("insert into public.presupuestos values ('p3','"+b+"','{}',now())",/row-level security/);
await rejects("insert into public.pagos_suscripcion(id) values(gen_random_uuid())",/permission denied/);
await as(admin);
const date=await value("select (now() at time zone 'America/Santiago')::date::text v");
const pid='44444444-4444-4444-8444-444444444444';
const pay="select public.plataforma_registrar_pago('"+pid+"','"+b+"','"+date+"',20000,'BANCO-001','"+date+"')";
await db.exec(pay); await db.exec(pay);
assert.equal(await value("select periodos_pagados v from public.suscripciones where empresa_id='"+b+"'"),1);
assert.equal(await value("select count(*)::int v from public.pagos_suscripcion"),1);
await rejects(pay.replace('20000','19999'),/otros datos/);
await rejects(pay.replace(pid,'55555555-5555-4555-8555-555555555555'),/período cambió/);
await rejects("select public.plataforma_configurar_suscripcion('"+b+"','Mensual',20000,'2025-01-01',5,false)",/inicio no se cambia/);
await rejects("select public.set_limite_usuarios('"+b+"',1)",/cupo debe cubrir/);
await rejects("select public.plataforma_cambiar_acceso('"+a+"','bloqueada','Prueba bloqueo')",/administradores de plataforma/);
await db.exec("select public.plataforma_cambiar_acceso('"+b+"','bloqueada','Bloqueo administrativo')");
await as(client);
assert.equal(await value("select (public.estado_servicio('"+b+"')->>'operativo')::boolean v"),false);
assert.equal(await value("select count(*)::int v from public.pagos_suscripcion"),1);
await as(member);
assert.equal(await value("select count(*)::int v from public.pagos_suscripcion"),0);
assert.equal(await value("select count(*)::int v from public.suscripciones"),0);
await as(admin);
await db.exec("select public.plataforma_cambiar_acceso('"+b+"','autorizada','Reactivar cuenta')");
await as(client);
assert.equal(await value("select count(*)::int v from public.presupuestos"),1);
assert.equal(await value("select public.fecha_ciclo('2025-01-31',1)::text v"),'2025-02-28');
assert.equal(await value("select public.fecha_ciclo('2025-01-31',2)::text v"),'2025-03-31');
await as(client);
await db.exec("update public.presupuestos set data=jsonb_build_object('ordenesTrabajo',jsonb_build_array(jsonb_build_object('id','ot-b'))) where id='p2'");
const publish="select public.publicar_ot('ot-b','OT-1','P-2','Cliente','CLP',0,'Ana',null,null,null,null,'[]',0,0,0,0,0,true,0,0,0)";
await db.exec(publish);
await as(admin);
await rejects(publish,/Guarda la orden/);
await as(client);
await db.exec(publish.replace("'Ana'","'Ana actualizada'"));
await as(admin);
await db.exec("select public.plataforma_cambiar_acceso('"+b+"','suspendida','Prueba de suspensión')");
await as(client);
await rejects(publish,/Sin acceso/);
await as('', 'anon');
await db.exec("select public.firmar_ot_publica('ot-b','firma-prueba',null)");
assert.equal(await value("select estado v from public.obtener_ot_publica('ot-b')"),'firmada');

await as('', 'anon');
assert.equal(await value("select has_function_privilege('anon','public.plataforma_registrar_pago(uuid,uuid,date,integer,text,date)','EXECUTE') v"),false);
assert.equal(await value("select has_function_privilege('anon','public.publicar_ot(text,text,text,text,text,integer,text,text,text,text,text,jsonb,numeric,numeric,numeric,numeric,numeric,boolean,numeric,numeric,numeric)','EXECUTE') v"),false);
await as(admin);
await db.exec("select public.plataforma_cambiar_acceso('"+b+"','archivada','Baja solicitada')");
await rejects("select public.plataforma_eliminar_empresa('"+b+"','Cliente')",/documentos o pagos/);
await db.exec("reset role");
const c='cccccccc-cccc-4ccc-8ccc-cccccccccccc',newuser='66666666-6666-4666-8666-666666666666';
await db.exec("insert into auth.users values('"+newuser+"','nuevo@test.local'); insert into public.empresas(id,nombre_comercial,aprobada,estado_acceso) values('"+c+"','Nueva',true,'autorizada'); insert into public.perfiles(id,empresa_id,rol) values('"+newuser+"','"+c+"','admin')");
await as(newuser);
assert.equal(await value("select (public.estado_servicio('"+c+"')->>'operativo')::boolean v"),false);
await rejects("select public.plataforma_eliminar_empresa('"+c+"','Nueva')",/No autorizado/);
await as(admin);
await db.exec("select public.plataforma_cambiar_acceso('"+c+"','archivada','Baja de prueba')");
await rejects("select public.plataforma_eliminar_empresa('"+c+"','nombre incorrecto')",/confirma su nombre/);
await db.exec("select public.plataforma_eliminar_empresa('"+c+"','Nueva')");
assert.equal(await value("select count(*)::int v from public.empresas where id='"+c+"'"),0);
assert.equal(await value("select count(*)::int v from public.plataforma_historial where accion='eliminacion' and empresa_id is null"),1);

await as(newuser);
await rejects("select public.estado_servicio('"+b+"')",/No autorizado/);

// ── Ejecución de proyectos ──
await db.exec("reset role");
await db.exec(fs.readFileSync('supabase/migrations/202610060001_proyectos.sql','utf8'));
const d='dddddddd-dddd-4ddd-8ddd-dddddddddddd',e2='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const jefe='77777777-7777-4777-8777-777777777777',obrero='88888888-8888-4888-8888-888888888888',otro='99999999-9999-4999-8999-999999999999';
await db.exec("insert into auth.users values('"+jefe+"','jefe@test.local'),('"+obrero+"','obrero@test.local'),('"+otro+"','otro@test.local'); insert into public.empresas(id,nombre_comercial,aprobada,estado_acceso,acceso_transitorio,limite_usuarios) values('"+d+"','Constructora',true,'autorizada',true,5),('"+e2+"','Otra',true,'autorizada',true,5); insert into public.perfiles(id,empresa_id,rol) values('"+jefe+"','"+d+"','admin'),('"+obrero+"','"+d+"','miembro'),('"+otro+"','"+e2+"','admin'); insert into public.presupuestos(id,empresa_id,data) values('pd','"+d+"','{}'),('pe','"+e2+"','{}');");
const altaProyecto="insert into public.proyectos(empresa_id,presupuesto_id,codigo,nombre,administrador_id) values('"+d+"','pd','CC-1','Obra','"+jefe+"') returning id v";
await as(obrero);
await rejects(altaProyecto,/row-level security/);
await as(otro);
await rejects("insert into public.proyectos(empresa_id,presupuesto_id,codigo,nombre) values('"+e2+"','pd','CC-X','Ajeno')",/Presupuesto inexistente/);
await as(jefe);
const pid2=await value(altaProyecto);
await as(otro);
assert.equal(await value("select count(*)::int v from public.proyectos"),0);
await rejects("insert into public.proyecto_gastos(proyecto_id,fecha,categoria,descripcion,monto) values('"+pid2+"','2026-10-01','generales','Intruso',1000)",/row-level security/);
// Estados de pago: secuencia y montos congelados.
await as(obrero);
await rejects("insert into public.proyecto_edps(proyecto_id) values('"+pid2+"')",/row-level security/);
await as(jefe);
const ep1=await value("insert into public.proyecto_edps(proyecto_id,numero,estado,items) values('"+pid2+"',99,'pagado','[1]') returning id v");
assert.equal(await value("select numero::text||estado v from public.proyecto_edps where id='"+ep1+"'"),'1borrador');
await rejects("insert into public.proyecto_edps(proyecto_id) values('"+pid2+"')",/abierto/);
await rejects("update public.proyecto_edps set estado='aprobado' where id='"+ep1+"'",/no permitido/);
await db.exec("update public.proyecto_edps set estado='presentado' where id='"+ep1+"'");
assert.equal(await value("select fecha_presentacion is not null v from public.proyecto_edps where id='"+ep1+"'"),true);
await rejects("update public.proyecto_edps set items='[2]' where id='"+ep1+"'",/presentado/);
await db.exec("update public.proyecto_edps set estado='aprobado',fecha_pago_estimada='2026-10-30' where id='"+ep1+"'");
await rejects("update public.proyecto_edps set estado='pagado' where id='"+ep1+"'",/fecha de pago/);
await db.exec("update public.proyecto_edps set estado='pagado',fecha_pago_real='2026-11-02',comprobante_path='x.pdf' where id='"+ep1+"'");
const ep2=await value("insert into public.proyecto_edps(proyecto_id) values('"+pid2+"') returning id v");
assert.equal(await value("select numero v from public.proyecto_edps where id='"+ep2+"'"),2);
await db.exec("delete from public.proyecto_edps where id in ('"+ep1+"','"+ep2+"')");
assert.equal(await value("select count(*)::int v from public.proyecto_edps"),1);
// Gastos: el trabajador registra, el administrador del proyecto aprueba.
await as(obrero);
const g1=await value("insert into public.proyecto_gastos(proyecto_id,fecha,categoria,subcategoria,descripcion,monto,estado,registrado_por) values('"+pid2+"','2026-10-02','generales','Petróleo','Camioneta',45000,'aprobado','"+jefe+"') returning id v");
assert.equal(await value("select estado||registrado_por::text v from public.proyecto_gastos where id='"+g1+"'"),'pendiente'+obrero);
await db.exec("update public.proyecto_gastos set monto=46000 where id='"+g1+"'");
await rejects("update public.proyecto_gastos set estado='aprobado' where id='"+g1+"'",/Solo el administrador/);
await as(jefe);
await rejects("update public.proyecto_gastos set estado='rechazado' where id='"+g1+"'",/motivo/);
await db.exec("update public.proyecto_gastos set estado='rechazado',motivo_rechazo='Sin boleta' where id='"+g1+"'");
assert.equal(await value("select revisado_por::text v from public.proyecto_gastos where id='"+g1+"'"),jefe);
await as(obrero);
await rejects("update public.proyecto_gastos set monto=1 where id='"+g1+"'",/pendientes/);
await db.exec("delete from public.proyecto_gastos where id='"+g1+"'");
assert.equal(await value("select count(*)::int v from public.proyecto_gastos"),1);
await as(jefe);
await db.exec("update public.proyectos set administrador_id='"+obrero+"' where id='"+pid2+"'");
await as(obrero);
const g2=await value("insert into public.proyecto_gastos(proyecto_id,fecha,categoria,descripcion,monto) values('"+pid2+"','2026-10-03','materiales','Yeso',120000) returning id v");
await db.exec("update public.proyecto_gastos set estado='aprobado' where id='"+g2+"'");
await rejects("update public.proyectos set administrador_id='"+jefe+"' where id='"+pid2+"'",/Solo el administrador de la empresa/);
// Archivos por carpeta de empresa.
await as(jefe);
await db.exec("insert into storage.objects(bucket_id,name) values('proyectos','"+d+"/"+pid2+"/gasto/a.jpg')");
await as(otro);
assert.equal(await value("select count(*)::int v from storage.objects"),0);
await rejects("insert into storage.objects(bucket_id,name) values('proyectos','"+d+"/"+pid2+"/gasto/b.jpg')",/row-level security/);
await as(jefe);
await rejects("delete from public.proyectos where id='"+pid2+"'",/foreign key/);
// Sin acceso operativo no se lee ni se registra nada.
await as(admin);
await db.exec("select public.plataforma_cambiar_acceso('"+d+"','suspendida','Prueba de suspensión')");
await as(jefe);
assert.equal(await value("select count(*)::int v from public.proyectos"),0);
await rejects("insert into public.proyecto_gastos(proyecto_id,fecha,categoria,descripcion,monto) values('"+pid2+"','2026-10-04','generales','Colación',8000)",/row-level security/);
assert.equal(await value("select count(*)::int v from storage.objects"),0);

// ── Mercado Pago: solo el servidor acredita, sin duplicar ni aceptar montos distintos ──
await db.exec("reset role");
await db.exec(fs.readFileSync('supabase/migrations/202610060002_mercadopago.sql','utf8'));
await db.exec("insert into public.suscripciones(empresa_id,plan_nombre,monto_mensual,inicio,dias_gracia) values('"+e2+"','Mensual',25000,'2026-10-01',5)");
const cobro=async monto=>value("insert into public.cobros_mp(empresa_id,periodo_inicio,monto) values('"+e2+"','2026-10-01',"+monto+") returning id v");
const c1=await cobro(25000),c2=await cobro(20000),c3=await cobro(25000),c4=await cobro(25000);
const acreditar=(c,pago,monto,estado)=>"select public.mp_acreditar_pago('"+c+"','"+pago+"',"+monto+",'2026-10-06','"+estado+"') v";
await as(otro);
await rejects(acreditar(c1,'123',25000,'approved'),/permission denied/);
assert.equal(await value("select count(*)::int v from public.cobros_mp"),4);
await as(obrero);
assert.equal(await value("select count(*)::int v from public.cobros_mp"),0);
await db.exec("reset role; set role service_role;");
assert.equal(await value(acreditar(c1,'123',25000,'approved')),'aplicado');
assert.equal(await value(acreditar(c1,'123',25000,'approved')),'aplicado');
assert.equal(await value(acreditar(c4,'123',25000,'approved')),'duplicado');
assert.equal(await value(acreditar(c2,'124',20000,'approved')),'revision');
assert.equal(await value(acreditar(c3,'125',25000,'rejected')),'rechazado');
await db.exec("reset role");
assert.equal(await value("select periodos_pagados v from public.suscripciones where empresa_id='"+e2+"'"),1);
assert.equal(await value("select origen||referencia||(registrado_por is null)::text v from public.pagos_suscripcion where empresa_id='"+e2+"'"),'mercadopagomp-123true');
assert.equal(await value("select count(*)::int v from public.plataforma_historial where empresa_id='"+e2+"' and actor is null"),2);

// ── Colaboradores de plataforma y eliminación completa de empresas ──
await db.exec("reset role");
await db.exec(fs.readFileSync('supabase/migrations/202610070003_colaboradores.sql','utf8'));
const col='12121212-1212-4212-8212-121212121212';
await db.exec("insert into auth.users values('"+col+"','Colab@test.local')");
await as(client);
await rejects("select public.plataforma_agregar_colaborador('colab@test.local','{suscripciones}')",/No autorizado/);
assert.equal(await value("select count(*)::int v from public.plataforma_listar_colaboradores()"),0);
await as(admin);
await rejects("select public.plataforma_agregar_colaborador('colab@test.local','{eliminar}')",/Permiso inválido/);
assert.equal(await value("select public.plataforma_agregar_colaborador('nadie@test.local','{}') v"),'sin_cuenta');
assert.equal(await value("select public.plataforma_agregar_colaborador(' COLAB@test.local ','{suscripciones,suscripciones}') v"),'agregado');
assert.equal(await value("select empresa_id is null and permisos_plataforma='{suscripciones}' v from public.perfiles where id='"+col+"'"),true);
assert.equal(await value("select email v from public.plataforma_listar_colaboradores()"),'Colab@test.local');
// Con 'suscripciones': ve todo el panel y gestiona planes, pero no acceso, cupos ni eliminación.
await as(col);
assert.equal(await value("select count(*)::int v from public.empresas"),4);
assert.ok(await value("select count(*)::int v from public.pagos_suscripcion")>0);
await db.exec("select public.plataforma_configurar_suscripcion('"+e2+"','Mensual',30000,'2026-10-01',5,false)");
await rejects("select public.set_limite_usuarios('"+e2+"',6)",/No autorizado/);
await rejects("select public.plataforma_cambiar_acceso('"+e2+"','bloqueada','Prueba colaborador')",/No autorizado/);
await rejects("select public.plataforma_eliminar_empresa('"+e2+"','Otra')",/Solo el dueño/);
await rejects("select public.plataforma_agregar_colaborador('otro@test.local','{acceso}')",/No autorizado/);
await rejects("update public.perfiles set permisos_plataforma='{acceso}' where id='"+col+"'",/permission denied/);
assert.equal(await value("select count(*)::int v from public.presupuestos"),0);
await as(admin);
await db.exec("select public.plataforma_permisos_colaborador('"+col+"','{acceso}')");
await as(col);
await db.exec("select public.set_limite_usuarios('"+e2+"',6)");
await rejects("select public.plataforma_configurar_suscripcion('"+e2+"','Mensual',30000,'2026-10-01',5,false)",/No autorizado/);
// Quitar a un colaborador sin empresa borra su perfil.
await as(admin);
await db.exec("select public.plataforma_quitar_colaborador('"+col+"')");
assert.equal(await value("select count(*)::int v from public.perfiles where id='"+col+"'"),0);
await as(col);
assert.equal(await value("select count(*)::int v from public.empresas"),0);
// Un miembro de empresa puede ser colaborador; si su empresa se elimina, conserva el rol sin empresa.
await as(admin);
assert.equal(await value("select public.plataforma_agregar_colaborador('obrero@test.local','{}') v"),'agregado');
await rejects("select public.plataforma_eliminar_empresa('"+d+"','constructora')",/nombre exacto/);
await rejects("select public.plataforma_eliminar_empresa('"+a+"','Plataforma')",/administradores de plataforma/);
await db.exec("select public.plataforma_eliminar_empresa('"+d+"','Constructora')");
await db.exec("select public.plataforma_eliminar_empresa('"+e2+"','Otra')");
await db.exec("reset role");
for (const [tabla,id] of [['empresas','id'],['presupuestos','empresa_id'],['proyectos','empresa_id'],['proyecto_gastos','empresa_id'],['proyecto_edps','empresa_id'],['suscripciones','empresa_id'],['pagos_suscripcion','empresa_id'],['cobros_mp','empresa_id']])
    assert.equal(await value("select count(*)::int v from public."+tabla+" where "+id+" in ('"+d+"','"+e2+"')"),0,tabla);
assert.equal(await value("select count(*)::int v from storage.objects where name like '"+d+"/%'"),0);
assert.equal(await value("select count(*)::int v from public.perfiles where id in ('"+jefe+"','"+otro+"')"),0);
assert.equal(await value("select empresa_id is null and colaborador_plataforma v from public.perfiles where id='"+obrero+"'"),true);
assert.equal(await value("select count(*)::int v from auth.users where id in ('"+jefe+"','"+otro+"')"),2);
assert.equal(await value("select count(*)::int v from public.plataforma_historial where accion='eliminacion' and detalle->>'nombre' in ('Constructora','Otra')"),2);

// ── Órdenes de compra: aprobación por tramos de monto neto ──
await db.exec("reset role");
await db.exec(fs.readFileSync('supabase/migrations/202610070004_ordenes_compra.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/202610070006_aprobacion_oc.sql','utf8'));
const f='f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',ger='a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',gpro='b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2',adp='c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',trab='d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4';
await db.exec("insert into auth.users values('"+ger+"','ger@test.local'),('"+gpro+"','gpro@test.local'),('"+adp+"','adp@test.local'),('"+trab+"','trab@test.local'); insert into public.empresas(id,nombre_comercial,aprobada,estado_acceso,acceso_transitorio,limite_usuarios) values('"+f+"','Compras SpA',true,'autorizada',true,10); insert into public.perfiles(id,empresa_id,rol) values('"+ger+"','"+f+"','admin'),('"+gpro+"','"+f+"','miembro'),('"+adp+"','"+f+"','miembro'),('"+trab+"','"+f+"','miembro'); insert into public.presupuestos(id,empresa_id,data) values('pf','"+f+"','{}');");
const pf=await value("insert into public.proyectos(empresa_id,presupuesto_id,codigo,nombre,administrador_id) values('"+f+"','pf','CC-F','Obra F','"+adp+"') returning id v");
const nuevaOC=async neto=>{await as(trab);return value("insert into public.ordenes_compra(empresa_id,proyecto_id,proveedor,items,totales) values('"+f+"','"+pf+"','{\"nombre\":\"Ferretería\"}','[{\"detalle\":\"x\"}]',jsonb_build_object('neto',"+neto+")) returning id v");};
const emitir=id=>"update public.ordenes_compra set estado='emitida' where id='"+id+"'";
// Sin tramos: el administrador del proyecto aprueba cualquier monto; el trabajador no.
const o0=await nuevaOC(2000000);
await rejects(emitir(o0),/administrador del proyecto|No te corresponde/);
await as(adp); await db.exec(emitir(o0));
// Solo el administrador de la empresa configura, con montos crecientes y designados de la empresa.
const cfg=(l1,l2,gp,gg)=>"update public.empresas set aprobacion_oc=jsonb_build_object('activo',true,'limite_administrador',"+l1+",'limite_gerente_proyectos',"+l2+",'gerente_proyectos_id','"+gp+"','gerente_general_id','"+gg+"') where id='"+f+"'";
await as(trab); await db.exec(cfg(1,2,'',''));
assert.equal(await value("select aprobacion_oc='{}'::jsonb v from public.empresas where id='"+f+"'"),true);
await as(ger);
await rejects(cfg(1500000,500000,gpro,ger),/crecientes/);
await rejects(cfg(500000,1500000,gpro,admin),/pertenecer/);
await db.exec(cfg(500000,1500000,gpro,ger));
// Tramo 1 (≤ 500.000): administrador del proyecto.
const o1=await nuevaOC(500000);
await as(adp); await db.exec(emitir(o1));
// Tramo 2 (≤ 1.500.000): gerente de proyectos; el administrador del proyecto ya no.
const o2=await nuevaOC(500001);
await as(adp); await rejects(emitir(o2),/No te corresponde/);
await as(gpro); await db.exec(emitir(o2));
assert.equal(await value("select aprobado_por::text v from public.ordenes_compra where id='"+o2+"'"),gpro);
// Tramo 3 (> 1.500.000): solo el gerente general.
const o3=await nuevaOC(1500001);
await as(gpro); await rejects(emitir(o3),/No te corresponde/);
await as(adp); await rejects(emitir(o3),/No te corresponde/);
await as(ger); await db.exec(emitir(o3));
// Un nivel superior aprueba montos menores.
const o4=await nuevaOC(1000);
await as(gpro); await db.exec(emitir(o4));
assert.equal(await value("select count(*)::int v from public.ordenes_compra where estado='emitida'"),5);
// Endurecimiento de seguridad (auditoría 06-10-2026): alta de empresa solo con sesión y firma pública acotada.
await db.exec("reset role");
await db.exec(fs.readFileSync('supabase/migrations/202610070005_seguridad.sql','utf8'));
const nuevo='44444444-4444-4444-8444-444444444444';
await db.exec("insert into auth.users values ('"+nuevo+"','nuevo@test.local')");
await db.exec("reset role; set role anon; select set_config('request.jwt.claim.sub','',false);");
await rejects("select public.crear_empresa_y_admin('Empresa fantasma','x')",/permission denied/);
await rejects("select public.mi_empresa_id()",/permission denied/);
await rejects("select public.firmar_ot_publica('_enlace_de_prueba_1','<script>alert(1)</script>',null)",/Firma no válida/);
await rejects("select public.firmar_ot_publica('_enlace_de_prueba_1','data:image/png;base64,'||repeat('A',1500000),null)",/Firma no válida/);
await rejects("select public.firmar_ot_publica('_enlace_de_prueba_1','data:image/png;base64,AAAA','texto que no es imagen')",/Foto no válida/);
await rejects("select public.firmar_ot_publica('x','data:image/png;base64,AAAA',null)",/Enlace no válido/);
await db.exec("select public.firmar_ot_publica('_enlace_de_prueba_1','data:image/png;base64,AAAA','data:image/jpeg;base64,AAAA')");
assert.equal(await value("select count(*)::int v from public.obtener_ot_publica('')"),0);
await as(nuevo);
await rejects("select public.crear_empresa_y_admin(' ','x')",/nombre de la empresa/);
await db.exec("select public.crear_empresa_y_admin('Empresa nueva','Usuario nuevo')");
await rejects("select public.crear_empresa_y_admin('Otra','x')",/ya tiene una empresa/);
await db.exec("reset role");
assert.equal(await value("select (aprobada=false and limite_usuarios=1)::text v from public.empresas where nombre_comercial='Empresa nueva'"),'true');
await db.close();
console.log('Migraciones ejecutadas en PostgreSQL temporal: plataforma (permisos, deuda, pagos, bloqueo) proyectos (estados de pago, gastos, archivos, aislamiento) seguridad (alta con sesión, firma acotada), colaboradores y aprobación de órdenes de compra correctos.');
})().catch(e=>{console.error(e.message);process.exit(1);});
