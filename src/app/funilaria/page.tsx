"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import type { ManualContent } from "@/components/operation-manual";
import { useAuth } from "@/context/auth-context";
import { createVehicleFlowFromAppointment, saveBodyShopProcess, subscribeBodyShopProcesses } from "@/services/firestore";
import type { BodyShopProcess, BodyShopStatus, BodyShopVehicleLocation } from "@/types/domain";

type BodyShopForm = {
  serviceOrder: string;
  entryDate: string;
  customerCode: string;
  model: string;
  year: string;
  color: string;
  claimNumber: string;
  clientName: string;
  insurer: string;
  plate: string;
  status: BodyShopStatus;
  vehicleImmobilized: boolean;
  vehicleLocation: BodyShopVehicleLocation;
  note: string;
};

type FinancialForm = {
  totalValue: string;
  deductibleValue: string;
  billingDate: string;
  invoiceSentDate: string;
  paymentDate: string;
  receiptMonth: string;
  paidValue: string;
};

type PartsForm = {
  partsNote: string;
};

const statusOptions: Array<{ value: BodyShopStatus; label: string }> = [
  { value: "aguardando_aprovacao", label: "Aguardando Aprovação" },
  { value: "aprovado", label: "Aprovado" },
  { value: "pecas_pendentes", label: "Peças Pendentes" },
  { value: "em_servico", label: "Em Serviço" },
  { value: "complemento", label: "Complemento" },
  { value: "finalizado", label: "Finalizado" },
  { value: "aguardando_pagamento", label: "Aguardando Pagamento" },
  { value: "pago", label: "Pago" },
];

const statusLabels = Object.fromEntries(statusOptions.map((item) => [item.value, item.label])) as Record<BodyShopStatus, string>;

const locationLabels: Record<BodyShopVehicleLocation, string> = {
  loja: "Loja",
  prestador: "Prestador",
};

const insurerOptions = [
  "Bradesco",
  "Azul",
  "Mapfre",
  "Yelum",
  "Porto",
  "Tokio",
  "Sura",
  "Zurich",
  "HDI",
  "Caixa",
  "Youse",
  "Allianz",
  "Itaú",
];

const emptyForm: BodyShopForm = {
  serviceOrder: "",
  entryDate: "",
  customerCode: "",
  model: "",
  year: "",
  color: "",
  claimNumber: "",
  clientName: "",
  insurer: "",
  plate: "",
  status: "aguardando_aprovacao",
  vehicleImmobilized: false,
  vehicleLocation: "loja",
  note: "",
};

const emptyFinancialForm: FinancialForm = {
  totalValue: "",
  deductibleValue: "",
  billingDate: "",
  invoiceSentDate: "",
  paymentDate: "",
  receiptMonth: "",
  paidValue: "",
};

const emptyPartsForm: PartsForm = {
  partsNote: "",
};

const manual: ManualContent = {
  title: "Manual da Funilaria",
  audience: "Uso principal: funilaria, gerente e financeiro",
  objective: "Acompanhar os processos de sinistro desde a entrada, aprovação, execução, faturamento e pagamento.",
  steps: [
    "Cadastre o processo com O.S., sinistro, cliente, seguradora, placa, valores e status.",
    "Atualize o status conforme o processo evoluir na oficina ou no financeiro.",
    "Use a busca e os filtros para localizar processos por cliente, placa, O.S. ou seguradora.",
    "Acompanhe os cards superiores para identificar pendências operacionais e valores aguardando pagamento.",
  ],
  rules: [
    "Aguardando Aprovação indica orçamento pendente de autorização.",
    "Peças Pendentes deve ser usado quando o processo está aprovado, mas parado por falta de peça.",
    "Finalizado indica serviço concluído, antes do recebimento financeiro.",
    "Aguardando Pagamento indica processo faturado e ainda não recebido.",
    "Pago encerra o processo financeiro.",
  ],
  flow: [
    { title: "Entrada", text: "Processo cadastrado com dados do sinistro." },
    { title: "Aprovação", text: "Seguradora autoriza ou pede complemento." },
    { title: "Execução", text: "Processo segue para peças, serviço e finalização." },
    { title: "Financeiro", text: "Faturamento, envio de NF, pagamento e franquia." },
  ],
};

function formatDate(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatMoney(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseMoney(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function todayInputDate() {
  return new Date().toLocaleDateString("en-CA");
}

function statusTone(status: BodyShopStatus) {
  if (status === "pago") return "good";
  if (status === "aguardando_pagamento" || status === "finalizado") return "warn";
  if (status === "pecas_pendentes" || status === "complemento") return "bad";
  return "";
}

function statusClass(status: BodyShopStatus) {
  if (status === "em_servico") return "is-service";
  if (status === "aprovado") return "is-approved";
  if (status === "pecas_pendentes") return "is-parts";
  if (status === "complemento") return "is-complement";
  if (status === "finalizado" || status === "aguardando_pagamento") return "is-bureaucracy";
  if (status === "pago") return "is-paid";
  return "is-waiting";
}

export default function FunilariaPage() {
  const { profile, user } = useAuth();
  const [processes, setProcesses] = useState<BodyShopProcess[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<BodyShopForm>(emptyForm);
  const [statusFilter, setStatusFilter] = useState<BodyShopStatus | "todos">("todos");
  const [insurerFilter, setInsurerFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [financialProcess, setFinancialProcess] = useState<BodyShopProcess | null>(null);
  const [financialForm, setFinancialForm] = useState<FinancialForm>(emptyFinancialForm);
  const [partsProcess, setPartsProcess] = useState<BodyShopProcess | null>(null);
  const [partsForm, setPartsForm] = useState<PartsForm>(emptyPartsForm);

  useEffect(() => {
    const unsubscribe = subscribeBodyShopProcesses((data) => {
      setProcesses(data);
      setError("");
    }, (currentError) => {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar a funilaria.");
    });

    return unsubscribe;
  }, []);

  const filteredProcesses = useMemo(() => {
    const normalizedSearch = search.trim().toUpperCase();

    return processes.filter((item) => {
      const statusMatches = statusFilter === "todos" || item.status === statusFilter;
      const insurerMatches = insurerFilter === "todos" || item.insurer === insurerFilter;
      const text = [
        item.serviceOrder,
        item.claimNumber,
        item.clientName,
        item.insurer,
        item.plate,
        item.customerCode,
        item.model,
      ].join(" ").toUpperCase();

      return statusMatches && insurerMatches && (!normalizedSearch || text.includes(normalizedSearch));
    });
  }, [insurerFilter, processes, search, statusFilter]);

  const metrics = useMemo(() => {
    const open = processes.filter((item) => item.status !== "pago").length;
    const waitingApproval = processes.filter((item) => item.status === "aguardando_aprovacao" || item.status === "complemento").length;
    const inProduction = processes.filter((item) => item.status === "aprovado" || item.status === "pecas_pendentes" || item.status === "em_servico").length;
    const waitingPayment = processes.filter((item) => item.status === "aguardando_pagamento").length;
    const paid = processes.filter((item) => item.status === "pago").length;

    return { open, waitingApproval, inProduction, waitingPayment, paid };
  }, [processes]);

  const waitingServiceProcesses = useMemo(() => {
    const waitingStatuses: BodyShopStatus[] = ["aguardando_aprovacao", "aprovado", "pecas_pendentes", "complemento"];
    return filteredProcesses.filter((item) => waitingStatuses.includes(item.status));
  }, [filteredProcesses]);

  const inServiceProcesses = useMemo(() => (
    filteredProcesses.filter((item) => item.status === "em_servico")
  ), [filteredProcesses]);

  const bureaucracyProcesses = useMemo(() => {
    const bureaucracyStatuses: BodyShopStatus[] = ["finalizado", "aguardando_pagamento", "pago"];
    return filteredProcesses.filter((item) => bureaucracyStatuses.includes(item.status));
  }, [filteredProcesses]);

  async function submitProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.clientName.trim()) {
      setError("Informe o nome do cliente.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await saveBodyShopProcess({
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        process: {
          serviceOrder: form.serviceOrder.trim(),
          entryDate: form.entryDate,
          customerCode: form.customerCode.trim(),
          model: form.model.trim(),
          year: form.year.trim(),
          color: form.color.trim(),
          claimNumber: form.claimNumber.trim(),
          clientName: form.clientName.trim(),
          insurer: form.insurer.trim(),
          plate: form.plate.trim(),
          status: form.status,
          vehicleImmobilized: form.vehicleImmobilized,
          vehicleLocation: form.vehicleLocation,
          note: form.note.trim(),
        },
      });

      setForm(emptyForm);
      setFormOpen(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o processo.");
    } finally {
      setSaving(false);
    }
  }

  function openFinancial(process: BodyShopProcess) {
    setFinancialProcess(process);
    setFinancialForm({
      totalValue: process.totalValue ? String(process.totalValue).replace(".", ",") : "",
      deductibleValue: process.deductibleValue ? String(process.deductibleValue).replace(".", ",") : "",
      billingDate: process.billingDate ?? "",
      invoiceSentDate: process.invoiceSentDate ?? "",
      paymentDate: process.paymentDate ?? "",
      receiptMonth: process.receiptMonth ?? "",
      paidValue: process.paidValue ? String(process.paidValue).replace(".", ",") : "",
    });
  }

  function openParts(process: BodyShopProcess) {
    setPartsProcess(process);
    setPartsForm({ partsNote: process.partsNote ?? "" });
  }

  async function submitFinancial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financialProcess) return;

    setSaving(true);
    setError("");

    try {
      await saveBodyShopProcess({
        id: financialProcess.id,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        process: {
          ...financialProcess,
          totalValue: parseMoney(financialForm.totalValue),
          deductibleValue: parseMoney(financialForm.deductibleValue),
          billingDate: financialForm.billingDate,
          invoiceSentDate: financialForm.invoiceSentDate,
          paymentDate: financialForm.paymentDate,
          receiptMonth: financialForm.receiptMonth,
          paidValue: parseMoney(financialForm.paidValue),
        },
      });
      setFinancialProcess(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o financeiro.");
    } finally {
      setSaving(false);
    }
  }

  async function submitParts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!partsProcess) return;

    setSaving(true);
    setError("");

    try {
      await saveBodyShopProcess({
        id: partsProcess.id,
        actionBy: profile?.name ?? user?.email ?? user?.uid,
        process: {
          ...partsProcess,
          partsRequested: true,
          partsNote: partsForm.partsNote.trim(),
          status: "pecas_pendentes",
        },
      });
      setPartsProcess(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o pedido de peças.");
    } finally {
      setSaving(false);
    }
  }

  async function sendToWorkshop(process: BodyShopProcess) {
    const flowId = process.workshopVehicleFlowId || `funilaria-${process.id}`;
    const operator = profile?.name ?? user?.email ?? user?.uid;

    setSaving(true);
    setError("");

    try {
      await createVehicleFlowFromAppointment({
        id: flowId,
        appointmentId: process.id,
        origin: "passante",
        currentLane: "preparacao_confirmada",
        appointmentDate: todayInputDate(),
        appointmentTime: "",
        clientName: process.clientName,
        plate: process.plate || `FUN-${process.id.slice(0, 6).toUpperCase()}`,
        model: [process.model, process.year, process.color].filter(Boolean).join(" "),
        serviceLabel: "Funilaria",
        consultantName: "",
        technicianName: "",
        priority: process.vehicleImmobilized ? "alta" : "normal",
        importedNotes: [
          "Origem: Funilaria",
          process.serviceOrder ? `O.S.: ${process.serviceOrder}` : "",
          process.claimNumber ? `Sinistro: ${process.claimNumber}` : "",
          process.insurer ? `Seguradora: ${process.insurer}` : "",
          process.vehicleImmobilized ? "Veículo imobilizado" : "",
          process.note ? `Observação: ${process.note}` : "",
        ].filter(Boolean).join(" | "),
        roadTestRequired: false,
        chiefPresenceRequired: false,
        customerWaits: false,
        washType: "nao",
        status: "ativo",
      });

      await saveBodyShopProcess({
        id: process.id,
        actionBy: operator,
        process: {
          ...process,
          workshopVehicleFlowId: flowId,
          sentToWorkshopAt: new Date().toISOString(),
        },
      });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível enviar para o fluxo da oficina.");
    } finally {
      setSaving(false);
    }
  }

  function renderProcessChip(item: BodyShopProcess) {
    return (
      <article key={item.id} className={`bodyshop-chip ${statusClass(item.status)}`}>
        <div className="bodyshop-chip-head">
          <div>
            <strong>{item.clientName}</strong>
            <span>{item.plate || "-"} · O.S. {item.serviceOrder || "-"}</span>
          </div>
          <span className={`tag ${statusTone(item.status)}`}>{statusLabels[item.status]}</span>
        </div>
        <div className="bodyshop-chip-grid">
          <span><b>Seguradora</b>{item.insurer || "-"}</span>
          <span><b>Sinistro</b>{item.claimNumber || "-"}</span>
          <span><b>Veículo</b>{[item.model, item.year, item.color].filter(Boolean).join(" · ") || "-"}</span>
          <span><b>Local</b>{item.vehicleLocation ? locationLabels[item.vehicleLocation] : "-"}</span>
        </div>
        {item.vehicleImmobilized && <div className="bodyshop-alert">Veículo imobilizado</div>}
        {item.partsRequested && <div className="bodyshop-alert neutral">Pedido de peças registrado</div>}
        <div className="bodyshop-chip-actions">
          <button type="button" className="ghost-btn" onClick={() => openFinancial(item)}>Financeiro</button>
          <button type="button" className="ghost-btn" onClick={() => openParts(item)}>Peças</button>
          <button type="button" className="primary-btn" disabled={saving} onClick={() => sendToWorkshop(item)}>
            {item.workshopVehicleFlowId ? "Reenviar ao fluxo" : "Enviar ao fluxo"}
          </button>
        </div>
      </article>
    );
  }

  return (
    <ProtectedPage
      title="Funilaria"
      subtitle="Acompanhamento dos processos de sinistro, execução, faturamento e pagamento."
      manual={manual}
    >
      <main className="page-wrap bodyshop-page">
        {error && <div className="duplicate-alert"><strong>Erro na funilaria</strong><span>{error}</span></div>}

        <section className="bodyshop-toolbar">
          <div>
            <strong>Processos de funilaria</strong>
            <span>Cadastre e acompanhe cada O.S. até o pagamento.</span>
          </div>
          <button type="button" className="primary-btn" onClick={() => setFormOpen(true)}>
            + Processo
          </button>
        </section>

        <section className="bodyshop-metrics">
          <button type="button" className="metric compact" onClick={() => setStatusFilter("todos")}>
            <strong>{metrics.open}</strong><span>em aberto</span>
          </button>
          <button type="button" className="metric compact" onClick={() => setStatusFilter("aguardando_aprovacao")}>
            <strong>{metrics.waitingApproval}</strong><span>aprovação/complemento</span>
          </button>
          <button type="button" className="metric compact" onClick={() => setStatusFilter("em_servico")}>
            <strong>{metrics.inProduction}</strong><span>produção/peças</span>
          </button>
          <button type="button" className="metric compact" onClick={() => setStatusFilter("aguardando_pagamento")}>
            <strong>{metrics.waitingPayment}</strong><span>aguardando pagamento</span>
          </button>
          <button type="button" className="metric compact" onClick={() => setStatusFilter("pago")}>
            <strong>{metrics.paid}</strong><span>pagos</span>
          </button>
        </section>

        <section className="panel">
          <div className="bodyshop-filters">
            <label className="field">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as BodyShopStatus | "todos")}>
                <option value="todos">Todos</option>
                {statusOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Seguradora</span>
              <select value={insurerFilter} onChange={(event) => setInsurerFilter(event.target.value)}>
                <option value="todos">Todas</option>
                {insurerOptions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Busca</span>
              <input value={search} placeholder="Cliente, placa, código, O.S. ou sinistro" onChange={(event) => setSearch(event.target.value)} />
            </label>
          </div>

          <div className="bodyshop-list">
            <div className="bodyshop-flow-grid">
              <section className="bodyshop-flow-lane">
                <div className="bodyshop-flow-head">
                  <strong>Aguardando Serviço</strong>
                  <span>{waitingServiceProcesses.length}</span>
                </div>
                <div className="bodyshop-chip-list">
                  {waitingServiceProcesses.length ? waitingServiceProcesses.map(renderProcessChip) : (
                    <div className="empty">Nenhum processo aguardando serviço.</div>
                  )}
                </div>
              </section>

              <section className="bodyshop-flow-lane">
                <div className="bodyshop-flow-head">
                  <strong>Em Serviço</strong>
                  <span>{inServiceProcesses.length}</span>
                </div>
                <div className="bodyshop-chip-list">
                  {inServiceProcesses.length ? inServiceProcesses.map(renderProcessChip) : (
                    <div className="empty">Nenhum processo em serviço.</div>
                  )}
                </div>
              </section>
            </div>

            <section className="bodyshop-bureaucracy">
              <div className="bodyshop-bureaucracy-head">
                <div>
                  <strong>Tratativa de burocracia</strong>
                  <span>Finalizados, aguardando pagamento e pagos ficam fora do fluxo operacional.</span>
                </div>
                <b>{bureaucracyProcesses.length}</b>
              </div>
              {bureaucracyProcesses.length ? bureaucracyProcesses.map((item) => (
                <article key={item.id} className="bodyshop-row">
                  <div>
                    <span>Cliente</span>
                    <strong>{item.clientName}</strong>
                    <small>{item.plate || "-"} · O.S. {item.serviceOrder || "-"}</small>
                  </div>
                  <div><span>Cód. Cliente</span><strong>{item.customerCode || "-"}</strong><small>{item.insurer || "-"}</small></div>
                  <div><span>Sinistro</span><strong>{item.claimNumber || "-"}</strong><small>Entrada {formatDate(item.entryDate)}</small></div>
                  <div><span>Financeiro</span><strong>{formatMoney(item.totalValue)}</strong><small>Pago {formatMoney(item.paidValue)}</small></div>
                  <div>
                    <span>Status</span>
                    <strong className={`tag ${statusTone(item.status)}`}>{statusLabels[item.status]}</strong>
                    <small>
                      {item.vehicleImmobilized ? "Imobilizado" : "Rodando"} · {item.vehicleLocation ? locationLabels[item.vehicleLocation] : "-"}
                    </small>
                  </div>
                  <div className="bodyshop-row-actions">
                    <button type="button" className="ghost-btn" onClick={() => openFinancial(item)}>Financeiro</button>
                    <button type="button" className="ghost-btn" onClick={() => openParts(item)}>Peças</button>
                  </div>
                </article>
              )) : (
                <div className="empty">Nenhum processo em burocracia no filtro atual.</div>
              )}
            </section>
          </div>
        </section>
      </main>

      {formOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal bodyshop-modal" onSubmit={submitProcess}>
            <div className="modal-head">
              <div>
                <strong>Novo processo de funilaria</strong>
                <span>Dados iniciais para identificar processo, cliente e veículo.</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>

            <div className="bodyshop-form-grid">
              <label className="field"><span>O.S.</span><input value={form.serviceOrder} onChange={(event) => setForm((current) => ({ ...current, serviceOrder: event.target.value }))} /></label>
              <label className="field"><span>Data de entrada</span><input type="date" value={form.entryDate} onChange={(event) => setForm((current) => ({ ...current, entryDate: event.target.value }))} /></label>
              <label className="field"><span>N° sinistro</span><input value={form.claimNumber} onChange={(event) => setForm((current) => ({ ...current, claimNumber: event.target.value }))} /></label>
              <label className="field"><span>Cód. Cliente</span><input value={form.customerCode} onChange={(event) => setForm((current) => ({ ...current, customerCode: event.target.value }))} /></label>
              <label className="field wide"><span>Cliente</span><input required value={form.clientName} onChange={(event) => setForm((current) => ({ ...current, clientName: event.target.value }))} /></label>
              <label className="field">
                <span>Seguradora</span>
                <select value={form.insurer} onChange={(event) => setForm((current) => ({ ...current, insurer: event.target.value }))}>
                  <option value="">Selecionar</option>
                  {insurerOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="field"><span>Placa</span><input value={form.plate} onChange={(event) => setForm((current) => ({ ...current, plate: event.target.value.toUpperCase() }))} /></label>
              <label className="field"><span>Modelo</span><input value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} /></label>
              <label className="field"><span>Ano</span><input value={form.year} onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))} /></label>
              <label className="field"><span>Cor</span><input value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} /></label>
              <label className="field"><span>Status</span><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as BodyShopStatus }))}>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="check-row bodyshop-check">
                <input
                  type="checkbox"
                  checked={form.vehicleImmobilized}
                  onChange={(event) => setForm((current) => ({ ...current, vehicleImmobilized: event.target.checked }))}
                />
                <span>Imobilizado</span>
              </label>
              <label className="field">
                <span>Local do veículo</span>
                <select
                  value={form.vehicleLocation}
                  onChange={(event) => setForm((current) => ({ ...current, vehicleLocation: event.target.value as BodyShopVehicleLocation }))}
                >
                  <option value="loja">Loja</option>
                  <option value="prestador">Prestador</option>
                </select>
              </label>
              <label className="field wide"><span>Observação</span><textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></label>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setFormOpen(false)}>Cancelar</button>
              <button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Salvar processo"}</button>
            </div>
          </form>
        </div>
      )}

      {financialProcess && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal bodyshop-modal" onSubmit={submitFinancial}>
            <div className="modal-head">
              <div>
                <strong>Informações financeiras</strong>
                <span>{financialProcess.clientName} · {financialProcess.plate || "-"}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setFinancialProcess(null)}>
                ×
              </button>
            </div>

            <div className="bodyshop-form-grid">
              <label className="field"><span>Valor total</span><input value={financialForm.totalValue} onChange={(event) => setFinancialForm((current) => ({ ...current, totalValue: event.target.value }))} /></label>
              <label className="field"><span>Franquia</span><input value={financialForm.deductibleValue} onChange={(event) => setFinancialForm((current) => ({ ...current, deductibleValue: event.target.value }))} /></label>
              <label className="field"><span>Faturamento</span><input type="date" value={financialForm.billingDate} onChange={(event) => setFinancialForm((current) => ({ ...current, billingDate: event.target.value }))} /></label>
              <label className="field"><span>Envio NF</span><input type="date" value={financialForm.invoiceSentDate} onChange={(event) => setFinancialForm((current) => ({ ...current, invoiceSentDate: event.target.value }))} /></label>
              <label className="field"><span>Data de pagamento</span><input type="date" value={financialForm.paymentDate} onChange={(event) => setFinancialForm((current) => ({ ...current, paymentDate: event.target.value }))} /></label>
              <label className="field"><span>Mês recebimento</span><input type="month" value={financialForm.receiptMonth} onChange={(event) => setFinancialForm((current) => ({ ...current, receiptMonth: event.target.value }))} /></label>
              <label className="field"><span>Valor pago</span><input value={financialForm.paidValue} onChange={(event) => setFinancialForm((current) => ({ ...current, paidValue: event.target.value }))} /></label>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setFinancialProcess(null)}>Cancelar</button>
              <button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Salvar financeiro"}</button>
            </div>
          </form>
        </div>
      )}

      {partsProcess && (
        <div className="modal-backdrop" role="presentation">
          <form className="flow-modal bodyshop-modal" onSubmit={submitParts}>
            <div className="modal-head">
              <div>
                <strong>Pedido de peças</strong>
                <span>{partsProcess.clientName} · {partsProcess.plate || "-"}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setPartsProcess(null)}>
                ×
              </button>
            </div>

            <label className="field">
              <span>Informações do pedido de peças</span>
              <textarea
                value={partsForm.partsNote}
                placeholder="Referências, peças pendentes, retorno da seguradora ou observação do setor."
                onChange={(event) => setPartsForm({ partsNote: event.target.value })}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setPartsProcess(null)}>Cancelar</button>
              <button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Salvar pedido de peças"}</button>
            </div>
          </form>
        </div>
      )}
    </ProtectedPage>
  );
}




