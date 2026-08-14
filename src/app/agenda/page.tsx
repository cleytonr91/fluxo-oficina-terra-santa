"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { listAgendaItems, listUserProfiles, saveAgendaItem, toggleAgendaItem, toggleAgendaItemOccurrence } from "@/services/firestore";
import type { AgendaItem, AgendaItemKind, AgendaRecurrence, UserProfile } from "@/types/domain";
import "./agenda.css";

const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const shortWeekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const kindColor: Record<AgendaItemKind, string> = { task: "#4f8f70", event: "#3d78a8", meeting: "#c56a1a" };

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function today() { return isoDate(new Date()); }
function startOfWeek(date: Date) { const copy = new Date(date); copy.setDate(copy.getDate() - copy.getDay()); return copy; }

function occurrenceMatches(item: AgendaItem, date: string) {
  if (item.date === date) return true;
  if (date < item.date) return false;
  const current = new Date(`${date}T12:00:00`);
  const origin = new Date(`${item.date}T12:00:00`);
  if (item.recurrence === "daily") return true;
  if (item.recurrence === "weekly") return (item.recurrenceWeekdays?.length ? item.recurrenceWeekdays : [origin.getDay()]).includes(current.getDay());
  if (item.recurrence === "monthly") return (item.recurrenceMonthDays?.length ? item.recurrenceMonthDays : [origin.getDate()]).includes(current.getDate());
  return false;
}

export default function AgendaPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [modal, setModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSeeTeam = profile?.role === "admin" || profile?.role === "gerente";
  const selected = useMemo(() => new Date(`${selectedDate}T12:00:00`), [selectedDate]);
  const [recurrence, setRecurrence] = useState<AgendaRecurrence>("none");
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [selectedMonthDays, setSelectedMonthDays] = useState<number[]>([]);

  useEffect(() => {
    let active = true;
    if (!profile?.id) return;
    Promise.allSettled([listAgendaItems(profile.id, canSeeTeam), listUserProfiles()]).then(([agendaResult, usersResult]) => {
      if (!active) return;
      if (agendaResult.status === "fulfilled") setItems(agendaResult.value);
      else setError("Não foi possível carregar os compromissos. Verifique a conexão com o sistema.");
      if (usersResult.status === "fulfilled") setUsers(usersResult.value.filter((user) => user.active));
      else setError("Não foi possível carregar os colaboradores cadastrados.");
    })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [profile, canSeeTeam]);

  const visibleDates = useMemo(() => {
    if (view === "day") return [selectedDate];
    if (view === "week") {
      const start = startOfWeek(selected);
      return Array.from({ length: 7 }, (_, index) => isoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)));
    }
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => isoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)));
  }, [selectedDate, selected, view]);

  const filteredItems = useMemo(() => items.filter((item) => scope === "team" || item.ownerId === profile?.id || item.participantIds?.includes(profile?.id ?? "")), [items, profile?.id, scope]);
  const itemForDate = (date: string) => filteredItems.filter((item) => occurrenceMatches(item, date));
  const isCompleted = (item: AgendaItem, date: string) => item.recurrence === "none" ? Boolean(item.completed) : item.completedDates?.includes(date) ?? false;

  function navigate(amount: number) {
    const next = new Date(selected);
    if (view === "month") {
      next.setDate(1);
      next.setMonth(next.getMonth() + amount);
    } else {
      next.setDate(next.getDate() + (view === "week" ? amount * 7 : amount));
    }
    setSelectedDate(isoDate(next));
  }

  async function complete(item: AgendaItem, date: string) {
    const next = !isCompleted(item, date);
    setItems((current) => current.map((entry) => entry.id !== item.id ? entry : entry.recurrence === "none" ? { ...entry, completed: next } : { ...entry, completedDates: next ? [...(entry.completedDates ?? []), date] : (entry.completedDates ?? []).filter((entryDate) => entryDate !== date) }));
    if (item.id.startsWith("demo-")) return;
    if (item.recurrence === "none") await toggleAgendaItem(item.id, next);
    else await toggleAgendaItemOccurrence(item.id, date, next);
  }

  function resetRecurrence() {
    setRecurrence("none");
    setSelectedWeekdays([]);
    setSelectedMonthDays([]);
  }

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.id) return;
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind")) as AgendaItemKind;
    const participantIds = form.getAll("participantIds") as string[];
    const participantNames = users.filter((user) => participantIds.includes(user.id)).map((user) => user.name);
    const item = { title: String(form.get("title")), kind, date: String(form.get("date")), startTime: String(form.get("startTime") || ""), endTime: String(form.get("endTime") || ""), recurrence, recurrenceWeekdays: recurrence === "weekly" ? selectedWeekdays : [], recurrenceMonthDays: recurrence === "monthly" ? selectedMonthDays : [], ownerId: profile.id, ownerName: profile.name, participantIds, participantNames, location: String(form.get("location") || ""), description: String(form.get("description") || ""), color: kindColor[kind] };
    if (recurrence === "weekly" && !selectedWeekdays.length) { setError("Escolha pelo menos um dia da semana."); return; }
    if (recurrence === "monthly" && !selectedMonthDays.length) { setError("Escolha pelo menos um dia do mês."); return; }
    setSaving(true);
    try {
      const id = await saveAgendaItem(item);
      setItems((current) => [...current, { ...item, id }]);
      setSelectedDate(item.date);
      setModal(false);
      resetRecurrence();
      setError("");
    } catch { setError("Não foi possível salvar o compromisso. Verifique se o acesso ao Firebase está ativo."); }
    finally { setSaving(false); }
  }

  return <ProtectedPage title="Agenda" subtitle="Organize tarefas, eventos e reuniões com toda a equipe.">
    <main className="page-wrap agenda-page">
      <div className="agenda-toolbar"><div><span className="agenda-eyebrow">Visão de trabalho</span><h2>{view === "day" ? selected.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) : `${monthNames[selected.getMonth()]} ${selected.getFullYear()}`}</h2><p>{filteredItems.length} compromissos nesta agenda</p></div><div className="agenda-actions"><div className="agenda-segmented">{(["month", "week", "day"] as const).map((option) => <button key={option} className={view === option ? "active" : ""} onClick={() => setView(option)}>{option === "month" ? "Mês" : option === "week" ? "Semana" : "Dia"}</button>)}</div><button className="primary-btn" onClick={() => { setError(""); resetRecurrence(); setModal(true); }}>+ Novo item</button></div></div>
      <section className="agenda-summary"><div><span>Hoje</span><strong>{itemForDate(today()).length}</strong><small>compromissos</small></div><div><span>Tarefas abertas</span><strong>{filteredItems.filter((item) => item.kind === "task" && !item.completed).length}</strong><small>para acompanhar</small></div><div><span>Próxima reunião</span><strong>{filteredItems.filter((item) => item.kind === "meeting" && item.date >= today()).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))[0]?.startTime ?? "—"}</strong><small>na sua agenda</small></div><div className="agenda-scope"><span>Mostrar</span><div className="agenda-segmented">{canSeeTeam && <button className={scope === "team" ? "active" : ""} onClick={() => setScope("team")}>Toda equipe</button>}<button className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")}>Minha agenda</button></div></div></section>
      {error && <div className="duplicate-alert"><strong>Atenção</strong><span>{error}</span></div>}
      <section className={`agenda-calendar agenda-${view}`}><div className="agenda-calendar-head"><button onClick={() => navigate(-1)}>‹</button><button className="today-btn" onClick={() => setSelectedDate(today())}>Hoje</button><button onClick={() => navigate(1)}>›</button><span>{view === "month" ? "Visão mensal" : view === "week" ? "Visão semanal" : "Agenda do dia"}</span></div>{view !== "day" && <div className="agenda-weekdays">{(view === "month" ? shortWeekdays : visibleDates.map((date) => shortWeekdays[new Date(`${date}T12:00:00`).getDay()])).map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>}<div className="agenda-grid">{loading ? <div className="empty">Carregando agenda...</div> : visibleDates.map((date) => <div key={date} className={`agenda-cell ${date === today() ? "is-today" : ""} ${date === selectedDate ? "is-selected" : ""} ${view === "month" && date.slice(0, 7) !== selectedDate.slice(0, 7) ? "is-muted" : ""}`} onClick={() => { setSelectedDate(date); if (view === "month") setView("day"); }}><div className="agenda-date"><strong>{new Date(`${date}T12:00:00`).getDate()}</strong>{date === today() && <span>Hoje</span>}</div><div className="agenda-items">{itemForDate(date).slice(0, view === "month" ? 3 : 8).map((item) => <button key={`${item.id}-${date}`} className="agenda-item" style={{ "--item-color": item.color ?? kindColor[item.kind] } as CSSProperties} onClick={(event) => { event.stopPropagation(); if (item.kind === "task") void complete(item, date); }}><i className={isCompleted(item, date) ? "done" : ""}></i><span>{item.startTime && <b>{item.startTime}</b>}{item.title}</span></button>)}{itemForDate(date).length > 3 && view === "month" && <small className="more-items">+{itemForDate(date).length - 3} mais</small>}</div></div>)}</div></section>
      <section className="agenda-bottom"><div><span className="agenda-eyebrow">Legenda</span><div className="agenda-legend"><span><i style={{ background: kindColor.task }} />Tarefas</span><span><i style={{ background: kindColor.event }} />Eventos</span><span><i style={{ background: kindColor.meeting }} />Reuniões</span></div></div><div className="agenda-note"><strong>Agenda compartilhada</strong><span>Participantes selecionados recebem o compromisso na própria agenda.</span></div></section>
    </main>
    {modal && <div className="modal-backdrop" onClick={() => setModal(false)}><form className="agenda-modal" onSubmit={createItem} onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><span>Novo compromisso</span><strong>Adicionar à agenda</strong></div><button type="button" onClick={() => setModal(false)}>×</button></div><label>O que você precisa fazer?<input name="title" required autoFocus placeholder="Ex.: Reunião de alinhamento" /></label><div className="agenda-form-grid"><label>Tipo<select name="kind" defaultValue="task"><option value="task">Tarefa</option><option value="event">Evento</option><option value="meeting">Reunião</option></select></label><label>Data<input name="date" type="date" defaultValue={selectedDate} required /></label><label>Início<input name="startTime" type="time" defaultValue="09:00" /></label><label>Fim<input name="endTime" type="time" /></label></div><label>Recorrência<select value={recurrence} onChange={(event) => setRecurrence(event.target.value as AgendaRecurrence)}><option value="none">Não se repete</option><option value="daily">Todos os dias</option><option value="weekly">Dias da semana</option><option value="monthly">Dias do mês</option></select></label>{recurrence === "weekly" && <div className="recurrence-options"><span>Repetir toda:</span><div className="recurrence-pills">{weekdays.map((day, index) => <button type="button" key={day} className={selectedWeekdays.includes(index) ? "selected" : ""} onClick={() => setSelectedWeekdays((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])}>{day}</button>)}</div></div>}{recurrence === "monthly" && <div className="recurrence-options"><span>Repetir todo dia:</span><div className="recurrence-pills month-pills">{Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <button type="button" key={day} className={selectedMonthDays.includes(day) ? "selected" : ""} onClick={() => setSelectedMonthDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])}>{String(day).padStart(2, "0")}</button>)}</div></div>}<label>Local ou link<input name="location" placeholder="Ex.: Sala de reunião" /></label><label>Participantes cadastrados<select name="participantIds" multiple>{users.filter((user) => user.id !== profile?.id).map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email ?? "colaborador"}</option>)}</select><small className="field-help">Use Ctrl (Windows) ou ⌘ (Mac) para escolher mais de uma pessoa.</small></label><label>Observações<textarea name="description" rows={3} placeholder="Pauta, lembretes ou detalhes" /></label><div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => setModal(false)}>Cancelar</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Salvar compromisso"}</button></div></form></div>}
  </ProtectedPage>;
}
