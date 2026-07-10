"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { listActiveVehicleFlows, listRecentFlowEvents } from "@/services/firestore";
import type { FlowEvent, VehicleFlow } from "@/types/domain";

const laneNames: Record<string, string> = {
  preparacao_confirmada: "Preparação Confirmada",
  aguardando_servico: "Aguardando Serviço",
  em_servico: "Em Serviço",
  orcamento_complementar: "Orçamento Complementar",
  aguardando_lavagem: "Aguardando Lavagem",
  lavagem: "Lavagem",
  preparacao_entrega: "Preparação de Entrega",
  entregue: "Entregue",
};

function normalize(value?: string) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatDateTime(value: unknown) {
  if (!value) return "-";
  const maybeTimestamp = value as { toDate?: () => Date };
  const date = typeof maybeTimestamp.toDate === "function"
    ? maybeTimestamp.toDate()
    : new Date(String(value));

  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default function AuditPage() {
  const { profile } = useAuth();
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [queryText, setQueryText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const canView = profile?.role === "admin" || profile?.role === "gerente" || profile?.role === "chefe_oficina";

  useEffect(() => {
    let active = true;

    async function loadAudit() {
      setLoading(true);
      setError("");

      try {
        const [vehicleData, eventData] = await Promise.all([
          listActiveVehicleFlows({ includeDelivered: true }),
          listRecentFlowEvents(250),
        ]);

        if (!active) return;
        setVehicles(vehicleData);
        setEvents(eventData);
      } catch (currentError) {
        if (!active) return;
        setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar a auditoria.");
      } finally {
        if (active) setLoading(false);
      }
    }

    if (canView) {
      loadAudit();
    }

    return () => {
      active = false;
    };
  }, [canView]);

  const vehiclesById = useMemo(() => {
    const map = new Map<string, VehicleFlow>();
    vehicles.forEach((vehicle) => map.set(vehicle.id, vehicle));
    return map;
  }, [vehicles]);

  const filteredEvents = useMemo(() => {
    const search = normalize(queryText);

    return events.filter((event) => {
      const vehicle = vehiclesById.get(event.vehicleFlowId);
      if (!search) return true;

      return [
        event.vehicleFlowId,
        event.actionBy,
        event.actionNote,
        vehicle?.clientName,
        vehicle?.plate,
        vehicle?.chassi,
        vehicle?.consultantName,
        vehicle?.technicianName,
      ].some((value) => normalize(value).includes(search));
    });
  }, [events, queryText, vehiclesById]);

  return (
    <ProtectedPage title="Auditoria do Fluxo" subtitle="Histórico de movimentações dos chips.">
      <main className="page-wrap">
        {!canView && (
          <div className="duplicate-alert">
            <strong>Acesso restrito</strong>
            <span>Apenas administração, gerência e chefe de oficina podem visualizar a auditoria.</span>
          </div>
        )}

        {canView && (
          <>
            {error && <div className="duplicate-alert"><strong>Erro</strong><span>{error}</span></div>}

            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Movimentações recentes</h2>
                <Link className="ghost-btn" href="/fluxo">Voltar ao fluxo</Link>
              </div>
              <div className="panel-body stack">
                <label className="field">
                  <span>Buscar por cliente, placa, chassi, usuário ou observação</span>
                  <input
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    placeholder="Ex.: RRB3F57"
                  />
                </label>

                {loading ? (
                  <p className="empty">Carregando auditoria...</p>
                ) : filteredEvents.length ? (
                  <div className="audit-list">
                    {filteredEvents.map((event) => {
                      const vehicle = vehiclesById.get(event.vehicleFlowId);

                      return (
                        <article key={event.id} className="audit-row">
                          <div>
                            <strong>{vehicle?.clientName ?? "Veículo não encontrado"}</strong>
                            <span>{vehicle?.plate ?? "-"} · {vehicle?.model ?? "-"} · {vehicle?.consultantName ?? "sem consultor"}</span>
                          </div>
                          <div>
                            <strong>{laneNames[event.fromLane ?? ""] ?? "Início"} → {laneNames[event.toLane] ?? event.toLane}</strong>
                            <span>{event.actionNote ?? "Sem observação"}</span>
                          </div>
                          <div>
                            <strong>{event.actionBy ?? "Usuário não identificado"}</strong>
                            <span>{formatDateTime(event.createdAt)}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="empty">Nenhuma movimentação encontrada para esse filtro.</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </ProtectedPage>
  );
}
