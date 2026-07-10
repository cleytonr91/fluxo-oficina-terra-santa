"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { completeComplementaryBudget, completeVehicleDelivery, createWalkInVehicle, listActiveVehicleFlows, markVehicleNoShow, moveVehicleFlow, requestComplementaryBudget, updatePromisedDelivery } from "@/services/firestore";
import type { FlowLane, PartAvailability, VehicleFlow, WashType } from "@/types/domain";

const laneLabels: Array<{ id: FlowLane; label: string }> = [
  { id: "preparacao_confirmada", label: "Preparação Confirmada" },
  { id: "aguardando_servico", label: "Aguardando Serviço" },
  { id: "em_servico", label: "Em Serviço" },
  { id: "orcamento_complementar", label: "Orçamento Complementar" },
  { id: "aguardando_lavagem", label: "Aguardando Lavagem" },
  { id: "lavagem", label: "Lavagem" },
  { id: "preparacao_entrega", label: "Preparação de Entrega" },
  { id: "entregue", label: "Entregue" },
];

const washOptions: Array<{ value: WashType; label: string }> = [
  { value: "simples", label: "Lavagem Simples" },
  { value: "motor", label: "Lavagem de Motor" },
  { value: "motor_bancos", label: "Lavagem Motor + Bancos" },
  { value: "nao", label: "Não" },
];

const workshopTechnicians = ["Wesley", "Ayslan", "Gilvan", "Elimarcos", "Hernando"];

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
];

type ReceiveForm = {
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

type BudgetRequestForm = {
  note: string;
};

type BudgetCompleteForm = {
  quotedBy: string;
  partAvailability: PartAvailability;
  partsNote: string;
};

type BudgetReturnForm = {
  promisedDeliveryAt: string;
  note: string;
};

type DeliveryForm = {
  deliveredOnTime: boolean;
  partsOrdered: boolean;
  internalNps: number;
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
  note: string;
};

type StartServiceForm = {
  customerWaits: boolean;
  technicianName: string;
  promisedDeliveryAt: string;
  note: string;
};

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

function isPastDate(date?: string) {
  if (!date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return date < today;
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

function FlowChip({
  vehicle,
  onAdvance,
  onDetails,
  now,
}: {
  vehicle: VehicleFlow;
  onAdvance?: (vehicle: VehicleFlow) => void;
  onDetails: (vehicle: VehicleFlow) => void;
  now: Date;
}) {
  const serviceText = vehicle.serviceLabel ?? "Serviço não informado";
  const chipClass = isDiagnostic(vehicle) ? "diagnostico" : isGeneralRepair(vehicle) ? "reparo" : "";
  const progress = timeProgress(vehicle, now);

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
        <span className={`plate ${vehicle.customerWaits ? "wait-plate" : ""}`} title={vehicle.customerWaits ? "Cliente aguardando na loja" : "Placa"}>
          {vehicle.customerWaits && <span className="plate-alert" aria-hidden="true">⚠</span>}
          <span>{vehicle.plate ?? "-"}</span>
        </span>
      </div>

      <div className="tag-row">
        <span className="tag">{serviceText}</span>
        {vehicle.origin === "passante" && <span className="tag warn">Passante</span>}
        {vehicle.priority === "alta" && <span className="tag bad">Alta</span>}
        {vehicle.roadTestRequired && <span className={`tag ${vehicle.roadTestDone ? "good" : "bad"}`}>Teste {vehicle.roadTestDone ? "👍" : "👎"}</span>}
        {vehicle.washingAdvanced && !vehicle.washDone && <span className="tag warn">Lavagem antecipada</span>}
        {vehicle.washingAdvanced && vehicle.washDone && !vehicle.serviceCompleted && <span className="tag warn">Lavagem feita</span>}
        {vehicle.noShow && <span className="tag bad">NO-SHOW</span>}
        {vehicle.budgetStatus === "realizado" && <span className="tag">{partAvailabilityIcon(vehicle.partAvailability)} Peças</span>}
        {vehicle.currentLane === "entregue" && typeof vehicle.internalNps === "number" && <span className="tag">NPS {vehicle.internalNps}</span>}
      </div>

      <div className="chip-compact-details">
        <div><span>Consultor:</span> {firstName(vehicle.consultantName)}</div>
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
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [consultantFilter, setConsultantFilter] = useState("Todos");
  const [technicianFilter, setTechnicianFilter] = useState("Todos");
  const [flowDate, setFlowDate] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [receivingVehicle, setReceivingVehicle] = useState<VehicleFlow | null>(null);
  const [detailVehicle, setDetailVehicle] = useState<VehicleFlow | null>(null);
  const [sendVehicle, setSendVehicle] = useState<VehicleFlow | null>(null);
  const [startServiceVehicle, setStartServiceVehicle] = useState<VehicleFlow | null>(null);
  const [budgetRequestVehicle, setBudgetRequestVehicle] = useState<VehicleFlow | null>(null);
  const [budgetCompleteVehicle, setBudgetCompleteVehicle] = useState<VehicleFlow | null>(null);
  const [budgetReturnVehicle, setBudgetReturnVehicle] = useState<VehicleFlow | null>(null);
  const [deliveryVehicle, setDeliveryVehicle] = useState<VehicleFlow | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>({
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
  const [budgetRequestForm, setBudgetRequestForm] = useState<BudgetRequestForm>({ note: "" });
  const [budgetCompleteForm, setBudgetCompleteForm] = useState<BudgetCompleteForm>({
    quotedBy: "",
    partAvailability: "sim",
    partsNote: "",
  });
  const [budgetReturnForm, setBudgetReturnForm] = useState<BudgetReturnForm>({
    promisedDeliveryAt: "",
    note: "",
  });
  const [deliveryForm, setDeliveryForm] = useState<DeliveryForm>({
    deliveredOnTime: true,
    partsOrdered: false,
    internalNps: 10,
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
    let active = true;
    const savedDate = localStorage.getItem("selectedFlowDate");
    if (savedDate) {
      window.requestAnimationFrame(() => setFlowDate(savedDate));
    }

    async function loadVehicles() {
      setLoading(true);
      setError("");

      try {
        const data = await listActiveVehicleFlows();
        if (!active) return;
        setVehicles(data.sort((a, b) => `${a.appointmentDate ?? ""}${a.appointmentTime ?? ""}`.localeCompare(`${b.appointmentDate ?? ""}${b.appointmentTime ?? ""}`)));
      } catch (currentError) {
        if (!active) return;
        setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar o fluxo.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadVehicles();
    return () => {
      active = false;
    };
  }, []);

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
      && isPastDate(vehicle.appointmentDate)
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
  }, [profile?.name, user?.email, user?.uid, vehicles]);

  function openReceiveModal(vehicle: VehicleFlow) {
    setReceivingVehicle(vehicle);
    setReceiveForm({
      customerWaits: vehicle.customerWaits ?? false,
      promisedDeliveryAt: toDateTimeLocal(vehicle.promisedDeliveryAt) || sameDayDefault(vehicle.appointmentDate),
      washType: vehicle.washType ?? "simples",
      receiveNote: vehicle.receiveNote ?? "",
      roadTestDone: typeof vehicle.roadTestDone === "boolean" ? (vehicle.roadTestDone ? "sim" : "nao") : "",
    });
  }

  function openDetailModal(vehicle: VehicleFlow) {
    setDetailVehicle(vehicle);
    setPromiseForm({
      promisedDeliveryAt: toDateTimeLocal(vehicle.promisedDeliveryAt) || sameDayDefault(vehicle.appointmentDate),
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
    if (vehicle.partAvailability !== "sim") {
      setError("O retorno para Aguardando Serviço só é permitido quando as peças estiverem disponíveis.");
      return;
    }

    setBudgetReturnVehicle(vehicle);
    setBudgetReturnForm({
      promisedDeliveryAt: "",
      note: "",
    });
  }

  function openDeliveryModal(vehicle: VehicleFlow) {
    const promisedDate = toDate(vehicle.promisedDeliveryAt);
    setDeliveryVehicle(vehicle);
    setDeliveryForm({
      deliveredOnTime: promisedDate ? Date.now() <= promisedDate.getTime() : true,
      partsOrdered: false,
      internalNps: 10,
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
    extra: Pick<VehicleFlow, "serviceCompleted" | "washingAdvanced" | "washDone"> = {},
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

    return moveToLane(vehicle, "aguardando_servico", "Lavagem antecipada concluída; retorno para Aguardando Serviço", {
      serviceCompleted: false,
      washingAdvanced: true,
      washDone: true,
    });
  }

  async function submitReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receivingVehicle) return;

    if (isEarlierThanCurrent(receiveForm.promisedDeliveryAt, receivingVehicle.promisedDeliveryAt)) {
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
      await moveVehicleFlow({
        vehicleFlowId: receivingVehicle.id,
        fromLane: receivingVehicle.currentLane,
        toLane: "aguardando_servico",
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote: receiveForm.receiveNote || "Veículo recebido pelo consultor",
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
              currentLane: "aguardando_servico",
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

    if (isEarlierThanCurrent(startServiceForm.promisedDeliveryAt, startServiceVehicle.promisedDeliveryAt)) {
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

    if (!budgetReturnForm.promisedDeliveryAt) {
      setError("Informe a nova previsão de entrega para retornar o veículo ao serviço.");
      return;
    }

    if (isEarlierThanCurrent(budgetReturnForm.promisedDeliveryAt, budgetReturnVehicle.promisedDeliveryAt)) {
      setError("A nova previsão não pode ser menor que a previsão já prometida.");
      return;
    }

    setMovingId(budgetReturnVehicle.id);
    setError("");

    const note = budgetReturnForm.note || "Orçamento realizado com peças em estoque. Retorno para Aguardando Serviço.";

    try {
      await moveVehicleFlow({
        vehicleFlowId: budgetReturnVehicle.id,
        fromLane: budgetReturnVehicle.currentLane,
        toLane: "aguardando_servico",
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        actionNote: note,
        promisedDeliveryAt: budgetReturnForm.promisedDeliveryAt,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === budgetReturnVehicle.id
          ? {
              ...vehicle,
              currentLane: "aguardando_servico",
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

    setMovingId(deliveryVehicle.id);
    setError("");

    try {
      await completeVehicleDelivery({
        vehicleFlowId: deliveryVehicle.id,
        fromLane: deliveryVehicle.currentLane,
        deliveredBy: profile?.name ?? user?.email ?? user?.uid,
        deliveredOnTime: deliveryForm.deliveredOnTime,
        partsOrdered: deliveryForm.partsOrdered,
        internalNps: deliveryForm.internalNps,
        futureNote: deliveryForm.futureNote,
      });

      setVehicles((current) => current.map((vehicle) => (
        vehicle.id === deliveryVehicle.id
          ? {
              ...vehicle,
              currentLane: "entregue",
              status: "entregue",
              deliveredAt: new Date().toISOString(),
              deliveredOnTime: deliveryForm.deliveredOnTime,
              partsOrdered: deliveryForm.partsOrdered,
              internalNps: deliveryForm.internalNps,
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
      await createWalkInVehicle({
        ...walkInForm,
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
          currentLane: "aguardando_servico",
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
          washType: "nao",
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

    if (isEarlierThanCurrent(promiseForm.promisedDeliveryAt, detailVehicle.promisedDeliveryAt)) {
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

  const consultants = useMemo(
    () => Array.from(new Set(vehicles.map((item) => item.consultantName).filter(Boolean))).sort() as string[],
    [vehicles],
  );
  const technicians = useMemo(
    () => Array.from(new Set(vehicles.map((item) => item.technicianName).filter(Boolean))).sort() as string[],
    [vehicles],
  );

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => {
      const dateMatches = !flowDate || vehicle.appointmentDate === flowDate;
      const consultantMatches = consultantFilter === "Todos" || vehicle.consultantName === consultantFilter;
      const technicianMatches = technicianFilter === "Todos" || vehicle.technicianName === technicianFilter;
      return dateMatches && consultantMatches && technicianMatches;
    });
  }, [consultantFilter, flowDate, technicianFilter, vehicles]);

  const metrics = [
    [filteredVehicles.length, "veículos no fluxo", "active"],
    [filteredVehicles.filter(isRevision).length, "revisões", ""],
    [filteredVehicles.filter(isDiagnostic).length, "diagnósticos", ""],
    [filteredVehicles.filter(isGeneralRepair).length, "reparos gerais", ""],
    [filteredVehicles.filter((item) => item.origin === "passante").length, "passantes", ""],
    [filteredVehicles.filter((item) => item.noShow).length, "no-show", "danger"],
    [filteredVehicles.filter((item) => item.priority === "alta" || item.roadTestRequired || item.customerWaits).length, "em atenção", ""],
    [filteredVehicles.filter((item) => item.currentLane === "entregue").length, "entregues", ""],
  ] as const;

  return (
    <ProtectedPage
      title="Fluxo da Oficina"
      subtitle="Agenda, passantes, oficina, lavagem e entrega."
    >
      <main className="flow-page">
        <section className="flow-metrics">
          {metrics.map(([value, label, state]) => (
            <button key={label} className={`flow-metric ${state}`} type="button">
              <strong>{value}</strong>
              <span>{label}</span>
            </button>
          ))}

          <label className="flow-filter">
            <span>Consultor</span>
            <select value={consultantFilter} onChange={(event) => setConsultantFilter(event.target.value)}>
              <option>Todos</option>
              {consultants.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>

          <label className="flow-filter">
            <span>Técnico</span>
            <select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)}>
              <option>Todos</option>
              {technicians.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </section>

        {error && <div className="duplicate-alert"><strong>Erro no fluxo</strong><span>{error}</span></div>}

        <section className="flow-board">
          {laneLabels.map((lane) => {
            const laneVehicles = sortLaneVehicles(lane.id, filteredVehicles.filter((vehicle) => vehicle.currentLane === lane.id));
            const pendingBudgetVehicles = laneVehicles.filter((vehicle) => vehicle.budgetStatus !== "realizado");
            const completedBudgetVehicles = laneVehicles.filter((vehicle) => vehicle.budgetStatus === "realizado");

            return (
              <section key={lane.id} className="flow-lane">
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
                          onAdvance={openBudgetCompleteModal}
                          onDetails={openDetailModal}
                          now={now}
                        />
                      )) : <p>Sem orçamentos pendentes</p>}
                    </div>
                    <div className="budget-box">
                      <h3>Orçamento realizado</h3>
                      {completedBudgetVehicles.length ? completedBudgetVehicles.map((vehicle) => (
                        <FlowChip
                          key={vehicle.id}
                          vehicle={vehicle}
                          onAdvance={vehicle.partAvailability === "sim" ? openBudgetReturnModal : undefined}
                          onDetails={openDetailModal}
                          now={now}
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
                          now={now}
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
                {movingId === receivingVehicle.id ? "Movendo..." : "Mover para Aguardando Serviço"}
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
              <div className="detail"><span>Chassi</span>{detailVehicle.chassi ?? "-"}</div>
              <div className="detail"><span>Telefone</span>{detailVehicle.phone ?? "-"}</div>
              <div className="detail"><span>Modelo</span>{detailVehicle.model ?? "-"}</div>
              <div className="detail"><span>Consultor</span>{detailVehicle.consultantName ?? "-"}</div>
              <div className="detail"><span>Técnico</span>{detailVehicle.technicianName ?? "-"}</div>
              <div className="detail"><span>Etapa</span>{laneLabels.find((lane) => lane.id === detailVehicle.currentLane)?.label ?? detailVehicle.currentLane}</div>
              <div className="detail"><span>Previsão atual</span>{formatDateTime(detailVehicle.promisedDeliveryAt)}</div>
              <div className="detail"><span>Cliente aguarda</span>{detailVehicle.customerWaits ? "Sim" : "Não"}</div>
              <div className="detail"><span>Lavagem</span>{detailVehicle.washDone ? "Realizada" : detailVehicle.washingAdvanced ? "Antecipada pendente" : "Pendente"}</div>
            </div>

            {(detailVehicle.importedNotes || detailVehicle.receiveNote || detailVehicle.partsNote) && (
              <section className="history-box">
                <h3>Observações</h3>
                {detailVehicle.importedNotes && <p><strong>Agenda:</strong> {detailVehicle.importedNotes}</p>}
                {detailVehicle.receiveNote && <p><strong>Recebimento:</strong> {detailVehicle.receiveNote}</p>}
                {detailVehicle.partsNote && <p><strong>Peças:</strong> {detailVehicle.partsNote}</p>}
              </section>
            )}

            <section className="history-box">
              <h3>Histórico de previsão</h3>
              {detailVehicle.promiseHistory?.length ? (
                <ul>
                  {detailVehicle.promiseHistory.map((item, index) => (
                    <li key={`${item.promisedDeliveryAt}-${index}`}>
                      <strong>{formatDateTime(item.promisedDeliveryAt)}</strong>
                      <span>{item.changedBy ?? "Usuário"} · {formatDateTime(item.changedAt)}</span>
                      {item.note && <p>{item.note}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nenhuma alteração de previsão registrada.</p>
              )}
            </section>

            <label className="field">
              <span>Nova previsão de entrega</span>
              <input
                required
                type="datetime-local"
                min={toDateTimeLocal(detailVehicle.promisedDeliveryAt) || undefined}
                value={promiseForm.promisedDeliveryAt}
                onChange={(event) => setPromiseForm((current) => ({ ...current, promisedDeliveryAt: event.target.value }))}
              />
            </label>

            <label className="field">
              <span>Motivo da alteração</span>
              <textarea
                value={promiseForm.note}
                onChange={(event) => setPromiseForm((current) => ({ ...current, note: event.target.value }))}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setDetailVehicle(null)}>
                Fechar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === detailVehicle.id}>
                {movingId === detailVehicle.id ? "Salvando..." : "Salvar nova previsão"}
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
                  {sendVehicle.washDone ? (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={movingId === sendVehicle.id}
                      onClick={() => moveToLane(sendVehicle, "preparacao_entrega", "Serviço concluído; lavagem antecipada já realizada", {
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
                <strong>Retornar para Aguardando Serviço</strong>
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

            <label className="field">
              <span>Nova previsão de entrega prometida</span>
              <input
                required
                type="datetime-local"
                min={toDateTimeLocal(budgetReturnVehicle.promisedDeliveryAt) || undefined}
                value={budgetReturnForm.promisedDeliveryAt}
                onChange={(event) => setBudgetReturnForm((current) => ({ ...current, promisedDeliveryAt: event.target.value }))}
              />
            </label>

            <label className="field">
              <span>Observação do retorno</span>
              <textarea
                value={budgetReturnForm.note}
                onChange={(event) => setBudgetReturnForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Ex.: Peças separadas pelo estoque, veículo liberado para execução."
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setBudgetReturnVehicle(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn" disabled={movingId === budgetReturnVehicle.id}>
                {movingId === budgetReturnVehicle.id ? "Movendo..." : "Voltar para Aguardando Serviço"}
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

            <label className="check-line modal-check">
              <input
                type="checkbox"
                checked={deliveryForm.deliveredOnTime}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, deliveredOnTime: event.target.checked }))}
              />
              Veículo entregue no prazo combinado
            </label>

            <label className="check-line modal-check">
              <input
                type="checkbox"
                checked={deliveryForm.partsOrdered}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, partsOrdered: event.target.checked }))}
              />
              Teve pedido de peça
            </label>

            <label className="field">
              <span>NPS interno do cliente</span>
              <input
                min="0"
                max="10"
                type="number"
                value={deliveryForm.internalNps}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, internalNps: Number(event.target.value) }))}
              />
            </label>

            <label className="field">
              <span>Observação para lembrar no futuro</span>
              <textarea
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
                min={toDateTimeLocal(startServiceVehicle.promisedDeliveryAt) || undefined}
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
                  onChange={(event) => setWalkInForm((current) => ({ ...current, service: event.target.value }))}
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



