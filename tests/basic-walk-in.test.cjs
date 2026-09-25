const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,mocks={}){const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(n=>mocks[n]??require(n),mod,mod.exports);return mod.exports;}
const domain=load('src/lib/basic-flow.ts'),actor={uid:'user',name:'Luan',role:'consultor'};
const input={client:'Cliente teste',phone:'',plate:'ABC1D23',chassi:'',model:'HB20',service:'Revisão 01',consultant:'Luan',technician:'Wesley',washType:'simples',promised:'2026-09-25T17:00',note:'',day:domain.localDay()};
function setup(existing=null){
 const writes=[],reads=[];
 const service=load('src/services/basic-walk-in.ts',{'@/lib/basic-flow':domain,'@/lib/firebase/client':{getFirebaseDb:()=>({})},'firebase/firestore':{
  collection:(_,name)=>name,doc:(...args)=>args.length===3?args.slice(1).join('/'):args[0]+'/event',Timestamp:{fromDate:d=>d},serverTimestamp:()=>'SERVER_TIME',
  runTransaction:async(_,cb)=>cb({get:async ref=>{reads.push(ref);return{exists:()=>!!existing,data:()=>existing};},set:(...args)=>writes.push(args),update:(...args)=>writes.push(args)})
 }});return{service,reads,writes};
}
test('Luan can add a walk-in with one targeted read and two writes',async()=>{
 const s=setup();await s.service.createBasicWalkIn(input,actor);assert.equal(s.reads.length,1);assert.equal(s.writes.length,2);
 const chip=s.writes[0][1];assert.equal(chip.consultantName,'Luan');assert.equal(chip.currentLane,'aguardando_servico');assert.equal(chip.attendanceStartedAt,'SERVER_TIME');
 assert.ok(s.writes.every(([ref])=>!ref.startsWith('appointments/')&&!ref.startsWith('partOrders/')&&!ref.startsWith('walkInCustomers/')));
});
test('repeat submit cannot overwrite an existing chip',async()=>{
 const s=setup({status:'ativo',currentLane:'em_servico'});await assert.rejects(()=>s.service.createBasicWalkIn(input,actor));assert.equal(s.writes.length,0);
});
test('identity uses matching chassis, never null placeholders',()=>{
 const s=setup().service;
 assert.equal(s.findBasicWalkInConflict({plate:'NULL',chassi:''},[{status:'ativo',plate:'null',chassi:'OTHER'}]),undefined);
 assert.equal(s.findBasicWalkInConflict({plate:'ABC1D23',chassi:'ONE'},[{status:'ativo',plate:'ABC1D23',chassi:'TWO'}]),undefined);
 assert.ok(s.findBasicWalkInConflict({plate:'',chassi:'ONE'},[{status:'ativo',plate:'',chassi:'one'}]));
 assert.equal(s.findBasicWalkInConflict({plate:'ABC1D23',chassi:''},[{status:'entregue',plate:'ABC1D23'}]),undefined);
});
test('old scheduled chip is reused only if still pending, never another active stage',async()=>{
 const old={id:'old',status:'ativo',currentLane:'preparacao_confirmada',appointmentDate:'2020-01-01',plate:'ABC1D23'};
 const s=setup(old);await s.service.createBasicWalkIn(input,actor,old);assert.equal(s.reads[0],'vehiclesFlow/old');assert.equal(s.writes.length,2);
 const t=setup({...old,currentLane:'em_servico'});await assert.rejects(()=>t.service.createBasicWalkIn(input,actor,old));assert.equal(t.writes.length,0);
});
test('embellishment assigns Igo, requires wash; invalid form writes nothing',async()=>{
 const s=setup();await s.service.createBasicWalkIn({...input,service:'Embelezamento'},actor);assert.equal(s.writes[0][1].technicianName,'Igo');assert.equal(s.writes[0][1].currentLane,'aguardando_lavagem');
 for(const change of [{service:'Embelezamento',washType:'nao'},{consultant:''},{technician:''},{promised:''},{day:'2020-01-01'},{plate:'',chassi:'null'}]){
  const t=setup();await assert.rejects(()=>t.service.createBasicWalkIn({...input,...change},actor));assert.equal(t.reads.length,0);assert.equal(t.writes.length,0);
 }
});
