import { collection, doc, getDocs, limit, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { preparationId } from "@/lib/preparation-id";
import { sourceVersion, validateSection, validateParts, type Preparation, type Section, type Campaign } from "@/lib/preparation-planning";

const collectionName = "preparationPlans";
export async function loadPreparationDay(date: string): Promise<Preparation[]> {
  const snapshot=await getDocs(query(collection(getFirebaseDb(),collectionName),where("date","==",date),limit(201)));
  if(snapshot.size>200) throw new Error("Mais de 200 agendamentos nesta data. Solicite revisão; a lista não foi carregada parcialmente.");
  return snapshot.docs.map(d=>({...d.data(),id:d.id}) as Preparation);
}
export async function importPreparation(p: Preparation, actor: string): Promise<Preparation> {
  if(p.id!==preparationId(p.appointment.eventId) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error("Confira evento e data do agendamento.");
  const ref=doc(getFirebaseDb(),collectionName,p.id);
  return runTransaction(getFirebaseDb(),async tx=>{
    const current=await tx.get(ref);
    if(current.exists()) { const saved=current.data() as Preparation; if(saved.date!==p.date || saved.appointment.client!==p.appointment.client) throw new Error(`Evento ${p.appointment.eventId} já cadastrado com outra data ou cliente.`); return {...saved,id:p.id}; }
    tx.set(ref,{...p,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:actor});return p;
  });
}
export async function savePreparationSection(p: Preparation, section: Section, actor: string): Promise<Preparation> {
  validateSection(p,section);
  const ref=doc(getFirebaseDb(),collectionName,p.id);
  return runTransaction(getFirebaseDb(),async tx=>{
    const snapshot=await tx.get(ref); if(!snapshot.exists()) throw new Error("Salve primeiro a agenda compartilhada.");
    const current={...snapshot.data(),id:p.id} as Preparation;
    const key=`${section}Version` as const;
    if(current[key]!==p[key]) throw new Error("Este setor foi alterado por outra pessoa. Copie suas alterações e atualize o dia antes de salvar.");
    if(section==="workshop" && current.sent) throw new Error("Veículo já enviado. Ajuste técnico e teste no fluxo.");
    if(section==="parts" && sourceVersion(p)!==sourceVersion(current)) throw new Error("Oficina ou garantia alteraram a preparação. Atualize antes de concluir a separação.");
    const value=section==="parts"?{...p.parts,sourceVersion:sourceVersion(current)}:p[section];
    const next={...current,[section]:value,[key]:current[key]+1};validateSection(next,section);
    tx.update(ref,{[section]:value,[key]:current[key]+1,[`${section}By`]:actor,updatedBy:actor,updatedAt:serverTimestamp()});return next;
  });
}
export async function loadCampaigns(): Promise<Campaign[]> {
  const snapshot=await getDocs(query(collection(getFirebaseDb(),"preparationCampaigns"),limit(101)));
  if(snapshot.size>100) throw new Error("O catálogo excedeu 100 campanhas. Solicite paginação antes de continuar.");
  return snapshot.docs.map(d=>({...d.data(),id:d.id}) as Campaign);
}
export async function saveCampaign(c: Campaign, actor: string): Promise<Campaign> {
  if(!c.code.trim()||!c.name.trim()||!c.tmo.trim())throw new Error("Preencha código, descrição e TMO.");validateParts(c.parts);
  const id=c.id || encodeURIComponent(`${c.kind}-${c.code.trim().toUpperCase()}`);
  const ref=doc(getFirebaseDb(),"preparationCampaigns",id);
  return runTransaction(getFirebaseDb(),async tx=>{
    const saved=await tx.get(ref);if(saved.exists() && saved.data().version!==c.version)throw new Error("Campanha já cadastrada ou alterada. Recarregue o catálogo.");
    const next={...c,id,version:(saved.exists()?c.version:0)+1};tx.set(ref,{...next,updatedBy:actor,updatedAt:serverTimestamp()});return next;
  });
}
export async function sendPreparation(p: Preparation, actor: string): Promise<Preparation> {
  const db=getFirebaseDb(),ref=doc(db,collectionName,p.id),flow=doc(db,"vehiclesFlow",p.id),event=doc(db,"flowEvents",`basic-preparation-${p.id}`);
  return runTransaction(db,async tx=>{
    const [snapshot,existing]=await Promise.all([tx.get(ref),tx.get(flow)]);
    if(!snapshot.exists())throw new Error("Preparação não encontrada.");
    const current={...snapshot.data(),id:p.id} as Preparation;
    if(current.workshopVersion!==p.workshopVersion)throw new Error("Oficina alterada. Atualize antes de enviar.");
    if(!current.workshop.technician.trim()||current.workshop.technician==="Definir")throw new Error("Defina e salve o técnico antes de enviar ao fluxo.");
    const a=current.appointment;
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time))throw new Error("Horário inválido no agendamento.");
    if(existing.exists()) {const v=existing.data();if(v.appointmentDate!==current.date||v.clientName!==a.client)throw new Error("Evento em uso por outro atendimento.");}
    else {
      tx.set(flow,{appointmentId:p.id,importedEventId:a.eventId,origin:"agendado",currentLane:"preparacao_confirmada",status:"ativo",appointmentDate:current.date,appointmentTime:a.time,clientName:a.client,plate:a.plate.startsWith("SEMPLACA")?"":a.plate,chassi:a.chassi,model:a.model,phone:a.phone,serviceLabel:a.service,consultantName:a.consultant,technicianName:current.workshop.technician,importedNotes:a.note,sourceFileName:current.sourceFile,preparationMode:"basic",priority:"normal",washType:"nao",roadTestRequired:current.workshop.roadTest,chiefPresenceRequired:false,customerWaits:false,preparationPlanId:p.id,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      tx.set(event,{vehicleFlowId:p.id,toLane:"preparacao_confirmada",actionBy:actor,actionNote:"Veículo enviado pela preparação compartilhada",createdAt:serverTimestamp()});
    }
    if(!current.sent)tx.update(ref,{sent:true,updatedBy:actor,updatedAt:serverTimestamp()});return {...current,sent:true};
  });
}
