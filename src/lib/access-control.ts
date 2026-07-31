import type { UserRole } from "@/types/domain";

export const roleOptions: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "Administrador" },
  { value: "chefe_oficina", label: "Chefe de oficina" },
  { value: "consultor", label: "Consultor técnico" },
  { value: "tecnico", label: "Mecânico" },
  { value: "lider_lavagem", label: "Líder de posto" },
  { value: "consultor_funilaria", label: "Consultor de funilaria" },
  { value: "estoquista", label: "Estoquista" },
  { value: "qualidade", label: "Coordenador de qualidade" },
  { value: "agendamento", label: "Agendamento" },
];

const rolePaths: Record<UserRole, string[]> = {
  admin: ["/preparacao", "/fluxo", "/agendamento", "/pecas", "/funilaria", "/pos-servico", "/radar", "/admin"],
  gerente: ["/preparacao", "/fluxo", "/agendamento", "/pecas", "/funilaria", "/pos-servico", "/radar", "/admin"],
  chefe_oficina: ["/preparacao", "/pecas", "/fluxo"],
  consultor: ["/fluxo", "/pos-servico"],
  tecnico: ["/fluxo"],
  lider_lavagem: ["/fluxo"],
  consultor_funilaria: ["/pecas", "/funilaria", "/fluxo"],
  estoquista: ["/pecas", "/fluxo", "/funilaria"],
  qualidade: ["/pos-servico"],
  agendamento: ["/agendamento"],
};

export function allowedPathsForRole(role?: UserRole) {
  return role ? rolePaths[role] ?? [] : [];
}

export function canAccessPath(role: UserRole | undefined, pathname: string) {
  if (!role) return false;
  if (pathname === "/") return role === "admin" || role === "gerente";
  return allowedPathsForRole(role).some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function defaultPathForRole(role?: UserRole) {
  return allowedPathsForRole(role)[0] ?? "/login";
}

export function roleLabel(role?: UserRole) {
  if (role === "gerente") return "Gerente";
  return roleOptions.find((item) => item.value === role)?.label ?? "Sem perfil";
}
