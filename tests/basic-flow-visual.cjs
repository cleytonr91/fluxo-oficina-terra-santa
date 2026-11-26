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
vehicles.forEach(vehicle=>{vehicle.promisedDeliveryAt='2026-09-25T17:00:00-03:00';});
Object.assign(vehicles[1],{customerWaits:true,attendanceStartedAt:'2026-09-25T10:30:00Z',appointmentTime:'10:00'});
vehicles[1].phone='(79) 99999-1234';
vehicles[2].serviceLabel='Reparo geral';
vehicles[3].serviceLabel='Diagnóstico';
vehicles[5].serviceLabel='Embelezamento';
vehicles[6].readyForDeliveryAt='2026-09-25T11:00:00-03:00';
vehicles[7].deliveredAt='2026-09-25T12:00:00-03:00';
vehicles.push({...vehicles[6],id:'ready-old',clientName:'CLIENTE DE TESTE ANTERIOR',plate:'DEF2G34',readyForDeliveryAt:'2026-09-24T16:00:00-03:00'});
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
  'next/dynamic':{default:()=>()=>null},
  react:{...React,useState:()=>[values[state++],()=>{}]},
  'next/link':{default:({children,href})=>React.createElement('a',{href},children)},
  '@/context/auth-context':auth,'@/components/app-header':{AppHeader},
  '@/lib/access-control':{allowedPathsForRole:()=>['/preparacao','/fluxo','/pos-servico']},
  '@/lib/basic-flow':domain,'@/services/basic-flow':{},
  '@/services/basic-walk-in':{canAddBasicWalkIn:()=>true},
  './basic-flow-board.module.css':{default:new Proxy({},{get:(_,key)=>key})}
 });
 const css=fs.readFileSync('src/app/globals.css','utf8').replace('@import "tailwindcss";','')
   +headerCss(fs.readFileSync('src/components/app-header.module.css','utf8'))
   +fs.readFileSync('src/components/basic-flow-board.module.css','utf8').replace(/:global\(([^)]+)\)/g,'$1');
 fs.writeFileSync(path.join(output,modal?'modal.html':'board.html'),'<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}button,input,select,textarea{font:inherit}button{cursor:pointer;padding:10px;border-radius:6px}.primary-btn{background:#002c5f;color:white;border:1px solid #002c5f}.ghost-btn{background:white;border:1px solid #ccd7dd}'+css+'</style>'+renderToStaticMarkup(React.createElement(BasicFlowBoard))+'</html>');
}
const deliveryGroups=domain.deliveryIndicators(vehicles,'2026-09-25');
const previewHtml=fs.readFileSync(path.join(output,'board.html'),'utf8');
const previewControls='<aside style="padding:10px 16px;background:#002c5f;color:white;font:14px Arial">Prévia com dados fictícios · produção não alterada <button id="preview-reset" style="margin-left:16px">Mostrar todos</button></aside>';
const previewScript=`<script>
 const names=${JSON.stringify([deliveryGroups.previous,deliveryGroups.today,deliveryGroups.delivered].map(items=>items.map(v=>v.clientName)))};
 const chips=[...document.querySelectorAll('.flow-chip')];
 const metrics=[...document.querySelectorAll('.flow-status-strip button')];
 function show(group){
   chips.forEach(chip=>{chip.style.display=group!==null&&!names[group].includes(chip.querySelector('.client').textContent)?'none':'';});
   metrics.forEach((button,index)=>button.classList.toggle('selected',group!==null&&index===group+3));
 }
 document.querySelectorAll('button').forEach(button=>{button.disabled=true;});
 metrics.slice(3).forEach((button,index)=>{button.disabled=false;button.onclick=()=>show(index);});
 document.querySelectorAll('input,select').forEach(control=>{control.disabled=true;});
 document.querySelectorAll('a').forEach(link=>{link.removeAttribute('href');});
 const reset=document.querySelector('#preview-reset');reset.disabled=false;reset.onclick=()=>show(null);
 document.querySelector('.flow-total').disabled=false;document.querySelector('.flow-total').onclick=()=>show(null);
 </script>`;
fs.writeFileSync(path.join(output,'preview.html'),previewHtml.replace('<div class="app-shell"',previewControls+'<div class="app-shell"').replace('</html>',previewScript+'</html>'));
async function main(){
 const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const [name,width,height] of [['desktop',1920,1080],['laptop',1440,900],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});
  for(const kind of ['board','modal']){
   await page.goto('file:///'+path.join(output,kind+'.html').replaceAll('\\','/'));
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Page overflow: '+name+' '+kind);
   if(await page.locator('.flow-lane').count()!==8)throw Error('Expected the original eight lanes');
   if(await page.locator('a.client-link[href="https://wa.me/5579999991234"][target="_blank"]').count()!==1)throw Error('Missing client WhatsApp link');
   if(await page.getByRole('button',{name:'Abrir menu de páginas'}).count()!==1)throw Error('Missing original menu');
   if(await page.getByRole('button',{name:'+ Passante',exact:true}).count()!==1)throw Error('Missing restored walk-in button');
   if(await page.locator('.flow-metrics').count()!==1)throw Error('Missing original metrics');
   if(await page.locator('.flow-status-strip .flow-metric').count()!==6)throw Error('Expected six status indicators');
   for(const label of ['Prontos — dias anteriores','Prontos — hoje','Entregues aos clientes']) {
    const metric=page.locator('.flow-status-strip button').filter({hasText:label});
    if(await metric.locator('strong').textContent()!=='1')throw Error('Incorrect delivery metric: '+label);
   }
   if(await page.locator('.flow-status-strip button').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1)))throw Error('Delivery metric overflow');
   if(await page.getByText('Atualização em tempo real ativa',{exact:true}).count())throw Error('Active status text still visible');
   for(const [service,color] of [['revisao','rgb(39, 128, 76)'],['reparo','rgb(231, 124, 25)'],['diagnostico','rgb(211, 50, 50)'],['embelezamento','rgb(134, 66, 179)']]) {
    if(await page.locator('.flow-chip.'+service).first().evaluate(n=>getComputedStyle(n).borderLeftColor)!==color)throw Error('Incorrect service color: '+service);
   }
   if(await page.locator('.mercosulPlate').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1||n.getBoundingClientRect().height!==68)))throw Error('Plate overflow');
   if(await page.locator('.plateNumber').first().innerText()!=='ABC\n1D23')throw Error('Expected two-line plate');
   if(await page.locator('.flow-chip').evaluateAll(nodes=>nodes.some(n=>n.parentElement.clientWidth-n.getBoundingClientRect().width>9)))throw Error('Chip does not fill its column');
   if(await page.locator('.chipTimes').filter({hasText:'Recebido:'}).count()<1)throw Error('Missing received time');
   if(await page.getByTitle('Cliente aguardando na loja').count()<1)throw Error('Missing waiting indicator');
   if(await page.locator('.chipTimes').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1)))throw Error('Chip time overflow');
   if(await page.locator('.time-bar-top').count()!==vehicles.length)throw Error('Missing delivery forecasts');
   if(await page.locator('.time-bar-top').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1)))throw Error('Delivery forecast overflow');
   if(await page.locator('.flow-chip:has(.time-bar):has(.chip-move-btn)').evaluateAll(nodes=>nodes.some(n=>{
    const button=n.querySelector('.chip-move-btn').getBoundingClientRect(),bar=n.querySelector('.time-bar').getBoundingClientRect();
    const track=n.querySelector('.time-track').getBoundingClientRect();
    return button.top>=bar.bottom||button.bottom<=bar.top||track.right>button.left;
   })))throw Error('Move button must align with forecast without overlap');
   await page.screenshot({path:path.join(output,name+'-'+kind+'.png'),fullPage:true});
  }await page.close();
 }
 const preview=await browser.newPage();
 await preview.goto('file:///'+path.join(output,'preview.html').replaceAll('\\','/'));
 await preview.getByRole('button',{name:'1 Prontos — hoje',exact:true}).click();
 if(await preview.locator('.flow-chip:visible').count()!==1)throw Error('Preview today filter failed');
 await preview.getByRole('button',{name:'Mostrar todos',exact:true}).click();
 if(await preview.locator('.flow-chip:visible').count()!==vehicles.length)throw Error('Preview reset failed');
 await preview.close();
 console.log('Desktop/mobile screenshots and isolated preview filters passed. Synthetic UI; not an authenticated end-to-end test.');}finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exit(1)});
