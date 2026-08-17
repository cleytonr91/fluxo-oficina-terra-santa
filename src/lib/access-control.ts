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
  admin: ["/preparacao", "/fluxo", "/agendamento", "/agenda", "/pecas", "/estoque", "/balcao", "/funilaria", "/pos-servico", "/radar", "/admin", "/cardapio"],
  gerente: ["/preparacao", "/fluxo", "/agendamento", "/agenda", "/pecas", "/estoque", "/balcao", "/funilaria", "/pos-servico", "/radar", "/admin", "/cardapio"],
  chefe_oficina: ["/preparacao", "/pecas", "/fluxo", "/agenda", "/cardapio"],
  consultor: ["/fluxo", "/balcao", "/pos-servico", "/agenda", "/cardapio"],
  tecnico: ["/fluxo", "/agenda", "/cardapio"],
  lider_lavagem: ["/fluxo", "/agenda", "/cardapio"],
  consultor_funilaria: ["/pecas", "/balcao", "/funilaria", "/fluxo", "/agenda", "/cardapio"],
  estoquista: ["/pecas", "/estoque", "/balcao", "/fluxo", "/funilaria", "/agenda", "/cardapio"],
  qualidade: ["/pos-servico", "/agenda", "/cardapio"],
  agendamento: ["/agendamento", "/agenda", "/cardapio"],
};

export const pageOptions = [
  { path: "/preparacao", label: "Preparação" },
  { path: "/fluxo", label: "Fluxo da oficina" },
  { path: "/agendamento", label: "Agendamento" },
  { path: "/agenda", label: "Agenda" },
  { path: "/pecas", label: "Peças" },
  { path: "/estoque", label: "Estoque" },
  { path: "/balcao", label: "Balcão de peças" },
  { path: "/funilaria", label: "Funilaria" },
  { path: "/pos-servico", label: "Pós-serviço" },
  { path: "/radar", label: "Farol Gerencial" },
  { path: "/cardapio", label: "Cardápio" },
  { path: "/admin", label: "Administração" },
] as const;

export function allowedPathsForRole(role?: UserRole, customPaths?: string[]) {
  return customPaths ?? (role ? rolePaths[role] ?? [] : []);
}

export function canAccessPath(role: UserRole | undefined, pathname: string, customPaths?: string[]) {
  if (!role) return false;
  if (pathname === "/") return role === "admin" || role === "gerente";
  return allowedPathsForRole(role, customPaths).some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function defaultPathForRole(role?: UserRole, customPaths?: string[]) {
  return allowedPathsForRole(role, customPaths)[0] ?? "/login";
}

export function roleLabel(role?: UserRole) {
  if (role === "gerente") return "Gerente";
  return roleOptions.find((item) => item.value === role)?.label ?? "Sem perfil";
}
