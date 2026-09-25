import { collection, doc, limit, onSnapshot, query, runTransaction, serverTimestamp, Timestamp, where } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { basicTargets } from "@/lib/basic-flow";
import type { FlowLane, VehicleFlow, WashType } from "@/types/domain";

// Two bounded, non-overlapping subscriptions; no auxiliary collections or writes on load.
export function subscribeBasicFlow(day: string, onData: (vehicles: VehicleFlow[]) => void, onError: (error: Error) => void) {
  const ref = collection(getFirebaseDb(), "vehiclesFlow");
  let active: VehicleFlow[] = [], delivered: VehicleFlow[] = [];
  let activeReady = false, deliveredReady = false, blocked = false;
  const emit = () => { if (activeReady && deliveredReady && !blocked) onData([...active, ...delivered]); };
  const start = new Date(`${day}T00:00:00-03:00`);
  const end = new Date(start.getTime() + 86400000);
  const fail = (error: Error) => { blocked = true; onError(error); };
  const stopActive = onSnapshot(query(ref, where("status", "==", "ativo"), limit(301)), (snapshot) => {
    if (snapshot.size > 300) return fail(new Error("Mais de 300 chips ativos. O quadro foi bloqueado para não mostrar uma lista incompleta. Solicite revisão da base."));
    active = snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as VehicleFlow);
    activeReady = true;
    emit();
  }, fail);
  const stopDelivered = onSnapshot(query(ref, where("deliveredAt", ">=", Timestamp.fromDate(start)), where("deliveredAt", "<", Timestamp.fromDate(end)), limit(101)), (snapshot) => {
    if (snapshot.size > 100) return fail(new Error("Mais de 100 entregas no dia. Solicite revisão antes de continuar."));
    delivered = snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as VehicleFlow).filter(v => v.status === "entregue");
    deliveredReady = true;
    emit();
  }, fail);
  return () => { stopActive(); stopDelivered(); };
}

export type BasicMoveInput = {
  vehicleId: string; from: FlowLane; to: FlowLane; actor: string; actorId: string;
  consultant: string; technician: string; washType: WashType; promised: string;
  note: string; customerWaits: boolean; onTime: boolean; pending: boolean; nps: string;
};
export async function moveBasicVehicle(input: BasicMoveInput) {
  const db = getFirebaseDb();
  const ref = doc(db, "vehiclesFlow", input.vehicleId);
  const event = doc(collection(db, "flowEvents"));
  await runTransaction(db, async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) throw new Error("Chip não encontrado.");
    const current = { ...snapshot.data(), id: snapshot.id } as VehicleFlow;
    if (current.status !== "ativo" || current.currentLane !== input.from) throw new Error("Este chip foi alterado por outra pessoa. Feche e confira a etapa atual.");
    if (!basicTargets(current).includes(input.to)) throw new Error("Transição não permitida.");
    const patch: Record<string, unknown> = { currentLane: input.to, updatedAt: serverTimestamp(), basicFlowVersion: 1, basicUpdatedBy: input.actorId };
    if (input.from === "preparacao_confirmada") {
      if (!input.consultant.trim() || !input.promised || !Number.isFinite(new Date(input.promised).getTime())) throw new Error("Informe consultor e previsão de entrega.");
      Object.assign(patch, { consultantName: input.consultant, washType: input.washType, customerWaits: input.customerWaits,
        attendanceStartedAt: serverTimestamp(), attendanceStartedBy: input.actor, receiveNote: input.note,
        promisedDeliveryAt: Timestamp.fromDate(new Date(input.promised)), noShow: false });
    }
    if (input.to === "em_servico") {
      if (!input.technician.trim()) throw new Error("Selecione o técnico responsável.");
      patch.technicianName = input.technician;
    }
    if (input.to === "orcamento_complementar") patch.budgetStatus = "aguardando";
    if (input.from === "orcamento_complementar") {
      if (!input.note.trim()) throw new Error("Registre a decisão do orçamento na observação.");
      Object.assign(patch, { budgetAuthorized: input.to === "aguardando_servico", budgetStatus: "realizado" });
      if (input.to === "aguardando_servico") {
        if (!input.promised || !Number.isFinite(new Date(input.promised).getTime())) throw new Error("Informe a nova previsão de entrega.");
        patch.promisedDeliveryAt = Timestamp.fromDate(new Date(input.promised));
      }
    }
    if (input.from === "em_servico" && input.to !== "orcamento_complementar") patch.serviceCompleted = true;
    if (input.from === "lavagem") Object.assign(patch, { washDone: true, washingAdvanced: false });
    if (input.to === "entregue") {
      if (!current.technicianName) throw new Error("O chip precisa de técnico responsável antes da entrega.");
      Object.assign(patch, { status: "entregue", deliveredAt: serverTimestamp(), deliveredOnTime: input.onTime, hasPendingIssue: input.pending, futureNote: input.note });
      if (input.nps !== "") {
        const score = Number(input.nps);
        if (!Number.isInteger(score) || score < 0 || score > 10) throw new Error("Nota deve estar entre 0 e 10.");
        patch.internalNps = score;
      }
      tx.set(doc(db, "deliveries", input.vehicleId), { vehicleFlowId: input.vehicleId, technicianName: current.technicianName, deliveredAt: serverTimestamp(), deliveredOnTime: input.onTime, hasPendingIssue: input.pending, futureNote: input.note, createdBy: input.actor, createdAt: serverTimestamp(), basicFlowVersion: 1 }, { merge: true });
    }
    tx.update(ref, patch);
    tx.set(event, { vehicleFlowId: input.vehicleId, fromLane: input.from, toLane: input.to, actionBy: input.actor, actionNote: input.note || "Movimentação no fluxo básico", createdAt: serverTimestamp(), basicFlowVersion: 1, actorId: input.actorId });
  });
}
