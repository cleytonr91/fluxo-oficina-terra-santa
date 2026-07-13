"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/auth-context";

const navigation = [
  { href: "/preparacao", label: "Preparação" },
  { href: "/fluxo", label: "Fluxo do dia" },
  { href: "/pecas", label: "Peças" },
  { href: "/pos-servico", label: "Pós-serviço" },
];

function todayDate() {
  return new Date().toLocaleDateString("en-CA");
}

function currentTime() {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function AppHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const { profile, user, logout } = useAuth();
  const isPreparation = pathname === "/preparacao";
  const isFlow = pathname === "/fluxo";
  const [flowDate, setFlowDate] = useState(todayDate);
  const [clock, setClock] = useState(currentTime);

  useEffect(() => {
    const savedDate = localStorage.getItem("selectedFlowDate");
    if (savedDate) {
      window.requestAnimationFrame(() => setFlowDate(savedDate));
    }
  }, []);

  useEffect(() => {
    if (!isFlow) return;

    window.requestAnimationFrame(() => setClock(currentTime()));
    const interval = window.setInterval(() => setClock(currentTime()), 1000);

    return () => window.clearInterval(interval);
  }, [isFlow]);

  function changeFlowDate(value: string) {
    setFlowDate(value);
    localStorage.setItem("selectedFlowDate", value);
    window.dispatchEvent(new CustomEvent("flow-date-change", { detail: value }));
  }

  return (
    <header className={`app-header ${isFlow ? "flow-header" : ""}`}>
      <div>
        <h1>{title}</h1>
        {subtitle && !isFlow && <p>{subtitle}</p>}
      </div>

      {isFlow && <strong className="flow-clock">{clock}</strong>}

      <div className="header-actions">
        <nav aria-label="Páginas do fluxo">
          {navigation.filter((item) => !(isFlow && item.href === "/fluxo")).map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${active ? "active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
          {isPreparation ? (
            <span className="save-status">Salva ao confirmar</span>
          ) : isFlow ? (
            <>
              <button
                className="ghost-btn icon-btn"
                type="button"
                aria-label="Atualizar página"
                title="Atualizar página"
                onClick={() => window.location.reload()}
              >
                ↻
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => window.dispatchEvent(new Event("open-walk-in"))}
              >
                + Passante
              </button>
              <label className="date-field">
                <span>Data</span>
                <input type="date" value={flowDate} onChange={(event) => changeFlowDate(event.target.value)} />
              </label>
            </>
          ) : (
            <Link href="/radar" className={`nav-link ${pathname === "/radar" ? "active" : ""}`}>
              Farol
            </Link>
          )}
        </nav>

        {!isPreparation && !isFlow && (
          <div className="user-pill">
            <div>
              <strong>{profile?.name ?? user?.email}</strong>
              <span>{profile?.role?.replaceAll("_", " ") ?? "sem perfil"}</span>
            </div>
            {(profile?.role === "admin" || profile?.role === "gerente") && (
              <Link href="/admin">Admin</Link>
            )}
            {(profile?.role === "admin" || profile?.role === "gerente" || profile?.role === "chefe_oficina") && (
              <Link href="/admin/auditoria">Auditoria</Link>
            )}
            <button type="button" onClick={logout}>
              Sair
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
