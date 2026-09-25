const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
function load(file,mocks={}) {
 const mod={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(n=>mocks[n]??require(n),mod,mod.exports);
 return mod.exports;
}
const domain=load('src/lib/basic-flow.ts');
const vehicle={id:'v1',status:'ativo',currentLane:'aguardando_servico',washType:'simples',washDone:false,plate:'ABC1D23',updatedAt:{seconds:100,nanoseconds:1}};
const actor={uid:'test',name:'Operador teste',role:'admin'};
function setup(current=vehicle,order=null,queryDocs=[]) {
 const reads=[],writes=[],queries=[];
 const snapshot=(id,data)=>({id,exists:()=>data!==null,data:()=>data});
 const service=load('src/services/chip-details.ts',{
  '@/lib/basic-flow':domain,'@/lib/firebase/client':{getFirebaseDb:()=>({})},
  'firebase/firestore':{
   collection:(_,name)=>name,doc:(...args)=>args.length===3?args.slice(1).join('/'):args.join('/'),
   limit:n=>({limit:n}),where:(...args)=>({where:args}),orderBy:(...args)=>({orderBy:args}),startAfter:cursor=>({cursor}),query:(...args)=>args,
   Timestamp:{fromDate:d=>d},serverTimestamp:()=> 'SERVER_TIME',arrayUnion:item=>({arrayUnion:item}),
   getDoc:async ref=>{reads.push(ref);return snapshot(ref.split('/').at(-1),ref==='partsCatalog/meta'?{chunkCount:2}:ref.startsWith('partsCatalog/')?{items:[{id:ref}]}:order);},
   getDocs:async q=>{queries.push(q);return {size:queryDocs.length,docs:queryDocs.map((v,i)=>snapshot(String(i),v))};},
   runTransaction:async(_,cb)=>cb({get:async ref=>{reads.push(ref);return snapshot('v1',ref.startsWith('vehiclesFlow/')?current:order);},set:(...args)=>writes.push(args),update:(...args)=>writes.push(args)})
  }
 });
 return {service,reads,writes,queries};
}
test('role restrictions remain independent from the visible controls',()=>{
 const {service:s}=setup();
 for(const role of ['tecnico','lider_lavagem','estoquista','consultor']){
  assert.equal(s.canEditChip(role,'cancel'),false);
  assert.equal(s.canEditChip(role,'immobilize'),false);
 }
 assert.equal(s.canEditChip('chefe_oficina','immobilize'),true);
 assert.equal(s.canEditChip('consultor','wait'),true);
 assert.equal(s.canEditChip('qualidade','plate'),false);
 assert.throws(()=>s.prepareChipPatch(vehicle,{kind:'cancel',note:'test'},{...actor,role:'tecnico'},new Date()));
});
test('detail changes read one chip and write only chip plus audit',async()=>{
 const s=setup();await s.service.saveChipAction(vehicle,{kind:'plate',value:'def4g56'},actor);
 assert.deepEqual(s.reads,['vehiclesFlow/v1']);assert.equal(s.writes.length,2);assert.equal(s.queries.length,0);
 assert.equal(s.writes[0][1].plate,'DEF4G56');
});
test('stale versions, unchanged values and absent reasons perform no writes',async()=>{
 const s=setup({...vehicle,updatedAt:{seconds:100,nanoseconds:2}});
 await assert.rejects(()=>s.service.saveChipAction(vehicle,{kind:'plate',value:'DEF4G56'},actor));assert.equal(s.writes.length,0);
 for(const action of [{kind:'plate',value:vehicle.plate},{kind:'stage',value:'em_servico',note:''},{kind:'promise',value:'',note:''}]) {
  const t=setup();await assert.rejects(()=>t.service.saveChipAction(vehicle,action,actor));assert.equal(t.writes.length,0);
 }
});
test('promise is explicit, non-admin cannot reduce it, event and history share one action',async()=>{
 const current={...vehicle,promisedDeliveryAt:new Date('2026-09-25T19:00:00Z')},s=setup(current);
 await assert.rejects(()=>s.service.saveChipAction(current,{kind:'promise',value:'2026-09-25T18:00:00Z',note:'Teste'},{...actor,role:'consultor'}));
 await s.service.saveChipAction(current,{kind:'promise',value:'2026-09-25T20:00:00Z',note:'Teste'},actor);
 assert.equal(s.writes.length,2);assert.equal(s.writes[0][1].promiseHistory.arrayUnion.chipDetailVersion,1);
});
test('parts save preserves sector status and does not write public lookup',async()=>{
 const s=setup(vehicle,{orderStatus:'disponivel',invoiceNumber:'NF-123'});
 await s.service.saveChipAction(vehicle,{kind:'parts',orderKind:'garantia',parts:[{id:'1',partReference:' a123 ',partDescription:'Item'}]},actor);
 assert.equal(s.reads.length,2);assert.equal(s.writes.length,3);
 const write=s.writes.find(w=>w[0]==='partOrders/v1');assert.equal(write[1].orderStatus,undefined);assert.equal(write[1].invoiceNumber,undefined);assert.equal(write[2].merge,true);
 assert.equal(write[1].parts[0].partReference,'A123');assert.ok(s.writes.every(w=>!w[0].includes('public')));
});
test('parts lookup ignores null chassis and every query is bounded',async()=>{
 const s=setup();await s.service.loadChipOrders({...vehicle,chassi:'null'});
 assert.equal(s.queries.length,1);assert.ok(s.queries[0].some(x=>x.limit===21));assert.equal(s.writes.length,0);
 const t=setup();await t.service.loadChipOrders({...vehicle,chassi:'9BH123'});assert.equal(t.queries.length,2);
 assert.ok(t.queries.every(q=>q.some(x=>x.limit===21)));
});
test('history paginates 50 events with one lookahead, catalog caches one bounded session load',async()=>{
 const s=setup(vehicle,null,Array.from({length:51},()=>({vehicleFlowId:'v1'})));
 const page=await s.service.loadChipHistory('v1');assert.equal(page.events.length,50);assert.ok(page.cursor);assert.ok(s.queries[0].some(x=>x.limit===51));
 await s.service.loadChipHistory('v1',page.cursor);assert.ok(s.queries[1].some(x=>x.cursor===page.cursor));
 await s.service.loadChipCatalog();await s.service.loadChipCatalog();assert.equal(s.reads.filter(r=>r.startsWith('partsCatalog')).length,3);assert.equal(s.writes.length,0);
});
test('advance wash returns to its origin, invalid anticipation is rejected',()=>{
 const s=setup();
 for(const lane of ['aguardando_servico','orcamento_complementar']){
  const {patch}=s.service.prepareChipPatch({...vehicle,currentLane:lane},{kind:'advanceWash'},actor,new Date());
  assert.equal(patch.currentLane,'lavagem');assert.deepEqual(domain.basicTargets({...vehicle,...patch}),[lane]);
 }
 assert.throws(()=>s.service.prepareChipPatch({...vehicle,washDone:true},{kind:'advanceWash'},actor,new Date()));
});
test('board opens details without auxiliary collection subscriptions or automatic writes',()=>{
 const modal=fs.readFileSync('src/components/chip-details-modal.tsx','utf8');
 assert.doesNotMatch(modal,/onSnapshot|setInterval|subscribePart|subscribeFlow/);
 assert.match(modal,/useState\(""\)/);assert.match(modal,/loadChipHistory/);
 const board=fs.readFileSync('src/components/basic-flow-board.tsx','utf8');
 assert.match(board,/onDoubleClick=\{\(\) => setDetail/);assert.match(board,/vehicles.find/);
});
