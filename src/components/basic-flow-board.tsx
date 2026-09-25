"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { useAuth } from "@/context/auth-context";
import { basicConsultants, basicLanes, basicTargets, basicTechnicians, canOperateBasic, localDay } from "@/lib/basic-flow";
import { BasicMoveInput, moveBasicVehicle, subscribeBasicFlow } from "@/services/basic-flow";
import type { FlowLane, VehicleFlow, WashType } from "@/types/domain";
import styles from "./basic-flow-board.module.css";

const washes: Record<WashType, string> = { nao: "Sem lavagem", simples: "Lavagem simples", motor: "Lavagem de motor", motor_bancos: "Motor + bancos" };
function time(value: unknown) {
  if (!value) return "-";
  const date: Date = value instanceof Date ? value : typeof value === "string" ? new Date(value)
    : typeof value === "object" && "toDate" in value && typeof value.toDate === "function" ? value.toDate()
      : typeof value === "object" && "seconds" in value && typeof value.seconds === "number" ? new Date(value.seconds * 1000) : new Date(NaN);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function dateValue(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value)
    : typeof value === "object" && "toDate" in value && typeof value.toDate === "function" ? value.toDate()
      : typeof value === "object" && "seconds" in value && typeof value.seconds === "number" ? new Date(value.seconds * 1000) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}
export function BasicFlowBoard() {
  const { profile, user } = useAuth();
  const [day, setDay] = useState(localDay);
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [search, setSearch] = useState("");
  const [consultant, setConsultant] = useState("");
  const [selected, setSelected] = useState<VehicleFlow | null>(null);
  const [form, setForm] = useState<BasicMoveInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [technicianFilter, setTechnicianFilter] = useState("");
  const [metric, setMetric] = useState("todos");
  const [now, setNow] = useState(() => new Date());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    const stop = subscribeBasicFlow(day, data => { if (alive) { setVehicles(data); setReady(true); setError(""); setLastSync(new Date()); } }, failure => { if (alive) { setError(failure.message); setReady(false); } });
    return () => { alive = false; stop(); };
  }, [day]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const filtered = vehicles.filter(v => {
    if (v.status === "ativo" && v.appointmentDate && v.appointmentDate > day) return false;
    if (consultant && v.consultantName !== consultant) return false;
    if (technicianFilter && v.technicianName !== technicianFilter) return false;
    return `${v.clientName ?? ""} ${v.plate ?? ""} ${v.chassi ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });
  const noShows = filtered.filter(v => v.currentLane === "preparacao_confirmada" && v.noShow);
  const active = filtered.filter(v => v.status === "ativo" && !noShows.includes(v));
  const attention = (v: VehicleFlow) => v.status === "ativo" && (v.customerWaits || v.priority === "alta" || v.budgetStatus === "aguardando" || v.roadTestRequired || (dateValue(v.promisedDeliveryAt)?.getTime() ?? Infinity) < now.getTime());
  const groups = [
    { id: "agendados", label: "Agendados", items: active.filter(v => v.origin !== "passante" && v.appointmentDate === day) },
    { id: "passantes", label: "Passantes", items: active.filter(v => v.origin === "passante" && v.appointmentDate === day) },
    { id: "anteriores", label: "Dias anteriores", items: active.filter(v => v.appointmentDate && v.appointmentDate < day) },
    { id: "revisao", label: "Revisões", items: active.filter(v => /revis/i.test(v.serviceLabel ?? "")) },
    { id: "diagnostico", label: "Diagnósticos", items: active.filter(v => /diagn/i.test(v.serviceLabel ?? "")) },
    { id: "reparo", label: "Reparos gerais", items: active.filter(v => /reparo/i.test(v.serviceLabel ?? "")) },
    { id: "embelezamento", label: "Embelezamento", items: active.filter(v => /embelez|lavagem/i.test(v.serviceLabel ?? "")) },
    { id: "noShow", label: "No-show", items: noShows },
    { id: "attention", label: "Em atenção", items: active.filter(attention) },
    { id: "immobilized", label: "Imobilizados", items: active.filter(v => v.vehicleImmobilized) },
    { id: "delivered", label: "Entregues do dia", items: filtered.filter(v => v.status === "entregue") },
  ];
  const visible = metric === "todos" ? filtered : groups.find(group => group.id === metric)?.items ?? [];
  const visibleNoShows = noShows.filter(v => visible.includes(v));
  function metricLine(group: typeof groups[number]) {
    return <button key={group.id} className={`metric-line-btn ${metric === group.id ? "selected" : ""}`} type="button" onClick={() => setMetric(metric === group.id ? "todos" : group.id)}><span>{group.label}</span><b>{group.items.length}</b></button>;
  }
  function open(vehicle: VehicleFlow) {
    setSelected(vehicle); setModalError("");
    const technician = profile?.role === "tecnico" ? basicTechnicians.find(name => profile.name.toLowerCase().split(" ").includes(name.toLowerCase())) : undefined;
    setForm({ vehicleId: vehicle.id, from: vehicle.currentLane, to: basicTargets(vehicle)[0] ?? vehicle.currentLane,
      actor: profile?.name ?? "", actorId: user?.uid ?? "", consultant: vehicle.consultantName ?? "", technician: technician ?? vehicle.technicianName ?? "",
      washType: vehicle.washType ?? "nao", promised: "", note: "", customerWaits: vehicle.customerWaits ?? false, onTime: true, pending: false, nps: "" });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || lock.current || !ready || !online) return;
    lock.current = true; setSaving(true); setModalError("");
    try { await moveBasicVehicle(form); setSelected(null); setForm(null); }
    catch (failure) { setModalError(failure instanceof Error ? failure.message : "Não foi possível salvar. Confira o quadro antes de tentar novamente."); }
    finally { lock.current = false; setSaving(false); }
  }
  function card(vehicle: VehicleFlow) {
    const received = dateValue(vehicle.attendanceStartedAt) ?? (vehicle.origin === "passante" ? dateValue(vehicle.createdAt) : null);
    const promise = dateValue(vehicle.promisedDeliveryAt);
    const late = promise && promise < now && vehicle.status === "ativo";
    const progress = promise && received && promise > received ? Math.min(100, Math.max(0, (now.getTime() - received.getTime()) / (promise.getTime() - received.getTime()) * 100)) : 0;
    const days = received ? Math.max(0, Math.floor((now.getTime() - received.getTime()) / 86400000)) : "-";
    const canMove = canOperateBasic(profile?.role, vehicle.currentLane) && basicTargets(vehicle).length > 0;
    return <article className={`chip flow-chip ${/diagn/i.test(vehicle.serviceLabel ?? "") ? "diagnostico" : /reparo/i.test(vehicle.serviceLabel ?? "") ? "reparo" : ""}`} key={vehicle.id}>
      <div className="chip-top"><div><h3 className="client">{vehicle.clientName || "Sem nome"}</h3><p className="model">{vehicle.model || "Modelo não informado"}</p></div><span className={`plate ${vehicle.customerWaits ? "wait-plate" : ""}`} title={vehicle.customerWaits ? "Cliente aguardando na loja" : "Placa"}>{vehicle.plate && vehicle.plate !== "null" ? vehicle.plate : "Sem placa"}</span></div>
      <div className="tag-row"><span className="tag">{vehicle.serviceLabel || "Serviço não informado"}</span>
        {vehicle.appointmentDate && vehicle.appointmentDate < day && <span className="tag previous-day">Dia anterior</span>}
        {vehicle.origin === "passante" && <span className="tag warn">Passante</span>}
        {vehicle.priority === "alta" && <span className="tag bad">Alta</span>}
        <span className={`tag ${vehicle.washDone ? "good" : vehicle.washType === "nao" ? "bad" : ""}`}>{washes[vehicle.washType] ?? "Lavagem não informada"}{vehicle.washDone ? " 👍" : vehicle.washType === "nao" ? " 👎" : ""}</span>
        {vehicle.noShow && vehicle.currentLane === "preparacao_confirmada" && <span className="tag bad">NO-SHOW</span>}
        {vehicle.budgetAuthorized && <span className="tag good">ORÇ Complementar 👍</span>}
        {vehicle.vehicleImmobilized && <span className="tag bad">Imobilizado · {vehicle.immobilizationReason === "aguardando_pecas" ? "Aguardando Peças" : "Aguardando Decisão"}</span>}
        {vehicle.customerWaits && <span className="tag warn">Cliente aguarda</span>}
      </div>
      <div className="chip-compact-details"><div><span>Consultor:</span> {vehicle.consultantName || "-"}</div><div><span>Técnico:</span> {vehicle.technicianName || "-"}</div><div><span>{vehicle.currentLane === "preparacao_confirmada" ? "Agenda:" : "Recebido:"}</span> {vehicle.currentLane === "preparacao_confirmada" ? vehicle.appointmentTime || "-" : received?.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) || "-"}</div></div>
      {vehicle.vehicleImmobilized ? <div className="immobilized-stay"><strong><b>{days}</b><small>dias</small></strong></div> : promise && <div className={`time-bar ${late ? "late" : ""}`}><div className="time-bar-top"><span>Previsão de entrega</span><strong>{time(vehicle.promisedDeliveryAt)}</strong></div><div className="time-track"><span style={{ width: `${progress}%` }} /></div></div>}
      {canMove && <button className="chip-move-btn" aria-label={`Mover ${vehicle.clientName || "veículo"}`} title="Mover para próxima etapa" disabled={!ready || !online} onClick={() => open(vehicle)}>→</button>}
    </article>;
  }
  return <div className="app-shell" data-flow-mode="basic-restored">
    <AppHeader title="Fluxo da Oficina" status={<div role="status" className={`realtime-status header-realtime-status ${error || !online ? "offline" : ""}`}><span>{online ? ready ? "Atualização em tempo real ativa" : "Aguardando conexão" : "Sem conexão · movimentações bloqueadas"}</span><strong>{lastSync ? `Atualizado ${lastSync.toLocaleTimeString("pt-BR")}` : "Conectando..."}</strong></div>}
      flowControls={<label className="date-field"><span>Data</span><input type="date" value={day} onChange={e => { if (e.target.value && e.target.value !== day) { setReady(false); setVehicles([]); setDay(e.target.value); } }} /></label>} />
    <main className={`flow-page ${styles.restored}`}>
    <section className="flow-metrics flow-day-panel">
      <button className={`flow-metric flow-total active ${metric === "todos" ? "selected-total" : ""}`} onClick={() => setMetric("todos")}><span>Fluxo do dia</span><strong>{active.length}</strong><small>veículos em atuação hoje</small></button>
      <div className="flow-metric-group"><strong>Origem do fluxo</strong>{groups.slice(0, 3).map(metricLine)}</div>
      <div className="flow-metric-group service-group"><strong>Tipo do serviço</strong>{groups.slice(3, 7).map(metricLine)}</div>
      <div className="flow-status-strip">{groups.slice(7).map(group => <button key={group.id} className={`flow-metric mini ${["noShow", "immobilized"].includes(group.id) ? "danger" : ""} ${metric === group.id ? "selected" : ""}`} onClick={() => setMetric(metric === group.id ? "todos" : group.id)}><strong>{group.items.length}</strong><span>{group.label}</span></button>)}</div>
      <div className="flow-filter-stack"><strong>Filtros</strong><label className="flow-filter compact"><span>Consultor</span><select value={consultant} onChange={e => setConsultant(e.target.value)}><option value="">Todos</option>{basicConsultants.map(name => <option key={name}>{name}</option>)}</select></label><label className="flow-filter compact"><span>Técnico</span><select value={technicianFilter} onChange={e => setTechnicianFilter(e.target.value)}><option value="">Todos</option>{basicTechnicians.map(name => <option key={name}>{name}</option>)}</select></label><label className="flow-filter compact flow-plate-filter"><span>Pesquisa</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, placa ou chassi" /></label></div>
    </section>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <section className="flow-board">{basicLanes.map(lane => {
      const items = visible.filter(v => v.currentLane === lane.id && !(lane.id === "preparacao_confirmada" && v.noShow));
      return <section className={`flow-lane lane-${lane.id}`} key={lane.id}><div className="flow-lane-head"><h2>{lane.label}</h2><strong>{items.length}</strong></div>
        {lane.id === "orcamento_complementar" ? <div className="budget-split">{[false, true].map(done => { const subset = items.filter(v => (v.budgetStatus === "realizado") === done); return <div className="budget-box" key={String(done)}><h3>{done ? "Orçamento realizado" : "Aguardando"}</h3>{subset.length ? subset.map(card) : <p>{done ? "Nenhum orçamento realizado" : "Sem orçamentos pendentes"}</p>}</div>; })}</div> : <div className="flow-lane-body">{items.map(card)}{!items.length && <div className="empty">{ready ? "Sem veículos nesta etapa" : "Carregando veículos..."}</div>}</div>}
        {lane.id === "preparacao_confirmada" && <div className="lane-no-show-section"><div className="lane-no-show-head"><h3>No-show</h3><strong>{visibleNoShows.length}</strong></div><div className="lane-no-show-body">{visibleNoShows.map(card)}{!visibleNoShows.length && <div className="empty">Nenhum no-show neste dia.</div>}</div></div>}
      </section>;
    })}</section></main>
    {selected && form && <div className={styles.overlay}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="basic-move-title">
      <h2 id="basic-move-title">Movimentar veículo</h2><p>{selected.clientName} · {selected.plate || "Sem placa"}</p>
      <form onSubmit={submit} className={styles.form}>
        <label>Próxima etapa<select value={form.to} onChange={e => setForm({ ...form, to: e.target.value as FlowLane })}>{basicTargets(selected).map(target => <option key={target} value={target}>{basicLanes.find(l => l.id === target)?.label}{selected.currentLane === "orcamento_complementar" ? target === "aguardando_servico" ? " · Autorizado" : " · Não autorizado" : ""}</option>)}</select></label>
        {form.from === "preparacao_confirmada" && <><label>Consultor que recebeu<select required value={form.consultant} onChange={e => setForm({ ...form, consultant: e.target.value })}><option value="">Selecionar</option>{basicConsultants.map(name => <option key={name}>{name}</option>)}</select></label><label>Tipo de lavagem<select value={form.washType} onChange={e => setForm({ ...form, washType: e.target.value as WashType })}>{Object.entries(washes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={styles.check}><input type="checkbox" checked={form.customerWaits} onChange={e => setForm({ ...form, customerWaits: e.target.checked })} />Cliente aguarda na loja</label></>}
        {(form.from === "preparacao_confirmada" || (form.from === "orcamento_complementar" && form.to === "aguardando_servico")) && <label>Previsão de entrega<input type="datetime-local" required value={form.promised} onChange={e => setForm({ ...form, promised: e.target.value })} /></label>}
        {form.to === "em_servico" && <label>Técnico responsável<select required value={form.technician} onChange={e => setForm({ ...form, technician: e.target.value })}><option value="">Selecionar</option>{basicTechnicians.map(name => <option key={name}>{name}</option>)}</select></label>}
        {form.to === "entregue" && <><label>Entregue no prazo?<select value={String(form.onTime)} onChange={e => setForm({ ...form, onTime: e.target.value === "true" })}><option value="true">Sim</option><option value="false">Não</option></select></label><label>Possui pendência?<select value={String(form.pending)} onChange={e => setForm({ ...form, pending: e.target.value === "true" })}><option value="false">Não</option><option value="true">Sim</option></select></label><label>NPS interno<input type="number" min="0" max="10" step="1" value={form.nps} onChange={e => setForm({ ...form, nps: e.target.value })} /></label></>}
        <label>Observação<textarea required={form.from === "orcamento_complementar"} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
        {modalError && <p role="alert" className={styles.error}>{modalError}</p>}
        <footer><button type="button" className="ghost-btn" disabled={saving} onClick={() => { setSelected(null); setForm(null); }}>Cancelar</button><button className="primary-btn" disabled={saving || !ready || !online}>{saving ? "Salvando..." : "Confirmar movimentação"}</button></footer>
      </form>
    </section></div>}
  </div>;
}
