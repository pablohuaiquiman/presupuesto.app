const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
process.chdir(path.resolve(__dirname,'..'));
const context=vm.createContext({document:{addEventListener(){}},Intl,Date,console,Number,Math});
vm.runInContext(fs.readFileSync('proyectos.js','utf8')+'\nglobalThis.t=Proyectos.test;',context);
const {calcularEDP,calcularDevolucion,diasEntre}=context.t;
const avance=obj=>new Map(Object.entries(obj));
const ep=(p,config,previo,cants)=>calcularEDP(p,config,previo,avance(cants));

// Plantilla "EE.PP. APLICACION YESO": 2 tipos de departamento, 8 de cada uno, retención 5 %, factura.
const yeso={moneda:'CLP',decimales:0,usarGGUtil:false,capitulos:[{id:'c1',numero:'1.0',nombre:'Remates de yeso',items:[
  {id:'a',numero:'1.1',descripcion:'DPTO TIPO A',unidad:'DPTO',cantidad:8,precioUnit:422500,total:3380000},
  {id:'b',numero:'1.2',descripcion:'DPTO TIPO B',unidad:'DPTO',cantidad:8,precioUnit:455000,total:3640000}]}]};
const cfg={anticipo_monto:0,retencion_pct:5,documento:'factura',tasa:19};
const e1=ep(yeso,cfg,null,{a:2,b:2});
assert.equal(e1.totales.contrato.sub,7020000);
assert.equal(e1.totales.per.sub,1755000);
assert.equal(e1.totales.per.retencion,87750);
assert.equal(e1.totales.per.neto,1667250);
assert.equal(e1.totales.impuesto,316778);
assert.equal(e1.totales.aPagar,1984028);
assert.equal(e1.totales.pctAvance,25);
const e2=ep(yeso,cfg,e1,{a:4.2,b:4.2});
assert.equal(e2.totales.acum.sub,3685500);
assert.equal(e2.totales.ant.sub,1755000);
assert.equal(e2.totales.per.sub,1930500);
assert.equal(e2.totales.per.retencion,96525);
assert.equal(e2.items[0].montoAnt,845000);
assert.equal(e2.items[0].montoPeriodo,929500);
const e3=ep(yeso,cfg,e2,{a:6,b:6});
assert.equal(e3.totales.acum.sub,5265000);
assert.equal(e3.totales.per.sub,1579500);
assert.equal(+e3.totales.pctAvance.toFixed(4),75);

// El avance no baja del anterior ni supera el contrato.
const limitado=ep(yeso,cfg,e2,{a:1,b:99});
assert.equal(limitado.items[0].cantAcum,4.2);
assert.equal(limitado.items[1].cantAcum,8);
assert.equal(ep(yeso,cfg,e2,{}).totales.per.sub,0);

// Anticipo proporcional; el estado que completa el 100 % salda el resto exacto.
const conAnticipo={...cfg,anticipo_monto:1000001};
const a1=ep(yeso,conAnticipo,null,{a:8/3,b:8/3});
assert.equal(a1.totales.per.anticipo,Math.round(1000001*a1.totales.acum.sub/7020000));
const a2=ep(yeso,conAnticipo,a1,{a:8,b:8});
assert.equal(a1.totales.per.anticipo+a2.totales.per.anticipo,1000001);
assert.equal(a2.totales.acum.sub,7020000);
assert.equal(a2.totales.acum.neto,7020000-1000001-351000);
assert.equal(a2.totales.per.neto,a2.totales.acum.neto-a1.totales.acum.neto);

// Gastos generales y utilidad como en el presupuesto.
const conGG={...yeso,usarGGUtil:true,ggPct:10,utilPct:5};
const g=ep(conGG,{retencion_pct:0},null,{a:8,b:8});
assert.equal(g.totales.contrato.gg,702000);
assert.equal(g.totales.contrato.util,351000);
assert.equal(g.totales.per.sub,8073000);
assert.equal(g.totales.aPagar,Math.round(8073000*1.19));

// Boleta de honorarios resta la retención; exenta no aplica impuesto.
const bol=ep(yeso,{retencion_pct:0,documento:'boleta_honorarios',tasa:15.25},null,{a:2,b:2});
assert.equal(bol.totales.impuesto,Math.round(1755000*0.1525));
assert.equal(bol.totales.aPagar,1755000-bol.totales.impuesto);
assert.equal(ep(yeso,{documento:'exenta'},null,{a:2,b:2}).totales.aPagar,1755000);

// UF con decimales.
const uf={moneda:'UF',decimales:2,usarGGUtil:false,capitulos:[{id:'u',numero:'1.0',nombre:'Obra',items:[{id:'x',numero:'1',descripcion:'Partida',unidad:'m2',cantidad:3,precioUnit:10.555,total:31.67}]}]};
const u1=ep(uf,{retencion_pct:0},null,{x:1});
assert.equal(u1.items[0].montoAcum,10.56);
assert.equal(ep(uf,{retencion_pct:0},u1,{x:3}).totales.acum.cd,31.67);

// Devolución de retenciones acumuladas.
const dev=calcularDevolucion(yeso,cfg,{totales:{acum:{retencion:351000}}});
assert.equal(dev.totales.per.neto,351000);
assert.equal(dev.totales.aPagar,351000+66690);

assert.equal(diasEntre('2026-10-01','2026-10-06'),5);
assert.equal(diasEntre('2026-12-31','2027-01-02'),2);
assert.equal(diasEntre('2026-10-06','2026-10-01'),-5);
console.log('Estados de pago: plantilla Yeso, anticipo, retención, GG/utilidad, boleta, UF y devolución correctos.');
