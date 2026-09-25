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
    case "lavagem": return [vehicle.washingAdvanced && !vehicle.serviceCompleted ? "aguardando_servico" : "preparacao_entrega"];
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
export function localDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
