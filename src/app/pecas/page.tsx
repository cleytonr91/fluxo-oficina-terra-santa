"use client";

import { useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { subscribeActiveVehicleFlows, subscribePartOrders, updatePartOrder } from "@/services/firestore";
import type { PartOrder, PartOrderItem, PartOrderKind, PartOrderSource, PartOrderStatus, VehicleFlow } from "@/types/domain";

type PartOrderFormFields = {
  customerId: string;
  orderKind: PartOrderKind | "";
  parts: PartOrderItem[];
  orderStatus: PartOrderStatus;
  orderSource: PartOrderSource | "";
  orderNumber: string;
  orderDate: string;
  invoiceNumber: string;
  expectedArrivalDate: string;
  cancellationReason: string;
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

const kindOptions: Array<{ value: PartOrderKind; label: string }> = [
  { value: "garantia", label: "Garantia" },
  { value: "externo", label: "Externo" },
];

type PartsFilter = "pendentes" | "todos" | PartOrderStatus;
type PartEditSection = "dados" | "pedido" | "pecas" | "cancelamento" | "info";

function formatDate(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate() as Date;
  }
  return null;
}

function formatDateTime(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function kindLabel(value?: PartOrderKind) {
  return kindOptions.find((option) => option.value === value)?.label ?? "-";
}

function whatsappUrl(phone?: string) {
  const digits = phone?.replace(/\D/g, "");
  if (!digits || digits.length < 10) return "";
  return `https://wa.me/55${digits.length > 11 ? digits.slice(-11) : digits}`;
}

function orderParts(order: PartOrder) {
  if (order.parts?.length) return order.parts;
  return [{ id: "peca-1", partReference: order.partReference ?? "", partDescription: order.partDescription ?? "" }];
}

export default function PecasPage() {
  const { profile, user } = useAuth();
  const initialFocusedOrderId = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("pedido") ?? "";
  const [orders, setOrders] = useState<PartOrder[]>([]);
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [orderForms, setOrderForms] = useState<Record<string, Partial<PartOrderFormFields>>>({});
  const [openSections, setOpenSections] = useState<Record<string, PartEditSection | undefined>>({});
  const [savingId, setSavingId] = useState("");
  const [statusFilter, setStatusFilter] = useState<PartsFilter>(initialFocusedOrderId ? "todos" : "pendentes");
  const [focusedOrderId, setFocusedOrderId] = useState(initialFocusedOrderId);
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
        customerId: "",
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

  const vehiclesById = useMemo(() => {
    const mapped = new Map<string, VehicleFlow>();
    vehicles.forEach((vehicle) => mapped.set(vehicle.id, vehicle));
    return mapped;
  }, [vehicles]);

  function customerNameContent(order: PartOrder) {
    const name = order.clientName ?? "Cliente sem nome";
    const url = whatsappUrl(vehiclesById.get(order.vehicleFlowId)?.phone);

    if (!url) return <strong>{name}</strong>;

    return (
      <a className="client-link" href={url} target="_blank" rel="noreferrer">
        <strong>{name}</strong>
      </a>
    );
  }

  const availableOrders = useMemo(() => (
    mergedOrders.filter((order) => order.orderStatus === "disponivel")
  ), [mergedOrders]);

  const canceledOrders = useMemo(() => (
    mergedOrders.filter((order) => order.orderStatus === "cancelado")
  ), [mergedOrders]);

  const pendingOrders = useMemo(() => (
    mergedOrders.filter((order) => order.orderStatus !== "disponivel" && order.orderStatus !== "cancelado")
  ), [mergedOrders]);

  const filteredOrders = useMemo(() => {
    if (focusedOrderId) return mergedOrders.filter((order) => order.vehicleFlowId === focusedOrderId || order.id === focusedOrderId);
    if (statusFilter === "todos") return mergedOrders;
    if (statusFilter === "pendentes") return pendingOrders;
    if (statusFilter === "solicitado_oficina") {
      return mergedOrders.filter((order) => order.orderStatus === "solicitado_oficina" || order.orderStatus === "necessidade_identificada" || order.orderStatus === "aguardando_pecas");
    }
    return mergedOrders.filter((order) => order.orderStatus === statusFilter);
  }, [focusedOrderId, mergedOrders, pendingOrders, statusFilter]);

  const availableImmobilized = availableOrders.filter((order) => order.vehicleImmobilized);
  const availableScheduling = availableOrders.filter((order) => !order.vehicleImmobilized);

  const metrics = [
    { label: "pendências", value: pendingOrders.length, filter: "pendentes" as PartsFilter, state: "active" },
    { label: "solicitado oficina", value: mergedOrders.filter((order) => order.orderStatus === "solicitado_oficina" || order.orderStatus === "necessidade_identificada" || order.orderStatus === "aguardando_pecas").length, filter: "solicitado_oficina" as PartsFilter, state: "" },
    { label: "pedido realizado", value: mergedOrders.filter((order) => order.orderStatus === "pedido_realizado").length, filter: "pedido_realizado" as PartsFilter, state: "" },
    { label: "em trânsito", value: mergedOrders.filter((order) => order.orderStatus === "em_transito").length, filter: "em_transito" as PartsFilter, state: "" },
    { label: "disponíveis", value: availableOrders.length, filter: "disponivel" as PartsFilter, state: "" },
    { label: "cancelados", value: canceledOrders.length, filter: "cancelado" as PartsFilter, state: "danger" },
  ];

  function orderFormValues(order: PartOrder): PartOrderFormFields {
    return {
      customerId: order.customerId ?? "",
      orderKind: order.orderKind ?? "",
      parts: orderParts(order),
      orderStatus: order.orderStatus === "necessidade_identificada" || order.orderStatus === "aguardando_pecas"
        ? "solicitado_oficina"
        : order.orderStatus,
      orderSource: order.orderSource ?? "",
      orderNumber: order.orderNumber ?? "",
      orderDate: order.orderDate ?? "",
      invoiceNumber: order.invoiceNumber ?? "",
      expectedArrivalDate: order.expectedArrivalDate ?? "",
      cancellationReason: order.cancellationReason ?? "",
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

    if (form.orderStatus === "cancelado" && !form.cancellationReason.trim()) {
      setError("Para cancelar um pedido, informe o motivo do cancelamento.");
      return;
    }

    setSavingId(order.id);
    setError("");

    try {
      await updatePartOrder({
        orderId: order.id,
        vehicleFlowId: order.vehicleFlowId,
        plate: order.plate,
        customerId: form.customerId,
        clientName: order.clientName,
        consultantName: order.consultantName,
        technicianName: order.technicianName,
        orderKind: form.orderKind || undefined,
        parts: validParts,
        orderStatus: form.orderStatus,
        orderSource: form.orderSource || undefined,
        orderNumber: form.orderNumber,
        orderDate: form.orderDate,
        invoiceNumber: form.invoiceNumber,
        expectedArrivalDate: form.expectedArrivalDate,
        cancellationReason: form.cancellationReason,
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
              customerId: form.customerId,
              orderKind: form.orderKind || undefined,
              orderStatus: form.orderStatus,
              orderSource: form.orderSource || undefined,
              orderNumber: form.orderNumber,
              orderDate: form.orderDate,
              invoiceNumber: form.invoiceNumber,
              expectedArrivalDate: form.expectedArrivalDate,
              cancellationReason: form.cancellationReason,
              updatedBy: profile?.name ?? user?.email ?? user?.uid,
              updatedAt: new Date().toISOString(),
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

  function toggleSection(orderId: string, section: PartEditSection) {
    setOpenSections((current) => ({
      ...current,
      [orderId]: current[orderId] === section ? undefined : section,
    }));
  }

  return (
    <ProtectedPage title="Pedidos de Peças" subtitle="Acompanhamento dos pedidos originados nos chips do fluxo.">
      <main className="page-wrap parts-page">
        <section className="flow-metrics">
          {metrics.map((metric) => (
            <button
              key={metric.label}
              className={`flow-metric ${metric.state} ${statusFilter === metric.filter ? "selected" : ""}`}
              type="button"
              onClick={() => setStatusFilter(metric.filter)}
            >
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </button>
          ))}

          <label className="flow-filter">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="pendentes">Pendências</option>
              <option value="todos">Todos</option>
              {statusOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </section>

        {error && <div className="duplicate-alert"><strong>Erro em peças</strong><span>{error}</span></div>}

        {focusedOrderId && (
          <div className="duplicate-alert parts-focus-alert">
            <strong>Pedido de peças selecionado</strong>
            <span>Mostrando apenas o pedido vinculado ao chip imobilizado.</span>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                window.history.replaceState(null, "", "/pecas");
                setFocusedOrderId("");
                setStatusFilter("pendentes");
              }}
            >
              Ver pendências
            </button>
          </div>
        )}

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
                    {customerNameContent(order)}
                    <small>Chefe de oficina deve programar execução.</small>
                  </div>
                )) : <p className="empty">Nenhum imobilizado disponível.</p>}
              </div>

              <div className="available-box">
                <h3>Agendamento / retorno</h3>
                {availableScheduling.length ? availableScheduling.map((order) => (
                  <div key={order.id} className="available-row">
                    <strong>{order.plate ?? "Sem placa"}</strong>
                    {customerNameContent(order)}
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
              const openSection = openSections[order.id];

              return (
              <article key={order.id} className={`parts-card ${focusedOrderId && (order.vehicleFlowId === focusedOrderId || order.id === focusedOrderId) ? "focused" : ""}`}>
                <div className="parts-table-row">
                  <div className="parts-cell parts-client-cell">
                    <span>Cliente</span>
                    {customerNameContent(order)}
                    <small>{order.plate ?? "Sem placa"} · ID {order.customerId || "-"}</small>
                  </div>
                  <div className="parts-cell parts-line-cell">
                    <span>Pe&ccedil;as</span>
                    <div className="parts-line-list">
                      {orderParts(order).map((part, index) => (
                        <div key={part.id || `${order.id}-part-${index}`} className="parts-line-item">
                          <strong>{part.partReference || "-"}</strong>
                          <small>{part.partDescription || "Sem descricao"}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Tipo</span><strong>{kindLabel(order.orderKind)}</strong></div>
                    <div><span>Status</span><strong className={`tag ${statusTone(order.orderStatus)}`}>{statusLabels[order.orderStatus]}</strong></div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Origem</span><strong>{sourceLabel(order.orderSource)}</strong></div>
                    <div><span>Pedido</span><strong>{order.orderNumber || "-"}</strong></div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Data pedido</span><strong>{formatDate(order.orderDate)}</strong></div>
                    <div><span>NF</span><strong>{order.invoiceNumber || "-"}</strong></div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Previsão</span><strong>{formatDate(order.expectedArrivalDate)}</strong></div>
                    <div><span>Imobilizado</span><strong>{order.vehicleImmobilized ? "Sim" : "Não"}</strong></div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Consultor</span><strong>{order.consultantName || "-"}</strong></div>
                    <div><span>Técnico</span><strong>{order.technicianName || "-"}</strong></div>
                  </div>
                  <div className="parts-cell"><span>Atualizado</span><strong>{order.updatedBy || order.requestedBy || "-"}</strong><small>{formatDateTime(order.updatedAt)}</small></div>
                </div>

                {order.vehicleImmobilized && <span className="tag bad">Veículo imobilizado</span>}
                {order.cancellationReason && <p className="parts-note"><strong>Cancelamento:</strong> {order.cancellationReason}</p>}

                <div className="parts-actions-row">
                  <button type="button" className="ghost-btn" onClick={() => toggleSection(order.id, "dados")}>+ Dados</button>
                  <button type="button" className="ghost-btn" onClick={() => toggleSection(order.id, "pecas")}>+ Peças</button>
                  <button type="button" className="ghost-btn" onClick={() => toggleSection(order.id, "pedido")}>+ Pedido</button>
                  <button type="button" className="ghost-btn" onClick={() => toggleSection(order.id, "cancelamento")}>+ Cancelamento</button>
                  <button type="button" className="ghost-btn info-btn" onClick={() => toggleSection(order.id, "info")}>i Info</button>
                </div>

                {openSection === "info" && (
                  <div className="parts-audit-box">
                    <div><span>Solicitado por</span><strong>{order.requestedBy || "-"}</strong><small>{formatDateTime(order.createdAt)}</small></div>
                    <div><span>Atualizado por</span><strong>{order.updatedBy || order.requestedBy || "-"}</strong><small>{formatDateTime(order.updatedAt)}</small></div>
                    <div><span>Status atual</span><strong>{statusLabels[order.orderStatus]}</strong></div>
                    <div><span>Pedido</span><strong>{order.orderNumber || "-"}</strong><small>{sourceLabel(order.orderSource)}</small></div>
                    <div><span>Nota / previsao</span><strong>{order.invoiceNumber || "-"}</strong><small>{formatDate(order.expectedArrivalDate)}</small></div>
                    <div><span>Cancelamento</span><strong>{order.cancellationReason || "-"}</strong></div>
                  </div>
                )}

                {openSection === "dados" && (
                  <div className="parts-edit-grid compact">
                    <label className="field">
                      <span>ID Cliente</span>
                      <input
                        value={form.customerId}
                        placeholder="Informar ID"
                        onChange={(event) => updateOrderForm(order.id, { customerId: event.target.value.toUpperCase() })}
                      />
                    </label>
                    <label className="field">
                      <span>Tipo</span>
                      <select
                        value={form.orderKind}
                        onChange={(event) => updateOrderForm(order.id, { orderKind: event.target.value as PartOrderKind | "" })}
                      >
                        <option value="">Selecionar</option>
                        {kindOptions.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {openSection === "pedido" && (
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
                      <span>Data do Pedido</span>
                      <input
                        type="date"
                        value={form.orderDate}
                        onChange={(event) => updateOrderForm(order.id, { orderDate: event.target.value })}
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
                )}

                {(openSection === "cancelamento" || form.orderStatus === "cancelado") && (
                  <label className="field">
                    <span>Motivo do cancelamento</span>
                    <textarea
                      required={form.orderStatus === "cancelado"}
                      value={form.cancellationReason}
                      placeholder="Informe por que este pedido foi cancelado"
                      onChange={(event) => updateOrderForm(order.id, { cancellationReason: event.target.value })}
                    />
                  </label>
                )}

                {openSection === "pecas" && (
                  <>
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
                              onChange={(event) => updatePartItem(order, part.id, { partDescription: event.target.value.toUpperCase() })}
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
                  </>
                )}

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
