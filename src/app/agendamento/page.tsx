"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { registerPartSchedulingAction, subscribeActiveVehicleFlows, subscribePartOrders } from "@/services/firestore";
import type { PartOrder, PartOrderItem, PartSchedulingActionType, PartSchedulingStatus, VehicleFlow } from "@/types/domain";

type ScheduleForm = {
  action: PartSchedulingActionType;
  returnDate: string;
  contactAttemptAt: string;
  nextContactAt: string;
  note: string;
};

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

export default function AgendamentoPage() {
  const { profile, user } = useAuth();
  const [orders, setOrders] = useState<PartOrder[]>([]);
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [search, setSearch] = useState("");
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
    const unsubscribe = subscribePartOrders((items) => {
      setOrders(items);
      setError("");
    }, (currentError) => {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar os pedidos para agendamento.");
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeActiveVehicleFlows(setVehicles, () => undefined, { includeDelivered: true });
    return unsubscribe;
  }, []);

  const vehiclesById = useMemo(() => {
    const mapped = new Map<string, VehicleFlow>();
    vehicles.forEach((vehicle) => mapped.set(vehicle.id, vehicle));
    return mapped;
  }, [vehicles]);

  const availableOrders = useMemo(() => (
    orders.filter((order) => order.orderStatus === "disponivel" && !order.vehicleImmobilized)
  ), [orders]);

  const filteredOrders = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return availableOrders;

    return availableOrders.filter((order) => {
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
  }, [availableOrders, search, vehiclesById]);

  const pendingContact = availableOrders.filter((order) => order.nextContactAt && isDue(order.nextContactAt));
  const confirmed = availableOrders.filter((order) => order.schedulingStatus === "agendamento_confirmado");
  const unsuccessful = availableOrders.filter((order) => order.schedulingStatus === "contato_sem_sucesso");
  const unavailable = availableOrders.filter((order) => order.schedulingStatus === "cliente_sem_disponibilidade");

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

        <section className="flow-metrics scheduling-metrics">
          <div className="flow-metric active"><strong>{availableOrders.length}</strong><span>disponíveis para agendar</span></div>
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
              <h2 className="panel-title">Veículos disponíveis para agendamento</h2>
              <span>{filteredOrders.length} cliente(s) no filtro atual.</span>
            </div>
          </div>

          <div className="scheduling-list">
            {filteredOrders.length ? filteredOrders.map((order) => {
              const vehicle = vehiclesById.get(order.vehicleFlowId);
              const phoneUrl = whatsappUrl(vehicle?.phone);
              const parts = orderParts(order);
              const dueContact = isDue(order.nextContactAt);

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
                    <div><span>Tipo</span><strong>{order.orderKind === "garantia" ? "Garantia" : order.orderKind === "externo" ? "Externo" : "-"}</strong></div>
                    <div><span>Disponível desde</span><strong>{formatDateTime(order.updatedAt)}</strong></div>
                    <div><span>Próximo contato</span><strong>{formatDateTime(order.nextContactAt)}</strong></div>
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
                      <span className={`tag ${dueContact ? "bad" : ""}`}>
                        {order.schedulingStatus ? schedulingStatusLabels[order.schedulingStatus] : "Disponível para agendar"}
                      </span>
                      {order.schedulingNote && <small>{order.schedulingNote}</small>}
                    </div>
                    <button type="button" className="primary-btn" onClick={() => openSchedule(order)}>
                      Agendar
                    </button>
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
                  <strong>Agendar retorno</strong>
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
                  <span>Data do retorno</span>
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
                        <span>{item.actionBy ?? "Operador"} · {formatDateTime(item.actionAt)}</span>
                        {item.returnDate && <p>Retorno: {formatDateTime(item.returnDate)}</p>}
                        {item.contactAttemptAt && <p>Tentativa: {formatDateTime(item.contactAttemptAt)}</p>}
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
