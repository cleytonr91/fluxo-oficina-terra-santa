// Real React pages, synthetic service responses: no production customer data or writes.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
const root=process.cwd(),output=path.resolve('output/parts-pages-qa');fs.mkdirSync(output,{recursive:true});
const sources=new Map(),mocks={
 '@/components/protected-page':`exports.ProtectedPage=({children})=>children;`,
 '@/context/auth-context':`exports.useAuth=()=>({profile:{id:'test',role:'admin',name:'Teste'},user:{uid:'test'}});`,
 '@/services/firestore':`exports.loadHyundaiPartsCatalog=async()=>[];exports.registerPartSchedulingAction=async()=>{window.counts.writes++};exports.updatePartOrder=async()=>{window.counts.writes++};`,
 '@/services/parts-catalog-cache':`exports.clearCatalogCache=()=>{};`,
 '@/lib/hyundai-parts-catalog':`exports.parseHyundaiPartsCatalog=()=>[];`,
 'pdfjs-dist/legacy/build/pdf.mjs':`module.exports={};`,
 '@/services/parts-pages':`exports.loadPartById=async()=>undefined;exports.loadPartsVehicle=async()=>undefined;
 exports.loadPartsPage=async(scope,cursor)=>{window.counts.reads++;await new Promise(resolve=>setTimeout(resolve,20));return{orders:[{id:cursor?'three':'one',vehicleFlowId:'',clientName:cursor?'TERCEIRO TESTE':'CLIENTE ALFA',plate:'ABC1D23',orderStatus:'disponivel',trackingState:'active',parts:[{id:'p',partReference:'REF',partDescription:'PECA TESTE'}],createdAt:'2026-09-20T10:00:00Z'},...(!cursor?[{id:'two',vehicleFlowId:'',clientName:'CLIENTE BETA',plate:'DEF4G56',orderStatus:'disponivel',trackingState:'active',parts:[{id:'p2',partReference:'REF2',partDescription:'PECA BETA'}]}]:[])],vehicles:[],cursor:cursor?undefined:'next'};};`,
};
function bundle(file){
 const id=path.relative(root,file).replaceAll('\\','/');if(sources.has(id))return id;sources.set(id,'');
 let source=fs.readFileSync(file,'utf8');if(/\.tsx?$/.test(file))source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 source=source.replace(/require\(["']([^"']+)["']\)/g,(_,name)=>{
  if(mocks[name]){sources.set(name,mocks[name]);return `require(${JSON.stringify(name)})`;}
  if(name.endsWith('.css')){sources.set(name,`exports.default=new Proxy({},{get:(_,key)=>key});`);return `require(${JSON.stringify(name)})`;}
  const base=name.startsWith('@/')?path.join(root,'src',name.slice(2)):null;
  const target=base?['.tsx','.ts',''].map(ext=>base+ext).find(f=>fs.existsSync(f)):require.resolve(name,{paths:[path.dirname(file)]});
  return `require(${JSON.stringify(bundle(target))})`;
 });sources.set(id,source.replaceAll('import.meta.url','location.href'));return id;
}
const pages={};for(const name of ['agendamento','pecas'])pages[name]=bundle(path.join(root,`src/app/${name}/page.tsx`));
const react=bundle(require.resolve('react')),client=bundle(require.resolve('react-dom/client'));
const css=fs.readFileSync('src/app/globals.css','utf8').replace('@import "tailwindcss";','')+fs.readFileSync('src/components/confirmed-search.module.css','utf8');
for(const [name,id]of Object.entries(pages)){
 const script=`window.history.replaceState=()=>{};window.counts={reads:0,writes:0};const process={env:{NODE_ENV:'development'}};const modules={${[...sources].map(([id,code])=>`${JSON.stringify(id)}:function(module,exports,require){${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](m,m.exports,require);return m.exports;}const React=require(${JSON.stringify(react)});require(${JSON.stringify(client)}).createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(require(${JSON.stringify(id)}).default)));`;
 fs.writeFileSync(path.join(output,name+'.html'),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font-family:Arial;margin:0}button,input,select,textarea{font:inherit}${css}</style><div id="root"></div><script>${script.replaceAll('</script','<\\/script')}</script></html>`);
}
async function main(){
 const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const name of Object.keys(pages))for(const [label,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.join(output,name+'.html').replaceAll('\\','/'));
  await page.waitForFunction(()=>window.counts.reads===1);
  if(name==='pecas')await page.getByRole('button',{name:/disponíveis para agendar/}).click();
  await page.getByText('CLIENTE BETA',{exact:true}).waitFor();
  await page.locator('input[type=search]:visible').first().fill('ALFA');
  await page.getByText('CLIENTE BETA',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.counts.reads),1);
  await page.getByRole('button',{name:'Pesquisar',exact:true}).first().click();
  await page.getByText('CLIENTE BETA',{exact:true}).waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>window.counts),{reads:1,writes:0});
  await page.locator('input[type=search]:visible').first().fill('');await page.getByRole('button',{name:'Pesquisar',exact:true}).first().click();
  await page.getByRole('button',{name:/Carregar mais 50/}).first().click();await page.getByText('TERCEIRO TESTE',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.counts.reads),2);
  await page.screenshot({path:path.join(output,name+'-'+label+'.png'),fullPage:true});assert.deepEqual(errors,[]);
  await page.close();
 }console.log('Both pages: desktop/mobile, StrictMode, draft search, submit, pagination and zero automatic writes passed.');}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exit(1)});
