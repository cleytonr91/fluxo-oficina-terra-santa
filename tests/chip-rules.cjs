// Rules API evaluation with synthetic resources and mocked profile reads. No document writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const project='fluxo-oficina-terra-santa',lib=process.env.FIREBASE_TOOLS_LIB;
if(!lib)throw Error('Set FIREBASE_TOOLS_LIB to the installed firebase-tools/lib directory.');
const now='2026-09-25T13:00:00Z';
const before={status:'ativo',currentLane:'aguardando_servico',plate:'ABC1D23',washType:'simples',washDone:false,promisedDeliveryAt:'2026-09-25T17:00:00Z'};
const cases=[],names=[];
function add(name,role,method,collection,resource,data,expectation='ALLOW',extra={}) {
 names.push(name);
 cases.push({expectation,request:{path:`/databases/(default)/documents/${collection}/test`,method,auth:{uid:'test'},time:now,...(data?{resource:{data}}:{}),...extra},resource:{data:resource??{}},functionMocks:[{function:'get',args:[{anyValue:{}}],result:{value:{data:{active:true,role}}}}]});
}
function edit(name,role,action,patch,expectation='ALLOW',original=before){
 add(name,role,'update','vehiclesFlow',original,{...original,...patch,chipAction:action,chipActor:'test',chipDetailVersion:1,updatedAt:now},expectation);
}
edit('plate edit','tecnico','plate',{plate:'DEF4G56'});
edit('plate cannot smuggle status','tecnico','plate',{plate:'DEF4G56',status:'cancelado'},'DENY');
edit('admin assigns consultant','admin','consultant',{consultantName:'Eliane'});
edit('technician cannot assign consultant','tecnico','consultant',{consultantName:'Eliane'},'DENY');
edit('technician assignment','consultor','technician',{technicianName:'Wesley'});
edit('service type','consultor','service',{serviceLabel:'Diagnóstico',serviceType:'diagnostico'});
edit('wash type','lider_lavagem','wash',{washType:'motor'});
edit('client waits','consultor','wait',{customerWaits:true,customerWaitsUpdatedBy:'Teste',customerWaitsUpdatedAt:now});
edit('stock cannot change waits','estoquista','wait',{customerWaits:true},'DENY');
edit('chief immobilizes','chefe_oficina','immobilize',{vehicleImmobilized:true,immobilizationReason:'aguardando_pecas'});
edit('consultant cannot immobilize','consultor','immobilize',{vehicleImmobilized:true,immobilizationReason:'aguardando_pecas'},'DENY');
edit('immobilization requires valid reason','chefe_oficina','immobilize',{vehicleImmobilized:true,immobilizationReason:''},'DENY');
edit('promise extends','consultor','promise',{promisedDeliveryAt:'2026-09-25T18:00:00Z',promiseHistory:[]});
edit('consultant cannot reduce promise','consultor','promise',{promisedDeliveryAt:'2026-09-25T16:00:00Z'},'DENY');
edit('admin can reduce promise','admin','promise',{promisedDeliveryAt:'2026-09-25T16:00:00Z'});
edit('stage correction','consultor','stage',{currentLane:'em_servico',status:'ativo',noShow:false});
edit('correction cannot deliver','consultor','stage',{currentLane:'entregue'},'DENY');
edit('admin cancels','admin','cancel',{status:'cancelado'});
edit('consultant cannot cancel','consultor','cancel',{status:'cancelado'},'DENY');
edit('road form','tecnico','roadTest',{roadTestForm:{serviceOrder:'123'}});
edit('parts flag','tecnico','parts',{partsOrdered:true});
edit('wash anticipation','consultor','advanceWash',{currentLane:'lavagem',washingAdvanced:true,serviceCompleted:false,advancedWashReturnLane:'aguardando_servico'});
edit('anticipation cannot choose arbitrary return','consultor','advanceWash',{currentLane:'lavagem',washingAdvanced:true,serviceCompleted:false,advancedWashReturnLane:'entregue'},'DENY');
edit('quality cannot edit chips','qualidade','plate',{plate:'DEF4G56'},'DENY');
add('bounded history','consultor','list','flowEvents',{},null,'ALLOW',{query:{limit:51}});
add('unbounded history denied','consultor','list','flowEvents',{},null,'DENY',{query:{limit:52}});
add('bounded parts','tecnico','list','partOrders',{},null,'ALLOW',{query:{limit:21}});
add('unbounded parts denied','tecnico','list','partOrders',{},null,'DENY',{query:{limit:22}});
const order={vehicleFlowId:'test',orderKind:'garantia',parts:[{id:'1',partReference:'REF'}],orderStatus:'solicitado_oficina',trackingState:'active',chipDetailVersion:1,chipActor:'test',updatedAt:now};
add('create workshop order','tecnico','create','partOrders',{},order);
add('cannot create already available order','tecnico','create','partOrders',{}, {...order,orderStatus:'disponivel'},'DENY');
add('preserve parts sector status','tecnico','update','partOrders',{...order,orderStatus:'disponivel'}, {...order,orderStatus:'disponivel',parts:[{id:'1',partReference:'NEW'}]});
add('cannot reset sector status','tecnico','update','partOrders',{...order,orderStatus:'disponivel'},order,'DENY');
add('no legacy catalog list','admin','list','partsCatalog',{},null,'DENY');
add('no legacy appointment reads','admin','list','appointments',{},null,'DENY');
add('wash returns to budget','lider_lavagem','update','vehiclesFlow',{...before,currentLane:'lavagem',washingAdvanced:true,advancedWashReturnLane:'orcamento_complementar'}, {...before,currentLane:'orcamento_complementar',washingAdvanced:false,advancedWashReturnLane:null,washDone:true,basicFlowVersion:1,basicUpdatedBy:'test',updatedAt:now});
const walkIn={origin:'passante',status:'ativo',currentLane:'aguardando_servico',clientName:'Teste',consultantName:'Luan',technicianName:'Wesley',promisedDeliveryAt:'2026-09-25T17:00:00Z',basicWalkInVersion:1,basicWalkInActor:'test',updatedAt:now,attendanceStartedAt:now,createdAt:now,customerWaits:false,partsOrdered:false,appointmentDate:'2026-09-25'};
add('consultant creates walk-in','consultor','create','vehiclesFlow',{},walkIn);
add('walk-in cannot set immobilized','consultor','create','vehiclesFlow',{}, {...walkIn,vehicleImmobilized:true},'DENY');
add('quality cannot create walk-in','qualidade','create','vehiclesFlow',{},walkIn,'DENY');
add('walk-in cannot create delivered','consultor','create','vehiclesFlow',{}, {...walkIn,currentLane:'entregue'},'DENY');
const pending={...walkIn,origin:'agendado',currentLane:'preparacao_confirmada',appointmentDate:'2026-09-24'};
add('reuse old scheduled','consultor','update','vehiclesFlow',pending,walkIn);
add('cannot reuse service chip','consultor','update','vehiclesFlow',{...pending,currentLane:'em_servico'},walkIn,'DENY');
async function main(){
 const account=require(path.join(lib,'auth')).getProjectDefaultAccount(process.cwd());
 await require(path.join(lib,'requireAuth')).requireAuth({project,...account});
 const {Client}=require(path.join(lib,'apiv2'));
 const api=new Client({urlPrefix:'https://firebaserules.googleapis.com',apiVersion:'v1'});
 const result=await api.post(`/projects/${project}:test`,{source:{files:[{name:'firestore.rules',content:fs.readFileSync('firestore.limited.rules','utf8')}]},testSuite:{testCases:cases}});
 const results=result.body.testResults??[];
 assert.equal(results.length,cases.length,JSON.stringify(result.body));
 const failed=results.flatMap((r,i)=>r.state==='SUCCESS'?[]:[{name:names[i],...r}]);
 if(failed.length)console.log(JSON.stringify(failed,null,2));
 assert.equal(failed.length,0);
 console.log(`${results.length} rules cases passed, synthetic resources only.`);
}
const timeout=setTimeout(()=>process.exit(2),60000);
main().then(()=>{clearTimeout(timeout);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)});
