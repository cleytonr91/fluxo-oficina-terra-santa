import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { collections } from "@/lib/firebase/collections";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { Appointment, BodyShopProcess, BodyShopStatus, BodyShopVehicleLocation, FlowEvent, FlowLane, HgsiAnswer, HgsiRecord, PartAvailability, PartOrder, PartOrderItem, PartOrderKind, PartOrderSource, PartOrderStatus, PartSchedulingActionType, PostCaseType, PostServiceCase, Preparation, ServiceType, TreatmentStatus, UserProfile, UserRole, VehicleFlow, WashType } from "@/types/domain";

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
  consultant: string;
  technician?: string;
  washType?: WashType;
  appointmentDate: string;
  appointmentTime?: string;
  createdBy?: string;
  note?: string;
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
  clientName?: string;
  plate?: string;
  serviceLabel?: string;
  consultantName?: string;
  rawPayload?: Record<string, unknown>;
};

type SaveHgsiAnswerInput = {
  chassi: string;
  osNumber: string;
  responseStatus?: string;
  clientName?: string;
  plate?: string;
  serviceLabel?: string;
  consultantName?: string;
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
  parts: PartOrderItem[];
  partReference?: string;
  partDescription?: string;
  vehicleImmobilized?: boolean;
  actionBy?: string;
};

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
  return service
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes("lavagem");
}

function washTypeFromService(service: string, fallback?: WashType): WashType {
  const text = service
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

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

export async function listHgsiRecords() {
  const db = getFirebaseDb();
  const snapshot = await getDocs(collection(db, collections.hgsiRecords));

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

export async function listPostServiceCases() {
  const db = getFirebaseDb();
  const snapshot = await getDocs(collection(db, collections.postServiceCases));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as PostServiceCase[];
}

export async function savePostServiceTreatment({
  vehicleFlowId,
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
  const ref = doc(collection(db, collections.postServiceCases), documentKey(vehicleFlowId));

  await setDoc(ref, withoutUndefined({
    vehicleFlowId,
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
    const ref = doc(collection(db, collections.hgsiRecords), documentKey(record.chassi || "sem-chassi", record.osNumber || `linha-${index}`));
    batch.set(ref, withoutUndefined({
      importBatchId,
      chassi: record.chassi,
      osNumber: record.osNumber,
      recordStatus: record.status,
      isValidRecord: record.valid,
      clientName: record.clientName,
      plate: record.plate,
      serviceLabel: record.serviceLabel,
      consultantName: record.consultantName,
      rawPayload: record.rawPayload,
      importedAt: serverTimestamp(),
    }), { merge: true });
  });

  await batch.commit();
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
  const batch = writeBatch(db);
  const importBatchId = `hgsi-answers-${Date.now()}`;
  const importBatchRef = doc(collection(db, collections.importBatches), importBatchId);

  batch.set(importBatchRef, {
    sourceFileName,
    sourceKind: "hgsi_answers",
    importedBy,
    importedAt: serverTimestamp(),
    totalRows: answers.length,
    notes: "Importacao de respostas HGSI",
  });

  answers.forEach((answer, index) => {
    const ref = doc(collection(db, collections.hgsiAnswers), documentKey(answer.chassi || "sem-chassi", answer.osNumber || `linha-${index}`));
    batch.set(ref, withoutUndefined({
      importBatchId,
      chassi: answer.chassi,
      osNumber: answer.osNumber,
      responseStatus: answer.responseStatus,
      clientName: answer.clientName,
      plate: answer.plate,
      serviceLabel: answer.serviceLabel,
      consultantName: answer.consultantName,
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

export async function updateUserProfile({
  userId,
  role,
  active,
}: {
  userId: string;
  role: UserRole;
  active: boolean;
}) {
  const db = getFirebaseDb();
  const userRef = doc(collection(db, collections.users), userId);

  await updateDoc(userRef, {
    role,
    active,
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
  const snapshot = await getDocs(collection(db, collections.vehiclesFlow));
  const vehicles = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as VehicleFlow[];

  return vehicles.find((vehicle) => {
    if (vehicle.id === ignoreId || vehicle.status === "cancelado") return false;
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

export async function savePartOrder({
  vehicle,
  customerId,
  parts,
  partReference,
  partDescription,
  vehicleImmobilized,
  actionBy,
}: SavePartOrderInput) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const orderRef = doc(collection(db, collections.partOrders), vehicle.id);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicle.id);
  const flowEventRef = doc(collection(db, collections.flowEvents));
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
    customerId: cleanCustomerId,
    clientName: vehicle.clientName,
    consultantName: vehicle.consultantName,
    technicianName: vehicle.technicianName,
    parts: normalizedParts,
    partReference: normalizedReference,
    partDescription: normalizedDescription,
    orderStatus: "solicitado_oficina",
    vehicleImmobilized: vehicleImmobilized ?? false,
    requestedBy: actionBy,
    updatedBy: actionBy,
    createdAt: serverTimestamp(),
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
    customerId: cleanCustomerId,
    clientName,
    consultantName,
    technicianName,
    orderKind,
    parts: normalizedParts,
    partReference: normalizedReference,
    partDescription: normalizedDescription,
    orderStatus,
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
    scheduledReturnDate: action === "agendamento_confirmado" ? returnDate : undefined,
    contactAttemptAt: contactAttemptAt || undefined,
    nextContactAt: nextContactAt || undefined,
    schedulingNote: cleanNote,
    schedulingUpdatedBy: actionBy,
    schedulingUpdatedAt: serverTimestamp(),
    schedulingHistory: arrayUnion(historyEntry),
    updatedBy: actionBy,
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
  consultant,
  technician,
  washType,
  appointmentDate,
  appointmentTime,
  createdBy,
  note,
}: WalkInVehicleInput) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const id = `passante-${appointmentDate}-${plate || Date.now()}`.replace(/[^a-zA-Z0-9-]/g, "-");
  const appointmentRef = doc(collection(db, collections.appointments), id);
  const flowRef = doc(collection(db, collections.vehiclesFlow), id);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const walkInRef = doc(collection(db, collections.walkInCustomers), id);
  const initialLane: FlowLane = isWashService(service) ? "aguardando_lavagem" : "aguardando_servico";
  const normalizedWashType = washTypeFromService(service, washType);

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
    appointmentDate,
    appointmentTime: appointmentTime || "",
    note,
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
    customerWaits: false,
    washType: normalizedWashType,
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

export async function markVehicleNoShow({
  vehicleFlowId,
  actionBy,
}: {
  vehicleFlowId: string;
  actionBy?: string;
}) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  batch.set(flowRef, {
    noShow: true,
    noShowAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane: "preparacao_confirmada",
    toLane: "preparacao_confirmada",
    actionBy,
    actionNote: "NO-SHOW identificado automaticamente",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
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
  const promisedDate = promisedDeliveryAt ? Timestamp.fromDate(new Date(promisedDeliveryAt)) : undefined;
  const startsAttendance = fromLane === "preparacao_confirmada" && toLane !== "preparacao_confirmada";

  batch.set(flowRef, {
    currentLane: toLane,
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
  const batch = writeBatch(db);
  const deliveredAt = serverTimestamp();
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const deliveryRef = doc(collection(db, collections.deliveries), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));

  batch.set(flowRef, {
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

  batch.set(deliveryRef, {
    vehicleFlowId,
    deliveredAt,
    deliveredOnTime,
    partsOrdered,
    internalNps,
    hasPendingIssue,
    futureNote,
    createdBy: deliveredBy,
    createdAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId,
    fromLane,
    toLane: "entregue",
    actionBy: deliveredBy,
    actionNote: "Veículo entregue ao cliente",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
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
