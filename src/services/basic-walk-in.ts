import { collection, doc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { basicConsultants, basicTechnicians, localDay } from "@/lib/basic-flow";
import type { UserRole, VehicleFlow, WashType } from "@/types/domain";

export type BasicWalkInInput = {
  client: string; phone: string; plate: string; chassi: string; model: string;
  service: string; consultant: string; technician: string; washType: WashType;
  promised: string; note: string; day: string;
};
export function canAddBasicWalkIn(role?: UserRole) {
  return !!role && ['admin','gerente','chefe_oficina','consultor','consultor_funilaria','tecnico','lider_lavagem','estoquista'].includes(role);
}
export function vehicleIdentity(value?: string) {
  const text = (value ?? "").trim().toUpperCase();
  return /^(NULL|UNDEFINED|N\/A|-|SEM PLACA|SEM CHASSI)$/.test(text) ? "" : text.replace(/[^A-Z0-9]/g, "");
}
export function findBasicWalkInConflict(input: Pick<BasicWalkInInput, "chassi" | "plate">, vehicles: VehicleFlow[]) {
  const chassis = vehicleIdentity(input.chassi), plate = vehicleIdentity(input.plate);
  return vehicles.find(vehicle => {
    if (vehicle.status !== "ativo") return false;
    const existingChassis = vehicleIdentity(vehicle.chassi);
    if (chassis && existingChassis) return chassis === existingChassis;
    return !!plate && plate === vehicleIdentity(vehicle.plate);
  });
}
export async function createBasicWalkIn(input: BasicWalkInInput, actor: { uid: string; name: string; role: UserRole }, reuse?: VehicleFlow) {
  if (!canAddBasicWalkIn(actor.role)) throw new Error("Seu perfil não permite cadastrar passantes.");
  if (!input.client.trim() || !basicConsultants.includes(input.consultant) || !basicTechnicians.includes(input.technician)) throw new Error("Informe cliente, consultor e técnico.");
  const chassi = vehicleIdentity(input.chassi), plate = vehicleIdentity(input.plate);
  if (!chassi && !plate) throw new Error("Informe a placa ou o chassi do veículo.");
  if (!input.service.trim() || !['nao','simples','motor','motor_bancos'].includes(input.washType)) throw new Error("Informe serviço e lavagem.");
  if (!input.promised || !Number.isFinite(new Date(input.promised).getTime())) throw new Error("Informe a previsão de entrega.");
  if (input.day !== localDay()) throw new Error("Cadastre o recebimento na data de hoje. Ajuste a data do quadro.");
  const washOnly = /embelez|lavagem/i.test(input.service);
  if (washOnly && input.washType === "nao") throw new Error("Selecione a lavagem para o embelezamento.");
  const id = reuse?.id ?? `passante-${input.day}-${chassi || plate}`;
  const db = getFirebaseDb(), ref = doc(db,"vehiclesFlow",id), event = doc(collection(db,"flowEvents"));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (reuse) {
      const current = snapshot.data();
      if (!snapshot.exists() || current?.status !== 'ativo' || current.currentLane !== 'preparacao_confirmada' || current.appointmentDate === input.day
        || current.appointmentDate !== reuse.appointmentDate || !findBasicWalkInConflict(input,[{...current,id} as VehicleFlow])) throw new Error("O chip anterior mudou. Feche o cadastro e confira o fluxo.");
    } else if (snapshot.exists()) {
      throw new Error("Este veículo já possui um cadastro de passante nesta data. Confira o chip existente antes de tentar novamente.");
    }
    const currentLane = washOnly ? 'aguardando_lavagem' : 'aguardando_servico';
    const patch = {
      origin: 'passante', currentLane, status: 'ativo', appointmentDate: input.day,
      appointmentTime: new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}),
      clientName: input.client.trim(), phone: input.phone.trim(), plate, chassi, model: input.model.trim(),
      serviceLabel: input.service, consultantName: input.consultant, technicianName: washOnly ? 'Igo' : input.technician,
      washType: input.washType, washDone: false, washOnlyService: washOnly, serviceCompleted: washOnly,
      noShow: false, noShowAt: null, washingAdvanced: false, advancedWashReturnLane: null,
      receiveNote: input.note.trim(), promisedDeliveryAt: Timestamp.fromDate(new Date(input.promised)),
      attendanceStartedAt: serverTimestamp(), attendanceStartedBy: actor.name,
      updatedAt: serverTimestamp(), basicWalkInVersion: 1, basicWalkInActor: actor.uid,
    };
    if (reuse) transaction.update(ref,patch);
    else transaction.set(ref,{...patch,appointmentId:id,priority:'normal',customerWaits:false,partsOrdered:false,createdAt:serverTimestamp()});
    transaction.set(event,{vehicleFlowId:id,toLane:currentLane,actionBy:actor.name,actionNote:reuse?'Agendamento anterior recebido como passante':'Passante recebido na oficina',createdAt:serverTimestamp(),basicWalkInVersion:1,basicWalkInActor:actor.uid});
  });
  return id;
}
