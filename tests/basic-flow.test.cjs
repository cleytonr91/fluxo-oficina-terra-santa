const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, mocks={}) {
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',js)(n=>mocks[n]??require(n),mod,mod.exports);
  return mod.exports;
}
const domain=load('src/lib/basic-flow.ts');
function setup(saved={status:'ativo',currentLane:'aguardando_servico',washType:'simples'}) {
  const writes=[],listeners=[];let reads=0;
  const service=load('src/services/basic-flow.ts',{
    '@/lib/basic-flow':domain,'@/lib/firebase/client':{getFirebaseDb:()=>({})},
    'firebase/firestore':{
      collection:(_,name)=>name,doc:(...args)=>args.length===3?args.slice(1).join('/'):args[0]+'/event',
      limit:n=>({limit:n}),where:(...args)=>({where:args}),query:(...args)=>args,
      Timestamp:{fromDate:d=>d},serverTimestamp:()=> 'SERVER_TIME',
      onSnapshot:(q,cb,err)=>{const entry={q,cb,err,stopped:false};listeners.push(entry);return()=>entry.stopped=true;},
      runTransaction:async(_,cb)=>cb({get:async()=>{reads++;return{exists:()=>!!saved,id:'v1',data:()=>saved};},set:(...args)=>writes.push(args),update:(...args)=>writes.push(args)})
    }
  });
  return {service,writes,listeners,reads:()=>reads};
}
const input={vehicleId:'v1',from:'aguardando_servico',to:'em_servico',actor:'Teste',actorId:'uid',technician:'Wesley',consultant:'Eliane',washType:'simples',promised:'',note:'',customerWaits:false,onTime:true,pending:false,nps:''};
test('load opens exactly two bounded subscriptions and no writes; overflow blocks partial data',()=>{
  const s=setup();let emitted=0,error='';
  const stop=s.service.subscribeBasicFlow('2026-09-25',()=>emitted++,e=>error=e.message);
  assert.equal(s.listeners.length,2);assert.equal(s.writes.length,0);assert.equal(s.reads(),0);
  assert.ok(s.listeners[0].q.some(x=>x.limit===301));assert.ok(s.listeners[1].q.some(x=>x.limit===101));
  s.listeners[0].cb({size:1,docs:[{id:'v1',data:()=>({status:'ativo'})}]});assert.equal(emitted,0);
  s.listeners[1].cb({size:0,docs:[]});assert.equal(emitted,1);
  s.listeners[0].cb({size:301,docs:[]});assert.match(error,/300/);assert.equal(emitted,1);
  stop();assert.ok(s.listeners.every(x=>x.stopped));
});
test('move reads one chip, writes vehicle and audit only',async()=>{
  const s=setup();await s.service.moveBasicVehicle(input);
  assert.equal(s.reads(),1);assert.equal(s.writes.length,2);
  assert.equal(s.writes[0][1].technicianName,'Wesley');
  assert.equal(s.writes[1][1].actorId,'uid');
});
test('stale movement, absent technician and invalid transitions write nothing',async()=>{
  for(const [saved,change] of [[{status:'ativo',currentLane:'lavagem'},{}],[{status:'ativo',currentLane:'aguardando_servico'},{technician:''}],[{status:'ativo',currentLane:'aguardando_servico'},{to:'entregue'}]]){
    const s=setup(saved);await assert.rejects(()=>s.service.moveBasicVehicle({...input,...change}));assert.equal(s.writes.length,0);
  }
});
test('receiving sets actual receipt, removes no-show and requires explicit promise',async()=>{
  const s=setup({status:'ativo',currentLane:'preparacao_confirmada'});
  await assert.rejects(()=>s.service.moveBasicVehicle({...input,from:'preparacao_confirmada',to:'aguardando_servico'}));
  assert.equal(s.writes.length,0);
  await s.service.moveBasicVehicle({...input,from:'preparacao_confirmada',to:'aguardando_servico',promised:'2026-09-25T17:00'});
  assert.equal(s.writes[0][1].attendanceStartedAt,'SERVER_TIME');assert.equal(s.writes[0][1].noShow,false);
});
test('delivery preserves post-service fields without touching parts collections',async()=>{
  const s=setup({status:'ativo',currentLane:'preparacao_entrega',technicianName:'Wesley'});
  await s.service.moveBasicVehicle({...input,from:'preparacao_entrega',to:'entregue',nps:'9',pending:true});
  assert.equal(s.reads(),1);assert.equal(s.writes.length,3);
  const vehicle=s.writes.find(x=>x[0]==='vehiclesFlow/v1')[1];assert.equal(vehicle.status,'entregue');assert.equal(vehicle.internalNps,9);assert.equal(vehicle.hasPendingIssue,true);
  assert.ok(s.writes.every(x=>!x[0].includes('part')));
});
test('lane permissions and existing advanced wash return are maintained',()=>{
  assert.equal(domain.canOperateBasic('estoquista','aguardando_servico'),false);
  assert.equal(domain.canOperateBasic('tecnico','aguardando_servico'),true);
  assert.equal(domain.canOperateBasic('consultor','preparacao_confirmada'),true);
  assert.equal(domain.canOperateBasic('lider_lavagem','lavagem'),true);
  assert.deepEqual(domain.basicTargets({currentLane:'lavagem',washingAdvanced:true,serviceCompleted:false}),['aguardando_servico']);
});
