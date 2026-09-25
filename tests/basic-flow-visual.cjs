// Synthetic data only. No Firebase initialization or production writes.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,mocks={}) {
 const mod={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText)(n=>mocks[n]??require(n),mod,mod.exports);
 return mod.exports;
}
const domain=load('src/lib/basic-flow.ts');
const vehicles=domain.basicLanes.map((lane,index)=>({id:'test-'+index,status:lane.id==='entregue'?'entregue':'ativo',currentLane:lane.id,clientName:'CLIENTE DE TESTE '+(index+1),plate:'ABC1D23',model:'HB20',serviceLabel:'Revisão 01',consultantName:'Eliane',technicianName:'Wesley',appointmentDate:'2026-09-25',appointmentTime:'09:00',washType:'simples'}));
const form={vehicleId:'test-0',from:'preparacao_confirmada',to:'aguardando_servico',actor:'Teste',actorId:'test',consultant:'Eliane',technician:'Wesley',washType:'simples',promised:'',note:'',customerWaits:false,onTime:true,pending:false,nps:''};
const output=path.resolve('output/basic-flow-qa');fs.mkdirSync(output,{recursive:true});
function headerCss(css) {
 const globals=[];
 return css.replace(/:global\(([^)]+)\)/g,(_,s)=>`__GLOBAL_${globals.push(s)-1}__`)
  .replace(/\.([a-zA-Z][\w-]*)/g,'.header_$1').replace(/__GLOBAL_(\d+)__/g,(_,i)=>globals[Number(i)]);
}
const auth={useAuth:()=>({profile:{role:'admin',name:'Usuário de teste'},user:{uid:'test'},logout(){}})};
const {AppHeader}=load('src/components/app-header.tsx',{
 'next/navigation':{usePathname:()=>'/fluxo'},'next/link':{default:({children,href})=>React.createElement('a',{href},children)},
 '@/context/auth-context':auth,'@/lib/access-control':{canAccessPath:()=>false,roleLabel:()=> 'Administrador'},
 './app-header.module.css':{default:new Proxy({},{get:(_,key)=>'header_'+key})},
});
for(const modal of [false,true]){
 let state=0;const values=['2026-09-25',vehicles,'',true,true,'','',modal?vehicles[0]:null,modal?form:null,false,'','','todos',new Date('2026-09-25T13:00:00-03:00'),new Date('2026-09-25T13:00:00-03:00')];
 const {BasicFlowBoard}=load('src/components/basic-flow-board.tsx',{
  react:{...React,useState:()=>[values[state++],()=>{}]},
  'next/link':{default:({children,href})=>React.createElement('a',{href},children)},
  '@/context/auth-context':auth,'@/components/app-header':{AppHeader},
  '@/lib/access-control':{allowedPathsForRole:()=>['/preparacao','/fluxo','/pos-servico']},
  '@/lib/basic-flow':domain,'@/services/basic-flow':{},
  './basic-flow-board.module.css':{default:new Proxy({},{get:(_,key)=>key})}
 });
 const css=fs.readFileSync('src/app/globals.css','utf8').replace('@import "tailwindcss";','')
   +headerCss(fs.readFileSync('src/components/app-header.module.css','utf8'))
   +fs.readFileSync('src/components/basic-flow-board.module.css','utf8').replace(/:global\(([^)]+)\)/g,'$1');
 fs.writeFileSync(path.join(output,modal?'modal.html':'board.html'),'<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}button,input,select,textarea{font:inherit}button{cursor:pointer;padding:10px;border-radius:6px}.primary-btn{background:#002c5f;color:white;border:1px solid #002c5f}.ghost-btn{background:white;border:1px solid #ccd7dd}'+css+'</style>'+renderToStaticMarkup(React.createElement(BasicFlowBoard))+'</html>');
}
async function main(){
 const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const [name,width,height] of [['desktop',1920,1080],['laptop',1440,900],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});
  for(const kind of ['board','modal']){
   await page.goto('file:///'+path.join(output,kind+'.html').replaceAll('\\','/'));
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Page overflow: '+name+' '+kind);
   if(await page.locator('.flow-lane').count()!==8)throw Error('Expected the original eight lanes');
   if(await page.getByRole('button',{name:'Abrir menu de páginas'}).count()!==1)throw Error('Missing original menu');
   if(await page.getByRole('button',{name:'+ Passante',exact:true}).count())throw Error('Disabled feature exposed');
   if(await page.locator('.flow-metrics').count()!==1)throw Error('Missing original metrics');
   await page.screenshot({path:path.join(output,name+'-'+kind+'.png'),fullPage:true});
  }await page.close();
 }console.log('Desktop/mobile screenshots passed. Synthetic UI; not an authenticated end-to-end test.');}finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exit(1)});
