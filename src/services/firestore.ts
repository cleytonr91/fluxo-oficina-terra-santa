import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  documentId,
  deleteField,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { collections } from "@/lib/firebase/collections";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { AgendaItem, Appointment, BodyShopProcess, BodyShopStatus, BodyShopVehicleLocation, FlowEvent, FlowLane, HgsiAnswer, HgsiRecord, HyundaiPartCatalogItem, PartAvailability, PartOrder, PartOrderItem, PartOrderKind, PartOrderSource, PartOrderStatus, PartSchedulingActionType, PartsCounterEntry, PartsCounterEntryType, PartsCounterItem, PartsSalesGoal, PostCaseType, PostServiceCase, Preparation, RoadTestFormData, ServiceType, TreatmentStatus, UserProfile, UserRole, VehicleFlow, WashType } from "@/types/domain";

type PreparedVehicleInput = {
  id: string;
  client: string;
  plate: string;
  model: string;
  chassi: string;
  eventId: string;
  phone: string;
  service: string;
  consultant: string;
  technician: string;
  priority: "Normal" | "Alta";
  roadTest: boolean;
  chief: boolean;
  importedNote: string;
  internalNote: string;
  appointmentDate: string;
  appointmentTime: string;
  origin: "Agendado" | "Passante";
  partsOrdered?: boolean;
};

type SavePreparedAgendaInput = {
  sourceFileName: string;
  selectedDate: string;
  importedBy?: string;
  vehicles: PreparedVehicleInput[];
};

type WalkInVehicleInput = {
  client: string;
  phone?: string;
  plate: string;
  model?: string;
  chassi?: string;
  service: string;
  promisedDeliveryAt: string;
  consultant: string;
  technician?: string;
  washType?: WashType;
  appointmentDate: string;
  appointmentTime?: string;
  createdBy?: string;
  note?: string;
  partsOrdered?: boolean;
};

type ReuseVehicleAsWalkInInput = WalkInVehicleInput & {
  vehicleFlowId: string;
};

type VehicleFlowConflictInput = {
  plate?: string;
  chassi?: string;
  appointmentDate?: string;
  ignoreId?: string;
};

type SaveHgsiRecordInput = {
  chassi: string;
  osNumber: string;
  status: string;
  valid: boolean;
  sourceMonth?: string;
  clientName?: string;
  plate?: string;
  serviceLabel?: string;
  consultantName?: string;
  rawPayload?: Record<string, unknown>;
};

type SaveHgsiAnswerInput = {
  questionnaireId?: string;
  chassi: string;
  osNumber: string;
  responseStatus?: string;
  sourceMonth?: string;
  clientName?: string;
  plate?: string;
  serviceLabel?: string;
  consultantName?: string;
  serviceDate?: string;
  answerDate?: string;
  nps?: number;
  recommendation?: boolean;
  installationScore?: number;
  consultantScore?: number;
  deadlineScore?: number;
  serviceQualityScore?: number;
  priceAlignmentScore?: number;
  washScore?: number;
  correctServiceScore?: number;
  correctService?: boolean;
  rawPayload?: Record<string, unknown>;
};

type SavePostServiceTreatmentInput = {
  vehicleFlowId: string;
  sourceMonth: string;
  clientName?: string;
  plate?: string;
  chassi?: string;
  osNumber?: string;
  serviceLabel?: string;
  consultantName?: string;
  caseType: PostCaseType;
  treatmentStatus: TreatmentStatus;
  treatmentBy?: string;
  customerObservation?: string;
  gpvRequired?: boolean;
  assignedTo?: string;
  hgsiRequestAllowed?: boolean;
  hgsiRequestStatus?: "nao_solicitada" | "solicitada" | "respondida" | "bloqueada";
};

type SavePartOrderInput = {
  vehicle: VehicleFlow;
  customerId?: string;
  orderKind?: PartOrderKind;
  parts: PartOrderItem[];
  partReference?: string;
  partDescription?: string;
  actionBy?: string;
};

export async function loadHyundaiPartsCatalog() {
  const db = getFirebaseDb();
  const snapshot = await getDocs(collection(db, collections.partsCatalog));

  return snapshot.docs
    .filter((item) => item.id.startsWith("chunk-"))
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((item) => (item.data().items ?? []) as HyundaiPartCatalogItem[]);
}

export async function replaceHyundaiPartsCatalog({
  items,
  sourceFileName,
  importedBy,
}: {
  items: HyundaiPartCatalogItem[];
  sourceFileName: string;
  importedBy?: string;
}) {
  const db = getFirebaseDb();
  const catalogRef = collection(db, collections.partsCatalog);
  const current = await getDocs(catalogRef);
  const batch = writeBatch(db);
  const chunkSize = 700;
  const chunks: HyundaiPartCatalogItem[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  current.docs.forEach((item) => batch.delete(item.ref));
  chunks.forEach((chunk, index) => {
    batch.set(doc(catalogRef, `chunk-${String(index).padStart(3, "0")}`), {
      items: chunk,
      itemCount: chunk.length,
      sourceFileName,
      importedBy,
      importedAt: serverTimestamp(),
    });
  });
  batch.set(doc(catalogRef, "meta"), {
    itemCount: items.length,
    chunkCount: chunks.length,
    sourceFileName,
    importedBy,
    importedAt: serverTimestamp(),
  });

  await batch.commit();
}

export function subscribePartsCounterEntries(
  onData: (items: PartsCounterEntry[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const ref = query(collection(db, collections.partsCounterEntries), orderBy("createdAt", "desc"));

  return onSnapshot(ref, (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as PartsCounterEntry[]);
  }, (error) => onError?.(error));
}

export function subscribePartsCounterEntriesForMonth(
  month: string,
  onData: (items: PartsCounterEntry[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(year, monthNumber, 1).toISOString().slice(0, 10);
  const ref = query(
    collection(db, collections.partsCounterEntries),
    where("occurredOn", ">=", monthStart),
    where("occurredOn", "<", nextMonth),
  );

  return onSnapshot(ref, (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as PartsCounterEntry[]);
  }, (error) => onError?.(error));
}

export function subscribePartsSalesGoals(
  onData: (items: PartsSalesGoal[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const ref = query(collection(db, collections.partsSalesGoals), orderBy("month", "desc"));

  return onSnapshot(ref, (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as PartsSalesGoal[]);
  }, (error) => onError?.(error));
}

export type FarolObservation = {
  id: string;
  month: string;
  indicatorKey: string;
  indicatorLabel: string;
  text: string;
  value?: string;
  updatedBy?: string;
  updatedAt?: unknown;
};

export function subscribeFarolObservations(
  onData: (items: FarolObservation[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(collection(db, collections.farolObservations), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as FarolObservation[]);
  }, (error) => onError?.(error));
}

export function subscribeFarolObservationsForMonth(
  month: string,
  onData: (items: FarolObservation[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(query(
    collection(db, collections.farolObservations),
    where("month", "==", month),
  ), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as FarolObservation[]);
  }, (error) => onError?.(error));
}

export async function saveFarolObservation({
  month,
  indicatorKey,
  indicatorLabel,
  text,
  value,
  updatedBy,
}: Omit<FarolObservation, "id" | "updatedAt">) {
  const db = getFirebaseDb();
  await setDoc(doc(db, collections.farolObservations, `${month}-${indicatorKey}`), withoutUndefined({
    month,
    indicatorKey,
    indicatorLabel,
    text: text.trim(),
    value: value?.trim(),
    updatedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export type FarolDailyResult = {
  id: string;
  month: string;
  day: number;
  revision: number;
  revisionCount: number;
  generalMechanics: number;
  alignmentBalancing: number;
  beauty: number;
  updatedBy?: string;
  updatedAt?: unknown;
};

export function subscribeFarolDailyResults(
  onData: (items: FarolDailyResult[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(collection(db, collections.farolDailyResults), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as FarolDailyResult[]);
  }, (error) => onError?.(error));
}

export function subscribeFarolDailyResultsForMonth(
  month: string,
  onData: (items: FarolDailyResult[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(query(
    collection(db, collections.farolDailyResults),
    where("month", "==", month),
  ), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as FarolDailyResult[]);
  }, (error) => onError?.(error));
}

export async function saveFarolDailyResult({
  month,
  day,
  revision,
  revisionCount,
  generalMechanics,
  alignmentBalancing,
  beauty,
  updatedBy,
}: Omit<FarolDailyResult, "id" | "updatedAt">) {
  const db = getFirebaseDb();
  await setDoc(doc(db, collections.farolDailyResults, `${month}-${String(day).padStart(2, "0")}`), withoutUndefined({
    month,
    day,
    revision: Math.max(0, Number(revision) || 0),
    revisionCount: Math.max(0, Math.floor(Number(revisionCount) || 0)),
    generalMechanics: Math.max(0, Number(generalMechanics) || 0),
    alignmentBalancing: Math.max(0, Number(alignmentBalancing) || 0),
    beauty: Math.max(0, Number(beauty) || 0),
    updatedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export type FarolRevenue = {
  id: string;
  month: string;
  parts: number;
  services: number;
  updatedBy?: string;
  updatedAt?: unknown;
};

export function subscribeFarolRevenue(
  onData: (items: FarolRevenue[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(collection(db, collections.farolRevenue), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as FarolRevenue[]);
  }, (error) => onError?.(error));
}

export async function saveFarolRevenue({
  month,
  parts,
  services,
  updatedBy,
}: Omit<FarolRevenue, "id" | "updatedAt">) {
  const db = getFirebaseDb();
  await setDoc(doc(db, collections.farolRevenue, month), withoutUndefined({
    month,
    parts: Math.max(0, Number(parts) || 0),
    services: Math.max(0, Number(services) || 0),
    updatedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export type FarolGrossProfit = {
  id: string;
  month: string;
  planned: number;
  realized: number;
  previousYear: number;
  margin: number;
  updatedBy?: string;
  updatedAt?: unknown;
};

export function subscribeFarolGrossProfit(
  onData: (items: FarolGrossProfit[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(collection(db, collections.farolGrossProfit), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as FarolGrossProfit[]);
  }, (error) => onError?.(error));
}

export async function saveFarolGrossProfit({
  month,
  planned,
  realized,
  previousYear,
  margin,
  updatedBy,
}: Omit<FarolGrossProfit, "id" | "updatedAt">) {
  const db = getFirebaseDb();
  await setDoc(doc(db, collections.farolGrossProfit, month), withoutUndefined({
    month,
    planned: Math.max(0, Number(planned) || 0),
    realized: Math.max(0, Number(realized) || 0),
    previousYear: Math.max(0, Number(previousYear) || 0),
    margin: Math.max(0, Number(margin) || 0),
    updatedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export type FarolChannelRevenue = {
  id: string;
  month: string;
  oficinaProdutiva: number;
  acessorios: number;
  embelezamento: number;
  funilaria: number;
  balcao: number;
  updatedBy?: string;
  updatedAt?: unknown;
};

export function subscribeFarolChannelRevenue(
  onData: (items: FarolChannelRevenue[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(collection(db, collections.farolChannelRevenue), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as FarolChannelRevenue[]);
  }, (error) => onError?.(error));
}

export async function saveFarolChannelRevenue({
  month,
  oficinaProdutiva,
  acessorios,
  embelezamento,
  funilaria,
  balcao,
  updatedBy,
}: Omit<FarolChannelRevenue, "id" | "updatedAt">) {
  const db = getFirebaseDb();
  await setDoc(doc(db, collections.farolChannelRevenue, month), withoutUndefined({
    month,
    oficinaProdutiva: Math.max(0, Number(oficinaProdutiva) || 0),
    acessorios: Math.max(0, Number(acessorios) || 0),
    embelezamento: Math.max(0, Number(embelezamento) || 0),
    funilaria: Math.max(0, Number(funilaria) || 0),
    balcao: Math.max(0, Number(balcao) || 0),
    updatedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export type FarolServiceProductivity = {
  id: string;
  month: string;
  revisions: number;
  revisionSales: number;
  mechanicsSales: number;
  additionalSales: number;
  beautySales: number;
  updatedBy?: string;
  updatedAt?: unknown;
};

export function subscribeFarolServiceProductivity(
  onData: (items: FarolServiceProductivity[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(collection(db, collections.farolServiceProductivity), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as FarolServiceProductivity[]);
  }, (error) => onError?.(error));
}

export async function saveFarolServiceProductivity({
  month,
  revisions,
  revisionSales,
  mechanicsSales,
  additionalSales,
  beautySales,
  updatedBy,
}: Omit<FarolServiceProductivity, "id" | "updatedAt">) {
  const db = getFirebaseDb();
  await setDoc(doc(db, collections.farolServiceProductivity, month), withoutUndefined({
    month,
    revisions: Math.max(0, Math.floor(Number(revisions) || 0)),
    revisionSales: Math.max(0, Number(revisionSales) || 0),
    mechanicsSales: Math.max(0, Number(mechanicsSales) || 0),
    additionalSales: Math.max(0, Number(additionalSales) || 0),
    beautySales: Math.max(0, Number(beautySales) || 0),
    updatedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

function normalizeCounterItems(items: PartsCounterItem[], entryType: PartsCounterEntryType) {
  return items.map((item, index) => withoutUndefined({
    id: item.id || `item-${index + 1}`,
    partReference: item.partReference.trim().toUpperCase(),
    partDescription: item.partDescription.trim().toUpperCase(),
    quantity: Math.max(1, Number(item.quantity) || 1),
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    availableInStock: entryType === "venda" ? true : Boolean(item.availableInStock),
    orderSource: item.availableInStock ? undefined : item.orderSource,
    orderStatus: item.availableInStock ? "disponivel" : item.orderStatus ?? "necessario_pedido",
    invoiceNumber: item.invoiceNumber?.trim().toUpperCase(),
    expectedArrivalDate: item.expectedArrivalDate || undefined,
    orderNote: item.orderNote?.trim().toUpperCase(),
  }));
}

export async function createPartsCounterEntry({
  entry,
  actionBy,
}: {
  entry: Omit<PartsCounterEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  await addDoc(collection(db, collections.partsCounterEntries), withoutUndefined({
    ...entry,
    occurredOn: entry.occurredOn || undefined,
    clientName: entry.clientName.trim().toUpperCase(),
    sellerName: entry.sellerName.trim().toUpperCase(),
    destinationState: entry.destinationState?.trim().toUpperCase(),
    notes: entry.notes?.trim().toUpperCase(),
    items: normalizeCounterItems(entry.items, entry.entryType),
    createdBy: actionBy,
    updatedBy: actionBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
}

export async function updatePartsCounterEntryDetails({
  entryId,
  entry,
  actionBy,
}: {
  entryId: string;
  entry: Omit<PartsCounterEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  await setDoc(doc(collection(db, collections.partsCounterEntries), entryId), {
    entryType: entry.entryType,
    occurredOn: entry.occurredOn || null,
    clientName: entry.clientName.trim().toUpperCase(),
    customerType: entry.customerType,
    sellerName: entry.sellerName.trim().toUpperCase(),
    destinationState: entry.destinationState?.trim().toUpperCase() || null,
    freightAmount: Math.max(0, Number(entry.freightAmount) || 0),
    notes: entry.notes?.trim().toUpperCase() || null,
    items: normalizeCounterItems(entry.items, entry.entryType),
    updatedBy: actionBy ?? null,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function updatePartsCounterEntry({
  entryId,
  entryType,
  items,
  actionBy,
}: {
  entryId: string;
  entryType: PartsCounterEntryType;
  items: PartsCounterItem[];
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  await setDoc(doc(collection(db, collections.partsCounterEntries), entryId), withoutUndefined({
    entryType,
    items: normalizeCounterItems(items, entryType),
    updatedBy: actionBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export async function convertPartsCounterEntry({
  entryId,
  entryType,
  actionBy,
}: {
  entryId: string;
  entryType: Extract<PartsCounterEntryType, "venda" | "venda_perdida">;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  await setDoc(doc(collection(db, collections.partsCounterEntries), entryId), {
    entryType,
    updatedBy: actionBy,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function savePartsSalesGoal({
  month,
  targetAmount,
  businessDays,
  updatedBy,
}: {
  month: string;
  targetAmount: number;
  businessDays: number;
  updatedBy?: string;
}) {
  const db = getFirebaseDb();
  await setDoc(doc(collection(db, collections.partsSalesGoals), month), withoutUndefined({
    month,
    targetAmount: Math.max(0, Number(targetAmount) || 0),
    businessDays: Math.max(1, Math.round(Number(businessDays) || 1)),
    updatedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

function normalizeVehicleIdentifier(value?: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function publicPartLookupId(plate?: string, customerId?: string) {
  const cleanPlate = normalizeVehicleIdentifier(plate);
  const cleanCustomerId = normalizeVehicleIdentifier(customerId);
  if (!cleanPlate || !cleanCustomerId) return "";
  return `${cleanPlate}_${cleanCustomerId}`;
}

function publicStatusLabel(status?: PartOrderStatus) {
  if (status === "pedido_realizado") return "Peça solicitada à montadora";
  if (status === "back_order") return "Aguardando disponibilidade da montadora";
  if (status === "em_transito") return "A caminho da concessionária";
  if (status === "recebido") return "Peça recebida pela concessionária";
  if (status === "disponivel") return "Disponível para agendamento";
  if (status === "disponivel_execucao") return "Disponível para execução na oficina";
  if (status === "cancelado") return "Solicitação cancelada";
  return "Pedido em análise";
}

function publicPartOrderPayload({
  orderId,
  vehicleFlowId,
  plate,
  customerId,
  parts,
  partReference,
  partDescription,
  orderStatus,
  expectedArrivalDate,
  invoiceNumber,
  orderNumber,
  updatedBy,
}: {
  orderId: string;
  vehicleFlowId?: string;
  plate?: string;
  customerId?: string;
  parts: PartOrderItem[];
  partReference?: string;
  partDescription?: string;
  orderStatus: PartOrderStatus;
  expectedArrivalDate?: string;
  invoiceNumber?: string;
  orderNumber?: string;
  updatedBy?: string;
}) {
  const normalizedParts = parts.length ? parts : [{
    id: "peca-1",
    partReference,
    partDescription,
  }];

  return withoutUndefined({
    id: orderId,
    vehicleFlowId,
    plate,
    customerId,
    parts: normalizedParts.map((part, index) => withoutUndefined({
      id: part.id || `peca-${index + 1}`,
      partReference: part.partReference,
      partDescription: part.partDescription,
    })),
    partReference,
    partDescription,
    status: publicStatusLabel(orderStatus),
    internalStatus: orderStatus,
    expectedArrivalDate: expectedArrivalDate || undefined,
    invoiceNumber: invoiceNumber || undefined,
    orderNumber: orderNumber || undefined,
    availableForScheduling: orderStatus === "disponivel",
    updatedBy,
    updatedAt: serverTimestamp(),
  });
}

function timestampToDateInput(value: unknown) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds?: number }).seconds);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000).toISOString().slice(0, 10);
    }
  }

  return "";
}

function matchesVehicleFlowDate(vehicle: VehicleFlow, appointmentDate?: string) {
  if (!appointmentDate) return true;
  if (vehicle.appointmentDate === appointmentDate || timestampToDateInput(vehicle.deliveredAt) === appointmentDate) {
    return true;
  }

  return Boolean(
    vehicle.status === "ativo"
      && vehicle.appointmentDate
      && vehicle.appointmentDate < appointmentDate
      && vehicle.currentLane !== "preparacao_confirmada",
  );
}

type UpdatePartOrderInput = {
  orderId: string;
  vehicleFlowId?: string;
  plate?: string;
  chassi?: string;
  phone?: string;
  customerId?: string;
  clientName?: string;
  consultantName?: string;
  technicianName?: string;
  orderKind?: PartOrderKind;
  parts: PartOrderItem[];
  partReference?: string;
  partDescription?: string;
  orderStatus: PartOrderStatus;
  orderSource?: PartOrderSource;
  orderNumber?: string;
  orderVor?: boolean;
  orderDate?: string;
  invoiceNumber?: string;
  expectedArrivalDate?: string;
  cancellationReason?: string;
  updatedBy?: string;
};

export type CreateStandalonePartOrderInput = Omit<UpdatePartOrderInput, "orderId"> & {
  plate?: string;
};

type RegisterPartSchedulingActionInput = {
  orderId: string;
  action: PartSchedulingActionType;
  actionBy?: string;
  returnDate?: string;
  contactAttemptAt?: string;
  nextContactAt?: string;
  note?: string;
};

function serviceTypeFromLabel(service: string): ServiceType {
  const text = service.toLowerCase();
  const revision = text.match(/revis[aã]o\s*0?(\d+)/);

  if (revision) {
    const number = Number(revision[1]);
    if (number >= 1 && number <= 10) {
      return `revisao_${String(number).padStart(2, "0")}` as ServiceType;
    }
  }

  if (text.includes("diagn")) return "diagnostico";
  if (text.includes("reparo")) return "reparo_geral";
  if (text.includes("recall") || text.includes("campanha")) return "recall";
  return "combinado";
}

function isWashService(service: string) {
  const text = service
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return text.includes("lavagem") || text.includes("embelezamento");
}

function washTypeFromService(service: string, fallback?: WashType): WashType {
  const text = service
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (text.includes("embelezamento")) {
    return fallback && fallback !== "nao" ? fallback : "simples";
  }
  if (!text.includes("lavagem")) return fallback ?? "simples";
  if (text.includes("motor") && text.includes("banco")) return "motor_bancos";
  if (text.includes("motor")) return "motor";
  return "simples";
}

function documentKey(...parts: string[]) {
  return parts
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || `registro-${Date.now()}`;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export async function listAppointmentsByDate(appointmentDate: string) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.appointments);
  const snapshot = await getDocs(query(ref, where("appointmentDate", "==", appointmentDate), orderBy("appointmentTime")));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as Appointment[];
}

export async function listUserProfiles() {
  const db = getFirebaseDb();
  const snapshot = await getDocs(collection(db, collections.users));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as UserProfile[];
}

export async function listAgendaItems(userId: string, canSeeTeam = false) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.agendaItems);
  const snapshots = canSeeTeam
    ? [await getDocs(query(ref, orderBy("date")))]
    : await Promise.all([
        getDocs(query(ref, where("ownerId", "==", userId))),
        getDocs(query(ref, where("participantIds", "array-contains", userId))),
      ]);
  const unique = new Map<string, AgendaItem>();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => unique.set(item.id, { id: item.id, ...item.data() } as AgendaItem)));
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveAgendaItem(item: Omit<AgendaItem, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
  const db = getFirebaseDb();
  const ref = item.id ? doc(collection(db, collections.agendaItems), item.id) : doc(collection(db, collections.agendaItems));
  await setDoc(ref, withoutUndefined({ ...item, updatedAt: serverTimestamp(), ...(item.id ? {} : { createdAt: serverTimestamp() }) }), { merge: true });
  return ref.id;
}

export async function toggleAgendaItem(itemId: string, completed: boolean) {
  await updateDoc(doc(getFirebaseDb(), collections.agendaItems, itemId), { completed, updatedAt: serverTimestamp() });
}

export async function toggleAgendaItemOccurrence(itemId: string, date: string, completed: boolean) {
  await updateDoc(doc(getFirebaseDb(), collections.agendaItems, itemId), {
    completedDates: completed ? arrayUnion(date) : arrayRemove(date),
    updatedAt: serverTimestamp(),
  });
}

export async function listHgsiRecords() {
  const db = getFirebaseDb();
  const snapshot = await getDocs(collection(db, collections.hgsiRecords));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as HgsiRecord[];
}

export async function listHgsiRecordsForMonth(sourceMonth: string) {
  const db = getFirebaseDb();
  const snapshot = await getDocs(query(
    collection(db, collections.hgsiRecords),
    where("sourceMonth", "==", sourceMonth),
  ));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as HgsiRecord[];
}

export async function listHgsiAnswers() {
  const db = getFirebaseDb();
  const snapshot = await getDocs(collection(db, collections.hgsiAnswers));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as HgsiAnswer[];
}

export async function listHgsiAnswersForMonth(sourceMonth: string) {
  const db = getFirebaseDb();
  const snapshot = await getDocs(query(
    collection(db, collections.hgsiAnswers),
    where("sourceMonth", "==", sourceMonth),
  ));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as HgsiAnswer[];
}

export async function listPostServiceCases() {
  const db = getFirebaseDb();
  const snapshot = await getDocs(collection(db, collections.postServiceCases));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as PostServiceCase[];
}

export async function listPostServiceCasesForMonth(sourceMonth: string) {
  const db = getFirebaseDb();
  const snapshot = await getDocs(query(
    collection(db, collections.postServiceCases),
    where("sourceMonth", "==", sourceMonth),
  ));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as PostServiceCase[];
}

export async function savePostServiceTreatment({
  vehicleFlowId,
  sourceMonth,
  clientName,
  plate,
  chassi,
  osNumber,
  serviceLabel,
  consultantName,
  caseType,
  treatmentStatus,
  treatmentBy,
  customerObservation,
  gpvRequired,
  assignedTo,
  hgsiRequestAllowed = true,
  hgsiRequestStatus = "nao_solicitada",
}: SavePostServiceTreatmentInput) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, collections.postServiceCases), documentKey(sourceMonth, vehicleFlowId));

  await setDoc(ref, withoutUndefined({
    vehicleFlowId,
    sourceMonth,
    clientName,
    plate,
    chassi,
    osNumber,
    serviceLabel,
    consultantName,
    caseType,
    pendingDescription: customerObservation,
    treatmentBy,
    customerObservation,
    gpvRequired,
    assignedTo: gpvRequired ? (assignedTo || "GPV") : assignedTo,
    treatmentStatus,
    hgsiRequestAllowed,
    hgsiRequestStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export async function saveHgsiRecords({
  sourceFileName,
  importedBy,
  records,
}: {
  sourceFileName: string;
  importedBy?: string;
  records: SaveHgsiRecordInput[];
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const importBatchId = `hgsi-records-${Date.now()}`;
  const importBatchRef = doc(collection(db, collections.importBatches), importBatchId);

  batch.set(importBatchRef, {
    sourceFileName,
    sourceKind: "hgsi_records",
    importedBy,
    importedAt: serverTimestamp(),
    totalRows: records.length,
    notes: "Importacao de status de registros Route/HGSI",
  });

  records.forEach((record, index) => {
    const ref = doc(collection(db, collections.hgsiRecords), documentKey(record.chassi || "sem-chassi", record.osNumber || `linha-${index}`, record.sourceMonth || "sem-mes"));
    batch.set(ref, withoutUndefined({
      importBatchId,
      chassi: record.chassi,
      osNumber: record.osNumber,
      recordStatus: record.status,
      isValidRecord: record.valid,
      sourceMonth: record.sourceMonth,
      clientName: record.clientName,
      plate: record.plate,
      serviceLabel: record.serviceLabel,
      consultantName: record.consultantName,
      rawPayload: record.rawPayload,
      importedAt: serverTimestamp(),
    }), { merge: true });
  });

  await batch.commit();
  return importBatchId;
}

export async function saveHgsiAnswers({
  sourceFileName,
  importedBy,
  answers,
}: {
  sourceFileName: string;
  importedBy?: string;
  answers: SaveHgsiAnswerInput[];
}) {
  const db = getFirebaseDb();
  const importBatchId = `hgsi-answers-${Date.now()}`;
  const importBatchRef = doc(collection(db, collections.importBatches), importBatchId);
  const batchSize = 450;

  for (let start = 0; start < Math.max(answers.length, 1); start += batchSize) {
    const batch = writeBatch(db);
    if (start === 0) {
      batch.set(importBatchRef, {
        sourceFileName,
        sourceKind: "hgsi_answers",
        importedBy,
        importedAt: serverTimestamp(),
        totalRows: answers.length,
        notes: "Importacao de respostas HGSI",
      });
    }

    answers.slice(start, start + batchSize).forEach((answer, offset) => {
      const index = start + offset;
      const ref = doc(collection(db, collections.hgsiAnswers), documentKey(
        answer.chassi || "sem-chassi",
        answer.osNumber || answer.questionnaireId || `linha-${index}`,
        answer.sourceMonth || "sem-mes",
        answer.answerDate || `linha-${index}`,
      ));
      batch.set(ref, withoutUndefined({
        importBatchId,
        questionnaireId: answer.questionnaireId,
        chassi: answer.chassi,
        osNumber: answer.osNumber,
        responseStatus: answer.responseStatus,
        sourceMonth: answer.sourceMonth,
        clientName: answer.clientName,
        plate: answer.plate,
        serviceLabel: answer.serviceLabel,
        consultantName: answer.consultantName,
        serviceDate: answer.serviceDate,
        answerDate: answer.answerDate,
        nps: answer.nps,
        recommendation: answer.recommendation,
        installationScore: answer.installationScore,
        consultantScore: answer.consultantScore,
        deadlineScore: answer.deadlineScore,
        serviceQualityScore: answer.serviceQualityScore,
        priceAlignmentScore: answer.priceAlignmentScore,
        washScore: answer.washScore,
        correctServiceScore: answer.correctServiceScore,
        correctService: answer.correctService,
        rawPayload: answer.rawPayload,
        importedAt: serverTimestamp(),
      }), { merge: true });
    });

    await batch.commit();
  }

  return importBatchId;
}

export async function updateUserProfile({
  userId,
  name,
  role,
  active,
  allowedPaths,
}: {
  userId: string;
  name: string;
  role: UserRole;
  active: boolean;
  allowedPaths: string[];
}) {
  const db = getFirebaseDb();
  const userRef = doc(collection(db, collections.users), userId);

  await updateDoc(userRef, {
    name,
    role,
    active,
    allowedPaths,
    updatedAt: serverTimestamp(),
  });
}

export async function saveImportedAppointments(appointments: Omit<Appointment, "createdAt" | "updatedAt">[]) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);

  appointments.forEach((appointment) => {
    const ref = doc(collection(db, collections.appointments), appointment.id);
    batch.set(ref, {
      ...appointment,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
}

export async function savePreparedAgenda({
  sourceFileName,
  selectedDate,
  importedBy,
  vehicles,
}: SavePreparedAgendaInput) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const importBatchId = `${selectedDate || "sem-data"}-${Date.now()}`;
  const importBatchRef = doc(collection(db, collections.importBatches), importBatchId);

  batch.set(importBatchRef, {
    sourceFileName,
    sourceKind: "agenda",
    importedBy,
    importedAt: serverTimestamp(),
    totalRows: vehicles.length,
    notes: `Preparacao confirmada para ${selectedDate}`,
  });

  vehicles.forEach((vehicle) => {
    const appointmentId = vehicle.id;
    const appointmentRef = doc(collection(db, collections.appointments), appointmentId);
    const preparationRef = doc(collection(db, collections.preparations), appointmentId);
    const flowRef = doc(collection(db, collections.vehiclesFlow), appointmentId);
    const flowEventRef = doc(collection(db, collections.flowEvents));

    batch.set(appointmentRef, {
      importBatchId,
      importedEventId: vehicle.eventId,
      appointmentDate: vehicle.appointmentDate,
      appointmentTime: vehicle.appointmentTime,
      clientName: vehicle.client,
      phone: vehicle.phone,
      plate: vehicle.plate,
      chassi: vehicle.chassi,
      model: vehicle.model,
      consultantName: vehicle.consultant,
      serviceType: serviceTypeFromLabel(vehicle.service),
      serviceLabel: vehicle.service,
      importedNotes: vehicle.importedNote,
      rawPayload: vehicle,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    batch.set(preparationRef, {
      appointmentId,
      technicianId: vehicle.technician,
      technicianName: vehicle.technician,
      priority: vehicle.priority === "Alta" ? "alta" : "normal",
      roadTestRequired: vehicle.roadTest,
      chiefPresenceRequired: vehicle.chief,
      internalNote: vehicle.internalNote,
      confirmedAt: serverTimestamp(),
      confirmedBy: importedBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    batch.set(flowRef, {
      appointmentId,
      origin: vehicle.origin === "Passante" ? "passante" : "agendado",
      currentLane: "preparacao_confirmada",
      appointmentDate: vehicle.appointmentDate,
      appointmentTime: vehicle.appointmentTime,
      clientName: vehicle.client,
      phone: vehicle.phone,
      plate: vehicle.plate,
      chassi: vehicle.chassi,
      model: vehicle.model,
      serviceLabel: vehicle.service,
      consultantName: vehicle.consultant,
      technicianName: vehicle.technician,
      priority: vehicle.priority === "Alta" ? "alta" : "normal",
      importedNotes: vehicle.importedNote,
      roadTestRequired: vehicle.roadTest,
      chiefPresenceRequired: vehicle.chief,
      customerWaits: false,
      partsOrdered: vehicle.partsOrdered ?? false,
      washType: "nao",
      status: "ativo",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    batch.set(flowEventRef, {
      vehicleFlowId: appointmentId,
      toLane: "preparacao_confirmada",
      actionBy: importedBy,
      actionNote: "Preparacao confirmada pelo chefe de oficina",
      createdAt: serverTimestamp(),
    });
  });

  await batch.commit();
}

export async function savePreparedVehicle({
  sourceFileName,
  selectedDate,
  importedBy,
  vehicle,
}: Omit<SavePreparedAgendaInput, "vehicles"> & { vehicle: PreparedVehicleInput }) {
  await savePreparedAgenda({
    sourceFileName,
    selectedDate,
    importedBy,
    vehicles: [vehicle],
  });
}

export async function listActiveVehicleFlows({ includeDelivered = false } = {}) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.vehiclesFlow);
  const snapshot = includeDelivered
    ? await getDocs(ref)
    : await getDocs(query(ref, where("status", "==", "ativo")));

  const vehicles = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as VehicleFlow[];

  return vehicles.filter((vehicle) => (
    includeDelivered || vehicle.currentLane !== "entregue"
  ));
}

export async function listVehicleFlowsForMonth(month: string) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.vehiclesFlow);
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthDate = new Date(year, monthNumber, 1);
  const nextMonth = nextMonthDate.toISOString().slice(0, 10);
  const deliveredStart = Timestamp.fromDate(new Date(`${monthStart}T00:00:00`));
  const deliveredEnd = Timestamp.fromDate(new Date(`${nextMonth}T00:00:00`));
  const [appointmentSnapshot, deliveredSnapshot] = await Promise.all([
    getDocs(query(
      ref,
      where("appointmentDate", ">=", monthStart),
      where("appointmentDate", "<", nextMonth),
    )),
    getDocs(query(
      ref,
      where("deliveredAt", ">=", deliveredStart),
      where("deliveredAt", "<", deliveredEnd),
    )),
  ]);

  return [...new Map([
    ...appointmentSnapshot.docs,
    ...deliveredSnapshot.docs,
  ].map((item) => [
    item.id,
    { id: item.id, ...item.data() } as VehicleFlow,
  ])).values()];
}

export async function listDeliveredVehicleFlowsForMonth(month: string) {
  const db = getFirebaseDb();
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = Timestamp.fromDate(new Date(`${month}-01T00:00:00`));
  const nextMonth = Timestamp.fromDate(new Date(year, monthNumber, 1));
  const snapshot = await getDocs(query(
    collection(db, collections.vehiclesFlow),
    where("deliveredAt", ">=", monthStart),
    where("deliveredAt", "<", nextMonth),
  ));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as VehicleFlow[];
}

export async function listVehicleFlowsByIds(vehicleFlowIds: string[]) {
  const db = getFirebaseDb();
  const uniqueIds = Array.from(new Set(vehicleFlowIds.filter(Boolean)));
  if (!uniqueIds.length) return [];

  const snapshots = await Promise.all(Array.from(
    { length: Math.ceil(uniqueIds.length / 30) },
    (_, index) => getDocs(query(
      collection(db, collections.vehiclesFlow),
      where(documentId(), "in", uniqueIds.slice(index * 30, (index + 1) * 30)),
    )),
  ));

  return snapshots.flatMap((snapshot) => snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }))) as VehicleFlow[];
}

export async function findVehicleFlowConflict({
  plate,
  chassi,
  appointmentDate,
  ignoreId,
}: VehicleFlowConflictInput) {
  const normalizedPlate = normalizeVehicleIdentifier(plate);
  const normalizedChassi = normalizeVehicleIdentifier(chassi);

  if (!normalizedPlate && !normalizedChassi) return null;

  const db = getFirebaseDb();
  const ref = collection(db, collections.vehiclesFlow);
  const identifierValues = (value?: string) => Array.from(new Set([
    value?.trim(),
    value?.trim().toUpperCase(),
    value?.trim().toLowerCase(),
    normalizeVehicleIdentifier(value),
  ].filter((entry): entry is string => Boolean(entry))));
  const searches = [
    { field: "plate", values: identifierValues(plate) },
    { field: "chassi", values: identifierValues(chassi) },
  ].filter((search) => search.values.length > 0);
  const snapshots = await Promise.all(searches.map((search) => getDocs(query(
    ref,
    where(search.field, "in", search.values),
  ))));
  const vehicles = [...new Map(snapshots.flatMap((snapshot) => snapshot.docs.map((item) => [
    item.id,
    { id: item.id, ...item.data() } as VehicleFlow,
  ]))).values()];

  return vehicles.find((vehicle) => {
    if (vehicle.id === ignoreId || vehicle.status !== "ativo" || vehicle.currentLane === "entregue") return false;
    if (!matchesVehicleFlowDate(vehicle, appointmentDate)) return false;

    const vehiclePlate = normalizeVehicleIdentifier(vehicle.plate);
    const vehicleChassi = normalizeVehicleIdentifier(vehicle.chassi);

    return Boolean(
      (normalizedChassi && vehicleChassi && normalizedChassi === vehicleChassi)
        || (normalizedPlate && vehiclePlate && normalizedPlate === vehiclePlate),
    );
  }) ?? null;
}

export function subscribeActiveVehicleFlows(
  onChange: (vehicles: VehicleFlow[]) => void,
  onError?: (error: Error) => void,
  { includeDelivered = false } = {},
) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.vehiclesFlow);
  const flowQuery = includeDelivered
    ? query(ref)
    : query(ref, where("status", "==", "ativo"));

  return onSnapshot(flowQuery, (snapshot) => {
    const vehicles = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as VehicleFlow[];

    onChange(vehicles.filter((vehicle) => (
      includeDelivered || vehicle.currentLane !== "entregue"
    )));
  }, onError);
}

export function subscribeVehicleFlowsByIds(
  vehicleFlowIds: string[],
  onChange: (vehicles: VehicleFlow[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const uniqueIds = Array.from(new Set(vehicleFlowIds.filter(Boolean)));

  if (!uniqueIds.length) {
    onChange([]);
    return () => undefined;
  }

  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 30) {
    chunks.push(uniqueIds.slice(index, index + 30));
  }

  const vehiclesByChunk = new Map<number, VehicleFlow[]>();
  const emit = () => onChange(Array.from(vehiclesByChunk.values()).flat());
  const unsubscribes = chunks.map((ids, chunkIndex) => onSnapshot(query(
    collection(db, collections.vehiclesFlow),
    where(documentId(), "in", ids),
  ), (snapshot) => {
    vehiclesByChunk.set(chunkIndex, snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as VehicleFlow[]);
    emit();
  }, onError));

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

export function subscribeVehicleFlowsByIdentifiers(
  plates: string[],
  chassis: string[],
  onChange: (vehicles: VehicleFlow[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const queries: Array<{ field: "plate" | "chassi"; values: string[] }> = [];

  ([
    ["plate", Array.from(new Set(plates.filter(Boolean)))],
    ["chassi", Array.from(new Set(chassis.filter(Boolean)))],
  ] as const).forEach(([field, values]) => {
    for (let index = 0; index < values.length; index += 30) {
      queries.push({ field, values: values.slice(index, index + 30) });
    }
  });

  if (!queries.length) {
    onChange([]);
    return () => undefined;
  }

  const vehiclesByQuery = new Map<number, VehicleFlow[]>();
  const emit = () => onChange([...new Map(
    Array.from(vehiclesByQuery.values())
      .flat()
      .map((vehicle) => [vehicle.id, vehicle]),
  ).values()]);
  const unsubscribes = queries.map(({ field, values }, queryIndex) => onSnapshot(query(
    collection(db, collections.vehiclesFlow),
    where(field, "in", values),
  ), (snapshot) => {
    vehiclesByQuery.set(queryIndex, snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as VehicleFlow[]);
    emit();
  }, onError));

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

export function subscribeVehicleFlowsForPreparation(
  selectedDate: string,
  onChange: (vehicles: VehicleFlow[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.vehiclesFlow);
  let selectedDateVehicles = new Map<string, VehicleFlow>();
  let pendingVehicles = new Map<string, VehicleFlow>();
  let immobilizedVehicles = new Map<string, VehicleFlow>();
  const emit = () => onChange([...new Map([
    ...selectedDateVehicles,
    ...pendingVehicles,
    ...immobilizedVehicles,
  ]).values()]);

  const unsubscribeSelectedDate = onSnapshot(
    query(ref, where("appointmentDate", "==", selectedDate)),
    (snapshot) => {
      selectedDateVehicles = new Map(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as VehicleFlow)
        .filter((vehicle) => vehicle.status !== "cancelado")
        .map((vehicle) => [vehicle.id, vehicle]));
      emit();
    },
    onError,
  );

  const unsubscribePending = onSnapshot(
    query(ref, where("currentLane", "in", ["aguardando_servico", "em_servico"])),
    (snapshot) => {
      pendingVehicles = new Map(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as VehicleFlow)
        .filter((vehicle) => (
          vehicle.status === "ativo"
          && !vehicle.noShow
          && Boolean(vehicle.appointmentDate && vehicle.appointmentDate < selectedDate)
        ))
        .map((vehicle) => [vehicle.id, vehicle]));
      emit();
    },
    onError,
  );

  const unsubscribeImmobilized = onSnapshot(
    query(ref, where("vehicleImmobilized", "==", true)),
    (snapshot) => {
      immobilizedVehicles = new Map(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as VehicleFlow)
        .filter((vehicle) => vehicle.status === "ativo")
        .map((vehicle) => [vehicle.id, vehicle]));
      emit();
    },
    onError,
  );

  return () => {
    unsubscribeSelectedDate();
    unsubscribePending();
    unsubscribeImmobilized();
  };
}

export function subscribeVehicleFlowsForDate(
  selectedDate: string,
  onChange: (vehicles: VehicleFlow[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.vehiclesFlow);
  const start = Timestamp.fromDate(new Date(`${selectedDate}T00:00:00`));
  const endDate = new Date(`${selectedDate}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const end = Timestamp.fromDate(endDate);
  let selectedDateVehicles = new Map<string, VehicleFlow>();
  let carryoverVehicles = new Map<string, VehicleFlow>();
  let immobilizedVehicles = new Map<string, VehicleFlow>();
  let deliveredVehicles = new Map<string, VehicleFlow>();

  const emit = () => {
    onChange([...new Map([
      ...selectedDateVehicles,
      ...carryoverVehicles,
      ...immobilizedVehicles,
      ...deliveredVehicles,
    ]).values()]);
  };

  const operationalLanes: FlowLane[] = [
    "aguardando_servico",
    "em_servico",
    "orcamento_complementar",
    "aguardando_lavagem",
    "lavagem",
    "preparacao_entrega",
  ];

  const unsubscribeSelectedDate = onSnapshot(
    query(ref, where("appointmentDate", "==", selectedDate)),
    (snapshot) => {
      selectedDateVehicles = new Map(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as VehicleFlow)
        .filter((vehicle) => vehicle.status !== "cancelado")
        .map((vehicle) => [vehicle.id, vehicle]));
      emit();
    },
    onError,
  );

  const unsubscribeCarryovers = onSnapshot(
    query(ref, where("currentLane", "in", operationalLanes)),
    (snapshot) => {
      carryoverVehicles = new Map(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as VehicleFlow)
        .filter((vehicle) => (
          vehicle.status === "ativo"
          && Boolean(vehicle.appointmentDate && vehicle.appointmentDate < selectedDate)
        ))
        .map((vehicle) => [vehicle.id, vehicle]));
      emit();
    },
    onError,
  );

  const unsubscribeImmobilized = onSnapshot(
    query(ref, where("vehicleImmobilized", "==", true)),
    (snapshot) => {
      immobilizedVehicles = new Map(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as VehicleFlow)
        .filter((vehicle) => (
          vehicle.status === "ativo"
          && (!vehicle.appointmentDate || vehicle.appointmentDate <= selectedDate)
        ))
        .map((vehicle) => [vehicle.id, vehicle]));
      emit();
    },
    onError,
  );

  const unsubscribeDelivered = onSnapshot(
    query(
      ref,
      where("deliveredAt", ">=", start),
      where("deliveredAt", "<", end),
    ),
    (snapshot) => {
      deliveredVehicles = new Map(snapshot.docs.map((item) => [
        item.id,
        { id: item.id, ...item.data() } as VehicleFlow,
      ]));
      emit();
    },
    onError,
  );

  return () => {
    unsubscribeSelectedDate();
    unsubscribeCarryovers();
    unsubscribeImmobilized();
    unsubscribeDelivered();
  };
}

export function subscribePartOrders(
  onChange: (orders: PartOrder[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.partOrders);

  return onSnapshot(ref, (snapshot) => {
    const orders = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as PartOrder[];

  onChange(orders.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))));
  }, onError);
}

type PartOrderTrackingState = "active" | "completed" | "cancelled";

const partOrderTrackingMarkerId = "__tracking_state_v1__";

function partOrderTrackingState(order: PartOrder): PartOrderTrackingState {
  if (order.orderStatus === "cancelado") return "cancelled";
  if (order.schedulingCompletedAt || order.executionCompletedAt) return "completed";

  const parts = order.parts?.length
    ? order.parts
    : [{ partReference: order.partReference, partDescription: order.partDescription }];
  const hasPart = parts.some((part) => Boolean(part.partReference?.trim() || part.partDescription?.trim()));
  const normalizedPlate = String(order.plate ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const normalizedClient = String(order.clientName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const workshopStatus = ["solicitado_oficina", "necessidade_identificada", "aguardando_pecas"].includes(order.orderStatus);

  if (workshopStatus && (!hasPart || normalizedPlate === "LIN226" || normalizedClient === "COMISSAOCLIENTES")) {
    return "completed";
  }

  return "active";
}

export async function ensurePartOrderTracking(canMigrate: boolean) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.partOrders);
  const markerRef = doc(ref, partOrderTrackingMarkerId);
  const marker = await getDoc(markerRef);

  if (marker.exists()) return true;
  if (!canMigrate) return false;

  const snapshot = await getDocs(ref);
  const documents = snapshot.docs.filter((item) => item.id !== partOrderTrackingMarkerId);

  for (let index = 0; index < documents.length; index += 400) {
    const batch = writeBatch(db);
    documents.slice(index, index + 400).forEach((item) => {
      const order = { id: item.id, ...item.data() } as PartOrder;
      batch.set(item.ref, { trackingState: partOrderTrackingState(order) }, { merge: true });
    });
    await batch.commit();
  }

  await setDoc(markerRef, {
    documentType: "tracking-migration",
    version: 1,
    migratedOrders: documents.length,
    completedAt: serverTimestamp(),
  });
  return true;
}

export function subscribeActivePartOrders(
  onChange: (orders: PartOrder[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  return onSnapshot(query(
    collection(db, collections.partOrders),
    where("trackingState", "==", "active"),
  ), (snapshot) => {
    const orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as PartOrder[];
    onChange(orders.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))));
  }, onError);
}

export async function listArchivedPartOrders() {
  const db = getFirebaseDb();
  const snapshot = await getDocs(query(
    collection(db, collections.partOrders),
    where("trackingState", "in", ["completed", "cancelled"]),
  ));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }) as PartOrder)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

export function subscribePartOrdersByStatuses(
  statuses: PartOrderStatus[],
  onChange: (orders: PartOrder[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const uniqueStatuses = Array.from(new Set(statuses));

  if (!uniqueStatuses.length) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(query(
    collection(db, collections.partOrders),
    where("orderStatus", "in", uniqueStatuses),
  ), (snapshot) => {
    const orders = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as PartOrder[];
    onChange(orders.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))));
  }, onError);
}

export function subscribePartOrdersForVehicles(
  vehicleFlowIds: string[],
  onChange: (orders: PartOrder[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const uniqueIds = Array.from(new Set(vehicleFlowIds.filter(Boolean)));

  if (!uniqueIds.length) {
    onChange([]);
    return () => undefined;
  }

  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 30) {
    chunks.push(uniqueIds.slice(index, index + 30));
  }

  const ordersByChunk = new Map<number, PartOrder[]>();
  const emit = () => {
    const orders = Array.from(ordersByChunk.values()).flat();
    onChange(orders.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))));
  };

  const unsubscribes = chunks.map((ids, chunkIndex) => onSnapshot(query(
    collection(db, collections.partOrders),
    where("vehicleFlowId", "in", ids),
  ), (snapshot) => {
    ordersByChunk.set(chunkIndex, snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as PartOrder[]);
    emit();
  }, onError));

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

export function subscribeBodyShopProcesses(
  onChange: (processes: BodyShopProcess[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.bodyShopProcesses);

  return onSnapshot(ref, (snapshot) => {
    const processes = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as BodyShopProcess[];

    onChange(processes.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))));
  }, onError);
}

export async function saveBodyShopProcess({
  id,
  actionBy,
  process,
}: {
  id?: string;
  actionBy?: string;
  process: {
    serviceOrder?: string;
    entryDate?: string;
    documents?: string;
    claimNumber?: string;
    customerCode?: string;
    clientName: string;
    insurer?: string;
    plate?: string;
    model?: string;
    year?: string;
    color?: string;
    vehicleImmobilized?: boolean;
    vehicleLocation?: BodyShopVehicleLocation;
    totalValue?: number;
    status: BodyShopStatus;
    billingDate?: string;
    invoiceSentDate?: string;
    paymentDate?: string;
    receiptMonth?: string;
    paidValue?: number;
    deductibleValue?: number;
    partsRequested?: boolean;
    partsNote?: string;
    workshopVehicleFlowId?: string;
    sentToWorkshopAt?: unknown;
    note?: string;
  };
}) {
  const db = getFirebaseDb();
  const ref = id
    ? doc(collection(db, collections.bodyShopProcesses), id)
    : doc(collection(db, collections.bodyShopProcesses));

  await setDoc(ref, {
    ...process,
    plate: process.plate?.toUpperCase(),
    updatedBy: actionBy,
    updatedAt: serverTimestamp(),
    ...(!id ? { createdBy: actionBy, createdAt: serverTimestamp() } : {}),
  }, { merge: true });

  return ref.id;
}

export async function listRecentFlowEvents(maxEvents = 150) {
  const db = getFirebaseDb();
  const snapshot = await getDocs(query(
    collection(db, collections.flowEvents),
    orderBy("createdAt", "desc"),
    limit(maxEvents),
  ));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as FlowEvent[];
}

export function subscribeRecentFlowEvents(
  onChange: (events: FlowEvent[]) => void,
  onError?: (error: Error) => void,
  maxEvents = 1000,
) {
  const db = getFirebaseDb();

  return onSnapshot(query(
    collection(db, collections.flowEvents),
    orderBy("createdAt", "desc"),
    limit(maxEvents),
  ), (snapshot) => {
    const events = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as FlowEvent[];

    onChange(events.sort((a, b) => eventTimeValue(b.createdAt) - eventTimeValue(a.createdAt)));
  }, onError);
}

export function subscribeFlowEventsForDate(
  selectedDate: string,
  onChange: (events: FlowEvent[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const start = Timestamp.fromDate(new Date(`${selectedDate}T00:00:00`));
  const endDate = new Date(`${selectedDate}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const end = Timestamp.fromDate(endDate);

  return onSnapshot(query(
    collection(db, collections.flowEvents),
    where("createdAt", ">=", start),
    where("createdAt", "<", end),
    orderBy("createdAt", "desc"),
  ), (snapshot) => {
    const events = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as FlowEvent[];

    onChange(events);
  }, onError);
}

function eventTimeValue(value: unknown) {
  if (!value) return 0;
  const timestamp = value as { toMillis?: () => number; toDate?: () => Date };
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  if (typeof timestamp.toDate === "function") return timestamp.toDate().getTime();

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function subscribeVehicleFlowEvents(
  vehicleFlowId: string,
  onChange: (events: FlowEvent[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const ref = collection(db, collections.flowEvents);

  return onSnapshot(query(ref, where("vehicleFlowId", "==", vehicleFlowId)), (snapshot) => {
    const events = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as FlowEvent[];

    onChange(events.sort((a, b) => eventTimeValue(b.createdAt) - eventTimeValue(a.createdAt)));
  }, onError);
}

export function subscribeFlowEventsForVehicles(
  vehicleFlowIds: string[],
  onChange: (events: FlowEvent[]) => void,
  onError?: (error: Error) => void,
) {
  const db = getFirebaseDb();
  const uniqueIds = Array.from(new Set(vehicleFlowIds.filter(Boolean)));

  if (!uniqueIds.length) {
    onChange([]);
    return () => undefined;
  }

  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 30) {
    chunks.push(uniqueIds.slice(index, index + 30));
  }

  const eventsByChunk = new Map<number, FlowEvent[]>();
  const emit = () => {
    const events = Array.from(eventsByChunk.values()).flat();
    onChange(events.sort((a, b) => eventTimeValue(b.createdAt) - eventTimeValue(a.createdAt)));
  };

  const unsubscribes = chunks.map((ids, chunkIndex) => onSnapshot(query(
    collection(db, collections.flowEvents),
    where("vehicleFlowId", "in", ids),
  ), (snapshot) => {
    eventsByChunk.set(chunkIndex, snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as FlowEvent[]);
    emit();
  }, onError));

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

export async function savePartOrder({
  vehicle,
  customerId,
  orderKind,
  parts,
  partReference,
  partDescription,
  actionBy,
}: SavePartOrderInput) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const orderRef = doc(collection(db, collections.partOrders), vehicle.id);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicle.id);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const existingOrder = await getDoc(orderRef);
  const existingOrderStatus = existingOrder.data()?.orderStatus as PartOrderStatus | undefined;
  const normalizedParts = parts
    .map((part, index) => ({
      id: part.id || `peca-${index + 1}`,
      partReference: part.partReference?.trim().toUpperCase(),
      partDescription: part.partDescription?.trim(),
    }))
    .filter((part) => part.partReference || part.partDescription);
  const firstPart = normalizedParts[0];
  const normalizedReference = partReference?.trim().toUpperCase() || firstPart?.partReference;
  const normalizedDescription = partDescription?.trim() || firstPart?.partDescription;
  const cleanCustomerId = customerId?.trim();
  const lookupId = publicPartLookupId(vehicle.plate, cleanCustomerId);

  batch.set(orderRef, withoutUndefined({
    vehicleFlowId: vehicle.id,
    plate: vehicle.plate,
    chassi: vehicle.chassi,
    phone: vehicle.phone,
    customerId: cleanCustomerId,
    orderKind,
    clientName: vehicle.clientName,
    consultantName: vehicle.consultantName,
    technicianName: vehicle.technicianName,
    parts: normalizedParts,
    partReference: normalizedReference,
    partDescription: normalizedDescription,
    orderStatus: "solicitado_oficina",
    trackingState: normalizedParts.length && normalizeVehicleIdentifier(vehicle.plate) !== "LIN226" ? "active" : "completed",
    ...(!existingOrder.exists() || existingOrderStatus !== "solicitado_oficina" ? { orderStatusUpdatedAt: serverTimestamp() } : {}),
    requestedBy: actionBy,
    updatedBy: actionBy,
    ...(!existingOrder.exists() ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }), { merge: true });

  if (lookupId) {
    batch.set(doc(collection(db, collections.publicPartLookups), lookupId), {
      plate: normalizeVehicleIdentifier(vehicle.plate),
      customerId: normalizeVehicleIdentifier(cleanCustomerId),
      updatedAt: serverTimestamp(),
      orders: {
        [orderRef.id]: publicPartOrderPayload({
          orderId: orderRef.id,
          vehicleFlowId: vehicle.id,
          plate: vehicle.plate,
          customerId: cleanCustomerId,
          parts: normalizedParts,
          partReference: normalizedReference,
          partDescription: normalizedDescription,
          orderStatus: "solicitado_oficina",
          updatedBy: actionBy,
        }),
      },
    }, { merge: true });
  }

  batch.set(flowRef, {
    partsOrdered: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId: vehicle.id,
    fromLane: vehicle.currentLane,
    toLane: vehicle.currentLane,
    actionBy,
    actionNote: `Pedido de peças: ${normalizedReference || "sem referência"} - ${normalizedDescription || "sem descrição"}`,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updatePartOrder({
  orderId,
  vehicleFlowId,
  plate,
  chassi,
  phone,
  customerId,
  clientName,
  consultantName,
  technicianName,
  orderKind,
  parts,
  partReference,
  partDescription,
  orderStatus,
  orderSource,
  orderNumber,
  orderVor,
  orderDate,
  invoiceNumber,
  expectedArrivalDate,
  cancellationReason,
  updatedBy,
}: UpdatePartOrderInput) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, collections.partOrders), orderId);
  const existingOrder = await getDoc(ref);
  const existingOrderStatus = existingOrder.data()?.orderStatus as PartOrderStatus | undefined;
  const existingTrackingState = existingOrder.data()?.trackingState as PartOrderTrackingState | undefined;
  const normalizedParts = parts
    .map((part, index) => ({
      id: part.id || `peca-${index + 1}`,
      partReference: part.partReference?.trim().toUpperCase(),
      partDescription: part.partDescription?.trim(),
    }))
    .filter((part) => part.partReference || part.partDescription);
  const firstPart = normalizedParts[0];
  const cleanCustomerId = customerId?.trim();
  const normalizedReference = partReference?.trim().toUpperCase() || firstPart?.partReference;
  const normalizedDescription = partDescription?.trim() || firstPart?.partDescription;
  const lookupId = publicPartLookupId(plate, cleanCustomerId);

  await setDoc(ref, withoutUndefined({
    vehicleFlowId,
    plate,
    chassi,
    phone,
    customerId: cleanCustomerId,
    clientName,
    consultantName,
    technicianName,
    orderKind,
    parts: normalizedParts,
    partReference: normalizedReference,
    partDescription: normalizedDescription,
    orderStatus,
    trackingState: orderStatus === "cancelado" ? "cancelled" : existingTrackingState === "completed" ? "completed" : "active",
    ...(!existingOrder.exists() || existingOrderStatus !== orderStatus ? { orderStatusUpdatedAt: serverTimestamp() } : {}),
    orderSource,
    orderNumber: orderNumber?.trim(),
    orderVor: orderVor ?? false,
    orderDate: orderDate || undefined,
    invoiceNumber: invoiceNumber?.trim(),
    expectedArrivalDate: expectedArrivalDate || undefined,
    cancellationReason: cancellationReason?.trim(),
    updatedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });

  if (lookupId) {
    await setDoc(doc(collection(db, collections.publicPartLookups), lookupId), {
      plate: normalizeVehicleIdentifier(plate),
      customerId: normalizeVehicleIdentifier(cleanCustomerId),
      updatedAt: serverTimestamp(),
      orders: {
        [orderId]: publicPartOrderPayload({
          orderId,
          vehicleFlowId,
          plate,
          customerId: cleanCustomerId,
          parts: normalizedParts,
          partReference: normalizedReference,
          partDescription: normalizedDescription,
          orderStatus,
          expectedArrivalDate: expectedArrivalDate || undefined,
          invoiceNumber: invoiceNumber?.trim(),
          orderNumber: orderNumber?.trim(),
          updatedBy,
        }),
      },
    }, { merge: true });
  }
}

export async function createStandalonePartOrder({
  plate,
  customerId,
  clientName,
  orderKind,
  parts,
  orderStatus,
  orderSource,
  orderNumber,
  orderVor,
  orderDate,
  invoiceNumber,
  expectedArrivalDate,
  cancellationReason,
  updatedBy,
}: CreateStandalonePartOrderInput) {
  const db = getFirebaseDb();
  const orderId = `avulso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ref = doc(collection(db, collections.partOrders), orderId);
  const normalizedParts = parts
    .map((part, index) => ({
      id: part.id || `peca-${index + 1}`,
      partReference: part.partReference?.trim().toUpperCase(),
      partDescription: part.partDescription?.trim(),
    }))
    .filter((part) => part.partReference || part.partDescription);
  const firstPart = normalizedParts[0];

  await setDoc(ref, withoutUndefined({
    vehicleFlowId: "",
    plate: plate?.trim().toUpperCase(),
    customerId: customerId?.trim().toUpperCase(),
    clientName: clientName?.trim(),
    parts: normalizedParts,
    partReference: firstPart?.partReference,
    partDescription: firstPart?.partDescription,
    orderKind,
    orderStatus,
    trackingState: orderStatus === "cancelado" ? "cancelled" : "active",
    orderStatusUpdatedAt: serverTimestamp(),
    orderSource,
    orderNumber: orderNumber?.trim().toUpperCase(),
    orderVor: orderVor ?? false,
    orderDate: orderDate || undefined,
    invoiceNumber: invoiceNumber?.trim().toUpperCase(),
    expectedArrivalDate: expectedArrivalDate || undefined,
    cancellationReason: cancellationReason?.trim(),
    requestedBy: updatedBy,
    updatedBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export async function registerPartSchedulingAction({
  orderId,
  action,
  actionBy,
  returnDate,
  contactAttemptAt,
  nextContactAt,
  note,
}: RegisterPartSchedulingActionInput) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, collections.partOrders), orderId);
  const cleanNote = note?.trim();
  const historyEntry = withoutUndefined({
    action,
    actionAt: new Date().toISOString(),
    actionBy,
    returnDate: returnDate || undefined,
    contactAttemptAt: contactAttemptAt || undefined,
    nextContactAt: nextContactAt || undefined,
    note: cleanNote,
  });

  await setDoc(ref, withoutUndefined({
    schedulingStatus: action,
    scheduledReturnDate: action === "agendamento_confirmado" ? returnDate : deleteField(),
    contactAttemptAt: action === "contato_sem_sucesso" ? contactAttemptAt : deleteField(),
    nextContactAt: nextContactAt || deleteField(),
    schedulingNote: cleanNote,
    schedulingUpdatedBy: actionBy,
    schedulingUpdatedAt: serverTimestamp(),
    schedulingHistory: arrayUnion(historyEntry),
    updatedBy: actionBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export async function markPartSchedulingCompleted({
  orderId,
  completedBy,
  newVehicleFlowId,
  newAppointmentDate,
}: {
  orderId: string;
  completedBy?: string;
  newVehicleFlowId: string;
  newAppointmentDate?: string;
}) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, collections.partOrders), orderId);

  await setDoc(ref, withoutUndefined({
    schedulingCompletedAt: serverTimestamp(),
    trackingState: "completed",
    schedulingCompletionReason: "Processo concluído por nova passagem do veículo",
    schedulingCompletionVehicleFlowId: newVehicleFlowId,
    schedulingCompletionDate: newAppointmentDate,
    schedulingUpdatedBy: completedBy,
    schedulingUpdatedAt: serverTimestamp(),
    updatedBy: completedBy,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export async function createWalkInVehicle({
  client,
  phone,
  plate,
  model,
  chassi,
  service,
  promisedDeliveryAt,
  consultant,
  technician,
  washType,
  appointmentDate,
  appointmentTime,
  createdBy,
  note,
  partsOrdered = false,
}: WalkInVehicleInput) {
  const db = getFirebaseDb();
  const conflict = await findVehicleFlowConflict({ plate, chassi });

  if (conflict) {
    throw new Error("Já existe um chip ativo para esta placa ou chassi no fluxo.");
  }

  const batch = writeBatch(db);
  const id = `passante-${appointmentDate}-${plate || Date.now()}`.replace(/[^a-zA-Z0-9-]/g, "-");
  const appointmentRef = doc(collection(db, collections.appointments), id);
  const flowRef = doc(collection(db, collections.vehiclesFlow), id);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const walkInRef = doc(collection(db, collections.walkInCustomers), id);
  const initialLane: FlowLane = isWashService(service) ? "aguardando_lavagem" : "aguardando_servico";
  const normalizedWashType = washTypeFromService(service, washType);
  const washOnlyService = isWashService(service);
  if (!service.trim()) {
    throw new Error("Informe o tipo de serviço para cadastrar o passante.");
  }
  if (!promisedDeliveryAt || Number.isNaN(new Date(promisedDeliveryAt).getTime())) {
    throw new Error("Informe uma previsão de entrega válida para cadastrar o passante.");
  }
  const promisedDate = Timestamp.fromDate(new Date(promisedDeliveryAt));

  if (washOnlyService && (!washType || washType === "nao")) {
    throw new Error("Informe o tipo da lavagem para cadastrar Embelezamento.");
  }

  batch.set(appointmentRef, {
    appointmentDate,
    appointmentTime: appointmentTime || "",
    clientName: client,
    phone,
    plate,
    chassi,
    model,
    consultantName: consultant,
    serviceType: serviceTypeFromLabel(service),
    serviceLabel: service,
    promisedDeliveryAt: promisedDate,
    importedNotes: note,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(walkInRef, {
    clientName: client,
    phone,
    plate,
    chassi,
    model,
    serviceLabel: service,
    consultantName: consultant,
    technicianName: technician || "",
    washType: normalizedWashType,
    promisedDeliveryAt: promisedDate,
    appointmentDate,
    appointmentTime: appointmentTime || "",
    note,
    partsOrdered,
    createdBy,
    createdAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowRef, {
    appointmentId: id,
    origin: "passante",
    currentLane: initialLane,
    appointmentDate,
    appointmentTime: appointmentTime || "",
    clientName: client,
    phone,
    plate,
    chassi,
    model,
    serviceLabel: service,
    consultantName: consultant,
    technicianName: technician || "",
    priority: "normal",
    importedNotes: note,
    partsOrdered,
    customerWaits: false,
    washType: normalizedWashType,
    promisedDeliveryAt: promisedDate,
    serviceCompleted: washOnlyService,
    washingAdvanced: false,
    washDone: false,
    status: "ativo",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId: id,
    toLane: initialLane,
    actionBy: createdBy,
    actionNote: initialLane === "aguardando_lavagem"
      ? "Passante cadastrado direto em Aguardando Lavagem"
      : "Passante cadastrado no fluxo",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function reuseVehicleAsWalkIn({
  vehicleFlowId,
  client,
  phone,
  plate,
  model,
  chassi,
  service,
  promisedDeliveryAt,
  consultant,
  technician,
  washType,
  appointmentDate,
  appointmentTime,
  createdBy,
  note,
  partsOrdered = false,
}: ReuseVehicleAsWalkInInput) {
  const db = getFirebaseDb();
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const walkInRef = doc(collection(db, collections.walkInCustomers), vehicleFlowId);
  const initialLane: FlowLane = isWashService(service) ? "aguardando_lavagem" : "aguardando_servico";
  const normalizedWashType = washTypeFromService(service, washType);
  const washOnlyService = isWashService(service);

  if (!service.trim()) {
    throw new Error("Informe o tipo de serviço para cadastrar o passante.");
  }
  if (!promisedDeliveryAt || Number.isNaN(new Date(promisedDeliveryAt).getTime())) {
    throw new Error("Informe uma previsão de entrega válida para cadastrar o passante.");
  }
  if (washOnlyService && (!washType || washType === "nao")) {
    throw new Error("Informe o tipo da lavagem para cadastrar Embelezamento.");
  }

  const promisedDate = Timestamp.fromDate(new Date(promisedDeliveryAt));

  await runTransaction(db, async (transaction) => {
    const flowSnapshot = await transaction.get(flowRef);
    if (!flowSnapshot.exists()) {
      throw new Error("O agendamento encontrado não existe mais. Atualize a página e tente novamente.");
    }

    const current = flowSnapshot.data() as VehicleFlow;
    if (current.status !== "ativo" || current.currentLane !== "preparacao_confirmada") {
      throw new Error("Este veículo já avançou no fluxo e não pode ser reaproveitado como passante.");
    }
    if (current.appointmentDate === appointmentDate) {
      throw new Error("Este veículo já está no Agendamento do Dia. Movimente o chip existente para recebê-lo.");
    }

    const appointmentRef = doc(collection(db, collections.appointments), current.appointmentId || vehicleFlowId);
    const previousDate = current.appointmentDate || "data anterior";

    transaction.set(appointmentRef, withoutUndefined({
      appointmentDate,
      appointmentTime: appointmentTime || "",
      clientName: client,
      phone,
      plate,
      chassi,
      model,
      consultantName: consultant,
      serviceType: serviceTypeFromLabel(service),
      serviceLabel: service,
      promisedDeliveryAt: promisedDate,
      importedNotes: note,
      updatedAt: serverTimestamp(),
    }), { merge: true });

    transaction.set(walkInRef, withoutUndefined({
      clientName: client,
      phone,
      plate,
      chassi,
      model,
      serviceLabel: service,
      consultantName: consultant,
      technicianName: technician || "",
      washType: normalizedWashType,
      promisedDeliveryAt: promisedDate,
      appointmentDate,
      appointmentTime: appointmentTime || "",
      note,
      partsOrdered: Boolean(current.partsOrdered || partsOrdered),
      createdBy,
      sourceVehicleFlowId: vehicleFlowId,
      createdAt: serverTimestamp(),
    }), { merge: true });

    transaction.update(flowRef, withoutUndefined({
      origin: "passante",
      currentLane: initialLane,
      appointmentDate,
      appointmentTime: appointmentTime || "",
      clientName: client,
      phone,
      plate,
      chassi,
      model,
      serviceLabel: service,
      consultantName: consultant,
      technicianName: technician || "",
      importedNotes: note,
      partsOrdered: Boolean(current.partsOrdered || partsOrdered),
      customerWaits: false,
      washType: normalizedWashType,
      promisedDeliveryAt: promisedDate,
      attendanceStartedAt: serverTimestamp(),
      attendanceStartedBy: createdBy,
      roadTestRequired: false,
      roadTestDone: false,
      chiefPresenceRequired: false,
      serviceCompleted: washOnlyService,
      washingAdvanced: false,
      washDone: false,
      noShow: false,
      noShowAt: null,
      status: "ativo",
      updatedAt: serverTimestamp(),
    }));

    transaction.set(flowEventRef, withoutUndefined({
      vehicleFlowId,
      fromLane: "preparacao_confirmada",
      toLane: initialLane,
      actionBy: createdBy,
      actionNote: `Agendamento de ${previousDate} reaproveitado como passante em ${appointmentDate}`,
      createdAt: serverTimestamp(),
    }));
  });
}

export async function markVehicleNoShow({
  vehicleFlowId,
  actionBy,
}: {
  vehicleFlowId: string;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  return runTransaction(db, async (transaction) => {
    const flowSnapshot = await transaction.get(flowRef);
    if (!flowSnapshot.exists()) return false;

    const vehicle = flowSnapshot.data() as Partial<VehicleFlow>;
    const attendanceAlreadyStarted = Boolean(
      vehicle.attendanceStartedAt
      || vehicle.promisedDeliveryAt
      || vehicle.receiveNote
      || vehicle.promiseHistory?.length,
    );

    // The lane may change while the automatic check is running. Revalidate it
    // inside the transaction so a received vehicle can never become a no-show.
    if (
      vehicle.currentLane !== "preparacao_confirmada"
      || vehicle.noShow
      || vehicle.status === "cancelado"
      || attendanceAlreadyStarted
    ) {
      return false;
    }

    transaction.set(flowRef, {
      noShow: true,
      noShowAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    transaction.set(flowEventRef, {
      vehicleFlowId,
      fromLane: "preparacao_confirmada",
      toLane: "preparacao_confirmada",
      actionBy,
      actionNote: "NO-SHOW identificado automaticamente",
      createdAt: serverTimestamp(),
    });

    return true;
  });
}

export async function cancelVehicleFlow({
  vehicleFlowId,
  currentLane,
  actionBy,
  actionNote,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  actionBy?: string;
  actionNote?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  batch.set(flowRef, {
    status: "cancelado",
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: actionNote || "Chip excluído do fluxo",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

type MoveVehicleFlowInput = {
  vehicleFlowId: string;
  fromLane?: FlowLane;
  toLane: FlowLane;
  appointmentTime?: string;
  actionBy?: string;
  actionNote?: string;
  customerWaits?: boolean;
  promisedDeliveryAt?: string;
  consultantName?: string;
  technicianName?: string;
  washType?: WashType;
  receiveNote?: string;
  roadTestDone?: boolean;
  serviceCompleted?: boolean;
  washingAdvanced?: boolean;
  washDone?: boolean;
  budgetAuthorized?: boolean;
  clearNoShow?: boolean;
};

function promiseHistoryEntry(promisedDeliveryAt: string, actionBy?: string, note?: string) {
  return {
    promisedDeliveryAt,
    changedAt: new Date().toISOString(),
    changedBy: actionBy,
    note,
  };
}

export async function moveVehicleFlow({
  vehicleFlowId,
  fromLane,
  toLane,
  appointmentTime,
  actionBy,
  actionNote,
  customerWaits,
  promisedDeliveryAt,
  consultantName,
  technicianName,
  washType,
  receiveNote,
  roadTestDone,
  serviceCompleted,
  washingAdvanced,
  washDone,
  budgetAuthorized,
  clearNoShow,
}: MoveVehicleFlowInput) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const partOrderRef = doc(collection(db, collections.partOrders), vehicleFlowId);
  const promisedDate = promisedDeliveryAt ? Timestamp.fromDate(new Date(promisedDeliveryAt)) : undefined;
  const startsAttendance = fromLane === "preparacao_confirmada" && toLane !== "preparacao_confirmada";
  const completesPartExecution = toLane === "preparacao_entrega" || toLane === "entregue";
  const partOrderSnapshot = completesPartExecution ? await getDoc(partOrderRef) : null;
  const partOrderStatus = partOrderSnapshot?.data()?.orderStatus as PartOrderStatus | undefined;

  batch.set(flowRef, {
    currentLane: toLane,
    ...(appointmentTime !== undefined ? { appointmentTime } : {}),
    ...(startsAttendance ? { attendanceStartedAt: serverTimestamp(), attendanceStartedBy: actionBy } : {}),
    ...(typeof customerWaits === "boolean" ? { customerWaits } : {}),
    ...(promisedDate ? { promisedDeliveryAt: promisedDate } : {}),
    ...(promisedDeliveryAt ? { promiseHistory: arrayUnion(promiseHistoryEntry(promisedDeliveryAt, actionBy, actionNote)) } : {}),
    ...(consultantName !== undefined ? { consultantName } : {}),
    ...(technicianName !== undefined ? { technicianName } : {}),
    ...(washType ? { washType } : {}),
    ...(receiveNote !== undefined ? { receiveNote } : {}),
    ...(typeof roadTestDone === "boolean" ? { roadTestDone } : {}),
    ...(typeof serviceCompleted === "boolean" ? { serviceCompleted } : {}),
    ...(typeof washingAdvanced === "boolean" ? { washingAdvanced } : {}),
    ...(typeof washDone === "boolean" ? { washDone } : {}),
    ...(typeof budgetAuthorized === "boolean" ? { budgetAuthorized } : {}),
    ...(clearNoShow ? { noShow: false, noShowAt: null } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane,
    toLane,
    actionBy,
    actionNote,
    createdAt: serverTimestamp(),
  });

  if (completesPartExecution && partOrderStatus === "disponivel_execucao") {
    batch.set(partOrderRef, {
      trackingState: "completed",
      executionCompletedAt: serverTimestamp(),
      executionCompletionReason: "Processo concluído após movimentação do chip para preparação de entrega",
      executionCompletionLane: toLane,
      updatedBy: actionBy,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
}

export async function updatePromisedDelivery({
  vehicleFlowId,
  currentLane,
  promisedDeliveryAt,
  actionBy,
  actionNote,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  promisedDeliveryAt: string;
  actionBy?: string;
  actionNote?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  batch.set(flowRef, {
    promisedDeliveryAt: Timestamp.fromDate(new Date(promisedDeliveryAt)),
    promiseHistory: arrayUnion(promiseHistoryEntry(promisedDeliveryAt, actionBy, actionNote || "Nova previsão de entrega")),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: actionNote || "Nova previsão de entrega",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updateVehicleImmobilization({
  vehicleFlowId,
  currentLane,
  vehicleImmobilized,
  immobilizationReason,
  actionBy,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  vehicleImmobilized: boolean;
  immobilizationReason?: "aguardando_pecas" | "aguardando_decisao";
  actionBy?: string;
}) {
  if (vehicleImmobilized && !immobilizationReason) {
    throw new Error("Informe o motivo da imobilização do veículo.");
  }

  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const partOrderRef = doc(collection(db, collections.partOrders), vehicleFlowId);
  const partOrderSnapshot = await getDoc(partOrderRef);
  const partOrder = partOrderSnapshot.exists()
    ? { id: partOrderSnapshot.id, ...partOrderSnapshot.data() } as PartOrder
    : null;
  const reasonLabel = immobilizationReason === "aguardando_pecas"
    ? "Aguardando Peças"
    : "Aguardando Decisão";

  batch.set(flowRef, {
    vehicleImmobilized,
    immobilizationReason: vehicleImmobilized ? immobilizationReason : null,
    immobilizationUpdatedBy: actionBy,
    immobilizationUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: vehicleImmobilized
      ? `Veículo imobilizado: ${reasonLabel}`
      : "Veículo removido da lista de imobilizados",
    createdAt: serverTimestamp(),
  });

  if (partOrder?.orderStatus === "disponivel") {
    batch.set(partOrderRef, {
      orderStatus: "disponivel_execucao",
      updatedBy: actionBy,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    const lookupId = publicPartLookupId(partOrder.plate, partOrder.customerId);
    if (lookupId) {
      batch.set(doc(collection(db, collections.publicPartLookups), lookupId), {
        plate: normalizeVehicleIdentifier(partOrder.plate),
        customerId: normalizeVehicleIdentifier(partOrder.customerId),
        updatedAt: serverTimestamp(),
        orders: {
          [partOrder.id]: publicPartOrderPayload({
            orderId: partOrder.id,
            vehicleFlowId: partOrder.vehicleFlowId,
            plate: partOrder.plate,
            customerId: partOrder.customerId,
            parts: partOrder.parts ?? [],
            partReference: partOrder.partReference,
            partDescription: partOrder.partDescription,
            orderStatus: "disponivel_execucao",
            expectedArrivalDate: partOrder.expectedArrivalDate,
            invoiceNumber: partOrder.invoiceNumber,
            orderNumber: partOrder.orderNumber,
            updatedBy: actionBy,
          }),
        },
      }, { merge: true });
    }
  }

  await batch.commit();
}

export async function updateVehicleCustomerWaits({
  vehicleFlowId,
  currentLane,
  customerWaits,
  actionBy,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  customerWaits: boolean;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  batch.set(flowRef, {
    customerWaits,
    customerWaitsUpdatedBy: actionBy,
    customerWaitsUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: customerWaits
      ? "Cliente indicado como aguardando na loja"
      : "Cliente indicado como não aguardando na loja",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updateVehiclePlate({
  vehicleFlowId,
  currentLane,
  plate,
  actionBy,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  plate: string;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const normalizedPlate = plate.trim().toUpperCase();

  batch.set(flowRef, {
    plate: normalizedPlate,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: `Placa atualizada para ${normalizedPlate}`,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updateVehicleConsultant({
  vehicleFlowId,
  currentLane,
  consultantName,
  actionBy,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  consultantName: string;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const normalizedConsultant = consultantName.trim();

  batch.set(flowRef, {
    consultantName: normalizedConsultant,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: `Consultor atualizado para ${normalizedConsultant}`,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updateVehicleTechnician({
  vehicleFlowId,
  currentLane,
  technicianName,
  actionBy,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  technicianName: string;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const normalizedTechnician = technicianName.trim();

  batch.set(flowRef, {
    technicianName: normalizedTechnician,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: `Técnico atualizado para ${normalizedTechnician}`,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updateVehicleService({
  vehicleFlowId,
  currentLane,
  serviceLabel,
  actionBy,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  serviceLabel: string;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const normalizedService = serviceLabel.trim();

  batch.set(flowRef, {
    serviceLabel: normalizedService,
    serviceType: serviceTypeFromLabel(normalizedService),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: `Tipo de serviço atualizado para ${normalizedService}`,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updateVehicleWashType({
  vehicleFlowId,
  currentLane,
  washType,
  actionBy,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  washType: WashType;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const washTypeLabels: Record<WashType, string> = {
    simples: "Lavagem Simples",
    motor: "Lavagem de Motor",
    motor_bancos: "Lavagem Motor + Bancos",
    nao: "Não",
  };

  batch.set(flowRef, {
    washType,
    ...(washType === "nao" ? { washingAdvanced: false, washDone: false } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: `Tipo da lavagem atualizado para ${washTypeLabels[washType]}`,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function saveVehicleRoadTestForm({
  vehicleFlowId,
  currentLane,
  roadTestForm,
  actionBy,
}: {
  vehicleFlowId: string;
  currentLane: FlowLane;
  roadTestForm: RoadTestFormData;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  batch.set(flowRef, {
    roadTestForm: {
      ...roadTestForm,
      updatedBy: actionBy ?? "",
      updatedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: currentLane,
    toLane: currentLane,
    actionBy,
    actionNote: "Ficha de teste de rodagem atualizada",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function requestComplementaryBudget({
  vehicleFlowId,
  fromLane,
  requestedBy,
  note,
}: {
  vehicleFlowId: string;
  fromLane: FlowLane;
  requestedBy?: string;
  note?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const budgetRef = doc(collection(db, collections.complementaryBudgets), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  batch.set(flowRef, {
    currentLane: "orcamento_complementar",
    budgetStatus: "aguardando",
    budgetRequestedBy: requestedBy,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(budgetRef, {
    vehicleFlowId,
    requestedBy,
    partsNote: note,
    status: "aguardando",
    createdAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane,
    toLane: "orcamento_complementar",
    actionBy: requestedBy,
    actionNote: note || "Orçamento complementar solicitado",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function completeComplementaryBudget({
  vehicleFlowId,
  quotedBy,
  partAvailability,
  partsNote,
}: {
  vehicleFlowId: string;
  quotedBy?: string;
  partAvailability: PartAvailability;
  partsNote?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const budgetRef = doc(collection(db, collections.complementaryBudgets), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  batch.set(flowRef, {
    budgetStatus: "realizado",
    budgetQuotedBy: quotedBy,
    partAvailability,
    partsNote,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(budgetRef, {
    vehicleFlowId,
    quotedBy,
    partAvailability,
    partsNote,
    status: "realizado",
    completedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: "orcamento_complementar",
    toLane: "orcamento_complementar",
    actionBy: quotedBy,
    actionNote: `Orçamento realizado. Peça disponível: ${partAvailability}`,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function completeVehicleDelivery({
  vehicleFlowId,
  fromLane,
  deliveredBy,
  deliveredOnTime,
  partsOrdered,
  internalNps,
  hasPendingIssue,
  futureNote,
}: {
  vehicleFlowId: string;
  fromLane: FlowLane;
  deliveredBy?: string;
  deliveredOnTime: boolean;
  partsOrdered: boolean;
  internalNps?: number;
  hasPendingIssue?: boolean;
  futureNote?: string;
}) {
  const db = getFirebaseDb();
  const deliveredAt = serverTimestamp();
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const deliveryRef = doc(collection(db, collections.deliveries), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  await runTransaction(db, async (transaction) => {
    const flowSnapshot = await transaction.get(flowRef);
    if (!flowSnapshot.exists()) throw new Error("Chip não encontrado para registrar a entrega.");
    const technicianName = String(flowSnapshot.data().technicianName ?? "").trim();
    if (!technicianName) throw new Error("Adicione um mecânico ao chip antes de registrar a entrega.");

    transaction.set(flowRef, {
      currentLane: "entregue",
      status: "entregue",
      deliveredAt,
      deliveredOnTime,
      partsOrdered,
      internalNps,
      hasPendingIssue,
      futureNote,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    transaction.set(deliveryRef, {
      vehicleFlowId,
      technicianName,
      deliveredAt,
      deliveredOnTime,
      partsOrdered,
      internalNps,
      hasPendingIssue,
      futureNote,
      createdBy: deliveredBy,
      createdAt: serverTimestamp(),
    }, { merge: true });

    transaction.set(flowEventRef, {
      vehicleFlowId,
      fromLane,
      toLane: "entregue",
      actionBy: deliveredBy,
      actionNote: "Veículo entregue ao cliente",
      createdAt: serverTimestamp(),
    });
  });
}

export async function confirmPreparation(preparation: Omit<Preparation, "createdAt" | "updatedAt">) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, collections.preparations), preparation.id);

  await setDoc(ref, {
    ...preparation,
    confirmedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function createVehicleFlowFromAppointment(vehicleFlow: Omit<VehicleFlow, "createdAt" | "updatedAt">) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, collections.vehiclesFlow), vehicleFlow.id);

  await setDoc(ref, {
    ...vehicleFlow,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function registerFlowEvent(event: Omit<FlowEvent, "id" | "createdAt">) {
  const db = getFirebaseDb();
  await addDoc(collection(db, collections.flowEvents), {
    ...event,
    createdAt: serverTimestamp(),
  });
}
