// Interactive React harness with synthetic data. All Firebase/PDF calls are mocked.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
const root=process.cwd(),output=path.resolve('output/chip-details-qa');fs.mkdirSync(output,{recursive:true});
const sources=new Map();
const mocks={
 '@/services/basic-walk-in':`exports.findBasicWalkInConflict=()=>undefined;exports.createBasicWalkIn=async(form)=>{window.walkInForm=form;window.counts.saves++;return 'test'};`,
 '@/context/auth-context':`exports.useAuth=()=>({profile:{role:window.testRole||'admin',name:'Operador teste'},user:{uid:'test'}});`,
 '@/services/firestore':`exports.loadHyundaiPartsCatalog=async()=>[];`,
 '@/lib/road-test-pdf':`exports.downloadRoadTestPdf=async()=>{window.counts.pdf++;};`,
 '@/services/chip-details':`exports.canEditChip=(role,kind)=>kind==='cancel'||kind==='consultant'?['admin','gerente'].includes(role):kind==='immobilize'?['admin','gerente','chefe_oficina'].includes(role):kind==='wait'?['admin','consultor'].includes(role):true;
 exports.chipDate=v=>v?new Date(v):null;
 exports.loadChipCatalog=async()=>{window.counts.catalog++;return[]};
 exports.loadChipOrders=async()=>{window.counts.orders++;return{orders:[{id:'test',orderStatus:'disponivel',orderKind:'garantia',parts:[{id:'1',partReference:'REF123',partDescription:'Item de teste'}],invoiceNumber:'NF-TESTE',updatedBy:'Setor de peças'}]}};
 exports.loadChipHistory=async()=>{window.counts.history++;return{events:[{id:'e1',toLane:'aguardando_servico',actionBy:'Eliane',createdAt:'2026-09-25T12:00:00Z',actionNote:'Recebido'}]}};
 exports.saveChipAction=async(vehicle,action)=>{window.counts.saves++;window.lastAction=action;await new Promise(r=>setTimeout(r,30));return{...vehicle,chipMutationId:'test-mutation'};};`,
};
function moduleId(file){return path.relative(root,file).replaceAll('\\','/');}
function bundle(file){
 const id=moduleId(file);if(sources.has(id))return id;sources.set(id,'');
 let source=fs.readFileSync(file,'utf8');
 if(/\.tsx?$/.test(file))source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 source=source.replace(/require\(["']([^"']+)["']\)/g,(_,name)=>{
  if(mocks[name]){sources.set(name,mocks[name]);return `require(${JSON.stringify(name)})`;}
  if(name.endsWith('.css')){sources.set(name,`exports.default=new Proxy({},{get:(_,key)=>key});`);return `require(${JSON.stringify(name)})`;}
  let target;
  if(name.startsWith('@/')){
   const base=path.join(root,'src',name.slice(2));target=['.tsx','.ts',''].map(ext=>base+ext).find(f=>fs.existsSync(f));
  }else target=require.resolve(name,{paths:[path.dirname(file)]});
  return `require(${JSON.stringify(bundle(target))})`;
 });
 sources.set(id,source);return id;
}
const component=bundle(path.join(root,'src/components/chip-details-modal.tsx'));
const walkInComponent=bundle(path.join(root,'src/components/basic-walk-in-modal.tsx'));
const react=bundle(require.resolve('react')),client=bundle(require.resolve('react-dom/client'));
const css=fs.readFileSync('src/app/globals.css','utf8').replace('@import "tailwindcss";','')+fs.readFileSync('src/components/basic-flow-board.module.css','utf8').replace(/:global\(([^)]+)\)/g,'$1')+fs.readFileSync('src/components/chip-details-modal.module.css','utf8').replace(/:global\(([^)]+)\)/g,'$1');
const js=`window.counts={orders:0,history:0,catalog:0,saves:0,pdf:0};const process={env:{NODE_ENV:'development'}};const modules={${[...sources].map(([id,code])=>`${JSON.stringify(id)}:function(module,exports,require){${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](m,m.exports,require);return m.exports;}const React=require(${JSON.stringify(react)});const {createRoot}=require(${JSON.stringify(client)});const {ChipDetailsModal}=require(${JSON.stringify(component)});
const vehicle={id:'test',status:'ativo',currentLane:'aguardando_servico',clientName:'CLIENTE DE TESTE',plate:'ABC1D23',chassi:'9BHTESTE1234567890',model:'HB20',consultantName:'Eliane',technicianName:'Wesley',serviceLabel:'Revisão 01',washType:'simples',washDone:false,customerWaits:false,promiseHistory:[{changedAt:'2026-09-25T12:10:00Z',promisedDeliveryAt:'2026-09-25T17:00:00Z',changedBy:'Eliane',note:'Ajuste anterior'}]};
const {BasicWalkInModal}=require(${JSON.stringify(walkInComponent)});
function Harness(){const[open,setOpen]=React.useState(true);return open?(location.search.includes('walk-in')?React.createElement(BasicWalkInModal,{day:'2026-09-25',vehicles:[],ready:true,onClose:()=>setOpen(false),onCreated:()=>setOpen(false)}):React.createElement(ChipDetailsModal,{vehicle,initialParts:location.search.includes('parts'),onClose:()=>setOpen(false)})):React.createElement('p',null,'Fechado');}createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));`;
fs.writeFileSync(path.join(output,'harness.html'),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font-family:Arial;margin:0}button,input,select,textarea{font:inherit}button{padding:10px;border:1px solid #ced9e2;border-radius:6px}.primary-btn{background:#002c5f;color:white}${css}</style><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></html>`);
async function main(){
 const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.join(output,'harness.html').replaceAll('\\','/'));
  await page.getByRole('heading',{name:'Ficha de Teste de Rodagem'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.counts),{orders:0,history:0,catalog:0,saves:0,pdf:0});
  assert.equal(await page.locator('input[type=datetime-local]').inputValue(),'');
  await page.screenshot({path:path.join(output,name+'-details.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Abrir pedidos de peças',exact:true}).click();
  await page.getByText('NF-TESTE',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Recolher pedidos'}).click();
  await page.getByRole('button',{name:'Abrir pedidos de peças',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.counts.orders),1);
  await page.getByRole('button',{name:'Carregar histórico',exact:true}).click();
  await page.getByText(/Ajuste anterior/).waitFor();
  assert.equal(await page.evaluate(()=>window.counts.history),1);
  const input=page.locator('section.history-box').filter({has:page.getByRole('heading',{name:'Placa do veículo',exact:true})}).locator('input');
  await input.fill('DEF4G56');await page.getByRole('button',{name:'Salvar placa',exact:true}).click();
  await page.getByText('Alteração salva.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.lastAction.kind),'plate');
  assert.equal(await page.evaluate(()=>window.counts.saves),1);
  await page.getByRole('button',{name:'Abrir ficha',exact:true}).click();
  await page.locator('canvas').first().waitFor();
  await page.screenshot({path:path.join(output,name+'-road-test.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  await page.goto('file:///'+path.join(output,'harness.html').replaceAll('\\','/')+'?parts');
  await page.getByText('NF-TESTE',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.counts.orders),1,'StrictMode must not duplicate initial parts request');
  await page.goto('file:///'+path.join(output,'harness.html').replaceAll('\\','/')+'?walk-in');
  await page.getByLabel('Cliente',{exact:true}).fill('Cliente de teste');
  await page.getByLabel('Placa',{exact:true}).fill('ABC1D23');
  await page.getByLabel(/^Consultor/).selectOption('Luan');
  await page.getByLabel(/^Tipo de atendimento/).selectOption('Embelezamento');
  assert.equal(await page.getByLabel(/^Técnico/).inputValue(),'Igo');
  await page.getByLabel('Previsão de entrega',{exact:true}).fill('2026-09-25T17:00');
  await page.screenshot({path:path.join(output,name+'-walk-in.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Cadastrar passante',exact:true}).click();
  await page.getByText('Fechado',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.walkInForm.consultant),'Luan');
  assert.equal(await page.evaluate(()=>window.counts.saves),1);
  assert.deepEqual(errors,[]);
  await page.close();
 }console.log('Interactive desktop/mobile: lazy loads, caching, save, history, road form, walk-in and StrictMode passed. Firebase/PDF mocked.');}finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exit(1)});
