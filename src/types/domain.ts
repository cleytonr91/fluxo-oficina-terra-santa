export type UserRole =
  | "admin"
  | "gerente"
  | "chefe_oficina"
  | "consultor"
  | "tecnico"
  | "lider_lavagem"
  | "estoquista"
  | "qualidade";

export type ServiceType =
  | "revisao_01"
  | "revisao_02"
  | "revisao_03"
  | "revisao_04"
  | "revisao_05"
  | "revisao_06"
  | "revisao_07"
  | "revisao_08"
  | "revisao_09"
  | "revisao_10"
  | "diagnostico"
  | "reparo_geral"
  | "recall"
  | "combinado";

export type PriorityLevel = "normal" | "alta";

export type FlowLane =
  | "preparacao_confirmada"
  | "aguardando_servico"
  | "em_servico"
  | "orcamento_complementar"
  | "aguardando_lavagem"
  | "lavagem"
  | "preparacao_entrega"
  | "entregue";

export type VehicleOrigin = "agendado" | "passante";
export type WashType = "simples" | "motor" | "motor_bancos" | "nao";
export type PartAvailability = "sim" | "nao" | "parcial";
export type BudgetStatus = "aguardando" | "realizado" | "cancelado";

export type PostCaseType =
  | "solicitar_hgsi"
  | "tratar_antes_pesquisa"
  | "nao_solicitar"
  | "fora_base"
  | "pendencia_acordada";

export type TreatmentStatus = "aberto" | "em_tratativa" | "tratado" | "sem_acao";
export type HgsiRequestStatus = "nao_solicitada" | "solicitada" | "respondida" | "bloqueada";

export type FirestoreTimestamp = Date | string;

export interface DeliveryPromiseHistory {
  promisedDeliveryAt: FirestoreTimestamp;
  changedAt: FirestoreTimestamp;
  changedBy?: string;
  note?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  active: boolean;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface ImportBatch {
  id: string;
  sourceFileName: string;
  sourceKind: "agenda" | "hgsi_records" | "hgsi_answers";
  importedBy?: string;
  importedAt: FirestoreTimestamp;
  totalRows: number;
  notes?: string;
}

export interface Appointment {
  id: string;
  importBatchId?: string;
  importedEventId?: string;
  appointmentDate: string;
  appointmentTime?: string;
  clientName: string;
  phone?: string;
  plate: string;
  chassi?: string;
  model?: string;
  consultantId?: string;
  consultantName?: string;
  serviceType: ServiceType;
  importedNotes?: string;
  rawPayload?: Record<string, unknown>;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface Preparation {
  id: string;
  appointmentId: string;
  technicianId?: string;
  priority: PriorityLevel;
  roadTestRequired: boolean;
  chiefPresenceRequired: boolean;
  internalNote?: string;
  confirmedAt?: FirestoreTimestamp;
  confirmedBy?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface VehicleFlow {
  id: string;
  appointmentId?: string;
  origin: VehicleOrigin;
  currentLane: FlowLane;
  appointmentDate?: string;
  appointmentTime?: string;
  clientName?: string;
  phone?: string;
  plate?: string;
  chassi?: string;
  model?: string;
  serviceLabel?: string;
  consultantName?: string;
  technicianName?: string;
  priority?: PriorityLevel;
  importedNotes?: string;
  roadTestRequired?: boolean;
  roadTestDone?: boolean;
  chiefPresenceRequired?: boolean;
  customerWaits: boolean;
  promisedDeliveryAt?: FirestoreTimestamp;
  promiseHistory?: DeliveryPromiseHistory[];
  washType: WashType;
  receiveNote?: string;
  serviceCompleted?: boolean;
  washingAdvanced?: boolean;
  washDone?: boolean;
  budgetStatus?: BudgetStatus;
  budgetRequestedBy?: string;
  budgetQuotedBy?: string;
  partAvailability?: PartAvailability;
  partsNote?: string;
  deliveredAt?: FirestoreTimestamp;
  deliveredOnTime?: boolean;
  partsOrdered?: boolean;
  internalNps?: number;
  futureNote?: string;
  noShow?: boolean;
  noShowAt?: FirestoreTimestamp;
  status: "ativo" | "entregue" | "cancelado";
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface FlowEvent {
  id: string;
  vehicleFlowId: string;
  fromLane?: FlowLane;
  toLane: FlowLane;
  actionBy?: string;
  actionNote?: string;
  createdAt: FirestoreTimestamp;
}

export interface ComplementaryBudget {
  id: string;
  vehicleFlowId: string;
  requestedBy?: string;
  quotedBy?: string;
  partAvailability?: PartAvailability;
  partsNote?: string;
  status: BudgetStatus;
  createdAt: FirestoreTimestamp;
  completedAt?: FirestoreTimestamp;
}

export interface Delivery {
  id: string;
  vehicleFlowId: string;
  deliveredAt: FirestoreTimestamp;
  deliveredOnTime?: boolean;
  partsOrdered: boolean;
  internalNps?: number;
  futureNote?: string;
  createdBy?: string;
  createdAt: FirestoreTimestamp;
}

export interface PostServiceCase {
  id: string;
  vehicleFlowId: string;
  caseType: PostCaseType;
  pendingDescription?: string;
  treatmentBy?: string;
  customerObservation?: string;
  gpvRequired?: boolean;
  treatmentStatus: TreatmentStatus;
  hgsiRequestAllowed: boolean;
  hgsiRequestStatus: HgsiRequestStatus;
  assignedTo?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface HgsiRecord {
  id: string;
  importBatchId?: string;
  chassi: string;
  osNumber: string;
  recordStatus: string;
  isValidRecord: boolean;
  rawPayload?: Record<string, unknown>;
  importedAt: FirestoreTimestamp;
}

export interface HgsiAnswer {
  id: string;
  importBatchId?: string;
  chassi?: string;
  osNumber?: string;
  consultantId?: string;
  answerDate?: string;
  nps?: number;
  installationScore?: number;
  deadlineScore?: number;
  serviceQualityScore?: number;
  priceAlignmentScore?: number;
  washScore?: number;
  correctService?: boolean;
  rawPayload?: Record<string, unknown>;
  importedAt: FirestoreTimestamp;
}
