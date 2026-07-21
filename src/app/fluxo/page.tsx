"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import type { ManualContent } from "@/components/operation-manual";
import { useAuth } from "@/context/auth-context";
import { cancelVehicleFlow, completeComplementaryBudget, completeVehicleDelivery, createWalkInVehicle, findVehicleFlowConflict, markVehicleNoShow, moveVehicleFlow, requestComplementaryBudget, savePartOrder, subscribeActiveVehicleFlows, subscribePartOrders, subscribeVehicleFlowEvents, updatePromisedDelivery, updateVehicleConsultant, updateVehiclePlate, updateVehicleService, updateVehicleTechnician, updateVehicleWashType } from "@/services/firestore";
import type { FlowEvent, FlowLane, PartAvailability, PartOrder, PartOrderItem, VehicleFlow, WashType } from "@/types/domain";

const laneLabels: Array<{ id: FlowLane; label: string }> = [
  { id: "preparacao_confirmada", label: "Agendamento do Dia" },
  { id: "aguardando_servico", label: "Aguardando Serviço" },
  { id: "em_servico", label: "Em Serviço" },
  { id: "orcamento_complementar", label: "Orçamento Complementar" },
  { id: "aguardando_lavagem", label: "Aguardando Lavagem" },
  { id: "lavagem", label: "Lavagem" },
  { id: "preparacao_entrega", label: "Preparação de Entrega" },
  { id: "entregue", label: "Entregue" },
];

const laneNameById = Object.fromEntries(laneLabels.map((lane) => [lane.id, lane.label])) as Record<FlowLane, string>;

const correctionLaneOptions = laneLabels.filter((lane) => lane.id !== "entregue");

const washOptions: Array<{ value: WashType; label: string }> = [
  { value: "simples", label: "Lavagem Simples" },
  { value: "motor", label: "Lavagem de Motor" },
  { value: "motor_bancos", label: "Lavagem Motor + Bancos" },
  { value: "nao", label: "Não" },
];

const washLabels = Object.fromEntries(washOptions.map((option) => [option.value, option.label])) as Record<WashType, string>;

const fixedConsultants = ["Cleverton", "Rosangela", "Eliane", "Luan"];

const workshopTechnicians = ["Wesley", "Ayslan", "Gilvan", "Elimarcos", "Hernando", "Nathan", "Igo"];

const walkInServices = [
  "Revisão 01",
  "Revisão 02",
  "Revisão 03",
  "Revisão 04",
  "Revisão 05",
  "Revisão 06",
  "Revisão 07",
  "Revisão 08",
  "Revisão 09",
  "Revisão 10",
  "Diagnóstico",
  "Reparo Geral",
  "Recall",
  "Combinado",
  "Lavagem Simples",
  "Lavagem de Motor",
  "Lavagem Motor + Bancos",
];

function duplicateVehicleMessage(conflict: VehicleFlow) {
  return [
    "Já existe um chip para esta placa ou chassi neste dia.",
    "",
    `Cliente: ${conflict.clientName || "-"}`,
    `Placa: ${conflict.plate || "-"}`,
    `Chassi: ${conflict.chassi || "-"}`,
    `Etapa atual: ${laneNameById[conflict.currentLane] || conflict.currentLane || "-"}`,
    `Serviço: ${conflict.serviceLabel || "-"}`,
    "",
    "Cancelar evita duplicidade. Continuar deve ser usado apenas se for realmente outro atendimento.",
    "",
    "Deseja continuar mesmo assim?",
  ].join("\n");
}

function hasActivePartOrder(vehicleId?: string, orders: PartOrder[] = []) {
  if (!vehicleId) return false;
  return orders.some((order) => order.vehicleFlowId === vehicleId && order.orderStatus !== "cancelado");
}

const manual: ManualContent = {
  title: "Manual do Fluxo da Oficina",
  audience: "Uso principal: consultores, técnicos, chefe de oficina, lavagem e peças",
  objective: "Acompanhar cada veículo do recebimento até a entrega, mantendo a equipe alinhada sobre etapa, prioridade, previsão, lavagem, orçamento e pendências.",
  steps: [
    "Selecione a data correta no cabeçalho.",
    "Use os filtros de consultor, técnico ou placa para localizar um chip.",
    "No quadro Agendamento do Dia, mova o veículo quando o cliente chegar.",
    "Informe consultor que recebeu, se cliente aguarda, previsão prometida, lavagem e observação.",
    "Avance o chip conforme a execução: aguardando serviço, em serviço, orçamento, lavagem, preparação de entrega e entregue.",
    "Use o detalhe do chip para corrigir etapa, alterar previsão, placa, técnico, serviço ou registrar pedido de peças.",
    "Na entrega, registre prazo, NPS, pendência e observação futura. Pedido de peças é avisado automaticamente quando já foi lançado no chip.",
  ],
  rules: [
    "A previsão de entrega não pode ser reduzida para ganhar prioridade.",
    "Cliente aguarda deve receber atenção visual no chip.",
    "Se não houver lavagem ou ela já tiver sido antecipada, o fluxo pode seguir direto para preparação de entrega.",
    "Toda correção de etapa deve ter motivo registrado.",
    "Veículos no-show ficam fora da fila principal e aparecem no filtro No-show.",
  ],
  flow: [
    { title: "Agendamento do Dia", text: "Consultor confirma chegada do cliente." },
    { title: "Aguardando Serviço", text: "Oficina visualiza prioridade por previsão, recebimento e cliente aguarda." },
    { title: "Em Serviço", text: "Técnico executa ou solicita orçamento complementar." },
    { title: "Lavagem", text: "Veículo segue para lavagem quando aplicável." },
    { title: "Entrega", text: "Consultor fecha dados de entrega e gera pós-serviço." },
  ],
};

function isWashService(service: string) {
  return service
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes("lavagem");
}

function isWashOnlyVehicle(vehicle: VehicleFlow) {
  return isWashService(vehicle.serviceLabel ?? "");
}

function washTypeFromService(service: string, fallback: WashType): WashType {
  const text = service
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!text.includes("lavagem")) return fallback;
  if (text.includes("motor") && text.includes("banco")) return "motor_bancos";
  if (text.includes("motor")) return "motor";
  return "simples";
}

type ReceiveForm = {
  consultantName: string;
  customerWaits: boolean;
  promisedDeliveryAt: string;
  washType: WashType;
  receiveNote: string;
  roadTestDone: "" | "sim" | "nao";
};

type PromiseForm = {
  promisedDeliveryAt: string;
  note: string;
};

type StageCorrectionForm = {
  toLane: FlowLane;
  note: string;
};

type PlateForm = {
  plate: string;
};

type ConsultantForm = {
  consultantName: string;
};

type TechnicianForm = {
  technicianName: string;
};

type ServiceForm = {
  serviceLabel: string;
};

type WashForm = {
  washType: WashType;
};

type PartOrderForm = {
  customerId: string;
  parts: PartOrderItem[];
  vehicleImmobilized: boolean;
};

type BudgetRequestForm = {
  note: string;
};

type BudgetCompleteForm = {
  quotedBy: string;
  partAvailability: PartAvailability;
  partsNote: string;
};

type BudgetReturnForm = {
  authorized: "" | "sim" | "nao";
  promisedDeliveryAt: string;
  note: string;
};

type DeliveryForm = {
  deliveredOnTime: boolean | null;
  partsOrdered: boolean;
  internalNps: number | null;
  hasPendingIssue: boolean | null;
  futureNote: string;
};

type WalkInForm = {
  client: string;
  phone: string;
  plate: string;
  model: string;
  chassi: string;
  service: string;
  consultant: string;
  technician: string;
  washType: WashType;
  note: string;
};

type StartServiceForm = {
  customerWaits: boolean;
  technicianName: string;
  promisedDeliveryAt: string;
  note: string;
};

type MetricFilter =
  | "todos"
  | "agendados"
  | "passantes"
  | "anteriores"
  | "revisao"
  | "diagnostico"
  | "reparo"
  | "embelezamento"
  | "noShow"
  | "concluidos"
  | "immobilized"
  | "attention";

function EmptyLane({ text = "Sem veículos nesta etapa" }: { text?: string }) {
  return <p className="empty">{text}</p>;
}

function isRevision(vehicle: VehicleFlow) {
  return (vehicle.serviceLabel ?? "").toLowerCase().includes("revis");
}

function isDiagnostic(vehicle: VehicleFlow) {
  return (vehicle.serviceLabel ?? "").toLowerCase().includes("diagn");
}

function isGeneralRepair(vehicle: VehicleFlow) {
  return (vehicle.serviceLabel ?? "").toLowerCase().includes("reparo");
}

function isBeautyService(vehicle: VehicleFlow) {
  return isWashOnlyVehicle(vehicle);
}

function sameDayDefault(date?: string) {
  const baseDate = date || new Date().toISOString().slice(0, 10);
  return `${baseDate}T17:00`;
}

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate() as Date;
  }
  return null;
}

function toDateTimeLocal(value: unknown) {
  const date = toDate(value);
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toDateInputValue(value: unknown) {
  const date = toDate(value);
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatDateTime(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatActionSignature(actionBy: string | undefined, value: unknown, fallback = "Operador") {
  const operator = actionBy || fallback;
  const date = toDate(value);
  if (!date) return operator;
  if (date.getHours() >= 18) return operator;
  return `${operator} · ${formatDateTime(value)}`;
}

function formatDateOnly(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function flowEventTitle(event: FlowEvent) {
  const toLane = laneNameById[event.toLane] ?? event.toLane;

  if (event.fromLane && event.fromLane === event.toLane) {
    return `Atualização em ${toLane}`;
  }

  return toLane;
}

function isAutomaticNoShowEvent(event: FlowEvent) {
  return event.fromLane === event.toLane
    && event.toLane === "preparacao_confirmada"
    && (event.actionNote ?? "").toUpperCase().includes("NO-SHOW");
}

type ChipTimelineItem = {
  id: string;
  title: string;
  actionBy?: string;
  createdAt: unknown;
  note?: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isEarlierThanCurrent(nextValue: string, currentValue: unknown) {
  const currentDate = toDate(currentValue);
  if (!currentDate) return false;
  return new Date(nextValue).getTime() < currentDate.getTime();
}

function partAvailabilityIcon(value?: PartAvailability) {
  if (value === "sim") return "👍";
  if (value === "nao") return "👎";
  if (value === "parcial") return "◐";
  return "";
}

function whatsappUrl(phone?: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}`;
}

function firstName(name?: string) {
  return name?.trim().split(/\s+/)[0] || "-";
}

function isMissingPlate(plate?: string) {
  return !plate?.trim() || plate.toUpperCase().startsWith("SEMPLACA");
}

function normalizeName(name?: string) {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function consultantDisplayName(name?: string) {
  const normalized = normalizeName(name);
  if (normalized.includes("cleverton")) return "Cleverton";
  if (normalized.includes("rosangela")) return "Rosangela";
  if (normalized.includes("eliane")) return "Eliane";
  if (normalized.includes("luan")) return "Luan";
  return firstName(name);
}

function priorityScore(vehicle: VehicleFlow) {
  const promised = toDate(vehicle.promisedDeliveryAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const waitScore = vehicle.customerWaits ? 0 : 1;
  const priority = vehicle.priority === "alta" ? 0 : 1;
  return `${waitScore}-${promised}-${priority}-${vehicle.consultantName ?? ""}`;
}

function sortLaneVehicles(lane: FlowLane, vehicles: VehicleFlow[]) {
  if (lane !== "aguardando_servico" && lane !== "aguardando_lavagem") return vehicles;
  return [...vehicles].sort((a, b) => priorityScore(a).localeCompare(priorityScore(b)));
}

function timeProgress(vehicle: VehicleFlow, now: Date) {
  const promised = toDate(vehicle.promisedDeliveryAt);
  if (!promised || vehicle.currentLane === "entregue") return null;

  const created = toDate(vehicle.createdAt);
  const dayStart = vehicle.appointmentDate ? new Date(`${vehicle.appointmentDate}T07:00:00`) : null;
  const start = created && created < promised ? created : dayStart && dayStart < promised ? dayStart : now;
  const total = Math.max(promised.getTime() - start.getTime(), 1);
  const elapsed = now.getTime() - start.getTime();
  const remainingMs = promised.getTime() - now.getTime();
  const percent = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const remainingMinutes = Math.ceil(Math.abs(remainingMs) / 60000);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  const timeText = hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes}min`;

  if (remainingMs < 0) return { percent: 100, status: "late", label: `Atrasado ${timeText}` };
  if (remainingMs <= 30 * 60000) return { percent, status: "danger", label: `Vence em ${timeText}` };
  if (remainingMs <= 90 * 60000) return { percent, status: "warn", label: `Atenção ${timeText}` };
  return { percent, status: "ok", label: `No prazo ${timeText}` };
}

function isPreviousDayVehicle(vehicle: VehicleFlow, selectedDate?: string) {
  return Boolean(selectedDate && vehicle.appointmentDate && vehicle.appointmentDate < selectedDate);
}

function isPreviousDayCarryover(vehicle: VehicleFlow, selectedDate?: string) {
  return isPreviousDayVehicle(vehicle, selectedDate)
    && (
      vehicle.currentLane === "aguardando_servico"
      || vehicle.currentLane === "em_servico"
      || vehicle.currentLane === "aguardando_lavagem"
      || vehicle.currentLane === "lavagem"
    );
}

function matchesSelectedFlowDate(vehicle: VehicleFlow, selectedDate?: string) {
  if (!selectedDate) return true;
  const deliveredDate = toDateInputValue(vehicle.deliveredAt);

  if (vehicle.currentLane === "entregue") {
    return deliveredDate === selectedDate;
  }

  return vehicle.appointmentDate === selectedDate
    || (isPreviousDayVehicle(vehicle, selectedDate) && vehicle.currentLane !== "preparacao_confirmada");
}

function matchesNoShowDate(vehicle: VehicleFlow, selectedDate?: string) {
  if (!selectedDate) return true;
  return vehicle.appointmentDate === selectedDate;
}

function appointmentDateTime(vehicle: VehicleFlow) {
  if (!vehicle.appointmentDate || !vehicle.appointmentTime) return null;
  const [hour = "0", minute = "0"] = vehicle.appointmentTime.split(":");
  const date = new Date(`${vehicle.appointmentDate}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNoShowDue(vehicle: VehicleFlow, referenceDate: Date) {
  const appointment = appointmentDateTime(vehicle);
  if (!appointment) return false;
  return referenceDate.getTime() - appointment.getTime() > 60 * 60 * 1000;
}

function hasVehicleStartedAttendance(vehicle: VehicleFlow) {
  return Boolean(
    vehicle.attendanceStartedAt
    || vehicle.promisedDeliveryAt
    || vehicle.receiveNote
    || vehicle.promiseHistory?.length,
  );
}

function isActiveNoShow(vehicle: VehicleFlow) {
  return Boolean(
    vehicle.noShow
    && vehicle.currentLane === "preparacao_confirmada"
    && !hasVehicleStartedAttendance(vehicle)
  );
}

function washStatusText(vehicle: VehicleFlow) {
  if (vehicle.washType === "nao") return "Não solicitada";
  if (vehicle.washDone) return "Realizada";
  if (vehicle.washingAdvanced) return "Antecipada pendente";
  return "Pendente";
}

function hasPendingWash(vehicle: VehicleFlow) {
  return vehicle.washType !== "nao" && !vehicle.washDone;
}

function FlowChip({
  vehicle,
  immobilized,
  onAdvance,
  onDetails,
  now,
  selectedDate,
}: {
  vehicle: VehicleFlow;
  immobilized?: boolean;
  onAdvance?: (vehicle: VehicleFlow) => void;
  onDetails: (vehicle: VehicleFlow) => void;
  now: Date;
  selectedDate?: string;
}) {
  const serviceText = vehicle.serviceLabel ?? "Serviço não informado";
  const chipClass = isDiagnostic(vehicle) ? "diagnostico" : isGeneralRepair(vehicle) ? "reparo" : "";
  const progress = timeProgress(vehicle, now);
  const previousDay = isPreviousDayVehicle(vehicle, selectedDate);

  return (
    <article className={`chip flow-chip ${chipClass}`} onDoubleClick={() => onDetails(vehicle)}>
      <div className="chip-top">
        <div>
          {whatsappUrl(vehicle.phone) ? (
            <a className="client client-link" href={whatsappUrl(vehicle.phone)} target="_blank" rel="noreferrer">
              {vehicle.clientName ?? "Cliente sem nome"}
            </a>
          ) : (
            <h3 className="client">{vehicle.clientName ?? "Cliente sem nome"}</h3>
          )}
          <p className="model">{vehicle.model ?? "Modelo não informado"}</p>
        </div>
        <span className={`plate ${vehicle.customerWaits ? "wait-plate" : ""} ${isMissingPlate(vehicle.plate) ? "missing-plate" : ""}`} title={vehicle.customerWaits ? "Cliente aguardando na loja" : "Placa"}>
          {vehicle.customerWaits && <span className="plate-alert" aria-hidden="true">⚠</span>}
          <span>{isMissingPlate(vehicle.plate) ? "Sem placa" : vehicle.plate}</span>
        </span>
      </div>

      <div className="tag-row">
        <span className="tag">{serviceText}</span>
        {previousDay && <span className="tag previous-day">Dia anterior</span>}
        {vehicle.origin === "passante" && <span className="tag warn">Passante</span>}
        {vehicle.priority === "alta" && <span className="tag bad">Alta</span>}
        {vehicle.roadTestRequired && (
          <span className={`tag ${typeof vehicle.roadTestDone === "boolean" ? (vehicle.roadTestDone ? "good" : "bad") : ""}`}>
            Teste{typeof vehicle.roadTestDone === "boolean" ? (vehicle.roadTestDone ? " 👍" : " 👎") : ""}
          </span>
        )}
        {vehicle.washingAdvanced && !vehicle.washDone && <span className="tag warn">Lavagem antecipada</span>}
        {vehicle.washingAdvanced && vehicle.washDone && !vehicle.serviceCompleted && <span className="tag warn">Lavagem feita</span>}
        {vehicle.budgetAuthorized && <span className="tag good">ORÇ Complementar 👍</span>}
        {isActiveNoShow(vehicle) && <span className="tag bad">NO-SHOW</span>}
        {immobilized && <span className="tag bad">Imobilizado</span>}
        {immobilized && (
          <a
            className="tag parts-shortcut"
            href={`/pecas?pedido=${encodeURIComponent(vehicle.id)}`}
            onClick={(event) => event.stopPropagation()}
            title="Ver andamento do pedido de peças"
          >
            Pedido de peças
          </a>
        )}
        {vehicle.budgetStatus === "realizado" && <span className="tag">{partAvailabilityIcon(vehicle.partAvailability)} Peças</span>}
        {vehicle.currentLane === "entregue" && typeof vehicle.internalNps === "number" && <span className="tag">NPS {vehicle.internalNps}</span>}
      </div>

      <div className="chip-compact-details">
        <div><span>Consultor:</span> {consultantDisplayName(vehicle.consultantName)}</div>
        <div><span>Técnico:</span> {firstName(vehicle.technicianName)}</div>
        {vehicle.appointmentTime && <div><span>Agenda:</span> {vehicle.appointmentTime}</div>}
      </div>

      {progress && (
        <div className={`time-bar ${progress.status}`}>
          <div className="time-bar-top">
            <span>Previsão de entrega</span>
            <strong>{progress.label}</strong>
          </div>
          <div className="time-track">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}

      <button
        className={`chip-info-btn ${onAdvance ? "" : "alone"}`}
        type="button"
        aria-label={`Ver detalhes de ${vehicle.clientName ?? "veículo"}`}
        title="Informações do veículo"
        onClick={() => onDetails(vehicle)}
      >
        i
      </button>

      {onAdvance && (
        <button
          className="chip-move-btn"
          type="button"
          aria-label={`Mover ${vehicle.clientName ?? "veículo"}`}
          title="Mover para próxima etapa"
          onClick={() => onAdvance(vehicle)}
        >
          →
        </button>
      )}
    </article>
  );
}

export default function FluxoPage() {
  const { profile, user } = useAuth();
  const canDeleteChip = profile?.role === "admin" || profile?.role === "gerente";
  const canEditConsultant = profile?.role === "admin" || profile?.role === "gerente";
  const canReducePromisedDelivery = profile?.role === "admin" || profile?.role === "gerente" || user?.email === "cleyton91@gmail.com";
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [partOrders, setPartOrders] = useState<PartOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [consultantFilter, setConsultantFilter] = useState("Todos");
  const [technicianFilter, setTechnicianFilter] = useState("Todos");
  const [plateFilter, setPlateFilter] = useState("");
  const [metricFilter, setMetricFilter] = useState<MetricFilter>("todos");
  const [flowDate, setFlowDate] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [receivingVehicle, setReceivingVehicle] = useState<VehicleFlow | null>(null);
  const [detailVehicle, setDetailVehicle] = useState<VehicleFlow | null>(null);
  const [detailEvents, setDetailEvents] = useState<FlowEvent[]>([]);
  const [detailEventsLoading, setDetailEventsLoading] = useState(false);
  const [sendVehicle, setSendVehicle] = useState<VehicleFlow | null>(null);
  const [startServiceVehicle, setStartServiceVehicle] = useState<VehicleFlow | null>(null);
  const [budgetRequestVehicle, setBudgetRequestVehicle] = useState<VehicleFlow | null>(null);
  const [budgetCompleteVehicle, setBudgetCompleteVehicle] = useState<VehicleFlow | null>(null);
  const [budgetReturnVehicle, setBudgetReturnVehicle] = useState<VehicleFlow | null>(null);
  const [deliveryVehicle, setDeliveryVehicle] = useState<VehicleFlow | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>({
    consultantName: "",
    customerWaits: false,
    promisedDeliveryAt: "",
    washType: "simples",
    receiveNote: "",
    roadTestDone: "",
  });
  const [promiseForm, setPromiseForm] = useState<PromiseForm>({
    promisedDeliveryAt: "",
    note: "",
  });
  const [stageCorrectionForm, setStageCorrectionForm] = useState<StageCorrectionForm>({
    toLane: "aguardando_servico",
    note: "",
  });
  const [plateForm, setPlateForm] = useState<PlateForm>({ plate: "" });
  const [consultantForm, setConsultantForm] = useState<ConsultantForm>({ consultantName: "" });
  const [technicianForm, setTechnicianForm] = useState<TechnicianForm>({ technicianName: "" });
  const [serviceForm, setServiceForm] = useState<ServiceForm>({ serviceLabel: "" });
  const [washForm, setWashForm] = useState<WashForm>({ washType: "nao" });
  const [partOrderForm, setPartOrderForm] = useState<PartOrderForm>({
    customerId: "",
    parts: [{ id: "peca-1", partReference: "", partDescription: "" }],
    vehicleImmobilized: false,
  });
  const [budgetRequestForm, setBudgetRequestForm] = useState<BudgetRequestForm>({ note: "" });
  const [budgetCompleteForm, setBudgetCompleteForm] = useState<BudgetCompleteForm>({
    quotedBy: "",
    partAvailability: "sim",
    partsNote: "",
  });
  const [budgetReturnForm, setBudgetReturnForm] = useState<BudgetReturnForm>({
    authorized: "",
    promisedDeliveryAt: "",
    note: "",
  });
  const [deliveryForm, setDeliveryForm] = useState<DeliveryForm>({
    deliveredOnTime: null,
    partsOrdered: false,
    internalNps: null,
    hasPendingIssue: null,
    futureNote: "",
  });
  const [walkInForm, setWalkInForm] = useState<WalkInForm>({
    client: "",
    phone: "",
    plate: "",
    model: "",
    chassi: "",
    service: "Revisão 01",
    consultant: profile?.name ?? "",
    technician: "",
    washType: "simples",
    note: "",
  });
  const [startServiceForm, setStartServiceForm] = useState<StartServiceForm>({
    customerWaits: false,
    technicianName: "",
    promisedDeliveryAt: "",
    note: "",
  });
  const [movingId, setMovingId] = useState("");

  useEffect(() => {
    const savedDate = localStorage.getItem("selectedFlowDate");
    if (savedDate) {
      window.requestAnimationFrame(() => setFlowDate(savedDate));
    }

    const unsubscribe = subscribeActiveVehicleFlows((data) => {
      setVehicles(data.sort((a, b) => `${a.appointmentDate ?? ""}${a.appointmentTime ?? ""}`.localeCompare(`${b.appointmentDate ?? ""}${b.appointmentTime ?? ""}`)));
      setError("");
      setLastSyncAt(new Date());
      setLoading(false);
    }, (currentError) => {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível acompanhar o fluxo em tempo real.");
      setLoading(false);
    }, { includeDelivered: true });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePartOrders(setPartOrders, () => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!detailVehicle?.id) {
      return undefined;
    }

    const unsubscribe = subscribeVehicleFlowEvents(detailVehicle.id, (events) => {
      setDetailEvents(events);
      setDetailEventsLoading(false);
    }, () => {
      setDetailEvents([]);
      setDetailEventsLoading(false);
    });

    return unsubscribe;
  }, [detailVehicle?.id]);

  const partOrdersByVehicle = useMemo(() => {
    const mapped = new Map<string, PartOrder>();
    partOrders.forEach((order) => mapped.set(order.vehicleFlowId, order));
    return mapped;
  }, [partOrders]);

  const immobilizedVehicleIds = useMemo(() => {
    return new Set(partOrders.filter((order) => order.vehicleImmobilized).map((order) => order.vehicleFlowId));
  }, [partOrders]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleFlowDateChange(event: Event) {
      const customEvent = event as CustomEvent<string>;
      setFlowDate(customEvent.detail);
    }

    window.addEventListener("flow-date-change", handleFlowDateChange);
    return () => window.removeEventListener("flow-date-change", handleFlowDateChange);
  }, []);

  useEffect(() => {
    function openWalkIn() {
      setWalkInForm((current) => ({
        ...current,
        consultant: current.consultant || profile?.name || "",
      }));
      setWalkInOpen(true);
    }

    window.addEventListener("open-walk-in", openWalkIn);
    return () => window.removeEventListener("open-walk-in", openWalkIn);
  }, [profile?.name]);

  useEffect(() => {
    const candidates = vehicles.filter((vehicle) => (
      vehicle.currentLane === "preparacao_confirmada"
      && !vehicle.noShow
      && !hasVehicleStartedAttendance(vehicle)
      && isNoShowDue(vehicle, now)
    ));

    if (!candidates.length) return;

    candidates.forEach((vehicle) => {
      markVehicleNoShow({
        vehicleFlowId: vehicle.id,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
      }).catch(() => undefined);
    });

    window.requestAnimationFrame(() => {
      setVehicles((current) => current.map((vehicle) => (
        candidates.some((candidate) => candidate.id === vehicle.id)
          ? { ...vehicle, noShow: true, noShowAt: new Date().toISOString() }
          : vehicle
      )));
    });
  }, [now, profile?.name, user?.email, user?.uid, vehicles]);

  function openReceiveModal(vehicle: VehicleFlow) {
    const loggedConsultant = consultantDisplayName(profile?.name);
    const importedConsultant = consultantDisplayName(vehicle.consultantName);
    const selectedConsultant = fixedConsultants.includes(loggedConsultant)
      ? loggedConsultant
      : fixedConsultants.includes(importedConsultant)
        ? importedConsultant
        : "";
    const washOnly = isWashOnlyVehicle(vehicle);

    setReceivingVehicle(vehicle);
    setReceiveForm({
      consultantName: selectedConsultant,
      customerWaits: vehicle.customerWaits ?? false,
      promisedDeliveryAt: toDateTimeLocal(vehicle.promisedDeliveryAt) || sameDayDefault(vehicle.appointmentDate),
      washType: washOnly ? washTypeFromService(vehicle.serviceLabel ?? "", vehicle.washType ?? "simples") : vehicle.washType ?? "simples",
      receiveNote: vehicle.receiveNote ?? "",
      roadTestDone: typeof vehicle.roadTestDone === "boolean" ? (vehicle.roadTestDone ? "sim" : "nao") : "",
    });
  }

  function openDetailModal(vehicle: VehicleFlow) {
    const existingPartOrder = partOrdersByVehicle.get(vehicle.id);
    setDetailEvents([]);
    setDetailEventsLoading(true);
    setDetailVehicle(vehicle);
    setPlateForm({ plate: vehicle.plate?.startsWith("SEMPLACA") ? "" : vehicle.plate ?? "" });
    setConsultantForm({ consultantName: consultantDisplayName(vehicle.consultantName) });
    setTechnicianForm({ technicianName: vehicle.technicianName ?? "" });
    setServiceForm({ serviceLabel: vehicle.serviceLabel ?? "" });
    setWashForm({ washType: vehicle.washType ?? "nao" });
    setPartOrderForm({
      customerId: existingPartOrder?.customerId ?? "",
      parts: existingPartOrder?.parts?.length
        ? existingPartOrder.parts
        : [{ id: "peca-1", partReference: existingPartOrder?.partReference ?? "", partDescription: existingPartOrder?.partDescription ?? "" }],
      vehicleImmobilized: existingPartOrder?.vehicleImmobilized ?? false,
    });
    setPromiseForm({
      promisedDeliveryAt: toDateTimeLocal(vehicle.promisedDeliveryAt) || sameDayDefault(vehicle.appointmentDate),
      note: "",
    });
    setStageCorrectionForm({
      toLane: vehicle.currentLane === "aguardando_servico" ? "em_servico" : "aguardando_servico",
      note: "",
    });
  }

  function openBudgetCompleteModal(vehicle: VehicleFlow) {
    setBudgetCompleteVehicle(vehicle);
    setBudgetCompleteForm({
      quotedBy: profile?.name ?? "",
      partAvailability: vehicle.partAvailability ?? "sim",
      partsNote: vehicle.partsNote ?? "",
    });
  }

  function openBudgetReturnModal(vehicle: VehicleFlow) {
    setBudgetReturnVehicle(vehicle);
    setBudgetReturnForm({
      authorized: "",
      promisedDeliveryAt: "",
      note: "",
    });
  }

  function openDeliveryModal(vehicle: VehicleFlow) {
    const hasPartsRequest = Boolean(vehicle.partsOrdered) || hasActivePartOrder(vehicle.id, partOrders);
    setDeliveryVehicle(vehicle);
    setDeliveryForm({
      deliveredOnTime: null,
      partsOrdered: hasPartsRequest,
      internalNps: null,
      hasPendingIssue: null,
      futureNote: "",
    });
  }

  function openStartServiceModal(vehicle: VehicleFlow) {
    setStartServiceVehicle(vehicle);
    setStartServiceForm({
      customerWaits: vehicle.customerWaits ?? false,
      technicianName: vehicle.technicianName || "",
      promisedDeliveryAt: toDateTimeLocal(vehicle.promisedDeliveryAt) || sameDayDefault(vehicle.appointmentDate),
      note: "",
    });
  }

  async function moveToLane(
    vehicle: VehicleFlow,
    toLane: FlowLane,
    actionNote: string,
    extra: Pick<VehicleFlow, "serviceCompleted" | "washingAdvanced" | "washDone" | "budgetAuthorized"> = {},
  ) {
    setMovingId(vehicle.id);
    setError("");

    try {
      await moveVehicleFlow({
        vehicleFlowId: vehicle.id,
        fromLane: vehicle.currentLane,
        toLane,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote,
        serviceCompleted: extra.serviceCompleted,
        washingAdvanced: extra.washingAdvanced,
        washDone: extra.washDone,
        budgetAuthorized: extra.budgetAuthorized,
      });

      setVehicles((current) => current.map((item) => (
        item.id === vehicle.id ? { ...item, currentLane: toLane, ...extra } : item
      )));
      setSendVehicle(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível mover o veículo.");
    } finally {
      setMovingId("");
    }
  }

  function completeWash(vehicle: VehicleFlow) {
    if (vehicle.serviceCompleted) {
      return moveToLane(vehicle, "preparacao_entrega", "Lavagem concluída", {
        washDone: true,
        washingAdvanced: false,
      });
    }

    if (vehicle.budgetStatus === "realizado") {
      return moveToLane(vehicle, "orcamento_complementar", "Lavagem antecipada concluída; retorno para Orçamento Complementar Realizado", {
        serviceCompleted: false,
        washingAdvanced: true,
        washDone: true,
      });
    }

    return moveToLane(vehicle, "aguardando_servico", "Lavagem antecipada concluída; retorno para Aguardando Serviço", {
      serviceCompleted: false,
      washingAdvanced: true,
      washDone: true,
    });
  }

  async function submitReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receivingVehicle) return;

    if (!receiveForm.consultantName.trim()) {
      setError("Informe o consultor que recebeu o cliente.");
      return;
    }

    if (!canReducePromisedDelivery && isEarlierThanCurrent(receiveForm.promisedDeliveryAt, receivingVehicle.promisedDeliveryAt)) {
      setError("A nova previsão não pode ser menor que a previsão já prometida.");
      return;
    }

    if (receivingVehicle.roadTestRequired && !receiveForm.roadTestDone) {
      setError("Informe se o teste de rodagem foi realizado antes de receber o veículo.");
      return;
    }

    setMovingId(receivingVehicle.id);
    setError("");

    try {
      const nextLane: FlowLane = isWashOnlyVehicle(receivingVehicle) ? "aguardando_lavagem" : "aguardando_servico";
      const receiveNote = receiveForm.receiveNote || (nextLane === "aguardando_lavagem"
        ? "Veículo recebido para serviço de lavagem"
        : "Veículo recebido pelo consultor");

      await moveVehicleFlow({
        vehicleFlowId: receivingVehicle.id,
        fromLane: receivingVehicle.currentLane,
        toLane: nextLane,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote: receiveNote,
        consultantName: receiveForm.consultantName.trim(),
        customerWaits: receiveForm.customerWaits,
        promisedDeliveryAt: receiveForm.promisedDeliveryAt,
        washType: receiveForm.washType,
        receiveNote: receiveForm.receiveNote,
        roadTestDone: receivingVehicle.roadTestRequired ? receiveForm.roadTestDone === "sim" : undefined,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === receivingVehicle.id
          ? {
              ...vehicle,
              currentLane: nextLane,
              consultantName: receiveForm.consultantName.trim(),
              customerWaits: receiveForm.customerWaits,
              promisedDeliveryAt: receiveForm.promisedDeliveryAt,
              washType: receiveForm.washType,
              receiveNote: receiveForm.receiveNote,
              roadTestDone: receivingVehicle.roadTestRequired ? receiveForm.roadTestDone === "sim" : vehicle.roadTestDone,
            }
          : vehicle
      )));
      setReceivingVehicle(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível mover o veículo.");
    } finally {
      setMovingId("");
    }
  }

  async function submitStartService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startServiceVehicle) return;

    if (!startServiceForm.technicianName) {
      setError("Defina o técnico antes de iniciar o serviço.");
      return;
    }

    if (!startServiceForm.promisedDeliveryAt) {
      setError("Informe a previsão de entrega antes de iniciar o serviço.");
      return;
    }

    if (!canReducePromisedDelivery && isEarlierThanCurrent(startServiceForm.promisedDeliveryAt, startServiceVehicle.promisedDeliveryAt)) {
      setError("A nova previsão não pode ser menor que a previsão já prometida.");
      return;
    }

    setMovingId(startServiceVehicle.id);
    setError("");

    try {
      await moveVehicleFlow({
        vehicleFlowId: startServiceVehicle.id,
        fromLane: startServiceVehicle.currentLane,
        toLane: "em_servico",
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote: startServiceForm.note || "Serviço iniciado na oficina",
        customerWaits: startServiceForm.customerWaits,
        technicianName: startServiceForm.technicianName,
        promisedDeliveryAt: startServiceForm.promisedDeliveryAt,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === startServiceVehicle.id
          ? {
              ...vehicle,
              currentLane: "em_servico",
              customerWaits: startServiceForm.customerWaits,
              technicianName: startServiceForm.technicianName,
              promisedDeliveryAt: startServiceForm.promisedDeliveryAt,
              promiseHistory: [
                ...(vehicle.promiseHistory ?? []),
                {
                  promisedDeliveryAt: startServiceForm.promisedDeliveryAt,
                  changedAt: new Date().toISOString(),
                  changedBy: profile?.name ?? user?.email ?? user?.uid,
                  note: startServiceForm.note || "Serviço iniciado na oficina",
                },
              ],
            }
          : vehicle
      )));
      setStartServiceVehicle(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível iniciar o serviço.");
    } finally {
      setMovingId("");
    }
  }

  async function submitBudgetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!budgetRequestVehicle) return;

    setMovingId(budgetRequestVehicle.id);
    setError("");

    try {
      await requestComplementaryBudget({
        vehicleFlowId: budgetRequestVehicle.id,
        fromLane: budgetRequestVehicle.currentLane,
        requestedBy: profile?.name ?? user?.email ?? user?.uid,
        note: budgetRequestForm.note,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === budgetRequestVehicle.id
          ? {
              ...vehicle,
              currentLane: "orcamento_complementar",
              budgetStatus: "aguardando",
              budgetRequestedBy: profile?.name ?? user?.email ?? user?.uid,
              partsNote: budgetRequestForm.note,
            }
          : vehicle
      )));
      setBudgetRequestVehicle(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível solicitar o orçamento.");
    } finally {
      setMovingId("");
    }
  }

  async function submitBudgetComplete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!budgetCompleteVehicle) return;

    setMovingId(budgetCompleteVehicle.id);
    setError("");

    try {
      await completeComplementaryBudget({
        vehicleFlowId: budgetCompleteVehicle.id,
        quotedBy: budgetCompleteForm.quotedBy,
        partAvailability: budgetCompleteForm.partAvailability,
        partsNote: budgetCompleteForm.partsNote,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === budgetCompleteVehicle.id
          ? {
              ...vehicle,
              budgetStatus: "realizado",
              budgetQuotedBy: budgetCompleteForm.quotedBy,
              partAvailability: budgetCompleteForm.partAvailability,
              partsNote: budgetCompleteForm.partsNote,
            }
          : vehicle
      )));
      setBudgetCompleteVehicle(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível concluir o orçamento.");
    } finally {
      setMovingId("");
    }
  }

  async function submitBudgetReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!budgetReturnVehicle) return;

    if (!budgetReturnForm.authorized) {
      setError("Informe se o orçamento foi autorizado.");
      return;
    }

    const budgetAuthorized = budgetReturnForm.authorized === "sim";
    const nextLane: FlowLane = budgetAuthorized
      ? "aguardando_servico"
      : hasPendingWash(budgetReturnVehicle)
        ? "aguardando_lavagem"
        : "preparacao_entrega";

    if (budgetAuthorized && !budgetReturnForm.promisedDeliveryAt) {
      setError("Informe a nova previsão de entrega para retornar o veículo ao serviço.");
      return;
    }

    if (budgetAuthorized && !canReducePromisedDelivery && isEarlierThanCurrent(budgetReturnForm.promisedDeliveryAt, budgetReturnVehicle.promisedDeliveryAt)) {
      setError("A nova previsão não pode ser menor que a previsão já prometida.");
      return;
    }

    setMovingId(budgetReturnVehicle.id);
    setError("");

    const note = budgetReturnForm.note || (budgetAuthorized
      ? "Orçamento complementar autorizado. Retorno para Aguardando Serviço."
      : nextLane === "aguardando_lavagem"
        ? "Orçamento complementar não autorizado. Veículo segue para lavagem."
        : "Orçamento complementar não autorizado. Veículo segue para preparação de entrega.");

    try {
      await moveVehicleFlow({
        vehicleFlowId: budgetReturnVehicle.id,
        fromLane: budgetReturnVehicle.currentLane,
        toLane: nextLane,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote: note,
        promisedDeliveryAt: budgetAuthorized ? budgetReturnForm.promisedDeliveryAt : undefined,
        serviceCompleted: !budgetAuthorized,
        washingAdvanced: false,
        washDone: nextLane === "aguardando_lavagem" ? false : budgetReturnVehicle.washDone,
        budgetAuthorized,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === budgetReturnVehicle.id
          ? {
              ...vehicle,
              currentLane: nextLane,
              serviceCompleted: !budgetAuthorized,
              washingAdvanced: false,
              washDone: nextLane === "aguardando_lavagem" ? false : vehicle.washDone,
              budgetAuthorized,
              ...(budgetAuthorized ? {
                promisedDeliveryAt: budgetReturnForm.promisedDeliveryAt,
                promiseHistory: [
                  ...(vehicle.promiseHistory ?? []),
                  {
                    promisedDeliveryAt: budgetReturnForm.promisedDeliveryAt,
                    changedAt: new Date().toISOString(),
                    changedBy: profile?.name ?? user?.email ?? user?.uid,
                    note,
                  },
                ],
              } : {}),
            }
          : vehicle
      )));
      setBudgetReturnVehicle(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível retornar o veículo ao serviço.");
    } finally {
      setMovingId("");
    }
  }

  async function submitDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deliveryVehicle) return;

    setError("");

    if (deliveryForm.deliveredOnTime === null) {
      setError("Informe se o veículo saiu no prazo.");
      return;
    }

    if (deliveryForm.hasPendingIssue === null) {
      setError("Informe se o veículo saiu com alguma pendência.");
      return;
    }

    if (deliveryForm.hasPendingIssue && !deliveryForm.futureNote.trim()) {
      setError("Descreva a pendência antes de registrar a entrega.");
      return;
    }

    if (deliveryForm.internalNps === null) {
      setError("Informe o NPS interno do cliente.");
      return;
    }

    const deliveredOnTime = deliveryForm.deliveredOnTime;
    const hasPendingIssue = deliveryForm.hasPendingIssue;
    const internalNps = deliveryForm.internalNps;

    setMovingId(deliveryVehicle.id);

    try {
      const partsOrderedByFlow = Boolean(deliveryVehicle.partsOrdered) || hasActivePartOrder(deliveryVehicle.id, partOrders);
      await completeVehicleDelivery({
        vehicleFlowId: deliveryVehicle.id,
        fromLane: deliveryVehicle.currentLane,
        deliveredBy: profile?.name ?? user?.email ?? user?.uid,
        deliveredOnTime,
        partsOrdered: partsOrderedByFlow,
        internalNps,
        hasPendingIssue,
        futureNote: deliveryForm.futureNote,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === deliveryVehicle.id
          ? {
              ...vehicle,
              currentLane: "entregue",
              status: "entregue",
              deliveredAt: new Date().toISOString(),
              deliveredOnTime,
              partsOrdered: partsOrderedByFlow,
              internalNps,
              hasPendingIssue,
              futureNote: deliveryForm.futureNote,
            }
          : vehicle
      )));
      setDeliveryVehicle(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível registrar a entrega.");
    } finally {
      setMovingId("");
    }
  }

  async function submitWalkIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMovingId("walk-in");
    setError("");

    try {
      const selectedDate = flowDate || new Date().toISOString().slice(0, 10);
      const initialLane: FlowLane = isWashService(walkInForm.service) ? "aguardando_lavagem" : "aguardando_servico";
      const normalizedWashType = washTypeFromService(walkInForm.service, walkInForm.washType);
      const conflict = await findVehicleFlowConflict({
        plate: walkInForm.plate,
        chassi: walkInForm.chassi,
        appointmentDate: selectedDate,
      });

      if (conflict && !window.confirm(duplicateVehicleMessage(conflict))) {
        return;
      }

      await createWalkInVehicle({
        ...walkInForm,
        washType: normalizedWashType,
        appointmentDate: selectedDate,
        appointmentTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        createdBy: profile?.name ?? user?.email ?? user?.uid,
      });

      const id = `passante-${selectedDate}-${walkInForm.plate}`.replace(/[^a-zA-Z0-9-]/g, "-");
      setVehicles((current) => [
        ...current,
        {
          id,
          appointmentId: id,
          origin: "passante",
          currentLane: initialLane,
          appointmentDate: selectedDate,
          appointmentTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          clientName: walkInForm.client,
          phone: walkInForm.phone,
          plate: walkInForm.plate,
          chassi: walkInForm.chassi,
          model: walkInForm.model,
          serviceLabel: walkInForm.service,
          consultantName: walkInForm.consultant,
          technicianName: walkInForm.technician,
          priority: "normal",
          importedNotes: walkInForm.note,
          customerWaits: false,
          washType: normalizedWashType,
          status: "ativo",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      setWalkInForm({
        client: "",
        phone: "",
        plate: "",
        model: "",
        chassi: "",
        service: "Revisão 01",
        consultant: profile?.name ?? "",
        technician: "",
        washType: "simples",
        note: "",
      });
      setWalkInOpen(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível cadastrar o passante.");
    } finally {
      setMovingId("");
    }
  }

  async function submitPromiseUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailVehicle) return;

    if (!canReducePromisedDelivery && isEarlierThanCurrent(promiseForm.promisedDeliveryAt, detailVehicle.promisedDeliveryAt)) {
      setError("A nova previsão não pode ser menor que a previsão já prometida.");
      return;
    }

    setMovingId(detailVehicle.id);
    setError("");

    try {
      await updatePromisedDelivery({
        vehicleFlowId: detailVehicle.id,
        currentLane: detailVehicle.currentLane,
        promisedDeliveryAt: promiseForm.promisedDeliveryAt,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote: promiseForm.note,
      });

      const historyItem = {
        promisedDeliveryAt: promiseForm.promisedDeliveryAt,
        changedAt: new Date().toISOString(),
        changedBy: profile?.name ?? user?.email ?? user?.uid,
        note: promiseForm.note,
      };

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === detailVehicle.id
          ? {
              ...vehicle,
              promisedDeliveryAt: promiseForm.promisedDeliveryAt,
              promiseHistory: [...(vehicle.promiseHistory ?? []), historyItem],
            }
          : vehicle
      )));
      setDetailVehicle((current) => current ? {
        ...current,
        promisedDeliveryAt: promiseForm.promisedDeliveryAt,
        promiseHistory: [...(current.promiseHistory ?? []), historyItem],
      } : current);
      setPromiseForm((current) => ({ ...current, note: "" }));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível atualizar a previsão.");
    } finally {
      setMovingId("");
    }
  }

  function correctionOperationalState(toLane: FlowLane) {
    if (toLane === "preparacao_confirmada" || toLane === "aguardando_servico" || toLane === "em_servico") {
      return {
        serviceCompleted: false,
        washingAdvanced: false,
        washDone: false,
      };
    }

    if (toLane === "aguardando_lavagem" || toLane === "lavagem" || toLane === "preparacao_entrega") {
      return {
        serviceCompleted: true,
        washingAdvanced: false,
      };
    }

    return {};
  }

  async function submitStageCorrection() {
    if (!detailVehicle) return;

    const note = stageCorrectionForm.note.trim();
    if (!note) {
      setError("Informe o motivo da correção de etapa.");
      return;
    }

    const shouldClearNoShow = Boolean(detailVehicle.noShow);

    if (stageCorrectionForm.toLane === detailVehicle.currentLane && !shouldClearNoShow) {
      setError("Escolha uma etapa diferente da etapa atual.");
      return;
    }

    const toLabel = laneLabels.find((lane) => lane.id === stageCorrectionForm.toLane)?.label ?? stageCorrectionForm.toLane;
    const actionNote = `Correção de etapa para ${toLabel}: ${note}`;
    const operationalState = correctionOperationalState(stageCorrectionForm.toLane);

    setMovingId(detailVehicle.id);
    setError("");

    try {
      await moveVehicleFlow({
        vehicleFlowId: detailVehicle.id,
        fromLane: detailVehicle.currentLane,
        toLane: stageCorrectionForm.toLane,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote,
        clearNoShow: shouldClearNoShow,
        ...operationalState,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === detailVehicle.id
          ? {
              ...vehicle,
              currentLane: stageCorrectionForm.toLane,
              ...(shouldClearNoShow ? { noShow: false, noShowAt: undefined } : {}),
              ...operationalState,
            }
          : vehicle
      )));
      setDetailVehicle((current) => current ? {
        ...current,
        currentLane: stageCorrectionForm.toLane,
        ...(shouldClearNoShow ? { noShow: false, noShowAt: undefined } : {}),
        ...operationalState,
      } : current);
      setStageCorrectionForm((current) => ({ ...current, note: "" }));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível corrigir a etapa.");
    } finally {
      setMovingId("");
    }
  }

  async function reactivateNoShowVehicle(vehicle: VehicleFlow) {
    setMovingId(vehicle.id);
    setError("");

    try {
      await moveVehicleFlow({
        vehicleFlowId: vehicle.id,
        fromLane: vehicle.currentLane,
        toLane: "preparacao_confirmada",
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote: "No-show reativado para Agendamento do Dia.",
        clearNoShow: true,
        serviceCompleted: false,
        washingAdvanced: false,
        washDone: false,
      });

      setVehicles((current) => current.map((currentVehicle) => (
        currentVehicle.id === vehicle.id
          ? {
              ...currentVehicle,
              currentLane: "preparacao_confirmada",
              noShow: false,
              noShowAt: undefined,
              serviceCompleted: false,
              washingAdvanced: false,
              washDone: false,
            }
          : currentVehicle
      )));
      setMetricFilter("todos");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível reativar o no-show.");
    } finally {
      setMovingId("");
    }
  }

  async function submitChipDeletion() {
    if (!detailVehicle || !canDeleteChip) return;

    const confirmed = window.confirm(`Excluir o chip de ${detailVehicle.clientName ?? "cliente sem nome"} do fluxo? Esta ação remove o chip das telas operacionais e registra a auditoria.`);
    if (!confirmed) return;

    setMovingId(detailVehicle.id);
    setError("");

    try {
      await cancelVehicleFlow({
        vehicleFlowId: detailVehicle.id,
        currentLane: detailVehicle.currentLane,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote: "Chip excluído pelo usuário autorizado",
      });

      setVehicles((current) => current.filter((vehicle) => vehicle.id !== detailVehicle.id));
      setDetailVehicle(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível excluir o chip.");
    } finally {
      setMovingId("");
    }
  }

  async function submitPlateUpdate() {
    if (!detailVehicle) return;

    const plate = plateForm.plate.trim().toUpperCase();
    if (!plate) {
      setError("Informe a placa antes de salvar.");
      return;
    }

    setMovingId(detailVehicle.id);
    setError("");

    try {
      await updateVehiclePlate({
        vehicleFlowId: detailVehicle.id,
        currentLane: detailVehicle.currentLane,
        plate,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === detailVehicle.id ? { ...vehicle, plate } : vehicle
      )));
      setDetailVehicle((current) => current ? { ...current, plate } : current);
      setPlateForm({ plate });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível atualizar a placa.");
    } finally {
      setMovingId("");
    }
  }

  async function submitConsultantUpdate() {
    if (!detailVehicle || !canEditConsultant) return;

    const consultantName = consultantForm.consultantName.trim();
    if (!consultantName) {
      setError("Selecione o consultor antes de salvar.");
      return;
    }

    setMovingId(detailVehicle.id);
    setError("");

    try {
      await updateVehicleConsultant({
        vehicleFlowId: detailVehicle.id,
        currentLane: detailVehicle.currentLane,
        consultantName,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === detailVehicle.id ? { ...vehicle, consultantName } : vehicle
      )));
      setDetailVehicle((current) => current ? { ...current, consultantName } : current);
      setConsultantForm({ consultantName });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível atualizar o consultor.");
    } finally {
      setMovingId("");
    }
  }

  async function submitTechnicianUpdate() {
    if (!detailVehicle) return;

    const technicianName = technicianForm.technicianName.trim();
    if (!technicianName) {
      setError("Selecione o técnico antes de salvar.");
      return;
    }

    setMovingId(detailVehicle.id);
    setError("");

    try {
      await updateVehicleTechnician({
        vehicleFlowId: detailVehicle.id,
        currentLane: detailVehicle.currentLane,
        technicianName,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === detailVehicle.id ? { ...vehicle, technicianName } : vehicle
      )));
      setDetailVehicle((current) => current ? { ...current, technicianName } : current);
      setTechnicianForm({ technicianName });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível atualizar o técnico.");
    } finally {
      setMovingId("");
    }
  }

  async function submitServiceUpdate() {
    if (!detailVehicle) return;

    const serviceLabel = serviceForm.serviceLabel.trim();
    if (!serviceLabel) {
      setError("Selecione o tipo de serviço antes de salvar.");
      return;
    }

    setMovingId(detailVehicle.id);
    setError("");

    try {
      await updateVehicleService({
        vehicleFlowId: detailVehicle.id,
        currentLane: detailVehicle.currentLane,
        serviceLabel,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === detailVehicle.id ? { ...vehicle, serviceLabel } : vehicle
      )));
      setDetailVehicle((current) => current ? { ...current, serviceLabel } : current);
      setServiceForm({ serviceLabel });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível atualizar o tipo de serviço.");
    } finally {
      setMovingId("");
    }
  }

  async function submitWashTypeUpdate() {
    if (!detailVehicle) return;

    const washType = washForm.washType;
    setMovingId(detailVehicle.id);
    setError("");

    try {
      await updateVehicleWashType({
        vehicleFlowId: detailVehicle.id,
        currentLane: detailVehicle.currentLane,
        washType,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
      });

      const washPatch = {
        washType,
        ...(washType === "nao" ? { washingAdvanced: false, washDone: false } : {}),
      };

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === detailVehicle.id ? { ...vehicle, ...washPatch } : vehicle
      )));
      setDetailVehicle((current) => current ? { ...current, ...washPatch } : current);
      setWashForm({ washType });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível atualizar o tipo da lavagem.");
    } finally {
      setMovingId("");
    }
  }

  function updatePartOrderItem(partId: string, patch: Partial<PartOrderItem>) {
    setPartOrderForm((current) => ({
      ...current,
      parts: current.parts.map((part) => (
        part.id === partId ? { ...part, ...patch } : part
      )),
    }));
  }

  function addPartOrderItem() {
    setPartOrderForm((current) => ({
      ...current,
      parts: [
        ...current.parts,
        { id: `peca-${Date.now()}`, partReference: "", partDescription: "" },
      ],
    }));
  }

  function removePartOrderItem(partId: string) {
    setPartOrderForm((current) => ({
      ...current,
      parts: current.parts.length > 1
        ? current.parts.filter((part) => part.id !== partId)
        : current.parts,
    }));
  }

  async function submitPartOrderUpdate() {
    if (!detailVehicle) return;
    const validParts = partOrderForm.parts.filter((part) => part.partReference?.trim() || part.partDescription?.trim());

    if (!validParts.length) {
      setError("Informe ao menos a referência ou a descrição da peça.");
      return;
    }

    setMovingId(detailVehicle.id);
    setError("");

    try {
      await savePartOrder({
        vehicle: detailVehicle,
        customerId: partOrderForm.customerId,
        parts: validParts,
        vehicleImmobilized: partOrderForm.vehicleImmobilized,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
      });

      const nextOrder: PartOrder = {
        id: detailVehicle.id,
        vehicleFlowId: detailVehicle.id,
        plate: detailVehicle.plate,
        customerId: partOrderForm.customerId,
        clientName: detailVehicle.clientName,
        consultantName: detailVehicle.consultantName,
        technicianName: detailVehicle.technicianName,
        parts: validParts.map((part, index) => ({
          id: part.id || `peca-${index + 1}`,
          partReference: part.partReference?.trim().toUpperCase(),
          partDescription: part.partDescription?.trim(),
        })),
        partReference: validParts[0]?.partReference?.trim().toUpperCase(),
        partDescription: validParts[0]?.partDescription?.trim(),
        orderStatus: "solicitado_oficina",
        vehicleImmobilized: partOrderForm.vehicleImmobilized,
        requestedBy: profile?.name ?? user?.email ?? user?.uid,
        updatedBy: profile?.name ?? user?.email ?? user?.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setPartOrders((current) => [...current.filter((order) => order.vehicleFlowId !== detailVehicle.id), nextOrder]);
      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === detailVehicle.id ? { ...vehicle, partsOrdered: true } : vehicle
      )));
      setDetailVehicle((current) => current ? { ...current, partsOrdered: true } : current);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o pedido de peças.");
    } finally {
      setMovingId("");
    }
  }

  const consultants = fixedConsultants;
  const technicians = workshopTechnicians;

  const dateScopedVehicles = useMemo(() => {
    const normalizedPlateFilter = plateFilter.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    return vehicles.filter((vehicle) => {
      if (vehicle.status === "cancelado") return false;
      const dateMatches = matchesSelectedFlowDate(vehicle, flowDate);
      const consultantMatches = consultantFilter === "Todos" || consultantDisplayName(vehicle.consultantName) === consultantFilter;
      const technicianMatches = technicianFilter === "Todos" || firstName(vehicle.technicianName) === technicianFilter;
      const plateMatches = !normalizedPlateFilter || (vehicle.plate ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().includes(normalizedPlateFilter);
      return dateMatches && consultantMatches && technicianMatches && plateMatches;
    });
  }, [consultantFilter, flowDate, plateFilter, technicianFilter, vehicles]);

  const noShowVehicles = useMemo(() => {
    const normalizedPlateFilter = plateFilter.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    return vehicles
      .filter((vehicle) => {
        if (vehicle.status === "cancelado") return false;
        const dateMatches = matchesNoShowDate(vehicle, flowDate);
        const consultantMatches = consultantFilter === "Todos" || consultantDisplayName(vehicle.consultantName) === consultantFilter;
        const technicianMatches = technicianFilter === "Todos" || firstName(vehicle.technicianName) === technicianFilter;
        const plateMatches = !normalizedPlateFilter || (vehicle.plate ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().includes(normalizedPlateFilter);
        return isActiveNoShow(vehicle) && dateMatches && consultantMatches && technicianMatches && plateMatches;
      })
      .sort((a, b) => `${b.appointmentDate ?? ""}${b.appointmentTime ?? ""}`.localeCompare(`${a.appointmentDate ?? ""}${a.appointmentTime ?? ""}`));
  }, [consultantFilter, flowDate, plateFilter, technicianFilter, vehicles]);

  const immobilizedVehicles = useMemo(() => {
    const normalizedPlateFilter = plateFilter.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    return vehicles
      .filter((vehicle) => {
        const consultantMatches = consultantFilter === "Todos" || consultantDisplayName(vehicle.consultantName) === consultantFilter;
        const technicianMatches = technicianFilter === "Todos" || firstName(vehicle.technicianName) === technicianFilter;
        const plateMatches = !normalizedPlateFilter || (vehicle.plate ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().includes(normalizedPlateFilter);
        return (
          immobilizedVehicleIds.has(vehicle.id)
          && !vehicle.noShow
          && vehicle.currentLane !== "entregue"
          && vehicle.status !== "cancelado"
          && consultantMatches
          && technicianMatches
          && plateMatches
        );
      })
      .map((vehicle) => ({ ...vehicle, currentLane: "aguardando_servico" as FlowLane }))
      .sort((a, b) => `${a.appointmentDate ?? ""}${a.appointmentTime ?? ""}`.localeCompare(`${b.appointmentDate ?? ""}${b.appointmentTime ?? ""}`));
  }, [consultantFilter, immobilizedVehicleIds, plateFilter, technicianFilter, vehicles]);

  const visibleDetailEvents = useMemo(() => (
    detailVehicle?.noShow
      ? detailEvents
      : detailEvents.filter((event) => !isAutomaticNoShowEvent(event))
  ), [detailEvents, detailVehicle?.noShow]);

  const chipTimeline = useMemo<ChipTimelineItem[]>(() => {
    const laneEvents = visibleDetailEvents.map((event) => ({
      id: `event-${event.id}`,
      title: flowEventTitle(event),
      actionBy: event.actionBy,
      createdAt: event.createdAt,
      note: event.actionNote,
    }));

    const promiseEvents = (detailVehicle?.promiseHistory ?? []).map((item, index) => ({
      id: `promise-${index}-${String(item.changedAt)}`,
      title: "Previsão de entrega",
      actionBy: item.changedBy,
      createdAt: item.changedAt,
      note: `${formatDateTime(item.promisedDeliveryAt)}${item.note ? ` · ${item.note}` : ""}`,
    }));

    return [...laneEvents, ...promiseEvents].sort((a, b) => {
      const aDate = toDate(a.createdAt)?.getTime() ?? 0;
      const bDate = toDate(b.createdAt)?.getTime() ?? 0;
      return bDate - aDate;
    });
  }, [detailVehicle?.promiseHistory, visibleDetailEvents]);

  const metricDate = flowDate || new Date().toISOString().slice(0, 10);
  const metricBaseVehicles = dateScopedVehicles.filter((vehicle) => !immobilizedVehicleIds.has(vehicle.id));
  const visibleFlowVehicles = dateScopedVehicles.filter((vehicle) => !isActiveNoShow(vehicle) && !immobilizedVehicleIds.has(vehicle.id));
  const operationalFlowVehicles = visibleFlowVehicles.filter((vehicle) => vehicle.currentLane !== "entregue");
  const scheduledDayMetricVehicles = metricBaseVehicles.filter((vehicle) => vehicle.origin !== "passante" && vehicle.appointmentDate === metricDate);
  const walkInDayMetricVehicles = metricBaseVehicles.filter((vehicle) => vehicle.origin === "passante" && vehicle.appointmentDate === metricDate);
  const previousDayMetricVehicles = metricBaseVehicles.filter((vehicle) => isPreviousDayCarryover(vehicle, metricDate));
  const noShowFlowDayVehicles = noShowVehicles.filter((vehicle) => vehicle.appointmentDate === metricDate);
  const scheduledDayFlowVehicles = scheduledDayMetricVehicles.filter((vehicle) => !isActiveNoShow(vehicle));
  const walkInDayFlowVehicles = walkInDayMetricVehicles.filter((vehicle) => !isActiveNoShow(vehicle));
  const previousDayFlowVehicles = previousDayMetricVehicles.filter((vehicle) => !isActiveNoShow(vehicle));
  const flowDayMetricVehicles = [
    ...scheduledDayFlowVehicles,
    ...walkInDayFlowVehicles,
    ...previousDayFlowVehicles,
  ];
  const concludedDayVehicles = visibleFlowVehicles.filter((vehicle) => (
    vehicle.currentLane === "preparacao_entrega"
    || (vehicle.currentLane === "entregue" && toDateInputValue(vehicle.deliveredAt) === metricDate)
  ));
  const flowDayTotal = Math.max(
    0,
    scheduledDayMetricVehicles.length + walkInDayMetricVehicles.length + previousDayMetricVehicles.length - noShowFlowDayVehicles.length,
  );
  const attentionVehicles = operationalFlowVehicles.filter((vehicle) => (
    vehicle.priority === "alta"
    || vehicle.roadTestRequired
    || vehicle.customerWaits
    || vehicle.budgetStatus === "aguardando"
    || timeProgress(vehicle, now)?.status === "late"
  ));

  const filteredVehicles = metricFilter === "noShow"
    ? noShowVehicles
    : metricFilter === "immobilized"
      ? immobilizedVehicles
      : metricFilter === "agendados"
        ? scheduledDayFlowVehicles
        : metricFilter === "passantes"
          ? walkInDayFlowVehicles
          : metricFilter === "anteriores"
            ? previousDayFlowVehicles
            : metricFilter === "revisao"
              ? flowDayMetricVehicles.filter(isRevision)
              : metricFilter === "diagnostico"
                ? flowDayMetricVehicles.filter(isDiagnostic)
                : metricFilter === "reparo"
                  ? flowDayMetricVehicles.filter(isGeneralRepair)
                  : metricFilter === "embelezamento"
                    ? flowDayMetricVehicles.filter(isBeautyService)
                    : metricFilter === "concluidos"
                      ? concludedDayVehicles
                      : metricFilter === "attention"
                        ? attentionVehicles
                        : visibleFlowVehicles;

  const originMetrics = [
    { value: scheduledDayFlowVehicles.length, label: "agendados", filter: "agendados" as MetricFilter },
    { value: walkInDayFlowVehicles.length, label: "passantes", filter: "passantes" as MetricFilter },
    { value: previousDayFlowVehicles.length, label: "dias anteriores", filter: "anteriores" as MetricFilter },
  ] as const;

  const serviceMetrics = [
    { value: flowDayMetricVehicles.filter(isRevision).length, label: "revisões", filter: "revisao" as MetricFilter },
    { value: flowDayMetricVehicles.filter(isDiagnostic).length, label: "diagnósticos", filter: "diagnostico" as MetricFilter },
    { value: flowDayMetricVehicles.filter(isGeneralRepair).length, label: "reparos gerais", filter: "reparo" as MetricFilter },
    { value: flowDayMetricVehicles.filter(isBeautyService).length, label: "embelezamento", filter: "embelezamento" as MetricFilter },
  ] as const;

  const statusMetrics = [
    { value: noShowVehicles.length, label: "no-show", state: "danger", filter: "noShow" as MetricFilter },
    { value: attentionVehicles.length, label: "em atenção", state: "", filter: "attention" as MetricFilter },
    { value: immobilizedVehicles.length, label: "imobilizados", state: "danger", filter: "immobilized" as MetricFilter },
    { value: concludedDayVehicles.length, label: "concluídos do dia", state: "", filter: "concluidos" as MetricFilter },
  ] as const;

  function generateNoShowPdf() {
    if (!noShowVehicles.length) {
      setError("Não há clientes no-show para gerar o PDF.");
      return;
    }

    const reportDate = flowDate ? formatDateOnly(flowDate) : "Todos os dias";
    const generatedAt = new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const rows = noShowVehicles.map((vehicle, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(vehicle.clientName || "Cliente não identificado")}</strong></td>
        <td>${escapeHtml(vehicle.plate || "-")}</td>
        <td>${escapeHtml(formatDateOnly(vehicle.appointmentDate))}</td>
        <td>${escapeHtml(vehicle.appointmentTime || "-")}</td>
        <td>${escapeHtml(consultantDisplayName(vehicle.consultantName))}</td>
        <td>${escapeHtml(firstName(vehicle.technicianName))}</td>
        <td>${escapeHtml(vehicle.serviceLabel || "-")}</td>
        <td>${escapeHtml(vehicle.phone || "-")}</td>
      </tr>
    `).join("");

    const reportWindow = window.open("", "_blank", "width=1100,height=800");
    if (!reportWindow) {
      setError("O navegador bloqueou a janela do relatório. Libere pop-ups para gerar o PDF.");
      return;
    }

    reportWindow.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>No-show ${escapeHtml(reportDate)}</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 28px; color: #1d2925; font-family: Arial, sans-serif; }
            header { display: flex; justify-content: space-between; gap: 18px; border-bottom: 2px solid #1d2925; padding-bottom: 14px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 22px; text-transform: uppercase; }
            .meta { color: #5b6863; font-size: 12px; line-height: 1.5; text-align: right; }
            .summary { display: flex; gap: 10px; margin-bottom: 14px; }
            .summary div { border: 1px solid #d7ded9; border-radius: 6px; padding: 8px 10px; }
            .summary strong { display: block; font-size: 20px; }
            .summary span { color: #5b6863; font-size: 11px; font-weight: 700; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #d7ded9; padding: 7px 8px; text-align: left; vertical-align: top; }
            th { background: #eef3ef; font-size: 10px; text-transform: uppercase; }
            tr:nth-child(even) td { background: #fafcfa; }
            @media print {
              body { margin: 12mm; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>Clientes no-show</h1>
              <p>Veículos com preparação confirmada que não evoluíram para atendimento.</p>
            </div>
            <div class="meta">
              <strong>Fluxo da Oficina</strong><br />
              Data do filtro: ${escapeHtml(reportDate)}<br />
              Gerado em: ${escapeHtml(generatedAt)}
            </div>
          </header>

          <section class="summary">
            <div><strong>${noShowVehicles.length}</strong><span>No-show</span></div>
            <div><strong>${escapeHtml(consultantFilter)}</strong><span>Consultor</span></div>
            <div><strong>${escapeHtml(technicianFilter)}</strong><span>Técnico</span></div>
          </section>

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Cliente</th>
                <th>Placa</th>
                <th>Data</th>
                <th>Hora</th>
                <th>Consultor</th>
                <th>Técnico</th>
                <th>Serviço</th>
                <th>Telefone</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>

          <script>
            window.onload = function () {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    reportWindow.document.close();
  }

  return (
    <ProtectedPage
      title="Fluxo da Oficina"
      subtitle="Agenda, passantes, oficina, lavagem e entrega."
      manual={manual}
    >
      <main className="flow-page">
        <div className={`realtime-status ${error ? "offline" : ""}`}>
          <span>{error ? "Conexão do fluxo instável" : "Atualização em tempo real ativa"}</span>
          <strong>{lastSyncAt ? `Atualizado ${lastSyncAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Conectando..."}</strong>
        </div>

        <section className="flow-metrics flow-day-panel">
          <button
            className={`flow-metric flow-total active ${metricFilter === "todos" ? "selected-total" : ""}`}
            type="button"
            onClick={() => setMetricFilter("todos")}
          >
            <span>Fluxo do dia</span>
            <strong>{flowDayTotal}</strong>
            <small>veículos em atuação hoje</small>
          </button>

          <div className="flow-metric-group">
            <strong>Origem do fluxo</strong>
            {originMetrics.map((item) => (
              <button
                key={item.label}
                className={`metric-line-btn ${metricFilter === item.filter ? "selected" : ""}`}
                type="button"
                onClick={() => setMetricFilter(metricFilter !== item.filter ? item.filter : "todos")}
              >
                <span>{item.label}</span>
                <b>{item.value}</b>
              </button>
            ))}
          </div>

          <div className="flow-metric-group service-group">
            <strong>Tipo do serviço</strong>
            {serviceMetrics.map((item) => (
              <button
                key={item.label}
                className={`metric-line-btn ${metricFilter === item.filter ? "selected" : ""}`}
                type="button"
                onClick={() => setMetricFilter(metricFilter !== item.filter ? item.filter : "todos")}
              >
                <span>{item.label}</span>
                <b>{item.value}</b>
              </button>
            ))}
          </div>

          <div className="flow-status-strip">
            {statusMetrics.map((item) => (
            <button
              key={item.label}
                className={`flow-metric mini ${item.state} ${metricFilter === item.filter ? "selected" : ""}`}
              type="button"
                onClick={() => setMetricFilter(metricFilter !== item.filter ? item.filter : "todos")}
            >
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </button>
          ))}
          </div>

          <div className="flow-filter-stack">
            <strong>Filtros</strong>
            <label className="flow-filter compact">
              <span>Consultor</span>
              <select value={consultantFilter} onChange={(event) => setConsultantFilter(event.target.value)}>
                <option>Todos</option>
                {consultants.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label className="flow-filter compact">
              <span>Técnico</span>
              <select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)}>
                <option>Todos</option>
                {technicians.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label className="flow-filter compact flow-plate-filter">
              <span>Placa</span>
              <input
                value={plateFilter}
                placeholder="Buscar placa"
                onChange={(event) => setPlateFilter(event.target.value.toUpperCase())}
              />
            </label>
          </div>
        </section>

        {error && <div className="duplicate-alert"><strong>Erro no fluxo</strong><span>{error}</span></div>}

        {metricFilter === "noShow" ? (
          <section className="no-show-panel">
            <div className="no-show-head">
              <div>
                <h2>Lista de no-show</h2>
                <span>Veículos que tinham preparação confirmada e não evoluíram para atendimento.</span>
              </div>
              <div className="no-show-actions">
                <button className="ghost-btn" type="button" onClick={generateNoShowPdf}>
                  Gerar PDF
                </button>
                <strong>{noShowVehicles.length}</strong>
              </div>
            </div>

            <div className="no-show-list">
              {noShowVehicles.length ? noShowVehicles.map((vehicle) => (
                <article key={vehicle.id} className="no-show-row">
                  <strong>{vehicle.clientName ?? "Cliente não identificado"}</strong>
                  <span>{vehicle.plate ?? "-"}</span>
                  <span>{formatDateOnly(vehicle.appointmentDate)} {vehicle.appointmentTime ?? ""}</span>
                  <span>{consultantDisplayName(vehicle.consultantName)}</span>
                  <span>{vehicle.serviceLabel ?? "-"}</span>
                  <div className="no-show-row-actions">
                    <button className="ghost-btn" type="button" onClick={() => openDetailModal(vehicle)}>
                      Detalhes
                    </button>
                    <button
                      className="dark-btn"
                      type="button"
                      disabled={movingId === vehicle.id}
                      onClick={() => reactivateNoShowVehicle(vehicle)}
                    >
                      Voltar ao Agendamento do Dia
                    </button>
                  </div>
                </article>
              )) : (
                <EmptyLane text="Nenhum no-show encontrado." />
              )}
            </div>
          </section>
        ) : (
        <section className="flow-board">
          {laneLabels.map((lane) => {
            const laneVehicles = sortLaneVehicles(lane.id, filteredVehicles.filter((vehicle) => vehicle.currentLane === lane.id));
            const pendingBudgetVehicles = laneVehicles.filter((vehicle) => vehicle.budgetStatus !== "realizado");
            const completedBudgetVehicles = laneVehicles.filter((vehicle) => vehicle.budgetStatus === "realizado");

            return (
              <section key={lane.id} className={`flow-lane lane-${lane.id}`}>
                <div className="flow-lane-head">
                  <h2>{lane.label}</h2>
                  <strong>{laneVehicles.length}</strong>
                </div>

                {lane.id === "orcamento_complementar" ? (
                  <div className="budget-split">
                    <div className="budget-box">
                      <h3>Aguardando</h3>
                      {pendingBudgetVehicles.length ? pendingBudgetVehicles.map((vehicle) => (
                        <FlowChip
                          key={vehicle.id}
                          vehicle={vehicle}
                          immobilized={immobilizedVehicleIds.has(vehicle.id)}
                          onAdvance={openBudgetCompleteModal}
                          onDetails={openDetailModal}
                          now={now}
                          selectedDate={flowDate}
                        />
                      )) : <p>Sem orçamentos pendentes</p>}
                    </div>
                    <div className="budget-box">
                      <h3>Orçamento realizado</h3>
                      {completedBudgetVehicles.length ? completedBudgetVehicles.map((vehicle) => (
                        <FlowChip
                          key={vehicle.id}
                          vehicle={vehicle}
                          immobilized={immobilizedVehicleIds.has(vehicle.id)}
                          onAdvance={openBudgetReturnModal}
                          onDetails={openDetailModal}
                          now={now}
                          selectedDate={flowDate}
                        />
                      )) : <p>Nenhum orçamento realizado</p>}
                    </div>
                  </div>
                ) : (
                  <div className="flow-lane-body">
                    {loading && lane.id === "preparacao_confirmada" ? (
                      <EmptyLane text="Carregando veículos..." />
                    ) : laneVehicles.length ? (
                      laneVehicles.map((vehicle) => (
                        <FlowChip
                          key={vehicle.id}
                          vehicle={vehicle}
                          immobilized={immobilizedVehicleIds.has(vehicle.id)}
                          now={now}
                          selectedDate={flowDate}
                          onAdvance={
                            lane.id === "preparacao_confirmada"
                              ? openReceiveModal
                              : lane.id === "aguardando_servico"
                                ? setSendVehicle
                                : lane.id === "em_servico"
                                  ? setSendVehicle
                                  : lane.id === "aguardando_lavagem"
                                    ? (item) => moveToLane(item, "lavagem", "Lavagem iniciada")
                                    : lane.id === "lavagem"
                                      ? completeWash
                                      : lane.id === "preparacao_entrega"
                                        ? openDeliveryModal
                                        : undefined
                          }
                          onDetails={openDetailModal}
                        />
                      ))
                    ) : (
                      <EmptyLane />
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </section>
        )}
      </main>

      {receivingVehicle && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal" onSubmit={submitReceive}>
            <div className="modal-head">
              <div>
                <strong>Receber veículo</strong>
                <span>{receivingVehicle.clientName} · {receivingVehicle.plate}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setReceivingVehicle(null)}>
                ×
              </button>
            </div>

            <label className="field">
              <span>Consultor que recebeu</span>
              <select
                required
                value={receiveForm.consultantName}
                onChange={(event) => setReceiveForm((current) => ({ ...current, consultantName: event.target.value }))}
              >
                <option value="">Selecionar consultor</option>
                {fixedConsultants.map((consultant) => (
                  <option key={consultant} value={consultant}>{consultant}</option>
                ))}
              </select>
            </label>

            <label className="check-line modal-check">
              <input
                type="checkbox"
                checked={receiveForm.customerWaits}
                onChange={(event) => setReceiveForm((current) => ({ ...current, customerWaits: event.target.checked }))}
              />
              O cliente irá aguardar na loja?
            </label>

            {receivingVehicle.roadTestRequired && (
              <label className="field">
                <span>Teste de rodagem foi realizado?</span>
                <select
                  required
                  value={receiveForm.roadTestDone}
                  onChange={(event) => setReceiveForm((current) => ({ ...current, roadTestDone: event.target.value as ReceiveForm["roadTestDone"] }))}
                >
                  <option value="">Responder</option>
                  <option value="sim">Sim, realizado</option>
                  <option value="nao">Não realizado</option>
                </select>
              </label>
            )}

            <label className="field">
              <span>Previsão de entrega prometida</span>
              <input
                required
                type="datetime-local"
                value={receiveForm.promisedDeliveryAt}
                onChange={(event) => setReceiveForm((current) => ({ ...current, promisedDeliveryAt: event.target.value }))}
              />
            </label>

            <label className="field">
              <span>Tipo da lavagem</span>
              <select
                value={receiveForm.washType}
                onChange={(event) => setReceiveForm((current) => ({ ...current, washType: event.target.value as WashType }))}
              >
                {washOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Observação do recebimento</span>
              <textarea
                value={receiveForm.receiveNote}
                onChange={(event) => setReceiveForm((current) => ({ ...current, receiveNote: event.target.value }))}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setReceivingVehicle(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === receivingVehicle.id}>
                {movingId === receivingVehicle.id
                  ? "Movendo..."
                  : isWashOnlyVehicle(receivingVehicle)
                    ? "Mover para Aguardando Lavagem"
                    : "Mover para Aguardando Serviço"}
              </button>
            </div>
          </form>
        </div>
      )}

      {detailVehicle && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal flow-detail-modal" onSubmit={submitPromiseUpdate}>
            <div className="modal-head">
              <div>
                <strong>Detalhes do veículo</strong>
                <span>{detailVehicle.clientName} · {detailVehicle.plate}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setDetailVehicle(null)}>
                ×
              </button>
            </div>

            <div className="detail-grid modal-detail-grid">
              <div className="detail"><span>Placa</span>{detailVehicle.plate?.startsWith("SEMPLACA") ? "-" : detailVehicle.plate ?? "-"}</div>
              <div className="detail"><span>Chassi</span>{detailVehicle.chassi ?? "-"}</div>
              <div className="detail"><span>Telefone</span>{detailVehicle.phone ?? "-"}</div>
              <div className="detail"><span>Modelo</span>{detailVehicle.model ?? "-"}</div>
              <div className="detail"><span>Consultor</span>{detailVehicle.consultantName ?? "-"}</div>
              <div className="detail"><span>Técnico</span>{detailVehicle.technicianName ?? "-"}</div>
              <div className="detail"><span>Etapa</span>{laneLabels.find((lane) => lane.id === detailVehicle.currentLane)?.label ?? detailVehicle.currentLane}</div>
              <div className="detail"><span>Previsão atual</span>{formatDateTime(detailVehicle.promisedDeliveryAt)}</div>
              <div className="detail"><span>Cliente aguarda</span>{detailVehicle.customerWaits ? "Sim" : "Não"}</div>
              <div className="detail"><span>Tipo da lavagem</span>{washLabels[detailVehicle.washType] ?? "-"}</div>
              <div className="detail"><span>Status da lavagem</span>{washStatusText(detailVehicle)}</div>
            </div>

            <section className="history-box">
              <h3>Placa do veículo</h3>
              <div className="correction-grid">
                <label className="field">
                  <span>Placa</span>
                  <input
                    value={plateForm.plate}
                    placeholder="Adicionar placa"
                    onChange={(event) => setPlateForm({ plate: event.target.value.toUpperCase() })}
                  />
                </label>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={movingId === detailVehicle.id || !plateForm.plate.trim()}
                  onClick={submitPlateUpdate}
                >
                  {movingId === detailVehicle.id ? "Salvando..." : "Salvar placa"}
                </button>
              </div>
            </section>

            {canEditConsultant && (
              <section className="history-box">
                <h3>Consultor responsável</h3>
                <div className="correction-grid">
                  <label className="field">
                    <span>Consultor</span>
                    <select
                      value={consultantForm.consultantName}
                      onChange={(event) => setConsultantForm({ consultantName: event.target.value })}
                    >
                      <option value="">Selecionar consultor</option>
                      {fixedConsultants.map((consultant) => (
                        <option key={consultant} value={consultant}>{consultant}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={movingId === detailVehicle.id || !consultantForm.consultantName.trim()}
                    onClick={submitConsultantUpdate}
                  >
                    {movingId === detailVehicle.id ? "Salvando..." : "Salvar consultor"}
                  </button>
                </div>
              </section>
            )}

            <section className="history-box">
              <h3>Técnico designado</h3>
              <div className="correction-grid">
                <label className="field">
                  <span>Técnico</span>
                  <select
                    value={technicianForm.technicianName}
                    onChange={(event) => setTechnicianForm({ technicianName: event.target.value })}
                  >
                    <option value="">Selecionar técnico</option>
                    {workshopTechnicians.map((technician) => (
                      <option key={technician} value={technician}>{technician}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={movingId === detailVehicle.id || !technicianForm.technicianName.trim()}
                  onClick={submitTechnicianUpdate}
                >
                  {movingId === detailVehicle.id ? "Salvando..." : "Salvar técnico"}
                </button>
              </div>
            </section>

            <section className="history-box">
              <h3>Tipo de serviço</h3>
              <div className="correction-grid">
                <label className="field">
                  <span>Serviço</span>
                  <select
                    value={serviceForm.serviceLabel}
                    onChange={(event) => setServiceForm({ serviceLabel: event.target.value })}
                  >
                    <option value="">Selecionar serviço</option>
                    {walkInServices.map((service) => (
                      <option key={service} value={service}>{service}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={movingId === detailVehicle.id || !serviceForm.serviceLabel.trim()}
                  onClick={submitServiceUpdate}
                >
                  {movingId === detailVehicle.id ? "Salvando..." : "Salvar serviço"}
                </button>
              </div>
            </section>

            <section className="history-box">
              <h3>Tipo da lavagem</h3>
              <div className="correction-grid">
                <label className="field">
                  <span>Lavagem</span>
                  <select
                    value={washForm.washType}
                    onChange={(event) => setWashForm({ washType: event.target.value as WashType })}
                  >
                    {washOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={movingId === detailVehicle.id}
                  onClick={submitWashTypeUpdate}
                >
                  {movingId === detailVehicle.id ? "Salvando..." : "Salvar lavagem"}
                </button>
              </div>
            </section>

            <section className="history-box">
              <h3>Pedido de peças</h3>
              <div className="correction-grid">
                <label className="field">
                  <span>ID Cliente</span>
                  <input
                    value={partOrderForm.customerId}
                    placeholder="Preencher se necessário"
                    onChange={(event) => setPartOrderForm((current) => ({ ...current, customerId: event.target.value.toUpperCase() }))}
                  />
                </label>
                <label className="modal-check">
                  <input
                    type="checkbox"
                    checked={partOrderForm.vehicleImmobilized}
                    onChange={(event) => setPartOrderForm((current) => ({ ...current, vehicleImmobilized: event.target.checked }))}
                  />
                  Veículo imobilizado
                </label>
              </div>
              <div className="parts-items">
                {partOrderForm.parts.map((part, index) => (
                  <div key={part.id} className="part-item-row">
                    <label className="field">
                      <span>Referência da peça {index + 1}</span>
                      <input
                        value={part.partReference ?? ""}
                        placeholder="Referência"
                        onChange={(event) => updatePartOrderItem(part.id, { partReference: event.target.value.toUpperCase() })}
                      />
                    </label>
                    <label className="field">
                      <span>Descrição da peça {index + 1}</span>
                      <input
                        value={part.partDescription ?? ""}
                        placeholder="Descrição"
                        onChange={(event) => updatePartOrderItem(part.id, { partDescription: event.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={partOrderForm.parts.length <= 1}
                      onClick={() => removePartOrderItem(part.id)}
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="ghost-btn" onClick={addPartOrderItem}>
                + Adicionar peça
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={movingId === detailVehicle.id}
                onClick={submitPartOrderUpdate}
              >
                {movingId === detailVehicle.id ? "Salvando..." : "Salvar pedido de peças"}
              </button>
            </section>

            {(detailVehicle.importedNotes || detailVehicle.receiveNote || detailVehicle.partsNote) && (
              <section className="history-box">
                <h3>Observações</h3>
                {detailVehicle.importedNotes && <p><strong>Agenda:</strong> {detailVehicle.importedNotes}</p>}
                {detailVehicle.receiveNote && <p><strong>Recebimento:</strong> {detailVehicle.receiveNote}</p>}
                {detailVehicle.partsNote && <p><strong>Peças:</strong> {detailVehicle.partsNote}</p>}
              </section>
            )}

            <section className="history-box">
              <h3>Histórico do chip</h3>
              {detailEventsLoading ? (
                <p>Carregando histórico...</p>
              ) : chipTimeline.length ? (
                <ul className="chip-history-list">
                  {chipTimeline.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{formatActionSignature(item.actionBy, item.createdAt, "Operador não identificado")}</span>
                      {item.note && <p>{item.note}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nenhuma movimentação registrada para este chip.</p>
              )}
            </section>

            <section className="history-box correction-box">
              <h3>Corrigir etapa</h3>
              <div className="correction-grid">
                <label className="field">
                  <span>Enviar para</span>
                  <select
                    value={stageCorrectionForm.toLane}
                    onChange={(event) => setStageCorrectionForm((current) => ({ ...current, toLane: event.target.value as FlowLane }))}
                  >
                    {correctionLaneOptions.map((lane) => (
                      <option key={lane.id} value={lane.id}>{lane.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Motivo da correção</span>
                  <textarea
                    placeholder="Ex.: Movido para executado por engano."
                    value={stageCorrectionForm.note}
                    onChange={(event) => setStageCorrectionForm((current) => ({ ...current, note: event.target.value }))}
                  />
                </label>
              </div>
              <button
                type="button"
                className="ghost-btn"
                disabled={movingId === detailVehicle.id}
                onClick={submitStageCorrection}
              >
                {movingId === detailVehicle.id ? "Corrigindo..." : "Aplicar correção de etapa"}
              </button>
            </section>

            <section className="history-box promise-update-box">
              <h3>Nova previsão de entrega</h3>
              <div className="promise-update-grid">
                <label className="field">
                  <span>Data e hora</span>
                  <input
                    required
                    type="datetime-local"
                    min={canReducePromisedDelivery ? undefined : toDateTimeLocal(detailVehicle.promisedDeliveryAt) || undefined}
                    value={promiseForm.promisedDeliveryAt}
                    onChange={(event) => setPromiseForm((current) => ({ ...current, promisedDeliveryAt: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>Motivo da alteração</span>
                  <input
                    value={promiseForm.note}
                    placeholder="Ex.: cliente autorizou novo horário"
                    onChange={(event) => setPromiseForm((current) => ({ ...current, note: event.target.value }))}
                  />
                </label>
              </div>
              <button type="submit" className="primary-btn" disabled={movingId === detailVehicle.id}>
                {movingId === detailVehicle.id ? "Salvando..." : "Salvar nova previsão"}
              </button>
            </section>

            <div className="modal-actions">
              {canDeleteChip && (
                <button
                  type="button"
                  className="ghost-btn danger-btn"
                  disabled={movingId === detailVehicle.id}
                  onClick={submitChipDeletion}
                >
                  {movingId === detailVehicle.id ? "Excluindo..." : "Excluir chip"}
                </button>
              )}
              <button type="button" className="ghost-btn" onClick={() => setDetailVehicle(null)}>
                Fechar
              </button>
            </div>
          </form>
        </div>
      )}

      {budgetRequestVehicle && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal" onSubmit={submitBudgetRequest}>
            <div className="modal-head">
              <div>
                <strong>Solicitar orçamento complementar</strong>
                <span>{budgetRequestVehicle.clientName} · {budgetRequestVehicle.plate}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setBudgetRequestVehicle(null)}>
                ×
              </button>
            </div>

            <label className="field">
              <span>Observação para peças</span>
              <textarea
                value={budgetRequestForm.note}
                onChange={(event) => setBudgetRequestForm({ note: event.target.value })}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setBudgetRequestVehicle(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === budgetRequestVehicle.id}>
                {movingId === budgetRequestVehicle.id ? "Enviando..." : "Enviar para orçamento"}
              </button>
            </div>
          </form>
        </div>
      )}

      {sendVehicle && (
        <div className="modal-backdrop" role="presentation">
          <div className="flow-modal">
            <div className="modal-head">
              <div>
                <strong>Enviar veículo</strong>
                <span>{sendVehicle.clientName} · {sendVehicle.plate}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setSendVehicle(null)}>
                ×
              </button>
            </div>

            <div className="send-options">
              {sendVehicle.currentLane === "aguardando_servico" ? (
                <>
                  {sendVehicle.washType !== "nao" && !sendVehicle.washDone && (
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={movingId === sendVehicle.id}
                      onClick={() => moveToLane(sendVehicle, "aguardando_lavagem", "Lavagem antecipada solicitada antes do serviço", {
                        serviceCompleted: false,
                        washingAdvanced: true,
                        washDone: false,
                      })}
                    >
                      Lavagem antecipada
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      openStartServiceModal(sendVehicle);
                      setSendVehicle(null);
                    }}
                  >
                    Iniciar serviço
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      setBudgetRequestVehicle(sendVehicle);
                      setBudgetRequestForm({ note: "" });
                      setSendVehicle(null);
                    }}
                  >
                    Orçamento complementar
                  </button>
                  {sendVehicle.washDone || sendVehicle.washType === "nao" ? (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={movingId === sendVehicle.id}
                      onClick={() => moveToLane(
                        sendVehicle,
                        "preparacao_entrega",
                        sendVehicle.washType === "nao"
                          ? "Serviço concluído; veículo sem lavagem"
                          : "Serviço concluído; lavagem antecipada já realizada",
                        {
                        serviceCompleted: true,
                        washingAdvanced: false,
                      })}
                    >
                      Preparação de entrega
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={movingId === sendVehicle.id}
                      onClick={() => moveToLane(sendVehicle, "aguardando_lavagem", "Serviço concluído, aguardando lavagem", {
                        serviceCompleted: true,
                        washingAdvanced: false,
                        washDone: false,
                      })}
                    >
                      Aguardando lavagem
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {budgetCompleteVehicle && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal" onSubmit={submitBudgetComplete}>
            <div className="modal-head">
              <div>
                <strong>Orçamento realizado</strong>
                <span>{budgetCompleteVehicle.clientName} · {budgetCompleteVehicle.plate}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setBudgetCompleteVehicle(null)}>
                ×
              </button>
            </div>

            <label className="field">
              <span>Quem realizou o orçamento</span>
              <input
                required
                value={budgetCompleteForm.quotedBy}
                onChange={(event) => setBudgetCompleteForm((current) => ({ ...current, quotedBy: event.target.value }))}
              />
            </label>

            <label className="field">
              <span>Peça disponível?</span>
              <select
                value={budgetCompleteForm.partAvailability}
                onChange={(event) => setBudgetCompleteForm((current) => ({ ...current, partAvailability: event.target.value as PartAvailability }))}
              >
                <option value="sim">👍 Sim</option>
                <option value="nao">👎 Não</option>
                <option value="parcial">◐ Parcial</option>
              </select>
            </label>

            <label className="field">
              <span>Observação de peças</span>
              <textarea
                value={budgetCompleteForm.partsNote}
                onChange={(event) => setBudgetCompleteForm((current) => ({ ...current, partsNote: event.target.value }))}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setBudgetCompleteVehicle(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === budgetCompleteVehicle.id}>
                {movingId === budgetCompleteVehicle.id ? "Salvando..." : "Marcar orçamento realizado"}
              </button>
            </div>
          </form>
        </div>
      )}

      {budgetReturnVehicle && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal" onSubmit={submitBudgetReturn}>
            <div className="modal-head">
              <div>
                <strong>Definir saída do orçamento</strong>
                <span>{budgetReturnVehicle.clientName} · {budgetReturnVehicle.plate}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setBudgetReturnVehicle(null)}>
                ×
              </button>
            </div>

            <div className="detail-grid modal-detail-grid">
              <div className="detail"><span>Peças</span>{partAvailabilityIcon(budgetReturnVehicle.partAvailability)} Disponíveis</div>
              <div className="detail"><span>Previsão atual</span>{formatDateTime(budgetReturnVehicle.promisedDeliveryAt)}</div>
            </div>

            {hasPendingWash(budgetReturnVehicle) && (
              <button
                type="button"
                className="ghost-btn"
                disabled={movingId === budgetReturnVehicle.id}
                onClick={() => {
                  moveToLane(budgetReturnVehicle, "aguardando_lavagem", "Lavagem antecipada solicitada durante orçamento complementar", {
                    serviceCompleted: false,
                    washingAdvanced: true,
                    washDone: false,
                  }).then(() => setBudgetReturnVehicle(null));
                }}
              >
                Adiantar lavagem
              </button>
            )}

            <label className="field">
              <span>Orçamento autorizado?</span>
              <select
                required
                value={budgetReturnForm.authorized}
                onChange={(event) => setBudgetReturnForm((current) => ({
                  ...current,
                  authorized: event.target.value as BudgetReturnForm["authorized"],
                }))}
              >
                <option value="">Selecionar</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            </label>

            {budgetReturnForm.authorized === "sim" && (
              <label className="field">
                <span>Nova previsão de entrega prometida</span>
                <input
                  required
                  type="datetime-local"
                  min={canReducePromisedDelivery ? undefined : toDateTimeLocal(budgetReturnVehicle.promisedDeliveryAt) || undefined}
                  value={budgetReturnForm.promisedDeliveryAt}
                  onChange={(event) => setBudgetReturnForm((current) => ({ ...current, promisedDeliveryAt: event.target.value }))}
                />
              </label>
            )}

            <label className="field">
              <span>Observação</span>
              <textarea
                value={budgetReturnForm.note}
                onChange={(event) => setBudgetReturnForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Ex.: Cliente autorizou orçamento, ou recusou e veículo seguirá o fluxo."
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setBudgetReturnVehicle(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === budgetReturnVehicle.id}>
                {movingId === budgetReturnVehicle.id ? "Movendo..." : "Confirmar decisão"}
              </button>
            </div>
          </form>
        </div>
      )}

      {deliveryVehicle && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal" onSubmit={submitDelivery}>
            <div className="modal-head">
              <div>
                <strong>Registrar entrega</strong>
                <span>{deliveryVehicle.clientName} · {deliveryVehicle.plate}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setDeliveryVehicle(null)}>
                ×
              </button>
            </div>

            <div className="field">
              <span>Veículo saiu no prazo?</span>
              <div className="choice-row" role="radiogroup" aria-label="Veículo saiu no prazo?">
                <button
                  type="button"
                  className={deliveryForm.deliveredOnTime === true ? "choice-btn active" : "choice-btn"}
                  onClick={() => setDeliveryForm((current) => ({ ...current, deliveredOnTime: true }))}
                >
                  Sim
                </button>
                <button
                  type="button"
                  className={deliveryForm.deliveredOnTime === false ? "choice-btn active danger" : "choice-btn"}
                  onClick={() => setDeliveryForm((current) => ({ ...current, deliveredOnTime: false }))}
                >
                  Não
                </button>
              </div>
            </div>

            {deliveryForm.partsOrdered && (
              <div className="delivery-parts-alert">
                <strong>Pedido de peças lançado</strong>
                <span>Este chip já recebeu solicitação de peças. A entrega será registrada com esse flag ativo automaticamente.</span>
              </div>
            )}

            <div className="field">
              <span>Veículo saiu com alguma pendência?</span>
              <div className="choice-row" role="radiogroup" aria-label="Veículo saiu com alguma pendência?">
                <button
                  type="button"
                  className={deliveryForm.hasPendingIssue === true ? "choice-btn active danger" : "choice-btn"}
                  onClick={() => setDeliveryForm((current) => ({ ...current, hasPendingIssue: true }))}
                >
                  Sim
                </button>
                <button
                  type="button"
                  className={deliveryForm.hasPendingIssue === false ? "choice-btn active" : "choice-btn"}
                  onClick={() => setDeliveryForm((current) => ({ ...current, hasPendingIssue: false }))}
                >
                  Não
                </button>
              </div>
            </div>

            <div className="field">
              <span>NPS interno do cliente</span>
              <div className="nps-scale" role="radiogroup" aria-label="NPS interno do cliente">
                {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={`nps-score nps-score-${score <= 6 ? "low" : score <= 8 ? "mid" : "high"}${deliveryForm.internalNps === score ? " active" : ""}`}
                    onClick={() => setDeliveryForm((current) => ({ ...current, internalNps: score }))}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>{deliveryForm.hasPendingIssue ? "Observação da pendência" : "Observação para lembrar no futuro"}</span>
              <textarea
                required={deliveryForm.hasPendingIssue === true}
                value={deliveryForm.futureNote}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, futureNote: event.target.value }))}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setDeliveryVehicle(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === deliveryVehicle.id}>
                {movingId === deliveryVehicle.id ? "Salvando..." : "Registrar entrega"}
              </button>
            </div>
          </form>
        </div>
      )}

      {startServiceVehicle && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal" onSubmit={submitStartService}>
            <div className="modal-head">
              <div>
                <strong>Iniciar serviço</strong>
                <span>{startServiceVehicle.clientName} · {startServiceVehicle.plate}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setStartServiceVehicle(null)}>
                ×
              </button>
            </div>

            <label className="field">
              <span>Técnico responsável</span>
              <select
                required
                value={startServiceForm.technicianName}
                onChange={(event) => setStartServiceForm((current) => ({ ...current, technicianName: event.target.value }))}
              >
                <option value="">Definir técnico</option>
                {workshopTechnicians.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>

            <label className="check-line modal-check">
              <input
                type="checkbox"
                checked={startServiceForm.customerWaits}
                onChange={(event) => setStartServiceForm((current) => ({ ...current, customerWaits: event.target.checked }))}
              />
              O cliente irá aguardar na loja?
            </label>

            <label className="field">
              <span>Previsão de entrega prometida</span>
              <input
                required
                type="datetime-local"
                min={canReducePromisedDelivery ? undefined : toDateTimeLocal(startServiceVehicle.promisedDeliveryAt) || undefined}
                value={startServiceForm.promisedDeliveryAt}
                onChange={(event) => setStartServiceForm((current) => ({ ...current, promisedDeliveryAt: event.target.value }))}
              />
            </label>

            <label className="field">
              <span>Observação da oficina</span>
              <textarea
                value={startServiceForm.note}
                onChange={(event) => setStartServiceForm((current) => ({ ...current, note: event.target.value }))}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setStartServiceVehicle(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === startServiceVehicle.id}>
                {movingId === startServiceVehicle.id ? "Iniciando..." : "Iniciar serviço"}
              </button>
            </div>
          </form>
        </div>
      )}

      {walkInOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal flow-detail-modal" onSubmit={submitWalkIn}>
            <div className="modal-head">
              <div>
                <strong>Cadastrar passante</strong>
                <span>Cliente sem agendamento para o dia selecionado</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setWalkInOpen(false)}>
                ×
              </button>
            </div>

            <div className="modal-detail-grid detail-grid">
              <label className="field">
                <span>Cliente</span>
                <input
                  required
                  value={walkInForm.client}
                  onChange={(event) => setWalkInForm((current) => ({ ...current, client: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Telefone</span>
                <input
                  value={walkInForm.phone}
                  onChange={(event) => setWalkInForm((current) => ({ ...current, phone: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Placa</span>
                <input
                  required
                  value={walkInForm.plate}
                  onChange={(event) => setWalkInForm((current) => ({ ...current, plate: event.target.value.toUpperCase() }))}
                />
              </label>
              <label className="field">
                <span>Modelo</span>
                <input
                  value={walkInForm.model}
                  onChange={(event) => setWalkInForm((current) => ({ ...current, model: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Chassi</span>
                <input
                  value={walkInForm.chassi}
                  onChange={(event) => setWalkInForm((current) => ({ ...current, chassi: event.target.value.toUpperCase() }))}
                />
              </label>
              <label className="field">
                <span>Tipo de atendimento</span>
                <select
                  value={walkInForm.service}
                  onChange={(event) => {
                    const service = event.target.value;
                    setWalkInForm((current) => ({
                      ...current,
                      service,
                      washType: washTypeFromService(service, current.washType),
                    }));
                  }}
                >
                  {walkInServices.map((service) => <option key={service}>{service}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Consultor</span>
                <input
                  required
                  value={walkInForm.consultant}
                  onChange={(event) => setWalkInForm((current) => ({ ...current, consultant: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Técnico</span>
                <input
                  value={walkInForm.technician}
                  onChange={(event) => setWalkInForm((current) => ({ ...current, technician: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Tipo da lavagem</span>
                <select
                  value={walkInForm.washType}
                  onChange={(event) => setWalkInForm((current) => ({ ...current, washType: event.target.value as WashType }))}
                >
                  {washOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Observação</span>
              <textarea
                value={walkInForm.note}
                onChange={(event) => setWalkInForm((current) => ({ ...current, note: event.target.value }))}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setWalkInOpen(false)}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === "walk-in"}>
                {movingId === "walk-in" ? "Cadastrando..." : "Cadastrar passante"}
              </button>
            </div>
          </form>
        </div>
      )}
    </ProtectedPage>
  );
}




