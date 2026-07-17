"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "@/context/auth-context";
import { findVehicleFlowConflict, savePreparedVehicle, subscribeActiveVehicleFlows } from "@/services/firestore";
import type { FlowLane, VehicleFlow } from "@/types/domain";

const technicians = ["Definir", "Wesley", "Ayslan", "Gilvan", "Elimarcos", "Hernando", "Nathan", "Igo"];

const laneLabels: Record<FlowLane, string> = {
  preparacao_confirmada: "Agendamento do dia",
  aguardando_servico: "Aguardando serviço",
  em_servico: "Em serviço",
  orcamento_complementar: "Orçamento complementar",
  aguardando_lavagem: "Aguardando lavagem",
  lavagem: "Lavagem",
  preparacao_entrega: "Preparação de entrega",
  entregue: "Entregue",
};

type Appointment = {
  id: string;
  client: string;
  plate: string;
  model: string;
  chassi: string;
  eventId: string;
  time: string;
  date: string;
  service: string;
  consultant: string;
  phone: string;
  note: string;
  serviceClass: string;
  priority: "Normal" | "Alta";
  technician: string;
  roadTest: boolean;
  chief: boolean;
  confirmed: boolean;
  internalNote: string;
};

type ImportState = {
  fileName: string;
  appointments: Appointment[];
  error: string;
};

const initialState: ImportState = {
  fileName: "",
  appointments: [],
  error: "",
};

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function normalize(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function valueAfterLabel(value: unknown, label: string) {
  const text = normalize(value);
  const index = text.toLowerCase().indexOf(label.toLowerCase());
  if (index < 0) return "";
  return text.slice(index + label.length).replace(/^[:\s]+/, "").trim();
}

function fieldFromRow(row: unknown[], label: string) {
  for (const cell of row) {
    const value = valueAfterLabel(cell, label);
    if (value) return value;
  }

  return "";
}

function parseDateTime(value: string) {
  const match = value.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/);
  if (!match) return { date: "", time: "" };

  const [, dateBr, time] = match;
  const [day, month, year] = dateBr.split("/");
  return { date: `${year}-${month}-${day}`, time };
}

function formatBrDate(date: string) {
  if (!date) return "Data não identificada";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function serviceClass(service: string, note: string) {
  const text = `${service} ${note}`.toLowerCase();
  if (text.includes("diagn")) return "diagnostico";
  if (text.includes("reparo")) return "reparo";
  if (text.includes("recall")) return "recall";
  if (text.includes("combinado")) return "combo";
  return "revisao";
}

function shortName(name?: string) {
  return String(name ?? "").trim().split(/\s+/)[0] || "-";
}

function shouldSuggestRoadTest(service: string, note: string) {
  const text = `${service} ${note}`.toLowerCase();
  return [
    "diagn",
    "barulho",
    "ruido",
    "freio",
    "suspensao",
    "repuxando",
    "falha",
    "vibra",
    "teste",
  ].some((term) => text.includes(term));
}

function shouldSuggestHighPriority(service: string, note: string) {
  const text = `${service} ${note}`.toLowerCase();
  return text.includes("diagn") || text.includes("cliente aguarda") || text.includes("retorno");
}

function isMissingPlate(plate: string) {
  return !plate.trim() || plate.toUpperCase().startsWith("SEMPLACA");
}

function parseAgendaRows(rows: unknown[][]) {
  const appointments: Appointment[] = [];
  let currentConsultant = "";

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const firstCell = normalize(row[0]);

    if (firstCell.startsWith("Consultor:")) {
      currentConsultant = valueAfterLabel(firstCell, "Consultor");
      continue;
    }

    if (!firstCell.startsWith("Cliente:")) {
      continue;
    }

    const vehicleRow = row;
    const serviceRow = rows[index + 1] ?? [];
    const phoneRow = rows[index + 2] ?? [];
    const noteRow = rows[index + 3] ?? [];
    const dateTime = parseDateTime(fieldFromRow(vehicleRow, "Data Agendamento"));
    const service = fieldFromRow(serviceRow, "Servico") || fieldFromRow(serviceRow, "Serviço") || "Serviço não informado";
    const note = fieldFromRow(noteRow, "Servicos Adicionais") || fieldFromRow(noteRow, "Serviços Adicionais") || "Sem observação importada.";
    const roadTest = shouldSuggestRoadTest(service, note);
    const priority = shouldSuggestHighPriority(service, note) ? "Alta" : "Normal";
    const plate = fieldFromRow(vehicleRow, "Placa") || `SEMPLACA-${appointments.length + 1}`;
    const eventText = fieldFromRow(serviceRow, "Evento");
    const eventId = eventText.split(" ")[0] || "";

    appointments.push({
      id: `${eventId || plate}-${appointments.length}`,
      client: fieldFromRow(vehicleRow, "Cliente") || "Cliente sem nome",
      plate,
      model: fieldFromRow(vehicleRow, "Modelo") || "Modelo não informado",
      chassi: fieldFromRow(serviceRow, "Chassi"),
      eventId,
      time: dateTime.time || "--:--",
      date: dateTime.date,
      service,
      consultant: currentConsultant || "Consultor não informado",
      phone: fieldFromRow(phoneRow, "Celular") || fieldFromRow(phoneRow, "Fone Residencial") || fieldFromRow(phoneRow, "Fone Comercial"),
      note,
      serviceClass: serviceClass(service, note),
      priority,
      technician: "Definir",
      roadTest,
      chief: roadTest,
      confirmed: false,
      internalNote: "",
    });
  }

  return appointments;
}

function duplicateChassis(appointments: Appointment[]) {
  const counts = new Map<string, number>();

  appointments.forEach((item) => {
    const key = item.chassi.trim().toUpperCase();
    if (!key) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([chassi]) => chassi),
  );
}

function conflictMessage(conflict: { clientName?: string; plate?: string; chassi?: string; currentLane?: string; serviceLabel?: string }) {
  return [
    "Já existe um chip para esta placa ou chassi neste dia.",
    "",
    `Cliente: ${conflict.clientName || "-"}`,
    `Placa: ${conflict.plate || "-"}`,
    `Chassi: ${conflict.chassi || "-"}`,
    `Etapa atual: ${conflict.currentLane || "-"}`,
    `Serviço: ${conflict.serviceLabel || "-"}`,
    "",
    "Cancelar evita duplicidade. Continuar deve ser usado apenas se for realmente outro atendimento.",
    "",
    "Deseja continuar mesmo assim?",
  ].join("\n");
}

export function PreparationImport() {
  const { profile, user } = useAuth();
  const [state, setState] = useState<ImportState>(initialState);
  const [selectedDate, setSelectedDate] = useState(tomorrowDate);
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [flowVehicles, setFlowVehicles] = useState<VehicleFlow[]>([]);

  useEffect(() => {
    return subscribeActiveVehicleFlows(setFlowVehicles, undefined, { includeDelivered: true });
  }, []);

  const detectedDates = useMemo(() => {
    return Array.from(new Set(state.appointments.map((item) => item.date).filter(Boolean))).sort();
  }, [state.appointments]);

  const appointmentsForDate = useMemo(() => {
    if (!selectedDate) return state.appointments;
    return state.appointments.filter((item) => item.date === selectedDate);
  }, [selectedDate, state.appointments]);

  const duplicatedInFile = useMemo(() => duplicateChassis(state.appointments), [state.appointments]);
  const duplicatedInDate = useMemo(() => duplicateChassis(appointmentsForDate), [appointmentsForDate]);

  const workshopTechnicians = useMemo(() => technicians.filter((name) => name !== "Definir"), []);

  const pendingPreviousVehicles = useMemo(() => {
    if (!selectedDate) return [];

    return flowVehicles
      .filter((vehicle) => (
        vehicle.status !== "cancelado"
        && (vehicle.currentLane === "aguardando_servico" || vehicle.currentLane === "em_servico")
        && !vehicle.noShow
        && Boolean(vehicle.appointmentDate && vehicle.appointmentDate < selectedDate)
      ))
      .sort((a, b) => `${a.appointmentDate ?? ""}${a.appointmentTime ?? ""}`.localeCompare(`${b.appointmentDate ?? ""}${b.appointmentTime ?? ""}`));
  }, [flowVehicles, selectedDate]);

  const confirmedPreparedVehicles = useMemo(() => {
    if (!selectedDate) return [];

    return flowVehicles
      .filter((vehicle) => (
        vehicle.status !== "cancelado"
        && vehicle.currentLane === "preparacao_confirmada"
        && vehicle.appointmentDate === selectedDate
      ))
      .sort((a, b) => `${a.appointmentTime ?? ""}${a.clientName ?? ""}`.localeCompare(`${b.appointmentTime ?? ""}${b.clientName ?? ""}`));
  }, [flowVehicles, selectedDate]);

  const technicianPlanning = useMemo(() => {
    return workshopTechnicians.map((technician) => {
      const scheduled = appointmentsForDate.filter((item) => item.technician === technician);
      const confirmed = confirmedPreparedVehicles.filter((vehicle) => shortName(vehicle.technicianName) === technician);
      const pending = pendingPreviousVehicles.filter((vehicle) => shortName(vehicle.technicianName) === technician);
      const confirmedIds = new Set(confirmed.map((vehicle) => vehicle.id));
      const scheduledOnly = scheduled.filter((item) => !confirmedIds.has(item.id));

      return {
        technician,
        scheduled: scheduledOnly,
        confirmed,
        pending,
        total: scheduledOnly.length + confirmed.length + pending.length,
      };
    });
  }, [appointmentsForDate, confirmedPreparedVehicles, pendingPreviousVehicles, workshopTechnicians]);

  const filteredAppointments = useMemo(() => {
    return appointmentsForDate.filter((item) => {
      const matchesMissing = !missingOnly || item.technician === "Definir";
      return matchesMissing;
    });
  }, [appointmentsForDate, missingOnly]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      const parsed = parseAgendaRows(rows);
      const firstDate = parsed.find((item) => item.date)?.date ?? "";

      setState({
        fileName: file.name,
        appointments: parsed,
        error: parsed.length ? "" : "Nenhum agendamento foi identificado neste arquivo.",
      });
      setSelectedDate(firstDate);
      setDateConfirmed(false);
      setMissingOnly(false);
    } catch (error) {
      setState({
        ...initialState,
        fileName: file.name,
        error: error instanceof Error ? error.message : "Não foi possível ler o arquivo.",
      });
      setSelectedDate("");
      setDateConfirmed(false);
    }
  }

  function updateAppointment(id: string, patch: Partial<Appointment>) {
    setState((current) => ({
      ...current,
      appointments: current.appointments.map((item) => (
        item.id === id ? { ...item, ...patch } : item
      )),
    }));
  }

  async function confirmAppointment(item: Appointment) {
    if (!dateConfirmed || !selectedDate) {
      window.alert("Confirme a data que será preparada antes de confirmar o veículo.");
      return;
    }

    if (item.technician === "Definir") {
      window.alert("Defina o técnico antes de confirmar a preparação.");
      return;
    }

    setSavingId(item.id);
    localStorage.setItem("prepSession", state.fileName || "agenda-importada");
    localStorage.setItem("selectedFlowDate", selectedDate);

    try {
      const conflict = await findVehicleFlowConflict({
        plate: item.plate,
        chassi: item.chassi,
        appointmentDate: item.date || selectedDate,
        ignoreId: item.id,
      });

      if (conflict && !window.confirm(conflictMessage(conflict))) {
        return;
      }

      await savePreparedVehicle({
        sourceFileName: state.fileName || "agenda-importada",
        selectedDate,
        importedBy: profile?.name ?? user?.email ?? user?.uid,
        vehicle: {
          id: item.id,
          client: item.client,
          plate: item.plate,
          model: item.model,
          chassi: item.chassi,
          eventId: item.eventId,
          phone: item.phone,
          service: item.service,
          consultant: item.consultant,
          technician: item.technician,
          priority: item.priority,
          roadTest: item.roadTest,
          chief: item.chief,
          importedNote: item.note,
          internalNote: item.internalNote,
          appointmentDate: item.date,
          appointmentTime: item.time,
          origin: "Agendado",
        },
      });

      updateAppointment(item.id, { confirmed: true });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível confirmar a preparação no Firestore.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <main className="prep-page">
      <aside className="prep-sidebar">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Agenda importada</h2>
          </div>
          <div className="panel-body">
            <div className="upload-box">
              <strong>Arquivo Excel 97/2003</strong>
              <span>
                Importe o arquivo .xls do agendamento. O sistema identifica consultor, cliente, modelo, placa,
                horário, serviço, chassi, telefone e observações.
              </span>
              <label className="file-button">
                <input accept=".xls,.xlsx" type="file" onChange={handleFile} />
                <strong>Adicionar arquivo do agendamento</strong>
                <span>.xls ou .xlsx</span>
              </label>
              {state.fileName && <span className="import-file-name">{state.fileName}</span>}
              {state.error && <span className="import-error">{state.error}</span>}
            </div>
          </div>
        </section>
      </aside>

      <section className="prep-main">
        {true && (
          <section className={`prep-date-confirm ${dateConfirmed ? "confirmed" : ""}`}>
            <div>
              <strong>Calendário da preparação</strong>
              <span>
                Planeje o dia escolhido, acompanhe pendentes de dias anteriores e direcione a agenda por técnico.
                {state.appointments.length > 0 && ` Arquivo atual: ${state.appointments.length} atendimento(s).`}
              </span>
            </div>

            <label>
              <span>Data da preparação</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  setDateConfirmed(false);
                }}
              />
            </label>

            {detectedDates.length > 1 && (
              <select
                value={selectedDate}
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  setDateConfirmed(false);
                }}
              >
                {detectedDates.map((date) => (
                  <option key={date} value={date}>
                    {formatBrDate(date)}
                  </option>
                ))}
              </select>
            )}

            <button className="primary-btn" type="button" onClick={() => setDateConfirmed(true)}>
              Confirmar data
            </button>
            {savingId && <span className="save-status">Enviando veículo para o fluxo...</span>}
          </section>
        )}

        {duplicatedInFile.size > 0 && (
          <div className="duplicate-alert">
            <strong>Chassi duplicado identificado</strong>
            <span>
              {duplicatedInFile.size} chassi(s) aparecem mais de uma vez no arquivo. Os cards duplicados serão
              sinalizados para conferência do chefe de oficina.
            </span>
          </div>
        )}

        <div className="prep-summary-row">
          <div className="metric"><strong>{appointmentsForDate.length}</strong><span>agendamentos</span></div>
          <div className="metric danger"><strong>{pendingPreviousVehicles.length}</strong><span>pendentes anteriores</span></div>
          <div className="metric"><strong>{appointmentsForDate.filter((item) => item.confirmed).length}</strong><span>confirmados</span></div>
          <div className="metric"><strong>{appointmentsForDate.filter((item) => item.roadTest).length}</strong><span>testes rodagem</span></div>
          <div className="metric"><strong>{appointmentsForDate.filter((item) => item.technician === "Definir").length}</strong><span>sem técnico</span></div>
          <div className="metric"><strong>{duplicatedInDate.size}</strong><span>chassis duplicados</span></div>
        </div>

        <section className="technician-plan panel">
          <div className="panel-head">
            <h2 className="panel-title">Distribuição estratégica por técnico - {formatBrDate(selectedDate)}</h2>
          </div>
          <div className="panel-body technician-plan-grid">
            {technicianPlanning.map((group) => (
              <article key={group.technician} className="technician-plan-card">
                <header>
                  <strong>{group.technician}</strong>
                  <span>{group.total}</span>
                </header>

                <div className="plan-section pending">
                  <div className="plan-section-title">
                    <span>Pendentes</span>
                    <b>{group.pending.length}</b>
                  </div>
                  {group.pending.length ? group.pending.map((vehicle) => (
                    <div key={`pending-${vehicle.id}`} className="plan-chip pending">
                      <strong>{vehicle.clientName || "Cliente não identificado"}</strong>
                      <span>{vehicle.plate || "-"} · {vehicle.serviceLabel || "-"} · {laneLabels[vehicle.currentLane]}</span>
                    </div>
                  )) : <p>Nenhum pendente.</p>}
                </div>

                <div className="plan-section">
                  <div className="plan-section-title">
                    <span>Agenda direcionada</span>
                    <b>{group.scheduled.length + group.confirmed.length}</b>
                  </div>
                  {group.confirmed.map((vehicle) => (
                    <div key={`confirmed-${vehicle.id}`} className="plan-chip confirmed">
                      <strong>{vehicle.clientName || "Cliente não identificado"}</strong>
                      <span>{vehicle.appointmentTime || "--:--"} · {vehicle.plate || "-"} · confirmado</span>
                    </div>
                  ))}
                  {group.scheduled.map((item) => (
                    <div key={`scheduled-${item.id}`} className="plan-chip">
                      <strong>{item.client}</strong>
                      <span>{item.time} · {isMissingPlate(item.plate) ? "Sem placa" : item.plate} · {item.service}</span>
                    </div>
                  ))}
                  {!group.confirmed.length && !group.scheduled.length && <p>Nada direcionado.</p>}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="prep-board panel">
          <div className="panel-head">
            <h2 className="panel-title">
              Preparação da oficina {dateConfirmed && selectedDate ? `- ${formatBrDate(selectedDate)}` : ""}
            </h2>
            <button className="ghost-btn" type="button" onClick={() => setMissingOnly((value) => !value)}>
              {missingOnly ? "Ver todos" : "Ver sem técnico"}
            </button>
          </div>
          <div className="panel-body">
            {!state.appointments.length ? (
              <div className="prep-empty">
                <strong>Importe a agenda do dia seguinte para iniciar.</strong>
                <span>Use o botão Adicionar arquivo do agendamento ao lado. Os atendimentos aparecerão aqui em formato de preparação.</span>
              </div>
            ) : !dateConfirmed ? (
              <div className="prep-empty">
                <strong>Confirme a data antes de iniciar a preparação.</strong>
                <span>Isso evita preparar a agenda errada quando o chefe de oficina adianta um ou mais dias.</span>
              </div>
            ) : !appointmentsForDate.length ? (
              <div className="prep-empty">
                <strong>Nenhum atendimento encontrado para {formatBrDate(selectedDate)}.</strong>
                <span>Escolha uma das datas encontradas no arquivo ou importe a agenda correta.</span>
              </div>
            ) : (
              <div className="prep-card-grid">
                {filteredAppointments.map((item) => {
                  const duplicated = duplicatedInFile.has(item.chassi.trim().toUpperCase());

                  return (
                    <article key={item.id} className={`prep-card ${item.serviceClass} ${item.confirmed ? "confirmed" : ""} ${duplicated ? "duplicate" : ""}`}>
                      <div className="chip-top">
                        <div>
                          <h3 className="client">{item.client}</h3>
                          <p className="model">{item.model}</p>
                        </div>
                        <span className={`plate ${isMissingPlate(item.plate) ? "missing-plate" : ""}`}>
                          {isMissingPlate(item.plate) ? "Sem placa" : item.plate}
                        </span>
                      </div>

                      <div className="tag-row">
                        <span className="tag">{item.time}</span>
                        <span className="tag">{item.service}</span>
                        {item.roadTest && <span className="tag warn">Teste rodagem</span>}
                        {duplicated && <span className="tag bad">Chassi duplicado</span>}
                      </div>

                      <div className="prep-inline">
                        <label className="field">
                          <span>Placa</span>
                          <input
                            value={isMissingPlate(item.plate) ? "" : item.plate}
                            disabled={item.confirmed}
                            placeholder="Adicionar placa"
                            onChange={(event) => updateAppointment(item.id, { plate: event.target.value.toUpperCase() })}
                          />
                        </label>
                        <div className="detail"><span>Consultor</span>{item.consultant}</div>
                        <div className="detail"><span>Horário agenda</span>{item.time}</div>
                      </div>

                      <div className="import-note">
                        <span>Observação importada da agenda</span>
                        {item.note}
                      </div>

                      <div className="prep-inline">
                        <label className="field">
                          <span>Técnico</span>
                          <select
                            value={item.technician}
                            disabled={item.confirmed}
                            onChange={(event) => updateAppointment(item.id, { technician: event.target.value })}
                          >
                            {technicians.map((name) => <option key={name}>{name}</option>)}
                          </select>
                        </label>
                        <label className="field">
                          <span>Prioridade</span>
                          <select
                            value={item.priority}
                            disabled={item.confirmed}
                            onChange={(event) => updateAppointment(item.id, { priority: event.target.value as Appointment["priority"] })}
                          >
                            <option>Normal</option>
                            <option>Alta</option>
                          </select>
                        </label>
                      </div>

                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={item.roadTest}
                          disabled={item.confirmed}
                          onChange={(event) => updateAppointment(item.id, { roadTest: event.target.checked })}
                        />
                        Precisa de teste de rodagem
                      </label>
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={item.chief}
                          disabled={item.confirmed}
                          onChange={(event) => updateAppointment(item.id, { chief: event.target.checked })}
                        />
                        Chefe/oficina deve ouvir relato do cliente
                      </label>

                      <label className="field">
                        <span>Observação da oficina</span>
                        <textarea
                          value={item.internalNote}
                          disabled={item.confirmed}
                          onChange={(event) => updateAppointment(item.id, { internalNote: event.target.value })}
                        />
                      </label>

                      <button
                        className="confirm-btn"
                        type="button"
                        disabled={item.technician === "Definir" || item.confirmed || savingId === item.id}
                        onClick={() => confirmAppointment(item)}
                      >
                        {savingId === item.id ? "Enviando..." : item.confirmed ? "Preparação confirmada" : "Confirmar preparação"}
                      </button>

                      <div className="prep-status">
                        <span>{item.technician === "Definir" ? "Aguardando técnico" : "Técnico definido"}</span>
                        <strong>{item.confirmed ? "No fluxo do dia" : "Não confirmado"}</strong>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
