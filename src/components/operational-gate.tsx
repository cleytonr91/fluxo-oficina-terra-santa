"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { allowedPathsForRole } from "@/lib/access-control";
import { isLimitedShellPath, isOperationalPathEnabled } from "@/lib/limited-operation";
import { AuthGate } from "@/components/auth-gate";

export function OperationalGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, logout } = useAuth();
  // This boundary must wrap the route itself, not just its rendered page content.
  // Otherwise hooks in suspended pages would still start Firestore listeners.
  if (isLimitedShellPath(pathname)) return children;
  if (isOperationalPathEnabled(pathname)) return <AuthGate>{children}</AuthGate>;
  const paths = allowedPathsForRole(profile?.role, profile?.allowedPaths);
  return (
    <main className="page-wrap">
      <section className="panel">
        <div className="panel-head"><h1 className="panel-title">Operação temporariamente limitada</h1></div>
        <div className="panel-body stack">
          <p>Esta página está suspensa. Preparação, Fluxo básico e Pós-serviço permanecem disponíveis conforme seu perfil.</p>
          {paths.map((path) => <Link className="primary-btn fit-btn" key={path} href={path}>{path === "/preparacao" ? "Preparação" : path === "/fluxo" ? "Fluxo básico" : "Pós-serviço"}</Link>)}
          <button className="ghost-btn fit-btn" onClick={logout}>Sair</button>
        </div>
      </section>
    </main>
  );
}
