"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { allowedPathsForRole } from "@/lib/access-control";
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
export function BasicFlowBoard() {
  const { profile, user, logout } = useAuth();
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
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    const stop = subscribeBasicFlow(day, data => { if (alive) { setVehicles(data); setReady(true); setError(""); } }, failure => { if (alive) { setError(failure.message); setReady(false); } });
    return () => { alive = false; stop(); };
  }, [day]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const filtered = vehicles.filter(v => {
    if (v.status === "ativo" && v.appointmentDate && v.appointmentDate > day) return false;
    if (consultant && v.consultantName !== consultant) return false;
    return `${v.clientName ?? ""} ${v.plate ?? ""} ${v.chassi ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });
  const noShows = filtered.filter(v => v.currentLane === "preparacao_confirmada" && v.noShow);
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
    return <article className={styles.card} key={vehicle.id}>
      <strong>{vehicle.clientName || "Sem nome"}</strong><span>{vehicle.plate && vehicle.plate !== "null" ? vehicle.plate : "Sem placa"} · {vehicle.model}</span>
      <span>{vehicle.serviceLabel}</span><span>Consultor: {vehicle.consultantName || "-"}</span><span>Técnico: {vehicle.technicianName || "-"}</span>
      <span>{vehicle.attendanceStartedAt ? `Recebido: ${time(vehicle.attendanceStartedAt)}` : `Agenda: ${vehicle.appointmentDate ?? "-"} ${vehicle.appointmentTime ?? ""}`}</span>
      {vehicle.promisedDeliveryAt && <span>Previsão: {time(vehicle.promisedDeliveryAt)}</span>}
      <span>{washes[vehicle.washType] ?? "Lavagem não informada"}{vehicle.washDone ? " · Realizada" : ""}</span>
      {vehicle.vehicleImmobilized && <b className={styles.alert}>Imobilizado · {vehicle.immobilizationReason === "aguardando_pecas" ? "Aguardando peças" : "Aguardando decisão"}</b>}
      {vehicle.customerWaits && <b>Cliente aguarda</b>}
      {vehicle.receiveNote && <span>{vehicle.receiveNote}</span>}
      {canOperateBasic(profile?.role, vehicle.currentLane) && basicTargets(vehicle).length > 0 && <button className="primary-btn" disabled={!ready || !online} onClick={() => open(vehicle)}>Movimentar →</button>}
    </article>;
  }
  return <div className={styles.page}>
    <header className={styles.header}><div><h1>Fluxo da Oficina</h1><span>Operação básica · Etapa 1</span></div>
      <nav aria-label="Páginas">{allowedPathsForRole(profile?.role, profile?.allowedPaths).filter(p => p !== "/fluxo").map(p => <Link key={p} href={p}>{p === "/preparacao" ? "Preparação" : "Pós-serviço"}</Link>)}<span>{profile?.name}</span><button className="ghost-btn" onClick={logout}>Sair</button></nav>
    </header>
    <section className={styles.toolbar}>
      <label>Data<input type="date" value={day} onChange={e => { if (e.target.value) { setReady(false); setVehicles([]); setDay(e.target.value); } }} /></label>
      <label>Consultor<select value={consultant} onChange={e => setConsultant(e.target.value)}><option value="">Todos</option>{basicConsultants.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Pesquisar<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, placa ou chassi" /></label>
      <strong>{ready ? `${filtered.filter(v => v.status === "ativo" && !v.noShow).length} em andamento` : "Carregando..."}</strong>
      <span role="status">{online ? ready ? "Atualização compartilhada ativa" : "Aguardando conexão" : "Sem conexão · movimentações bloqueadas"}</span>
    </section>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <main className={styles.board}>{basicLanes.map(lane => {
      const items = filtered.filter(v => v.currentLane === lane.id && !(lane.id === "preparacao_confirmada" && v.noShow));
      return <section className={styles.lane} key={lane.id}><h2>{lane.label}<span>{items.length}</span></h2><div className={styles.cards}>{items.map(card)}{ready && !items.length && <p>Sem veículos</p>}</div>
        {lane.id === "preparacao_confirmada" && <><h2 className={styles.alert}>No-show<span>{noShows.length}</span></h2><div className={styles.cards}>{noShows.map(card)}</div></>}
      </section>;
    })}</main>
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
