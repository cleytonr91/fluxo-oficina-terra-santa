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
  admin: ["/preparacao", "/fluxo", "/agendamento", "/pecas", "/balcao", "/funilaria", "/pos-servico", "/radar", "/admin", "/cardapio"],
  gerente: ["/preparacao", "/fluxo", "/agendamento", "/pecas", "/balcao", "/funilaria", "/pos-servico", "/radar", "/admin", "/cardapio"],
  chefe_oficina: ["/preparacao", "/pecas", "/fluxo", "/cardapio"],
  consultor: ["/fluxo", "/balcao", "/pos-servico", "/cardapio"],
  tecnico: ["/fluxo", "/cardapio"],
  lider_lavagem: ["/fluxo", "/cardapio"],
  consultor_funilaria: ["/pecas", "/balcao", "/funilaria", "/fluxo", "/cardapio"],
  estoquista: ["/pecas", "/balcao", "/fluxo", "/funilaria", "/cardapio"],
  qualidade: ["/pos-servico", "/cardapio"],
  agendamento: ["/agendamento", "/cardapio"],
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
