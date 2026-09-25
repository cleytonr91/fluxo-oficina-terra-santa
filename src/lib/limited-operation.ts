// Temporary containment: do not add routes without reviewing their database usage.
export const LIMITED_OPERATION = true;
export const limitedOperationalPaths = ["/preparacao", "/fluxo", "/pos-servico"] as const;

export function isOperationalPathEnabled(pathname: string) {
  return !LIMITED_OPERATION || limitedOperationalPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isLimitedShellPath(pathname: string) {
  return pathname === "/login" || pathname === "/operacao-limitada";
}
