"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useAuth } from "@/context/auth-context";
import { canAccessPath, roleLabel } from "@/lib/access-control";
import styles from "./app-header.module.css";

const navigation = [
  { href: "/cardapio", label: "Cardápio" },
  { href: "/preparacao", label: "Preparação" },
  { href: "/fluxo", label: "Fluxo do dia" },
  { href: "/agendamento", label: "Agendamento" },
  { href: "/agenda", label: "Agenda" },
  { href: "/pecas", label: "Peças" },
  { href: "/estoque", label: "Estoque" },
  { href: "/balcao", label: "Balcão" },
  { href: "/funilaria", label: "Funilaria" },
  { href: "/pos-servico", label: "Pós-serviço" },
  { href: "/radar", label: "Farol" },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [flowDate, setFlowDate] = useState(todayDate);
  const [clock, setClock] = useState(currentTime);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

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

  const drawer = menuOpen && createPortal(
    <div className={styles.drawerLayer}>
      <button
        className={styles.backdrop}
        type="button"
        aria-label="Fechar menu"
        onClick={() => setMenuOpen(false)}
      />
      <aside
        id="app-side-navigation"
        className={styles.drawer}
        aria-label="Páginas do sistema"
      >
        <div className={styles.drawerHeader}>
          <div>
            <strong>Fluxo Oficina</strong>
            <span>{roleLabel(profile?.role)}</span>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Fechar menu"
            title="Fechar"
            onClick={() => setMenuOpen(false)}
          >
            ×
          </button>
        </div>

        <nav className={styles.drawerNavigation} aria-label="Páginas do sistema">
          {navigation.filter((item) => canAccessPath(profile?.role, item.href)).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? styles.activeDrawerLink : styles.drawerLink}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {(canAccessPath(profile?.role, "/admin") || canAccessPath(profile?.role, "/admin/auditoria")) && (
          <div className={styles.managementLinks}>
            <span>Gestão</span>
            {canAccessPath(profile?.role, "/admin") && (
              <Link href="/admin" className={pathname === "/admin" ? styles.activeDrawerLink : styles.drawerLink} onClick={() => setMenuOpen(false)}>
                Usuários e acessos
              </Link>
            )}
            {canAccessPath(profile?.role, "/admin/auditoria") && (
              <Link href="/admin/auditoria" className={pathname === "/admin/auditoria" ? styles.activeDrawerLink : styles.drawerLink} onClick={() => setMenuOpen(false)}>
                Auditoria
              </Link>
            )}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );

  return (
    <>
    <header className={`app-header ${isFlow ? "flow-header" : ""}`}>
      <div className={styles.titleGroup}>
        <button
          className={styles.menuButton}
          type="button"
          aria-label="Abrir menu de páginas"
          aria-controls="app-side-navigation"
          aria-expanded={menuOpen}
          title="Menu"
          onClick={() => setMenuOpen(true)}
        >
          ☰
        </button>
        <div>
          <h1>{title}</h1>
          {subtitle && !isFlow && <p>{subtitle}</p>}
        </div>
      </div>

      {isFlow && <strong className="flow-clock">{clock}</strong>}

      <div className={`header-actions ${styles.headerActions}`}>
        <div className={styles.pageActions}>
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
          ) : null}
        </div>

        <div className={`user-pill ${styles.profile}`}>
          <div>
            <strong>{profile?.name ?? user?.email}</strong>
            <span>{roleLabel(profile?.role)}</span>
          </div>
          <button type="button" onClick={logout}>
            Sair
          </button>
        </div>
      </div>

    </header>
    {drawer}
    </>
  );
}

