"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { markPartSchedulingCompleted, registerPartSchedulingAction, subscribePartOrdersByStatuses, subscribeVehicleFlowsByIdentifiers, subscribeVehicleFlowsByIds } from "@/services/firestore";
import type { PartOrder, PartOrderItem, PartOrderStatus, PartSchedulingActionType, PartSchedulingStatus, VehicleFlow } from "@/types/domain";

type ScheduleForm = {
  action: PartSchedulingActionType;
  returnDate: string;
  contactAttemptAt: string;
  nextContactAt: string;
  note: string;
};

type SchedulingFilter = "available" | "overdue" | "completed" | PartSchedulingActionType;

const actionLabels: Record<PartSchedulingActionType, string> = {
  agendamento_confirmado: "Agendamento confirmado",
  contato_sem_sucesso: "Contato sem sucesso",
  cliente_sem_disponibilidade: "Cliente sem disponibilidade",
};

const schedulingStatusLabels: Record<PartSchedulingStatus, string> = {
  disponivel_agendamento: "Disponível para agendar",
  agendamento_confirmado: "Agendamento confirmado",
  contato_sem_sucesso: "Contato sem sucesso",
  cliente_sem_disponibilidade: "Cliente sem disponibilidade",
};

const orderStatusLabels: Record<PartOrderStatus, string> = {
  solicitado_oficina: "Solicitado oficina",
  necessidade_identificada: "Solicitado oficina",
  aguardando_pecas: "Solicitado oficina",
  pedido_realizado: "Pedido realizado",
  back_order: "B.O",
  em_transito: "Em trânsito",
  recebido: "Recebido",
  disponivel: "Disponível",
  cancelado: "Cancelado",
};


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

function toDateTimeLocal(value: unknown) {
  const date = toDate(value) ?? new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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

function formatActionSignature(actionBy: string | undefined, value: unknown, fallback = "Operador") {
  const operator = actionBy || fallback;
  const date = toDate(value);
  if (!date) return operator;
  if (date.getHours() >= 18) return operator;
  return `${operator} · ${formatDateTime(value)}`;
}

function formatOperationalDateTime(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  if (date.getHours() >= 18) return "Fora do expediente";
  return formatDateTime(value);
}

function elapsedDaysSince(value: unknown) {
  const startedAt = toDate(value);
  if (!startedAt) return null;

  const start = new Date(startedAt.getFullYear(), startedAt.getMonth(), startedAt.getDate()).getTime();
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.max(0, Math.floor((current - start) / 86400000));
}

function elapsedDaysBetween(startValue: unknown, endValue: unknown) {
  const startedAt = toDate(startValue);
  const endedAt = toDate(endValue);
  if (!startedAt || !endedAt) return null;

  const start = new Date(startedAt.getFullYear(), startedAt.getMonth(), startedAt.getDate()).getTime();
  const end = new Date(endedAt.getFullYear(), endedAt.getMonth(), endedAt.getDate()).getTime();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function normalizeSearch(value?: string) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function orderParts(order: PartOrder): PartOrderItem[] {
  if (order.parts?.length) return order.parts;
  return [{ id: "peca-1", partReference: order.partReference ?? "", partDescription: order.partDescription ?? "" }];
}

function whatsappUrl(phone?: string) {
  const digits = phone?.replace(/\D/g, "");
  if (!digits || digits.length < 10) return "";
  return `https://wa.me/55${digits.length > 11 ? digits.slice(-11) : digits}`;
}

function isDue(value?: string) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
}

function isAvailableSchedulingStatus(status?: PartSchedulingStatus) {
  return !status || status === "disponivel_agendamento";
}

function isOverdueContact(order: PartOrder) {
  const hasConfirmedAppointment =
    order.schedulingStatus === "agendamento_confirmado" &&
    Boolean(order.scheduledReturnDate);

  return (
    !order.schedulingCompletedAt &&
    Boolean(order.nextContactAt) &&
    isDue(order.nextContactAt) &&
    !hasConfirmedAppointment
  );
}

function normalizeIdentifier(value?: string) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

export default function AgendamentoPage() {
  const { profile, user } = useAuth();
  const [orders, setOrders] = useState<PartOrder[]>([]);
  const [orderVehicles, setOrderVehicles] = useState<VehicleFlow[]>([]);
  const [relatedVehicles, setRelatedVehicles] = useState<VehicleFlow[]>([]);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<SchedulingFilter>("available");
  const [activeOrder, setActiveOrder] = useState<PartOrder | null>(null);
  const [form, setForm] = useState<ScheduleForm>({
    action: "agendamento_confirmado",
    returnDate: "",
    contactAttemptAt: toDateTimeLocal(new Date()),
    nextContactAt: "",
    note: "",
  });
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = subscribePartOrdersByStatuses(["disponivel"], (items) => {
      setOrders(items);
      setError("");
    }, (currentError) => {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar os pedidos para agendamento.");
    });

    return unsubscribe;
  }, []);

  const orderVehicleIds = useMemo(
    () => Array.from(new Set(orders.map((order) => order.vehicleFlowId).filter(Boolean))).sort(),
    [orders],
  );
  const orderVehicleIdsKey = orderVehicleIds.join("|");

  useEffect(() => {
    return subscribeVehicleFlowsByIds(orderVehicleIds, setOrderVehicles, () => undefined);
  }, [orderVehicleIdsKey]);

  const relatedIdentifiers = useMemo(() => ({
    plates: Array.from(new Set([
      ...orders.map((order) => order.plate),
      ...orderVehicles.map((vehicle) => vehicle.plate),
    ].filter((value): value is string => Boolean(value)))).sort(),
    chassis: Array.from(new Set(orderVehicles
      .map((vehicle) => vehicle.chassi)
      .filter((value): value is string => Boolean(value)))).sort(),
  }), [orderVehicles, orders]);
  const relatedIdentifiersKey = `${relatedIdentifiers.plates.join("|")}::${relatedIdentifiers.chassis.join("|")}`;

  useEffect(() => {
    return subscribeVehicleFlowsByIdentifiers(
      relatedIdentifiers.plates,
      relatedIdentifiers.chassis,
      setRelatedVehicles,
      () => undefined,
    );
  }, [relatedIdentifiersKey]);

  const vehicles = useMemo(() => [...new Map([
    ...orderVehicles.map((vehicle) => [vehicle.id, vehicle] as const),
    ...relatedVehicles.map((vehicle) => [vehicle.id, vehicle] as const),
  ]).values()], [orderVehicles, relatedVehicles]);

  const vehiclesById = useMemo(() => {
    const mapped = new Map<string, VehicleFlow>();
    vehicles.forEach((vehicle) => mapped.set(vehicle.id, vehicle));
    return mapped;
  }, [vehicles]);

  const schedulableOrders = useMemo(() => (
    orders.filter((order) => (
      order.orderStatus === "disponivel"
      && !order.cancellationReason?.trim()
      && !vehiclesById.get(order.vehicleFlowId)?.vehicleImmobilized
    ))
  ), [orders, vehiclesById]);

  const newerPassageByOrder = useMemo(() => {
    const result = new Map<string, VehicleFlow>();

    orders.forEach((order) => {
      if (order.schedulingCompletedAt) return;
      const originalVehicle = vehiclesById.get(order.vehicleFlowId);
      const originalPlate = normalizeIdentifier(order.plate || originalVehicle?.plate);
      const originalChassi = normalizeIdentifier(originalVehicle?.chassi);
      const orderCreatedAt = toDate(order.createdAt)?.getTime() ?? 0;
      if (!orderCreatedAt || (!originalPlate && !originalChassi)) return;

      const newer = vehicles
        .filter((vehicle) => {
          if (vehicle.id === order.vehicleFlowId || vehicle.status === "cancelado") return false;
          const vehicleCreatedAt = toDate(vehicle.createdAt)?.getTime() ?? 0;
          if (!vehicleCreatedAt || vehicleCreatedAt <= orderCreatedAt) return false;
          const vehiclePlate = normalizeIdentifier(vehicle.plate);
          const vehicleChassi = normalizeIdentifier(vehicle.chassi);
          return Boolean(
            (originalPlate && vehiclePlate && originalPlate === vehiclePlate)
            || (originalChassi && vehicleChassi && originalChassi === vehicleChassi),
          );
        })
        .sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0))[0];

      if (newer) result.set(order.id, newer);
    });

    return result;
  }, [orders, vehicles, vehiclesById]);

  const completedOrders = useMemo(() => (
    schedulableOrders.filter((order) => Boolean(order.schedulingCompletedAt))
  ), [schedulableOrders]);

  useEffect(() => {
    if (!newerPassageByOrder.size) return undefined;
    let cancelled = false;
    const completedBy = profile?.name ?? user?.email ?? user?.uid;

    Promise.all(Array.from(newerPassageByOrder.entries()).map(([orderId, vehicle]) => (
      markPartSchedulingCompleted({
        orderId,
        completedBy,
        newVehicleFlowId: vehicle.id,
        newAppointmentDate: vehicle.appointmentDate,
      })
    ))).catch((currentError) => {
      if (!cancelled) setError(currentError instanceof Error ? currentError.message : "Não foi possível concluir os processos por nova passagem.");
    });

    return () => { cancelled = true; };
  }, [newerPassageByOrder, profile?.name, user?.email, user?.uid]);

  const availableOrders = useMemo(() => (
    [...schedulableOrders]
      .filter((order) => isAvailableSchedulingStatus(order.schedulingStatus) && !order.schedulingCompletedAt)
      .sort((a, b) => {
        const aCreatedAt = toDate(a.createdAt)?.getTime() ?? toDate(a.updatedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bCreatedAt = toDate(b.createdAt)?.getTime() ?? toDate(b.updatedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return aCreatedAt - bCreatedAt;
      })
  ), [schedulableOrders]);

  const availablePartsCount = useMemo(() => (
    schedulableOrders.filter((order) => !order.schedulingCompletedAt).length
  ), [schedulableOrders]);

  const pendingContact = useMemo(() => schedulableOrders.filter(isOverdueContact), [schedulableOrders]);
  const confirmed = useMemo(() => schedulableOrders.filter((order) => !order.schedulingCompletedAt && order.schedulingStatus === "agendamento_confirmado"), [schedulableOrders]);
  const unsuccessful = useMemo(() => schedulableOrders.filter((order) => !order.schedulingCompletedAt && order.schedulingStatus === "contato_sem_sucesso"), [schedulableOrders]);
  const unavailable = useMemo(() => schedulableOrders.filter((order) => !order.schedulingCompletedAt && order.schedulingStatus === "cliente_sem_disponibilidade"), [schedulableOrders]);

  const filteredOrders = useMemo(() => {
    const query = normalizeSearch(search);
    const sourceOrders = activeFilter === "available"
      ? availableOrders
      : activeFilter === "overdue"
        ? pendingContact
        : activeFilter === "completed"
          ? completedOrders
          : schedulableOrders.filter((order) => order.schedulingStatus === activeFilter && !order.schedulingCompletedAt);
    if (!query) return sourceOrders;

    return sourceOrders.filter((order) => {
      const vehicle = vehiclesById.get(order.vehicleFlowId);
      return [
        order.clientName,
        order.plate,
        order.customerId,
        vehicle?.chassi,
        vehicle?.phone,
        vehicle?.model,
        order.parts?.map((part) => `${part.partReference ?? ""} ${part.partDescription ?? ""}`).join(" "),
      ].some((value) => normalizeSearch(value).includes(query));
    });
  }, [activeFilter, availableOrders, completedOrders, pendingContact, schedulableOrders, search, vehiclesById]);

  const filterCards: Array<{ id: SchedulingFilter; count: number; label: string; className?: string }> = [
    { id: "available", count: availableOrders.length, label: "disponíveis para agendar", className: "active" },
    { id: "overdue", count: pendingContact.length, label: "compromissos vencidos", className: "danger" },
    { id: "agendamento_confirmado", count: confirmed.length, label: "agendados" },
    { id: "contato_sem_sucesso", count: unsuccessful.length, label: "contato sem sucesso" },
    { id: "cliente_sem_disponibilidade", count: unavailable.length, label: "sem disponibilidade" },
    { id: "completed", count: completedOrders.length, label: "concluídos", className: "good" },
  ];

  function openSchedule(order: PartOrder) {
    setActiveOrder(order);
    setForm({
      action: order.schedulingStatus === "contato_sem_sucesso" || order.schedulingStatus === "cliente_sem_disponibilidade"
        ? order.schedulingStatus
        : "agendamento_confirmado",
      returnDate: order.scheduledReturnDate ?? "",
      contactAttemptAt: order.contactAttemptAt ?? toDateTimeLocal(new Date()),
      nextContactAt: order.nextContactAt ?? "",
      note: order.schedulingNote ?? "",
    });
  }

  async function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrder) return;

    if (form.action === "agendamento_confirmado" && !form.returnDate) {
      setError("Informe a data do retorno para confirmar o agendamento.");
      return;
    }

    if ((form.action === "contato_sem_sucesso" || form.action === "cliente_sem_disponibilidade") && !form.note.trim()) {
      setError("Informe uma observação para registrar a tentativa ou disponibilidade do cliente.");
      return;
    }

    if (form.action === "contato_sem_sucesso" && !form.contactAttemptAt) {
      setError("Confirme a data e hora da tentativa de contato.");
      return;
    }

    setSavingId(activeOrder.id);
    setError("");

    try {
      await registerPartSchedulingAction({
        orderId: activeOrder.id,
        action: form.action,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        returnDate: form.action === "agendamento_confirmado" ? form.returnDate : undefined,
        contactAttemptAt: form.action === "contato_sem_sucesso" ? form.contactAttemptAt : undefined,
        nextContactAt: form.nextContactAt || undefined,
        note: form.note,
      });
      setActiveOrder(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar a ação de agendamento.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <ProtectedPage title="Agendamento" subtitle="Retornos de clientes com peças disponíveis.">
      <main className="page-wrap scheduling-page">
        {error && <div className="duplicate-alert"><strong>Erro em agendamento</strong><span>{error}</span></div>}

        <section className="scheduling-filter-bar" aria-label="Filtros de agendamento">
          {filterCards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`flow-metric ${card.className ?? ""} ${activeFilter === card.id ? "selected" : ""}`}
              aria-pressed={activeFilter === card.id}
              onClick={() => setActiveFilter(card.id)}
            >
              <strong>{card.count}</strong><span>{card.label}</span>
            </button>
          ))}
          <label className="flow-filter scheduling-search">
            <span>Pesquisa</span>
            <input
              value={search}
              placeholder="Cliente, placa, chassi ou telefone"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </section>

        <section className="flow-metrics scheduling-metrics">
          <div className="flow-metric active"><strong>{availableOrders.length}</strong><span>disponíveis para agendar</span></div>
          <div className="flow-metric"><strong>{availablePartsCount}</strong><span>espelho de disponíveis em Peças</span></div>
          <div className="flow-metric danger"><strong>{pendingContact.length}</strong><span>compromissos vencidos</span></div>
          <div className="flow-metric"><strong>{confirmed.length}</strong><span>agendados</span></div>
          <div className="flow-metric"><strong>{unsuccessful.length}</strong><span>contato sem sucesso</span></div>
          <div className="flow-metric"><strong>{unavailable.length}</strong><span>sem disponibilidade</span></div>
          <label className="flow-filter scheduling-search">
            <span>Pesquisa</span>
            <input
              value={search}
              placeholder="Cliente, placa, chassi ou telefone"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{activeFilter === "available" ? "Veículos disponíveis para agendamento" : activeFilter === "overdue" ? "Compromissos vencidos" : activeFilter === "completed" ? "Concluídos por nova passagem" : actionLabels[activeFilter]}</h2>
              <span>{filteredOrders.length} cliente(s) no filtro atual. {search.trim() ? "Pesquisa em todos os pedidos." : "Fila de disponíveis para ação."}</span>
            </div>
          </div>

          <div className="scheduling-list">
            {filteredOrders.length ? filteredOrders.map((order) => {
              const vehicle = vehiclesById.get(order.vehicleFlowId);
              const phoneUrl = whatsappUrl(vehicle?.phone);
              const parts = orderParts(order);
              const processDays = order.schedulingCompletedAt
                ? elapsedDaysBetween(order.createdAt, order.schedulingCompletedAt)
                : elapsedDaysSince(order.createdAt);
              const dueContact = isOverdueContact(order);
              const vehicleImmobilized = vehiclesById.get(order.vehicleFlowId)?.vehicleImmobilized ?? false;
              const canSchedule = order.orderStatus === "disponivel" && !vehicleImmobilized && isAvailableSchedulingStatus(order.schedulingStatus) && !order.schedulingCompletedAt;
              const canEdit = order.orderStatus === "disponivel" && !vehicleImmobilized && !order.schedulingCompletedAt;

              return (
                <article key={order.id} className={`scheduling-card ${dueContact ? "attention" : ""}`}>
                  <div className="scheduling-main">
                    <div>
                      {phoneUrl ? (
                        <a className="client-link" href={phoneUrl} target="_blank" rel="noreferrer">
                          <strong>{order.clientName ?? "Cliente sem nome"}</strong>
                        </a>
                      ) : (
                        <strong>{order.clientName ?? "Cliente sem nome"}</strong>
                      )}
                      <span>{order.plate ?? "-"} · {vehicle?.chassi ?? "sem chassi"}</span>
                    </div>
                    <div><span>Telefone</span><strong>{vehicle?.phone ?? "-"}</strong></div>
                    <div><span>Status atual</span><strong>{orderStatusLabels[order.orderStatus]}</strong></div>
                    <div><span>Tipo</span><strong>{order.orderKind === "garantia" ? "Garantia" : order.orderKind === "externo" ? "Externo" : "-"}</strong></div>
                    <div><span>Disponível desde</span><strong>{formatOperationalDateTime(order.updatedAt)}</strong></div>
                    <div className={order.schedulingStatus === "agendamento_confirmado" && order.scheduledReturnDate ? "scheduled-return-highlight" : ""}>
                      <span>Veículo agendado para</span>
                      <strong>{order.schedulingStatus === "agendamento_confirmado" && order.scheduledReturnDate ? formatDateTime(order.scheduledReturnDate) : "Ainda não agendado"}</strong>
                    </div>
                    <div>
                      <span>{order.schedulingStatus === "agendamento_confirmado" ? "Último contato" : "Próximo contato"}</span>
                      <strong>{order.schedulingStatus === "agendamento_confirmado" ? formatDateTime(order.schedulingUpdatedAt) : formatDateTime(order.nextContactAt)}</strong>
                    </div>
                    <div className="scheduling-age"><span>Tempo do processo</span><strong>{processDays === null ? "-" : `${processDays} ${processDays === 1 ? "dia" : "dias"}`}</strong></div>
                  </div>

                  <div className="scheduling-parts">
                    {parts.map((part, index) => (
                      <span key={part.id || index}>
                        <strong>{part.partReference || "-"}</strong> {part.partDescription || "Sem descrição"}
                      </span>
                    ))}
                  </div>

                  <div className="scheduling-foot">
                    <div>
                      {order.schedulingCompletedAt && <span className="tag good">Concluído por nova passagem</span>}
                      <span className={`tag ${dueContact ? "bad" : ""}`}>
                        {order.schedulingStatus ? schedulingStatusLabels[order.schedulingStatus] : canSchedule ? "Disponível para agendar" : orderStatusLabels[order.orderStatus]}
                      </span>
                      {order.schedulingCompletedAt && <small>Nova passagem registrada em {formatDateTime(order.schedulingCompletedAt)}{order.schedulingCompletionDate ? ` · data ${order.schedulingCompletionDate}` : ""}</small>}
                      {order.schedulingNote && <small>{order.schedulingNote}</small>}
                    </div>
                    {canEdit ? (
                      <button type="button" className={canSchedule ? "primary-btn" : "ghost-btn"} onClick={() => openSchedule(order)}>
                        {canSchedule ? "Agendar" : "Editar ação"}
                      </button>
                    ) : (
                      <span className="tag">{vehicleImmobilized ? "Imobilizado" : "Consulta"}</span>
                    )}
                  </div>
                </article>
              );
            }) : (
              <p className="empty">Nenhum veículo disponível para agendamento neste filtro.</p>
            )}
          </div>
        </section>

        {activeOrder && (
          <div className="modal-backdrop" role="presentation">
            <form className="flow-modal scheduling-modal" onSubmit={submitSchedule}>
              <div className="modal-head">
                <div>
                  <strong>{activeOrder.schedulingStatus ? "Editar ação de agendamento" : "Agendar retorno"}</strong>
                  <span>{activeOrder.clientName} · {activeOrder.plate}</span>
                </div>
                <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setActiveOrder(null)}>
                  ×
                </button>
              </div>

              <label className="field">
                <span>Decisão</span>
                <select
                  value={form.action}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    action: event.target.value as PartSchedulingActionType,
                    contactAttemptAt: event.target.value === "contato_sem_sucesso" && !current.contactAttemptAt
                      ? toDateTimeLocal(new Date())
                      : current.contactAttemptAt,
                  }))}
                >
                  <option value="agendamento_confirmado">Agendamento confirmado</option>
                  <option value="contato_sem_sucesso">Contato sem sucesso</option>
                  <option value="cliente_sem_disponibilidade">Cliente sem disponibilidade</option>
                </select>
              </label>

              {form.action === "agendamento_confirmado" && (
                <label className="field">
                  <span>Data do agendamento</span>
                  <input
                    required
                    type="datetime-local"
                    value={form.returnDate}
                    onChange={(event) => setForm((current) => ({ ...current, returnDate: event.target.value }))}
                  />
                </label>
              )}

              {form.action === "contato_sem_sucesso" && (
                <label className="field">
                  <span>Data e hora da tentativa</span>
                  <input
                    required
                    type="datetime-local"
                    value={form.contactAttemptAt}
                    onChange={(event) => setForm((current) => ({ ...current, contactAttemptAt: event.target.value }))}
                  />
                </label>
              )}

              <label className="field">
                <span>{form.action === "agendamento_confirmado" ? "Observação" : "Observação obrigatória"}</span>
                <textarea
                  required={form.action !== "agendamento_confirmado"}
                  value={form.note}
                  placeholder="Registre o resumo do contato com o cliente"
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                />
              </label>

              {form.action !== "agendamento_confirmado" && (
                <label className="field">
                  <span>Novo compromisso de contato</span>
                  <input
                    type="datetime-local"
                    value={form.nextContactAt}
                    onChange={(event) => setForm((current) => ({ ...current, nextContactAt: event.target.value }))}
                  />
                </label>
              )}

              <section className="history-box">
                <h3>Histórico de agendamento</h3>
                  {activeOrder.schedulingHistory?.length ? (
                    <ul>
                    {[...activeOrder.schedulingHistory].reverse().map((item, index) => (
                      <li key={`${item.actionAt}-${index}`}>
                        <strong>{actionLabels[item.action]}</strong>
                        <span>{formatActionSignature(item.actionBy, item.actionAt)}</span>
                        {item.returnDate && <p>Agendamento: {formatDateTime(item.returnDate)}</p>}
                        {item.contactAttemptAt && <p>Tentativa: {formatOperationalDateTime(item.contactAttemptAt)}</p>}
                        {item.nextContactAt && <p>Novo contato: {formatDateTime(item.nextContactAt)}</p>}
                        {item.note && <p>{item.note}</p>}
                      </li>
                    ))}
                  </ul>
                  ) : (
                    <p>Nenhuma ação registrada.</p>
                  )}
              </section>

              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setActiveOrder(null)}>
                  Fechar
                </button>
                <button type="submit" className="primary-btn" disabled={savingId === activeOrder.id}>
                  {savingId === activeOrder.id ? "Salvando..." : "Salvar ação"}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </ProtectedPage>
  );
}
