const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,mocks){const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>mocks[name]??require(name),mod,mod.exports);return mod.exports;}
test('all order scopes have hard limits and cursor pagination, with only linked vehicle gets',async()=>{
 const queries=[],gets=[];
 const api=load('src/services/parts-pages.ts',{'@/lib/firebase/client':{getFirebaseDb:()=>({})},'firebase/firestore':{
  collection:(_,name)=>name,doc:(_,name,id)=>`${name}/${id}`,documentId:()=> '__name__',
  where:(...args)=>['where',...args],orderBy:(...args)=>['orderBy',...args],limit:n=>['limit',n],startAfter:id=>['cursor',id],query:(...args)=>args,
  getDocs:async q=>{queries.push(q);return{size:50,docs:Array.from({length:50},(_,i)=>({id:`id-${i}`,data:()=>({vehicleFlowId:i%2?'same':''})}))};},
  getDoc:async ref=>{gets.push(ref);return{exists:()=>true,id:'same',data:()=>({status:'ativo'})};}
 }});
 for(const scope of ['active','archive','scheduling']){
  const result=await api.loadPartsPage(scope,'last');assert.equal(result.orders.length,50);assert.equal(result.cursor,'id-49');
  assert.equal(result.vehicles.length,1);
 }
 assert.equal(gets.length,3);for(const q of queries){assert.ok(q.some(x=>Array.isArray(x)&&x[0]==='limit'&&x[1]===50));assert.ok(q.some(x=>Array.isArray(x)&&x[0]==='cursor'&&x[1]==='last'));}
});
test('pages cannot run broad listeners or automatic scheduling completion',()=>{
 for(const name of ['pecas','agendamento']){
  const source=fs.readFileSync(`src/app/${name}/page.tsx`,'utf8');
  assert.doesNotMatch(source,/subscribe[A-Z]|markPartSchedulingCompleted|ensurePartOrderTracking|listArchivedPartOrders/);
  assert.match(source,/usePartsPage/);assert.match(source,/Carregar mais 50/);
 }
 const source=fs.readFileSync('src/app/pecas/page.tsx','utf8');
 assert.doesNotMatch(source,/syncPublicPartsPortal/);
 const search=source.slice(source.indexOf('function applySearchQuery'),source.indexOf('async function importPartsCatalog'));
 assert.doesNotMatch(search,/ensureArchiveLoaded|loadPartsPage/);
});
test('unchanged catalog import writes nothing; persistent cache uses just metadata',async()=>{
 const items=[{reference:'A',description:'Peca'}],crypto=require('node:crypto').webcrypto;
 global.crypto=crypto;
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(items)))).toString('hex');
 let reads=0,writes=0;
 global.localStorage={getItem:()=>JSON.stringify({version:`${hash}:1:1`,items}),removeItem(){},setItem(){}};
 const api=load('src/services/parts-catalog-cache.ts',{'@/lib/firebase/client':{getFirebaseDb:()=>({})},'firebase/firestore':{
  doc:(_,name,id)=>`${name}/${id}`,getDoc:async()=>{reads++;return{exists:()=>true,data:()=>({chunkCount:1,contentHash:hash,importedAt:{toMillis:()=>1}})}},
  writeBatch:()=>({set(){writes++;},commit:async()=>{}}),serverTimestamp:()=> 'now',
 }});
 await api.importCachedCatalog({items,sourceFileName:'test'});assert.equal(writes,0);
 assert.deepEqual(await api.loadCachedCatalog(),items);assert.equal(reads,2);
 await api.loadCachedCatalog();assert.equal(reads,2);
});
test('saving the same order or scheduling action again performs no extra writes',async()=>{
 let data={orderStatus:'solicitado_oficina',trackingState:'active'},writes=0;
 const api=load('src/services/firestore.ts',{
  '@/lib/limited-operation':{LIMITED_OPERATION:true},'@/services/parts-catalog-cache':{},
  '@/lib/firebase/client':{getFirebaseDb:()=>({})},'@/lib/firebase/collections':{collections:{partOrders:'partOrders'}},
  'firebase/firestore':{collection:(_,name)=>name,doc:()=> 'order',getDoc:async()=>({exists:()=>true,data:()=>data}),
   serverTimestamp:()=> 'TIME',setDoc:async(_,value)=>{writes++;data={...data,...value};},deleteField:()=>undefined,arrayUnion:x=>[x],
   runTransaction:async(_,callback)=>callback({get:async()=>({exists:()=>true,data:()=>data}),set:(_,value)=>{writes++;data={...data,...value};}})
  }
 });
 const input={orderId:'test',vehicleFlowId:'vehicle',plate:'ABC1D23',orderStatus:'solicitado_oficina',parts:[{id:'1',partReference:'REF',partDescription:'Teste'}]};
 await api.updatePartOrder(input);assert.equal(writes,1);await api.updatePartOrder(input);assert.equal(writes,1);
 data={...data,orderStatus:'disponivel'};
 const action={orderId:'test',action:'contato_sem_sucesso',contactAttemptAt:'2026-09-28T09:00',note:'Contato'};
 await api.registerPartSchedulingAction(action);assert.equal(writes,2);await api.registerPartSchedulingAction(action);assert.equal(writes,2);
 data={...data,orderStatus:'cancelado'};
 await assert.rejects(()=>api.registerPartSchedulingAction(action),/disponível/);assert.equal(writes,2);
});
