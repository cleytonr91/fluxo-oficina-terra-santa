"use client";

import { useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { subscribeActiveVehicleFlows, subscribePartOrders, updatePartOrder } from "@/services/firestore";
import type { PartOrder, PartOrderItem, PartOrderSource, PartOrderStatus, VehicleFlow } from "@/types/domain";

type PartOrderFormFields = {
  parts: PartOrderItem[];
  orderStatus: PartOrderStatus;
  orderSource: PartOrderSource | "";
  orderNumber: string;
  invoiceNumber: string;
  expectedArrivalDate: string;
};

const statusLabels: Record<PartOrderStatus, string> = {
  solicitado_oficina: "Solicitado oficina",
  necessidade_identificada: "Solicitado oficina",
  aguardando_pecas: "Solicitado oficina",
  pedido_realizado: "Pedido realizado",
  em_transito: "Em trânsito",
  recebido: "Recebido",
  disponivel: "Disponível",
  cancelado: "Cancelado",
};

const statusOptions: Array<{ value: PartOrderStatus; label: string }> = [
  { value: "solicitado_oficina", label: "Solicitado oficina" },
  { value: "pedido_realizado", label: "Pedido realizado" },
  { value: "em_transito", label: "Em trânsito" },
  { value: "recebido", label: "Recebido" },
  { value: "disponivel", label: "Disponível" },
  { value: "cancelado", label: "Cancelado" },
];

const sourceOptions: Array<{ value: PartOrderSource; label: string }> = [
  { value: "mobis", label: "Mobis" },
  { value: "natal", label: "Natal" },
  { value: "mossoro", label: "Mossoró" },
  { value: "juazeiro", label: "Juazeiro" },
  { value: "rede_autorizada", label: "Rede Autorizada" },
];

function formatDate(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function statusTone(status: PartOrderStatus) {
  if (status === "disponivel" || status === "recebido") return "good";
  if (status === "cancelado") return "bad";
  if (status === "em_transito" || status === "pedido_realizado") return "warn";
  return "";
}

function sourceLabel(value?: PartOrderSource) {
  return sourceOptions.find((option) => option.value === value)?.label ?? "-";
}

function orderParts(order: PartOrder) {
  if (order.parts?.length) return order.parts;
  return [{ id: "peca-1", partReference: order.partReference ?? "", partDescription: order.partDescription ?? "" }];
}

export default function PecasPage() {
  const { profile, user } = useAuth();
  const [orders, setOrders] = useState<PartOrder[]>([]);
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
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

  useEffect(() => {
    const unsubscribe = subscribeActiveVehicleFlows((items) => {
      setVehicles(items);
    }, () => undefined, { includeDelivered: true });

    return unsubscribe;
  }, []);

  const mergedOrders = useMemo(() => {
    const orderByVehicle = new Map(orders.map((order) => [order.vehicleFlowId, order]));
    const syntheticOrders = vehicles
      .filter((vehicle) => vehicle.partsOrdered && !orderByVehicle.has(vehicle.id))
      .map((vehicle): PartOrder => ({
        id: vehicle.id,
        vehicleFlowId: vehicle.id,
        plate: vehicle.plate,
        customerId: vehicle.chassi,
        clientName: vehicle.clientName,
        consultantName: vehicle.consultantName,
        technicianName: vehicle.technicianName,
        parts: [{ id: "peca-1", partReference: "", partDescription: vehicle.partsNote ?? "" }],
        orderStatus: "solicitado_oficina",
        vehicleImmobilized: false,
        createdAt: vehicle.createdAt,
        updatedAt: vehicle.updatedAt,
      }));

    return [...orders, ...syntheticOrders];
  }, [orders, vehicles]);

  const filteredOrders = useMemo(() => (
    statusFilter === "todos" ? mergedOrders : mergedOrders.filter((order) => order.orderStatus === statusFilter)
  ), [mergedOrders, statusFilter]);

  const availableOrders = useMemo(() => (
    mergedOrders.filter((order) => order.orderStatus === "disponivel")
  ), [mergedOrders]);

  const availableImmobilized = availableOrders.filter((order) => order.vehicleImmobilized);
  const availableScheduling = availableOrders.filter((order) => !order.vehicleImmobilized);

  const metrics = [
    { label: "pedidos", value: mergedOrders.length },
    { label: "solicitado oficina", value: mergedOrders.filter((order) => order.orderStatus === "solicitado_oficina" || order.orderStatus === "necessidade_identificada" || order.orderStatus === "aguardando_pecas").length },
    { label: "pedido realizado", value: mergedOrders.filter((order) => order.orderStatus === "pedido_realizado").length },
    { label: "em trânsito", value: mergedOrders.filter((order) => order.orderStatus === "em_transito").length },
    { label: "disponíveis", value: availableOrders.length },
  ];

  function orderFormValues(order: PartOrder): PartOrderFormFields {
    return {
      parts: orderParts(order),
      orderStatus: order.orderStatus === "necessidade_identificada" || order.orderStatus === "aguardando_pecas"
        ? "solicitado_oficina"
        : order.orderStatus,
      orderSource: order.orderSource ?? "",
      orderNumber: order.orderNumber ?? "",
      invoiceNumber: order.invoiceNumber ?? "",
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
    const validParts = form.parts.filter((part) => part.partReference?.trim() || part.partDescription?.trim());

    if (form.orderStatus === "pedido_realizado" && (!form.orderSource || !form.orderNumber.trim())) {
      setError("Para marcar Pedido Realizado, informe a origem e o número do pedido.");
      return;
    }

    if (form.orderStatus === "em_transito" && (!form.invoiceNumber.trim() || !form.expectedArrivalDate)) {
      setError("Para marcar Em trânsito, informe a nota fiscal e confirme a previsão de chegada.");
      return;
    }

    setSavingId(order.id);
    setError("");

    try {
      await updatePartOrder({
        orderId: order.id,
        vehicleFlowId: order.vehicleFlowId,
        plate: order.plate,
        customerId: order.customerId,
        clientName: order.clientName,
        consultantName: order.consultantName,
        technicianName: order.technicianName,
        parts: validParts,
        orderStatus: form.orderStatus,
        orderSource: form.orderSource || undefined,
        orderNumber: form.orderNumber,
        invoiceNumber: form.invoiceNumber,
        expectedArrivalDate: form.expectedArrivalDate,
        updatedBy: profile?.name ?? user?.email ?? user?.uid,
      });

      setOrders((current) => current.map((item) => (
        item.id === order.id
          ? {
              ...item,
              parts: validParts.map((part, index) => ({
                id: part.id || `peca-${index + 1}`,
                partReference: part.partReference?.trim().toUpperCase(),
                partDescription: part.partDescription?.trim(),
              })),
              partReference: validParts[0]?.partReference?.trim().toUpperCase(),
              partDescription: validParts[0]?.partDescription?.trim(),
              orderStatus: form.orderStatus,
              orderSource: form.orderSource || undefined,
              orderNumber: form.orderNumber,
              invoiceNumber: form.invoiceNumber,
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

  function updatePartItem(order: PartOrder, partId: string, patch: Partial<PartOrderItem>) {
    const form = orderFormValues(order);
    updateOrderForm(order.id, {
      parts: form.parts.map((part) => (
        part.id === partId ? { ...part, ...patch } : part
      )),
    });
  }

  function addPartItem(order: PartOrder) {
    const form = orderFormValues(order);
    updateOrderForm(order.id, {
      parts: [...form.parts, { id: `peca-${Date.now()}`, partReference: "", partDescription: "" }],
    });
  }

  function removePartItem(order: PartOrder, partId: string) {
    const form = orderFormValues(order);
    if (form.parts.length <= 1) return;
    updateOrderForm(order.id, {
      parts: form.parts.filter((part) => part.id !== partId),
    });
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
              {statusOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </section>

        {error && <div className="duplicate-alert"><strong>Erro em peças</strong><span>{error}</span></div>}

        {availableOrders.length > 0 && (
          <section className="panel parts-available-panel">
            <div className="panel-head">
              <h2 className="panel-title">Peças disponíveis para ação</h2>
              <span className="panel-subtitle">{availableOrders.length} pedido(s) disponível(is).</span>
            </div>

            <div className="available-split">
              <div className="available-box urgent">
                <h3>Veículos imobilizados</h3>
                {availableImmobilized.length ? availableImmobilized.map((order) => (
                  <div key={order.id} className="available-row">
                    <strong>{order.plate ?? "Sem placa"}</strong>
                    <span>{order.clientName ?? "Cliente sem nome"}</span>
                    <small>Chefe de oficina deve programar execução.</small>
                  </div>
                )) : <p className="empty">Nenhum imobilizado disponível.</p>}
              </div>

              <div className="available-box">
                <h3>Agendamento / retorno</h3>
                {availableScheduling.length ? availableScheduling.map((order) => (
                  <div key={order.id} className="available-row">
                    <strong>{order.plate ?? "Sem placa"}</strong>
                    <span>{order.clientName ?? "Cliente sem nome"}</span>
                    <small>Agendamento deve dar sequência ao atendimento.</small>
                  </div>
                )) : <p className="empty">Nenhum retorno pendente.</p>}
              </div>
            </div>
          </section>
        )}

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
                {order.vehicleImmobilized && (
                  <span className="tag bad">Veículo imobilizado</span>
                )}

                <div className="parts-edit-grid">
                  <label className="field">
                    <span>Status do Pedido</span>
                    <select
                      value={form.orderStatus}
                      onChange={(event) => updateOrderForm(order.id, { orderStatus: event.target.value as PartOrderStatus })}
                    >
                      {statusOptions.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Origem</span>
                    <select
                      value={form.orderSource}
                      onChange={(event) => updateOrderForm(order.id, { orderSource: event.target.value as PartOrderSource | "" })}
                    >
                      <option value="">Selecionar origem</option>
                      {sourceOptions.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Número do Pedido</span>
                    <input
                      value={form.orderNumber}
                      placeholder="Mobis ou externo"
                      onChange={(event) => updateOrderForm(order.id, { orderNumber: event.target.value.toUpperCase() })}
                    />
                  </label>
                  <label className="field">
                    <span>Nota Fiscal</span>
                    <input
                      value={form.invoiceNumber}
                      onChange={(event) => updateOrderForm(order.id, { invoiceNumber: event.target.value.toUpperCase() })}
                    />
                  </label>
                  <label className="field">
                    <span>Previsão de chegada</span>
                    <input
                      type="date"
                      value={form.expectedArrivalDate}
                      onChange={(event) => updateOrderForm(order.id, { expectedArrivalDate: event.target.value })}
                    />
                  </label>
                </div>

                <div className="parts-items">
                  {form.parts.map((part, index) => (
                    <div key={part.id} className="part-item-row">
                      <label className="field">
                        <span>Referência da Peça {index + 1}</span>
                        <input
                          value={part.partReference ?? ""}
                          onChange={(event) => updatePartItem(order, part.id, { partReference: event.target.value.toUpperCase() })}
                        />
                      </label>
                      <label className="field">
                        <span>Descrição da Peça {index + 1}</span>
                        <input
                          value={part.partDescription ?? ""}
                          onChange={(event) => updatePartItem(order, part.id, { partDescription: event.target.value })}
                        />
                      </label>
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={form.parts.length <= 1}
                        onClick={() => removePartItem(order, part.id)}
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>

                <button className="ghost-btn" type="button" onClick={() => addPartItem(order)}>
                  + Adicionar peça
                </button>

                <div className="detail-grid">
                  <div className="detail"><span>Origem</span>{sourceLabel(order.orderSource)}</div>
                  <div className="detail"><span>Pedido</span>{order.orderNumber || "-"}</div>
                  <div className="detail"><span>Nota fiscal</span>{order.invoiceNumber || "-"}</div>
                  <div className="detail"><span>Previsão atual</span>{formatDate(order.expectedArrivalDate)}</div>
                  <div className="detail"><span>Consultor</span>{order.consultantName || "-"}</div>
                  <div className="detail"><span>Técnico</span>{order.technicianName || "-"}</div>
                  <div className="detail"><span>Imobilizado</span>{order.vehicleImmobilized ? "Sim" : "Não"}</div>
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
