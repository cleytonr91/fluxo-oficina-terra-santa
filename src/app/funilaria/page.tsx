"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import type { ManualContent } from "@/components/operation-manual";
import { useAuth } from "@/context/auth-context";
import { saveBodyShopProcess, subscribeBodyShopProcesses } from "@/services/firestore";
import type { BodyShopProcess, BodyShopStatus } from "@/types/domain";

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
  note: string;
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
  note: "",
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

function statusTone(status: BodyShopStatus) {
  if (status === "pago") return "good";
  if (status === "aguardando_pagamento" || status === "finalizado") return "warn";
  if (status === "pecas_pendentes" || status === "complemento") return "bad";
  return "";
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
            {filteredProcesses.length ? filteredProcesses.map((item) => (
              <article key={item.id} className="bodyshop-row">
                <div>
                  <span>Cliente</span>
                  <strong>{item.clientName}</strong>
                  <small>{item.plate || "-"} · O.S. {item.serviceOrder || "-"}</small>
                </div>
                <div><span>Cód. Cliente</span><strong>{item.customerCode || "-"}</strong><small>{item.insurer || "-"}</small></div>
                <div><span>Sinistro</span><strong>{item.claimNumber || "-"}</strong><small>Entrada {formatDate(item.entryDate)}</small></div>
                <div><span>Veículo</span><strong>{item.model || "-"}</strong><small>{[item.year, item.color].filter(Boolean).join(" · ") || "-"}</small></div>
                <div>
                  <span>Status</span>
                  <strong className={`tag ${statusTone(item.status)}`}>{statusLabels[item.status]}</strong>
                  <small>{item.note || "Sem observação"}</small>
                </div>
              </article>
            )) : (
              <div className="empty">Nenhum processo encontrado.</div>
            )}
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
              <label className="field wide"><span>Observação</span><textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></label>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setFormOpen(false)}>Cancelar</button>
              <button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Salvar processo"}</button>
            </div>
          </form>
        </div>
      )}
    </ProtectedPage>
  );
}




