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
import type { Appointment, FlowEvent, FlowLane, PartAvailability, Preparation, ServiceType, UserProfile, UserRole, VehicleFlow, WashType } from "@/types/domain";

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
  appointmentDate: string;
  appointmentTime?: string;
  createdBy?: string;
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

export async function createWalkInVehicle({
  client,
  phone,
  plate,
  model,
  chassi,
  service,
  consultant,
  technician,
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
    appointmentDate,
    appointmentTime: appointmentTime || "",
    note,
    createdBy,
    createdAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowRef, {
    appointmentId: id,
    origin: "passante",
    currentLane: "aguardando_servico",
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
    washType: "nao",
    status: "ativo",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(flowEventRef, {
    vehicleFlowId: id,
    toLane: "aguardando_servico",
    actionBy: createdBy,
    actionNote: "Passante cadastrado no fluxo",
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
}: MoveVehicleFlowInput) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const flowRef = doc(collection(db, collections.vehiclesFlow), vehicleFlowId);
  const flowEventRef = doc(collection(db, collections.flowEvents));
  const promisedDate = promisedDeliveryAt ? Timestamp.fromDate(new Date(promisedDeliveryAt)) : undefined;

  batch.set(flowRef, {
    currentLane: toLane,
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
  futureNote,
}: {
  vehicleFlowId: string;
  fromLane: FlowLane;
  deliveredBy?: string;
  deliveredOnTime: boolean;
  partsOrdered: boolean;
  internalNps?: number;
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
    futureNote,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(deliveryRef, {
    vehicleFlowId,
    deliveredAt,
    deliveredOnTime,
    partsOrdered,
    internalNps,
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
