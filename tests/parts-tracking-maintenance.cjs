// Explicit one-off maintenance. Never imported by the application.
const path=require('node:path');
const project='fluxo-oficina-terra-santa',lib=process.env.FIREBASE_TOOLS_LIB;
async function main(){
 if(!lib)throw Error('FIREBASE_TOOLS_LIB required');
 const account=require(path.join(lib,'auth')).getProjectDefaultAccount(process.cwd());
 await require(path.join(lib,'requireAuth')).requireAuth({project,...account});
 const {Client}=require(path.join(lib,'apiv2'));
 const api=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
 const base=`/projects/${project}/databases/(default)/documents`;
 let cursor,scanned=0,changed=0;const counts={};
 do{
  const response=await api.post(base+':runQuery',{structuredQuery:{from:[{collectionId:'partOrders'}],select:{fields:['trackingState','orderStatus','schedulingCompletedAt','executionCompletedAt'].map(fieldPath=>({fieldPath}))},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:50,...(cursor?{startAt:{values:[{referenceValue:cursor}],before:false}}:{})}});
  const docs=response.body.filter(item=>item.document).map(item=>item.document);scanned+=docs.length;
  const writes=[];
  for(const document of docs){
   const fields=document.fields??{};
   if(fields.trackingState||!fields.orderStatus?.stringValue)continue;
   const state=fields.orderStatus.stringValue==='cancelado'?'cancelled':(fields.schedulingCompletedAt?.timestampValue||fields.schedulingCompletedAt?.stringValue||fields.executionCompletedAt?.timestampValue||fields.executionCompletedAt?.stringValue)?'completed':'active';
   counts[state]=(counts[state]??0)+1;
   writes.push({update:{name:document.name,fields:{trackingState:{stringValue:state}}},updateMask:{fieldPaths:['trackingState']},currentDocument:{updateTime:document.updateTime}});
  }
  if(process.argv.includes('--apply')&&writes.length){await api.post(base+':commit',{writes});changed+=writes.length;}
  cursor=docs.length===50?docs.at(-1).name:undefined;
 }while(cursor);
 console.log(JSON.stringify({scanned,missing:counts,changed,apply:process.argv.includes('--apply')}));
}
setTimeout(()=>process.exit(2),60000);
main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1)});
