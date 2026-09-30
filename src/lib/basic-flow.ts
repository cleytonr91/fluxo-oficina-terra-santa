import type { FlowLane, UserRole, VehicleFlow } from "@/types/domain";

export const basicLanes: { id: FlowLane; label: string }[] = [
  { id: "preparacao_confirmada", label: "Agendamento do Dia" },
  { id: "aguardando_servico", label: "Aguardando Serviço" },
  { id: "em_servico", label: "Em Serviço" },
  { id: "orcamento_complementar", label: "Orçamento Complementar" },
  { id: "aguardando_lavagem", label: "Aguardando Lavagem" },
  { id: "lavagem", label: "Lavagem" },
  { id: "preparacao_entrega", label: "Preparação de Entrega" },
  { id: "entregue", label: "Entregue" },
];
export const basicConsultants = ["Cleverton", "Eliane", "Rosangela", "Luan"];
export const basicTechnicians = ["Hernando", "Elimarcos", "Wesley", "Ayslan", "Gilvan", "Nathan", "Igo"];
export function basicTargets(vehicle: VehicleFlow): FlowLane[] {
  const finish: FlowLane = vehicle.washType !== "nao" && !vehicle.washDone ? "aguardando_lavagem" : "preparacao_entrega";
  switch (vehicle.currentLane) {
    case "preparacao_confirmada": return ["aguardando_servico"];
    case "aguardando_servico": return ["em_servico"];
    case "em_servico": return [finish, "orcamento_complementar"];
    case "orcamento_complementar": return ["aguardando_servico", finish];
    case "aguardando_lavagem": return ["lavagem"];
    case "lavagem": {
      const origin = (vehicle as VehicleFlow & { advancedWashReturnLane?: FlowLane }).advancedWashReturnLane;
      return [vehicle.washingAdvanced && !vehicle.serviceCompleted
        ? origin === "orcamento_complementar" ? origin : "aguardando_servico"
        : "preparacao_entrega"];
    }
    case "preparacao_entrega": return ["entregue"];
    default: return [];
  }
}
export function canOperateBasic(role: UserRole | undefined, lane: FlowLane) {
  if (role && ["admin", "gerente", "chefe_oficina"].includes(role)) return true;
  if (["preparacao_confirmada", "preparacao_entrega", "orcamento_complementar"].includes(lane)) return role === "consultor" || role === "consultor_funilaria";
  if (["aguardando_lavagem", "lavagem"].includes(lane)) return role === "lider_lavagem";
  return role === "tecnico";
}
export function isCurrentDayAppointment(vehicle: VehicleFlow, today: string) {
  return vehicle.currentLane !== "preparacao_confirmada" || vehicle.appointmentDate === today;
}
export function basicFlowDayVehicles(vehicles: VehicleFlow[], day: string, today: string) {
  return vehicles.filter(vehicle => isCurrentDayAppointment(vehicle, today)
    && !(vehicle.status === "ativo" && vehicle.appointmentDate && vehicle.appointmentDate > day));
}
export function localDay(reference = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(reference);
}

function flowTimestamp(value: unknown): number | undefined {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value)
    : value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function" ? value.toDate()
      : value && typeof value === "object" && "seconds" in value && typeof value.seconds === "number" ? new Date(value.seconds * 1000) : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : undefined;
}

export function flowSequenceTime(vehicle: VehicleFlow): number {
  if (vehicle.currentLane !== "preparacao_confirmada") {
    const received = flowTimestamp(vehicle.attendanceStartedAt)
      ?? (vehicle.origin === "passante" ? flowTimestamp(vehicle.createdAt) : undefined);
    if (received !== undefined) return received;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(vehicle.appointmentTime ?? "");
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || !/^\d{4}-\d{2}-\d{2}$/.test(vehicle.appointmentDate ?? "")) return Infinity;
  return flowTimestamp(`${vehicle.appointmentDate}T${match[1].padStart(2, "0")}:${match[2]}:00-03:00`) ?? Infinity;
}

export function sortFlowLane(vehicles: VehicleFlow[], day: string): VehicleFlow[] {
  return [...vehicles].sort((left, right) => {
    const a = flowSequenceTime(left), b = flowSequenceTime(right);
    if (left.currentLane === "aguardando_lavagem" && right.currentLane === "aguardando_lavagem") {
      const oldA = Number(Number.isFinite(a) && localDay(new Date(a)) < day);
      const oldB = Number(Number.isFinite(b) && localDay(new Date(b)) < day);
      if (oldA !== oldB) return oldB - oldA;
      const origin = Number(left.origin === "passante") - Number(right.origin === "passante");
      if (origin) return origin;
    }
    if (a !== b) return a < b ? -1 : 1;
    if (left.currentLane === "aguardando_lavagem" && right.currentLane === "aguardando_lavagem") {
      const wash = Number(right.washType === "simples") - Number(left.washType === "simples");
      if (wash) return wash;
    }
    return left.id.localeCompare(right.id);
  });
}
