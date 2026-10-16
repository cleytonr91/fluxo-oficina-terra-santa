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

test('priority uses later appointment or receipt; walk-ins use receipt only',()=>{
 const make=(id,appointmentTime,received,extra={})=>({id,status:'ativo',currentLane:'aguardando_servico',origin:'agendado',appointmentDate:'2026-10-16',appointmentTime,attendanceStartedAt:received,...extra});
 const early=make('early','10:00','2026-10-16T07:30:00-03:00');
 const onTime=make('onTime','07:30','2026-10-16T07:35:00-03:00');
 const late=make('late','07:30','2026-10-16T10:15:00-03:00');
 assert.deepEqual(domain.sortFlowLane([early,late,onTime],'2026-10-16').map(v=>v.id),['onTime','early','late']);
 assert.equal(domain.flowSequenceTime(early),Date.parse('2026-10-16T10:00:00-03:00'));
 assert.equal(domain.flowSequenceTime(make('walk','10:00','2026-10-16T07:30:00-03:00',{origin:'passante'})),Date.parse('2026-10-16T07:30:00-03:00'));
 assert.equal(domain.flowSequenceTime(make('missing','','2026-10-16T07:30:00-03:00')),Date.parse('2026-10-16T07:30:00-03:00'));
 assert.equal(domain.flowSequenceTime(make('old','23:00','2026-10-16T01:00:00-03:00',{appointmentDate:'2026-10-15'})),Date.parse('2026-10-16T01:00:00-03:00'));
});

test('immobilized chips only appear in their filter and return to their unchanged lane on release',()=>{
 const regular={id:'normal',status:'ativo',currentLane:'em_servico'};
 const held={id:'held',status:'ativo',currentLane:'em_servico',vehicleImmobilized:true};
 const noShow={id:'no-show',status:'ativo',currentLane:'preparacao_confirmada',noShow:true,vehicleImmobilized:true};
 const cancelled={id:'cancelled',status:'cancelado',vehicleImmobilized:true};
 const list=[regular,held,noShow,cancelled];
 assert.deepEqual(domain.visibleByImmobilization(list,false),[regular]);
 assert.deepEqual(domain.visibleByImmobilization(list,true),[held,noShow]);
 const released={...held,vehicleImmobilized:false};
 assert.deepEqual(domain.visibleByImmobilization([regular,released],false),[regular,released]);
 assert.deepEqual(domain.visibleByImmobilization([released],true),[]);
 assert.equal(released.currentLane,'em_servico');assert.equal(held.vehicleImmobilized,true);
 const source=fs.readFileSync('src/components/basic-flow-board.tsx','utf8');
 assert.match(source,/const visible = visibleByImmobilization\(/);
});

test('lane order uses appointment before receipt and actual receipt afterwards',()=>{
 const make=(id,time,extra={})=>({id,currentLane:'preparacao_confirmada',appointmentDate:'2026-09-30',appointmentTime:time,...extra});
 const ids=items=>domain.sortFlowLane(items,'2026-09-30').map(v=>v.id);
 const late=make('late','10:00'),early=make('early','8:00');
 const input=[late,early];assert.deepEqual(ids(input),['early','late']);assert.equal(input[0],late);
 assert.deepEqual(ids([make('late','08:00',{currentLane:'em_servico',attendanceStartedAt:'2026-09-30T13:00:00Z'}),make('early','10:00',{currentLane:'em_servico',attendanceStartedAt:{seconds:Date.parse('2026-09-30T12:00:00Z')/1000}})]),['early','late']);
 assert.deepEqual(ids([make('missing','99:99'),make('valid','09:00')]),['valid','missing']);
 assert.deepEqual(ids([make('b',''),make('a','')]),['a','b']);
 assert.equal(domain.flowSequenceTime(make('walk','15:00',{origin:'passante',currentLane:'aguardando_servico',createdAt:new Date('2026-09-30T11:00:00Z')})),Date.parse('2026-09-30T11:00:00Z'));
 assert.deepEqual(ids([make('today','08:00',{currentLane:'em_servico'}),make('old','17:00',{currentLane:'em_servico',appointmentDate:'2026-09-29'})]),['old','today']);
});

test('wash queue retains previous day, scheduled priority and simple wash as tie breaker',()=>{
 const make=(id,date,time,origin='agendado',washType='motor')=>({id,currentLane:'aguardando_lavagem',appointmentDate:date,appointmentTime:time,origin,washType});
 const list=[make('walk','2026-09-30','07:00','passante'),make('scheduled','2026-09-30','10:00'),make('old','2026-09-29','17:00','passante'),make('simple','2026-09-30','10:00','agendado','simples')];
 assert.deepEqual(domain.sortFlowLane(list,'2026-09-30').map(v=>v.id),['old','simple','scheduled','walk']);
});
test('scheduled column only includes today, without hiding vehicles already in service',()=>{
 const today='2026-09-25';
 for(const date of ['2026-09-24','2026-09-26','',undefined]) {
  assert.equal(domain.isCurrentDayAppointment({currentLane:'preparacao_confirmada',appointmentDate:date},today),false);
 }
 assert.equal(domain.isCurrentDayAppointment({currentLane:'preparacao_confirmada',appointmentDate:today},today),true);
 assert.equal(domain.isCurrentDayAppointment({currentLane:'preparacao_confirmada',appointmentDate:'2026-09-24',noShow:true},today),false);
 for(const lane of ['aguardando_servico','em_servico','lavagem','preparacao_entrega']) {
  assert.equal(domain.isCurrentDayAppointment({currentLane:lane,appointmentDate:'2026-09-24'},today),true);
 }
 assert.equal(domain.localDay(new Date('2026-09-26T02:59:00Z')),today);
 assert.equal(domain.localDay(new Date('2026-09-26T03:00:00Z')),'2026-09-26');
});
function setup(saved={status:'ativo',currentLane:'aguardando_servico',washType:'simples'}) {
  const writes=[],listeners=[];let reads=0;
  const service=load('src/services/basic-flow.ts',{
    '@/lib/basic-flow':domain,'@/lib/firebase/client':{getFirebaseDb:()=>({})},
    'firebase/firestore':{
      collection:(_,name)=>name,doc:(...args)=>args.length===3?args.slice(1).join('/'):args[0]+'/event',
      limit:n=>({limit:n}),where:(...args)=>({where:args}),query:(...args)=>args,
      and:(...args)=>({and:args}),or:(...args)=>({or:args}),
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
  s.listeners[0].cb({size:0,docs:[]});assert.equal(emitted,2,'recovers after relevant overflow clears');
  stop();assert.ok(s.listeners.every(x=>x.stopped));
});
test('server filter excludes old and future appointments before the 301 limit, retaining ongoing work',()=>{
 const s=setup();const today='2026-10-13';let result;
 s.service.subscribeBasicFlow(today,data=>result=data,assert.fail,today);
 function matches(filter,v){
  if(filter.and)return filter.and.every(f=>matches(f,v));
  if(filter.or)return filter.or.some(f=>matches(f,v));
  const [field,op,value]=filter.where;return op==='=='?v[field]===value:value.includes(v[field]);
 }
 const filter=s.listeners[0].q.find(f=>f.and);
 const old=Array.from({length:400},(_,i)=>({id:'old'+i,status:'ativo',currentLane:'preparacao_confirmada',appointmentDate:'2026-10-12',noShow:true}));
 const keep=[{id:'today',status:'ativo',currentLane:'preparacao_confirmada',appointmentDate:today,noShow:true},
 ...['aguardando_servico','em_servico','orcamento_complementar','aguardando_lavagem','lavagem','preparacao_entrega'].map(currentLane=>({id:currentLane,status:'ativo',currentLane,appointmentDate:'2026-01-01',vehicleImmobilized:true}))];
 const all=[...old,...keep,{id:'future',status:'ativo',currentLane:'preparacao_confirmada',appointmentDate:'2026-10-14'},{id:'cancelled',status:'cancelado',currentLane:'em_servico'}];
 const selected=all.filter(v=>matches(filter,v)).slice(0,301);
 s.listeners[0].cb({size:selected.length,docs:selected.map(v=>({id:v.id,data:()=>v}))});
 s.listeners[1].cb({size:0,docs:[]});assert.deepEqual(result,keep);assert.equal(s.writes.length,0);
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

test('restored layout keeps one subscription effect keyed only by day and no auxiliary services',()=>{
 const source=fs.readFileSync('src/components/basic-flow-board.tsx','utf8');
 assert.equal((source.match(/subscribeBasicFlow\(day/g)||[]).length,1);
 assert.match(source,/return \(\) => \{ alive = false; stop\(\); \};\s*\}, \[day, today\]\)/);
 assert.doesNotMatch(source,/getDocs|onSnapshot|subscribePart|subscribeFlowEvents|loadHyundaiPartsCatalog/);
 assert.match(source,/data-flow-mode="basic-restored"/);
});
