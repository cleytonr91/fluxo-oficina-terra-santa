import { arrayUnion, collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp, where, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { basicLanes } from "@/lib/basic-flow";
import type { FlowEvent, FlowLane, HyundaiPartCatalogItem, PartOrder, PartOrderItem, PartOrderKind, RoadTestFormData, UserRole, VehicleFlow, WashType } from "@/types/domain";

export type ChipAction =
  | { kind: "plate" | "consultant" | "technician" | "service"; value: string }
  | { kind: "wash"; value: WashType }
  | { kind: "wait"; value: boolean }
  | { kind: "immobilize"; value: boolean; reason: string }
  | { kind: "promise"; value: string; note: string }
  | { kind: "stage"; value: FlowLane; note: string }
  | { kind: "cancel"; note: string }
  | { kind: "roadTest"; value: RoadTestFormData }
  | { kind: "advanceWash" }
  | { kind: "parts"; orderKind: PartOrderKind; parts: PartOrderItem[] };

export function canEditChip(role: UserRole | undefined, kind: ChipAction["kind"]) {
  if (!role || !["admin", "gerente", "chefe_oficina", "consultor", "consultor_funilaria", "tecnico", "lider_lavagem", "estoquista"].includes(role)) return false;
  if (kind === "cancel" || kind === "consultant") return ["admin", "gerente"].includes(role);
  if (kind === "immobilize") return ["admin", "gerente", "chefe_oficina"].includes(role);
  if (kind === "wait") return ["admin", "consultor"].includes(role);
  return true;
}
export function chipDate(value: unknown): Date | null {
  const result = value instanceof Date ? value : typeof value === "string" ? new Date(value)
    : value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function" ? value.toDate()
      : value && typeof value === "object" && "seconds" in value && typeof value.seconds === "number" ? new Date(value.seconds * 1000) : null;
  return result && Number.isFinite(result.getTime()) ? result : null;
}
export function chipVersion(value: unknown) {
  if (value && typeof value === "object" && "seconds" in value) return `${value.seconds}:${"nanoseconds" in value ? value.nanoseconds : 0}`;
  return chipDate(value)?.toISOString() ?? "";
}
export function prepareChipPatch(current: VehicleFlow, action: ChipAction, actor: { name: string; role: UserRole }, now: Date) {
  if (!canEditChip(actor.role, action.kind)) throw new Error("Seu perfil não permite esta alteração.");
  if (current.status === "cancelado") throw new Error("Este chip foi cancelado.");
  const patch: Record<string, unknown> = {};
  let note = "";
  switch (action.kind) {
    case "plate": case "consultant": case "technician": case "service": {
      const value = action.value.trim();
      if (!value) throw new Error("Preencha o campo antes de salvar.");
      const field = { plate: "plate", consultant: "consultantName", technician: "technicianName", service: "serviceLabel" }[action.kind];
      patch[field] = action.kind === "plate" ? value.toUpperCase() : value;
      if (current[field as keyof VehicleFlow] === patch[field]) throw new Error("Nenhuma alteração para salvar.");
      if (action.kind === "service") {
        const text = value.toLowerCase(), revision = text.match(/revis[aã]o\s*0?(\d+)/);
        patch.serviceType = revision && Number(revision[1]) >= 1 && Number(revision[1]) <= 10
          ? `revisao_${String(Number(revision[1])).padStart(2, "0")}`
          : text.includes("diagn") ? "diagnostico" : text.includes("reparo") ? "reparo_geral" : /recall|campanha/.test(text) ? "recall" : "combinado";
      }
      note = `${{ plate: "Placa", consultant: "Consultor", technician: "Técnico", service: "Serviço" }[action.kind]}: ${patch[field]}`;
      break;
    }
    case "wash":
      if (!["nao", "simples", "motor", "motor_bancos"].includes(action.value)) throw new Error("Lavagem inválida.");
      if (current.washType === action.value) throw new Error("Nenhuma alteração para salvar.");
      patch.washType = action.value;
      if (action.value === "nao") Object.assign(patch, { washDone: false, washingAdvanced: false });
      note = `Tipo de lavagem: ${action.value}`; break;
    case "wait":
      Object.assign(patch, { customerWaits: action.value, customerWaitsUpdatedBy: actor.name, customerWaitsUpdatedAt: now });
      note = action.value ? "Cliente aguarda na loja" : "Cliente não aguarda na loja"; break;
    case "immobilize":
      if (action.value && !["aguardando_pecas", "aguardando_decisao"].includes(action.reason)) throw new Error("Informe o motivo da imobilização.");
      Object.assign(patch, { vehicleImmobilized: action.value, immobilizationReason: action.value ? action.reason : null, immobilizationUpdatedBy: actor.name, immobilizationUpdatedAt: now });
      note = action.value ? `Veículo imobilizado: ${action.reason === "aguardando_pecas" ? "Aguardando Peças" : "Aguardando Decisão"}` : "Imobilização removida"; break;
    case "promise": {
      const date = new Date(action.value);
      if (!action.value || !Number.isFinite(date.getTime()) || !action.note.trim()) throw new Error("Informe data, hora e motivo da nova previsão.");
      const previous = chipDate(current.promisedDeliveryAt);
      if (previous && previous.getTime() === date.getTime()) throw new Error("A previsão não foi alterada.");
      if (previous && date < previous && !["admin", "gerente"].includes(actor.role)) throw new Error("Somente administrador ou gerente pode reduzir a previsão.");
      patch.promisedDeliveryAt = date;
      note = `Nova previsão de entrega: ${date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. ${action.note.trim()}`; break;
    }
    case "stage":
      if (!basicLanes.some(l => l.id === action.value && l.id !== "entregue") || !action.note.trim()) throw new Error("Informe a etapa e o motivo da correção.");
      if (current.currentLane === action.value && !current.noShow) throw new Error("O chip já está nesta etapa.");
      Object.assign(patch, { currentLane: action.value, status: "ativo", noShow: false, noShowAt: null, washingAdvanced: false, advancedWashReturnLane: null });
      if (["preparacao_confirmada", "aguardando_servico", "em_servico"].includes(action.value)) Object.assign(patch, { serviceCompleted: false, washDone: false });
      if (["aguardando_lavagem", "lavagem", "preparacao_entrega"].includes(action.value)) patch.serviceCompleted = true;
      if (current.status === "entregue") patch.deliveredAt = null;
      note = `Correção de etapa: ${action.note.trim()}`; break;
    case "cancel":
      if (!action.note.trim()) throw new Error("Informe o motivo da exclusão.");
      patch.status = "cancelado"; note = `Chip excluído do fluxo: ${action.note.trim()}`; break;
    case "roadTest":
      if (JSON.stringify(action.value).length > 700000) throw new Error("Ficha muito grande. Reduza as assinaturas antes de salvar.");
      patch.roadTestForm = { ...JSON.parse(JSON.stringify(action.value)), updatedBy: actor.name, updatedAt: now }; note = "Ficha de teste de rodagem atualizada"; break;
    case "advanceWash":
      if (!['aguardando_servico', 'orcamento_complementar'].includes(current.currentLane) || current.washType === "nao" || current.washDone) throw new Error("Não há lavagem pendente para antecipar nesta etapa.");
      Object.assign(patch, { currentLane: "lavagem", washingAdvanced: true, serviceCompleted: false, advancedWashReturnLane: current.currentLane });
      note = "Lavagem antecipada iniciada; retornar à etapa de origem ao concluir"; break;
    case "parts": patch.partsOrdered = true; note = "Pedido de peças atualizado pela oficina"; break;
  }
  return { patch, note };
}

export async function saveChipAction(vehicle: VehicleFlow, action: ChipAction, actor: { uid: string; name: string; role: UserRole }) {
  const db = getFirebaseDb(), ref = doc(db, "vehiclesFlow", vehicle.id), eventRef = doc(collection(db, "flowEvents"));
  const now = new Date();
  const mutationId = crypto.randomUUID();
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Chip não encontrado.");
    const current = { ...snap.data(), id: snap.id } as VehicleFlow;
    if (chipVersion(current.updatedAt) !== chipVersion(vehicle.updatedAt)) throw new Error("O chip foi atualizado por outra pessoa. Feche e abra os detalhes antes de salvar.");
    const { patch, note } = prepareChipPatch(current, action, actor, now);
    const orderRef = doc(db, "partOrders", vehicle.id);
    const order = action.kind === "parts" ? await tx.get(orderRef) : null;
    const event = { vehicleFlowId: vehicle.id, fromLane: current.currentLane, toLane: patch.currentLane ?? current.currentLane, actionBy: actor.name, actionNote: note, createdAt: serverTimestamp(), chipDetailVersion: 1, chipActor: actor.uid, chipAction: action.kind };
    if (action.kind === "parts") {
      if (!["garantia", "campanha", "externo"].includes(action.orderKind)) throw new Error("Selecione o tipo do pedido.");
      const parts = action.parts.map((p, i) => ({ id: p.id || `peca-${i+1}`, partReference: p.partReference?.trim().toUpperCase() ?? "", partDescription: p.partDescription?.trim() ?? "" })).filter(p => p.partReference || p.partDescription);
      if (!parts.length || parts.length > 50) throw new Error("Informe entre 1 e 50 peças.");
      const existing = order?.data();
      tx.set(orderRef, { vehicleFlowId: vehicle.id, plate: current.plate ?? "", chassi: current.chassi ?? "", phone: current.phone ?? "", clientName: current.clientName ?? "", consultantName: current.consultantName ?? "", technicianName: current.technicianName ?? "",
        orderKind: action.orderKind, parts, partReference: parts[0].partReference, partDescription: parts[0].partDescription,
        ...(!order?.exists() ? { orderStatus: "solicitado_oficina", trackingState: "active", createdAt: serverTimestamp(), orderStatusUpdatedAt: serverTimestamp(), requestedBy: actor.name } : {}),
        updatedBy: actor.name, updatedAt: serverTimestamp(), chipDetailVersion: 1, chipActor: actor.uid,
      }, { merge: true });
      event.actionNote = `Pedido de peças (${existing?.orderStatus ?? "solicitado_oficina"}): ${parts.map(p => p.partReference || p.partDescription).join(", ")}`;
    }
    const writePatch: Record<string, unknown> = { ...patch, chipDetailVersion: 1, chipActor: actor.uid, chipAction: action.kind, chipMutationId: mutationId, updatedAt: serverTimestamp() };
    if (action.kind === "promise") {
      writePatch.promisedDeliveryAt = Timestamp.fromDate(patch.promisedDeliveryAt as Date);
      writePatch.promiseHistory = arrayUnion({ promisedDeliveryAt: (patch.promisedDeliveryAt as Date).toISOString(), changedAt: now.toISOString(), changedBy: actor.name, note: action.note, chipDetailVersion: 1 });
    }
    tx.update(ref, writePatch); tx.set(eventRef, event);
    return { ...current, ...patch, updatedAt: now, chipMutationId: mutationId } as VehicleFlow & { chipMutationId: string };
  });
}

export async function loadChipOrders(vehicle: VehicleFlow) {
  const db = getFirebaseDb(), ref = collection(db, "partOrders");
  const direct = await getDoc(doc(ref, vehicle.id));
  const linked = await getDocs(query(ref, where("vehicleFlowId", "==", vehicle.id), limit(21)));
  const rawChassi = vehicle.chassi?.trim();
  const chassi = rawChassi && !/^(null|undefined|n\/a|-|sem chassi)$/i.test(rawChassi) ? rawChassi : "";
  const matching = chassi ? await getDocs(query(ref, where("chassi", "in", [...new Set([chassi, chassi.toUpperCase(), chassi.toLowerCase()])]), limit(21))) : null;
  const records = [...(direct.exists() ? [direct] : []), ...linked.docs, ...(matching?.docs ?? [])];
  return { orders: [...new Map(records.map(item => [item.id, { ...item.data(), id: item.id } as PartOrder])).values()], limited: linked.size === 21 || matching?.size === 21 };
}
export async function loadChipHistory(vehicleId: string, cursor?: QueryDocumentSnapshot<DocumentData>) {
  const constraints = [where("vehicleFlowId", "==", vehicleId), orderBy("createdAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(51)];
  const snapshot = await getDocs(query(collection(getFirebaseDb(), "flowEvents"), ...constraints));
  const docs = snapshot.docs.slice(0, 50);
  return { events: docs.map(item => ({ ...item.data(), id: item.id } as FlowEvent)), cursor: snapshot.size > 50 ? docs[docs.length - 1] : undefined };
}

let catalogRequest: Promise<HyundaiPartCatalogItem[]> | undefined;
export function loadChipCatalog() {
  // Chunked catalog, one load per browser session; never subscribe to it.
  return catalogRequest ??= (async () => {
    const db = getFirebaseDb(), meta = await getDoc(doc(db, "partsCatalog", "meta"));
    const count = Number(meta.data()?.chunkCount ?? 0);
    if (!meta.exists() || !Number.isInteger(count) || count < 0 || count > 100) throw new Error("Catálogo indisponível ou acima do limite de 100 blocos. Use o preenchimento manual.");
    const items: HyundaiPartCatalogItem[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = await getDoc(doc(db, "partsCatalog", `chunk-${String(i).padStart(3, "0")}`));
      items.push(...(chunk.data()?.items ?? []));
    }
    return items;
  })().catch(error => { catalogRequest = undefined; throw error; });
}
