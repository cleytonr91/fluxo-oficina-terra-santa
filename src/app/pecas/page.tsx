"use client";

import { useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { subscribePartOrders, updatePartOrder } from "@/services/firestore";
import type { PartOrder, PartOrderStatus } from "@/types/domain";

type PartOrderFormFields = {
  partReference: string;
  partDescription: string;
  orderStatus: PartOrderStatus;
  expectedArrivalDate: string;
};

const statusLabels: Record<PartOrderStatus, string> = {
  necessidade_identificada: "Necessidade identificada",
  aguardando_pecas: "Aguardando peças",
  pedido_realizado: "Pedido realizado",
  em_transito: "Em trânsito",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

function formatDate(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function statusTone(status: PartOrderStatus) {
  if (status === "recebido") return "good";
  if (status === "cancelado") return "bad";
  if (status === "em_transito" || status === "pedido_realizado") return "warn";
  return "";
}

export default function PecasPage() {
  const { profile, user } = useAuth();
  const [orders, setOrders] = useState<PartOrder[]>([]);
  const [orderForms, setOrderForms] = useState<Record<string, Partial<PartOrderFormFields>>>({});
  const [savingId, setSavingId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | PartOrderStatus>("todos");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = subscribePartOrders((items) => {
      setOrders(items);
      setError("");
    }, (currentError) => {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar pedidos de peças.");
    });

    return unsubscribe;
  }, []);

  const filteredOrders = useMemo(() => (
    statusFilter === "todos" ? orders : orders.filter((order) => order.orderStatus === statusFilter)
  ), [orders, statusFilter]);

  const metrics = [
    { label: "pedidos", value: orders.length },
    { label: "aguardando peças", value: orders.filter((order) => order.orderStatus === "aguardando_pecas").length },
    { label: "em trânsito", value: orders.filter((order) => order.orderStatus === "em_transito").length },
    { label: "recebidos", value: orders.filter((order) => order.orderStatus === "recebido").length },
  ];

  function orderFormValues(order: PartOrder): PartOrderFormFields {
    return {
      partReference: order.partReference ?? "",
      partDescription: order.partDescription ?? "",
      orderStatus: order.orderStatus,
      expectedArrivalDate: order.expectedArrivalDate ?? "",
      ...orderForms[order.id],
    };
  }

  function updateOrderForm(orderId: string, patch: Partial<PartOrderFormFields>) {
    setOrderForms((current) => ({
      ...current,
      [orderId]: {
        ...current[orderId],
        ...patch,
      },
    }));
  }

  async function saveOrder(order: PartOrder) {
    const form = orderFormValues(order);

    setSavingId(order.id);
    setError("");

    try {
      await updatePartOrder({
        orderId: order.id,
        partReference: form.partReference,
        partDescription: form.partDescription,
        orderStatus: form.orderStatus,
        expectedArrivalDate: form.expectedArrivalDate,
        updatedBy: profile?.name ?? user?.email ?? user?.uid,
      });

      setOrders((current) => current.map((item) => (
        item.id === order.id
          ? {
              ...item,
              partReference: form.partReference.trim().toUpperCase(),
              partDescription: form.partDescription.trim(),
              orderStatus: form.orderStatus,
              expectedArrivalDate: form.expectedArrivalDate,
              updatedBy: profile?.name ?? user?.email ?? user?.uid,
            }
          : item
      )));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o pedido.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <ProtectedPage title="Pedidos de Peças" subtitle="Acompanhamento dos pedidos originados nos chips do fluxo.">
      <main className="page-wrap parts-page">
        <section className="flow-metrics">
          {metrics.map((metric) => (
            <div key={metric.label} className="flow-metric active">
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}

          <label className="flow-filter">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="todos">Todos</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </section>

        {error && <div className="duplicate-alert"><strong>Erro em peças</strong><span>{error}</span></div>}

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Acompanhamento dos pedidos</h2>
            <span className="panel-subtitle">{filteredOrders.length} pedido(s) no filtro atual.</span>
          </div>

          <div className="parts-list">
            {filteredOrders.length ? filteredOrders.map((order) => {
              const form = orderFormValues(order);

              return (
              <article key={order.id} className="parts-card">
                <div className="parts-card-main">
                  <div>
                    <strong>{order.clientName ?? "Cliente sem nome"}</strong>
                    <span>{order.plate ?? "Sem placa"} · ID Cliente: {order.customerId || "-"}</span>
                  </div>
                  <span className={`tag ${statusTone(order.orderStatus)}`}>{statusLabels[order.orderStatus]}</span>
                </div>

                <div className="parts-edit-grid">
                  <label className="field">
                    <span>Referência da Peça</span>
                    <input
                      value={form.partReference}
                      onChange={(event) => updateOrderForm(order.id, { partReference: event.target.value.toUpperCase() })}
                    />
                  </label>
                  <label className="field">
                    <span>Status do Pedido</span>
                    <select
                      value={form.orderStatus}
                      onChange={(event) => updateOrderForm(order.id, { orderStatus: event.target.value as PartOrderStatus })}
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Previsão de Chegada</span>
                    <input
                      type="date"
                      value={form.expectedArrivalDate}
                      onChange={(event) => updateOrderForm(order.id, { expectedArrivalDate: event.target.value })}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Descrição da Peça</span>
                  <textarea
                    value={form.partDescription}
                    onChange={(event) => updateOrderForm(order.id, { partDescription: event.target.value })}
                  />
                </label>

                <div className="detail-grid">
                  <div className="detail"><span>Previsão atual</span>{formatDate(order.expectedArrivalDate)}</div>
                  <div className="detail"><span>Consultor</span>{order.consultantName || "-"}</div>
                  <div className="detail"><span>Técnico</span>{order.technicianName || "-"}</div>
                  <div className="detail"><span>Atualizado por</span>{order.updatedBy || order.requestedBy || "-"}</div>
                </div>

                <button
                  className="ghost-btn"
                  type="button"
                  disabled={savingId === order.id}
                  onClick={() => saveOrder(order)}
                >
                  {savingId === order.id ? "Salvando..." : "Salvar andamento"}
                </button>
              </article>
            );
            }) : (
              <p className="empty">Nenhum pedido de peças encontrado.</p>
            )}
          </div>
        </section>
      </main>
    </ProtectedPage>
  );
}
