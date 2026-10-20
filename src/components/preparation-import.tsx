"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIMITED_OPERATION } from "@/lib/limited-operation";
import { saveBasicPreparedVehicle } from "@/services/basic-preparation";
import styles from "./preparation-import.module.css";
import * as XLSX from "xlsx";
import { useAuth } from "@/context/auth-context";
import { findVehicleFlowConflict, savePreparedVehicle, subscribePartOrdersByStatuses, subscribeVehicleFlowsByIds, subscribeVehicleFlowsForPreparation } from "@/services/firestore";
import type { FlowLane, PartOrder, PartOrderStatus, VehicleFlow } from "@/types/domain";

const technicians = ["Definir", "Wesley", "Ayslan", "Gilvan", "Elimarcos", "Hernando", "Nathan", "Igo"];
const openPartOrderStatuses: PartOrderStatus[] = [
  "solicitado_oficina",
  "necessidade_identificada",
  "aguardando_pecas",
  "pedido_realizado",
  "back_order",
  "em_transito",
  "recebido",
  "disponivel",
  "disponivel_execucao",
];

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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalize(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeIdentifier(value: unknown) {
  const identifier = normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  if (
    !identifier
    || ["NULL", "UNDEFINED", "NA", "NAOINFORMADO", "SEMINFORMACAO"].includes(identifier)
    || identifier.startsWith("SEMPLACA")
    || identifier.startsWith("SEMCHASSI")
  ) {
    return "";
  }

  return identifier;
}

function displayIdentifier(value: unknown) {
  return normalizeIdentifier(value) ? normalize(value) : "-";
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
    const importedPlate = fieldFromRow(vehicleRow, "Placa");
    const plate = normalizeIdentifier(importedPlate) ? importedPlate : `SEMPLACA-${appointments.length + 1}`;
    const importedChassi = fieldFromRow(serviceRow, "Chassi");
    const eventText = fieldFromRow(serviceRow, "Evento");
    const eventId = eventText.split(" ")[0] || "";

    appointments.push({
      id: `${eventId || plate}-${appointments.length}`,
      client: fieldFromRow(vehicleRow, "Cliente") || "Cliente sem nome",
      plate,
      model: fieldFromRow(vehicleRow, "Modelo") || "Modelo não informado",
      chassi: normalizeIdentifier(importedChassi) ? importedChassi : "",
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
    const key = normalizeIdentifier(item.chassi);
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
    "Já existe um chip para este mesmo chassi neste dia.",
    "",
    `Cliente: ${conflict.clientName || "-"}`,
    `Placa: ${displayIdentifier(conflict.plate)}`,
    `Chassi: ${displayIdentifier(conflict.chassi)}`,
    `Etapa atual: ${conflict.currentLane || "-"}`,
    `Serviço: ${conflict.serviceLabel || "-"}`,
    "",
    "O chassi coincide com outro chip. Cancelar evita duplicidade; continuar deve ser usado apenas se for realmente outro atendimento.",
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
  const [availableImmobilizedOnly, setAvailableImmobilizedOnly] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [preparationVehicles, setPreparationVehicles] = useState<VehicleFlow[]>([]);
  const [orderVehicles, setOrderVehicles] = useState<VehicleFlow[]>([]);
  const [partOrders, setPartOrders] = useState<PartOrder[]>([]);
  const savingLock = useRef(false);
  const [search, setSearch] = useState("");
  const [technicianFilter, setTechnicianFilter] = useState("");
  const [consultantFilter, setConsultantFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("time");

  useEffect(() => {
    if (LIMITED_OPERATION || !selectedDate) return undefined;
    return subscribeVehicleFlowsForPreparation(selectedDate, setPreparationVehicles);
  }, [selectedDate]);

  useEffect(() => {
    if (LIMITED_OPERATION) return;
    return subscribePartOrdersByStatuses(openPartOrderStatuses, setPartOrders, () => undefined);
  }, []);

  const partOrderVehicleIds = useMemo(
    () => Array.from(new Set(partOrders.map((order) => order.vehicleFlowId).filter(Boolean))).sort(),
    [partOrders],
  );
  const partOrderVehicleIdsKey = partOrderVehicleIds.join("|");

  useEffect(() => {
    if (LIMITED_OPERATION) return;
    return subscribeVehicleFlowsByIds(partOrderVehicleIds, setOrderVehicles, () => undefined);
  }, [partOrderVehicleIdsKey]);

  const flowVehicles = useMemo(() => [...new Map([
    ...preparationVehicles.map((vehicle) => [vehicle.id, vehicle] as const),
    ...orderVehicles.map((vehicle) => [vehicle.id, vehicle] as const),
  ]).values()], [orderVehicles, preparationVehicles]);

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

  const executionReadyOrders = useMemo(() => {
    return partOrders
      .map((order) => ({
        order,
        vehicle: flowVehicles.find((vehicle) => vehicle.id === order.vehicleFlowId),
      }))
      .filter(({ order, vehicle }) => (
        order.orderStatus === "disponivel_execucao"
        && vehicle?.status !== "cancelado"
      ))
      .sort((a, b) => String(a.order.expectedArrivalDate ?? a.order.updatedAt ?? "").localeCompare(String(b.order.expectedArrivalDate ?? b.order.updatedAt ?? "")));
  }, [flowVehicles, partOrders]);

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
      const availableImmobilized = executionReadyOrders.filter(({ order, vehicle }) => (
        shortName(vehicle?.technicianName ?? order.technicianName) === technician
      ));
      const confirmedIds = new Set(confirmed.map((vehicle) => vehicle.id));
      const scheduledOnly = scheduled.filter((item) => !confirmedIds.has(item.id));

      return {
        technician,
        scheduled: scheduledOnly,
        confirmed,
        pending,
        availableImmobilized,
        total: scheduledOnly.length + confirmed.length + pending.length + availableImmobilized.length,
      };
    });
  }, [appointmentsForDate, confirmedPreparedVehicles, executionReadyOrders, pendingPreviousVehicles, workshopTechnicians]);

  const filteredAppointments = useMemo(() => {
    if (availableImmobilizedOnly) return [];

    return appointmentsForDate.filter((item) => {
      const matchesMissing = !missingOnly || item.technician === "Definir";
      return matchesMissing;
    });
  }, [appointmentsForDate, availableImmobilizedOnly, missingOnly]);

  const linkedPartOrders = useCallback((item: Appointment) => {
    const appointmentPlate = normalizeIdentifier(item.plate);
    const appointmentChassi = normalizeIdentifier(item.chassi);

    return partOrders.filter((order) => {
      if (order.orderStatus === "cancelado") return false;
      if (order.vehicleFlowId === item.id) return true;
      const orderPlate = normalizeIdentifier(order.plate);
      const orderVehicle = flowVehicles.find((vehicle) => vehicle.id === order.vehicleFlowId);
      const orderChassi = normalizeIdentifier(orderVehicle?.chassi);
      return Boolean(
        (appointmentPlate && orderPlate && appointmentPlate === orderPlate)
        || (appointmentChassi && orderChassi && appointmentChassi === orderChassi),
      );
    });
  }, [flowVehicles, partOrders]);

  const appointmentsWithParts = useMemo(
    () => appointmentsForDate.filter((item) => linkedPartOrders(item).length > 0),
    [appointmentsForDate, linkedPartOrders],
  );

  function localIssues(item: Appointment) {
    const issues: string[] = [];
    if (!item.client.trim() || item.client === "Cliente sem nome") issues.push("Confira o cliente.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) issues.push("Confira o horário.");
    return issues;
  }
  const searchText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const localAppointments = appointmentsForDate.filter((item) =>
    searchText([item.client, item.plate, item.chassi, item.model, item.service, item.consultant].join(" ")).includes(searchText(search.trim()))
    && (!technicianFilter || item.technician === technicianFilter)
    && (!consultantFilter || item.consultant === consultantFilter)
    && (!statusFilter || (statusFilter === "confirmed" ? item.confirmed : statusFilter === "pending" ? !item.confirmed : item.technician === "Definir"))
  ).sort((a, b) => (sortBy === "technician" ? a.technician.localeCompare(b.technician) : sortBy === "consultant" ? a.consultant.localeCompare(b.consultant) : 0) || a.time.localeCompare(b.time) || a.client.localeCompare(b.client));

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
      setSearch(""); setTechnicianFilter(""); setConsultantFilter(""); setStatusFilter("");
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
    if (savingLock.current || item.confirmed) return;
    if (!dateConfirmed || !selectedDate) {
      window.alert("Confirme a data que será preparada antes de confirmar o veículo.");
      return;
    }

    if (item.technician === "Definir" || !item.technician.trim()) {
      window.alert("Defina o técnico antes de confirmar a preparação.");
      return;
    }

    if (LIMITED_OPERATION && localIssues(item).length) return;
    if (LIMITED_OPERATION && duplicatedInDate.has(normalizeIdentifier(item.chassi)) && !window.confirm("Este chassi aparece mais de uma vez nesta data. Confira os atendimentos. Deseja adicionar mesmo assim?")) return;
    savingLock.current = true;
    setSavingId(item.id);
    localStorage.setItem("prepSession", state.fileName || "agenda-importada");
    localStorage.setItem("selectedFlowDate", selectedDate);

    try {
      if (LIMITED_OPERATION) {
        await saveBasicPreparedVehicle({
          id: item.id, client: item.client, plate: normalizeIdentifier(item.plate),
          chassi: normalizeIdentifier(item.chassi), model: item.model,
          eventId: item.eventId, phone: item.phone, service: item.service,
          consultant: item.consultant, technician: item.technician === "Definir" ? "" : item.technician,
          appointmentDate: item.date || selectedDate, appointmentTime: item.time,
          roadTestRequired: item.roadTest, importedNote: item.note, sourceFileName: state.fileName,
          importedBy: profile?.name ?? user?.email ?? user?.uid ?? "",
        });
        updateAppointment(item.id, { confirmed: true });
        return;
      }
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
          partsOrdered: linkedPartOrders(item).length > 0,
        },
      });

      updateAppointment(item.id, { confirmed: true });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível confirmar a preparação no Firestore.");
    } finally {
      savingLock.current = false;
      setSavingId("");
    }
  }

  if (LIMITED_OPERATION) return (
    <main className={`page-wrap stack ${styles.page}`}>
      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">Preparar agenda da oficina</h2></div>
        <div className="panel-body stack">
          <p>Importe a agenda, confira os atendimentos e distribua os serviços antes de adicionar ao fluxo.</p>
          <div className={styles.filters}>
            <label className="field"><span>Agenda (.xls ou .xlsx)</span><input type="file" accept=".xls,.xlsx" disabled={Boolean(savingId)} onChange={handleFile} /></label>
            <label className="field"><span>Data da preparação</span><input type="date" value={selectedDate} disabled={Boolean(savingId)} onChange={(event) => { setSelectedDate(event.target.value); setDateConfirmed(false); }} /></label>
            <button type="button" className="primary-btn fit-btn" disabled={!selectedDate || Boolean(savingId)} onClick={() => setDateConfirmed(true)}>{dateConfirmed ? "Data confirmada" : "Confirmar data"}</button>
          </div>
          {state.fileName && <p>Arquivo: <strong>{state.fileName}</strong> · {state.appointments.length} atendimento(s).</p>}
          {state.error && <p role="alert" className="import-error">{state.error}</p>}
          {detectedDates.length > 1 && <p>Datas no arquivo: {detectedDates.map(formatBrDate).join(" · ")}</p>}
          {state.appointments.some((item) => !item.date) && <p role="alert">Há atendimentos sem data no arquivo. Corrija a planilha e importe novamente para incluí-los.</p>}
        </div>
      </section>
      <div className={styles.metrics} aria-label="Resumo da agenda importada">
        {[["Na agenda", appointmentsForDate.length], ["Adicionados nesta sessão", appointmentsForDate.filter((item) => item.confirmed).length], ["Pendentes de envio", appointmentsForDate.filter((item) => !item.confirmed).length], ["Sem técnico", appointmentsForDate.filter((item) => item.technician === "Definir").length]].map(([label, value]) => <div key={label} className={styles.metric}><strong>{value}</strong><span>{label}</span></div>)}
      </div>
      {state.appointments.length > 0 && <>
        <section className="panel"><div className="panel-head"><h2 className="panel-title">Distribuição da agenda por técnico</h2></div><div className={`panel-body ${styles.distribution}`}>
          {technicians.map((name) => <button type="button" key={name} aria-pressed={technicianFilter === name} className={styles.tech} onClick={() => setTechnicianFilter(technicianFilter === name ? "" : name)}><span>{name === "Definir" ? "Sem técnico" : name}</span><strong>{appointmentsForDate.filter((item) => item.technician === name).length}</strong></button>)}
        </div></section>
        <section className="panel"><div className={`panel-body ${styles.filters}`}>
          <label className="field"><span>Buscar atendimento</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, placa, chassi ou serviço" /></label>
          <label className="field"><span>Consultor</span><select value={consultantFilter} onChange={(event) => setConsultantFilter(event.target.value)}><option value="">Todos</option>{Array.from(new Set(appointmentsForDate.map((item) => item.consultant))).sort().map((name) => <option key={name}>{name}</option>)}</select></label>
          <label className="field"><span>Técnico</span><select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)}><option value="">Todos</option>{technicians.map((name) => <option key={name} value={name}>{name === "Definir" ? "Sem técnico" : name}</option>)}</select></label>
          <label className="field"><span>Situação</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todas</option><option value="pending">Pendentes de envio</option><option value="confirmed">Adicionados nesta sessão</option><option value="missing">Sem técnico</option></select></label>
          <label className="field"><span>Ordenar por</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="time">Horário</option><option value="technician">Técnico e horário</option><option value="consultant">Consultor e horário</option></select></label>
          <button className="ghost-btn" type="button" onClick={() => { setSearch(""); setTechnicianFilter(""); setConsultantFilter(""); setStatusFilter(""); }}>Limpar filtros</button>
        </div></section>
        <p aria-live="polite">{localAppointments.length} de {appointmentsForDate.length} atendimento(s) da data selecionada. As confirmações exibidas são desta sessão.</p>
      </>}
      {!state.appointments.length && <section className="panel"><div className="panel-body">Importe uma agenda para iniciar a preparação.</div></section>}
      {state.appointments.length > 0 && !localAppointments.length && <section className="panel"><div className="panel-body">Nenhum atendimento para esta data ou estes filtros. Confira a data ou limpe os filtros.</div></section>}
      <div className={styles.chipGrid}>
      {localAppointments.map((item) => (
        <section className="panel" key={item.id}><div className={`panel-body stack ${item.confirmed ? styles.confirmed : ""}`}>
          <div className={styles.cardHead}><div><strong>{item.time} · {item.client}</strong><p>{item.model} · {displayIdentifier(item.plate)} · {item.consultant}</p><p>{item.service}</p></div><span className={styles.badge}>{item.confirmed ? "Adicionado ao fluxo" : item.technician === "Definir" ? "Sem técnico" : "Pendente de envio"}</span></div>
          {duplicatedInDate.has(normalizeIdentifier(item.chassi)) && <p className={styles.warning}>Chassi repetido nesta data. Confira se são atendimentos diferentes.</p>}
          {!normalizeIdentifier(item.plate) && <p className={styles.warning}>Veículo sem placa informada. Confira o chassi nos detalhes.</p>}
          {localIssues(item).length > 0 && <p role="alert" className="import-error">{localIssues(item).join(" ")} Corrija a planilha e importe novamente.</p>}
          <details className={styles.details}><summary>Observações e dados do agendamento</summary><p><strong>Observação:</strong> {item.note}</p><p><strong>Chassi:</strong> {displayIdentifier(item.chassi)} · <strong>Telefone:</strong> {item.phone || "Não informado"}</p></details>
          <label className="check-line"><input type="checkbox" checked={item.roadTest} disabled={item.confirmed || Boolean(savingId)} onChange={(event) => updateAppointment(item.id, { roadTest: event.target.checked })} />Solicitar teste de rodagem no recebimento</label>
          {item.roadTest && <p className={styles.warning}>O consultor deverá informar no fluxo se o teste foi realizado.</p>}
          <div className={styles.actions}><label className="field"><span>Técnico</span><select value={item.technician} disabled={item.confirmed || Boolean(savingId)} onChange={(event) => updateAppointment(item.id, { technician: event.target.value })}>{technicians.map((name) => <option key={name}>{name}</option>)}</select></label>
          <button type="button" className="primary-btn" disabled={!dateConfirmed || item.confirmed || Boolean(savingId) || item.technician === "Definir" || !item.technician.trim() || localIssues(item).length > 0} onClick={() => confirmAppointment(item)}>{item.confirmed ? "Adicionado ao fluxo" : savingId === item.id ? "Adicionando..." : item.technician === "Definir" ? "Defina o técnico para adicionar" : "Adicionar ao fluxo"}</button></div>
          {!dateConfirmed && <small>Confirme a data acima para habilitar o envio.</small>}
        </div></section>
      ))}
      </div>
    </main>
  );

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
          <div className="metric danger"><strong>{appointmentsWithParts.length}</strong><span>com pedido de peça</span></div>
          <div className="metric danger"><strong>{pendingPreviousVehicles.length}</strong><span>pendentes anteriores</span></div>
          <button
            className={`metric warning ${availableImmobilizedOnly ? "selected" : ""}`}
            type="button"
            onClick={() => setAvailableImmobilizedOnly((value) => !value)}
          >
            <strong>{executionReadyOrders.length}</strong>
            <span>disponíveis para execução</span>
          </button>
          <div className="metric"><strong>{appointmentsForDate.filter((item) => item.confirmed).length}</strong><span>confirmados</span></div>
          <div className="metric"><strong>{appointmentsForDate.filter((item) => item.roadTest).length}</strong><span>testes rodagem</span></div>
          <div className="metric"><strong>{appointmentsForDate.filter((item) => item.technician === "Definir").length}</strong><span>sem técnico</span></div>
          <div className="metric"><strong>{duplicatedInDate.size}</strong><span>chassis duplicados</span></div>
        </div>

        {(availableImmobilizedOnly || executionReadyOrders.length > 0) && (
          <section className="available-immobilized panel">
            <div className="panel-head">
              <h2 className="panel-title">Veículos com peças disponíveis para execução</h2>
              <strong>{executionReadyOrders.length}</strong>
            </div>
            <div className="panel-body available-immobilized-grid">
              {executionReadyOrders.length ? executionReadyOrders.map(({ order, vehicle }) => (
                <article key={order.id} className="plan-chip immobilized-ready">
                  <strong>{vehicle?.clientName || order.clientName || "Cliente não identificado"}</strong>
                  <span>{vehicle?.plate || order.plate || "-"} · Técnico {shortName(vehicle?.technicianName ?? order.technicianName)} · Pedido {order.orderNumber || "-"}</span>
                  <span>{order.parts?.map((part) => [part.partReference, part.partDescription].filter(Boolean).join(" - ")).filter(Boolean).join(" | ") || order.partDescription || "Peça disponível"}</span>
                  <a className="tag parts-shortcut" href="/pecas">Ver pedido</a>
                </article>
              )) : (
                <p>Nenhum veículo com peças disponíveis para execução no momento.</p>
              )}
            </div>
          </section>
        )}

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

                <div className="plan-section immobilized-ready-section">
                  <div className="plan-section-title">
                    <span>Imobilizados disponíveis</span>
                    <b>{group.availableImmobilized.length}</b>
                  </div>
                  {group.availableImmobilized.length ? group.availableImmobilized.map(({ order, vehicle }) => (
                    <div key={`available-immobilized-${order.id}`} className="plan-chip immobilized-ready">
                      <strong>{vehicle?.clientName || order.clientName || "Cliente não identificado"}</strong>
                      <span>{vehicle?.plate || order.plate || "-"} · peça disponível</span>
                    </div>
                  )) : <p>Nenhum disponível.</p>}
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
                  const duplicated = duplicatedInFile.has(normalizeIdentifier(item.chassi));
                  const linkedOrders = linkedPartOrders(item);
                  const linkedParts = linkedOrders.flatMap((order) => order.parts?.length ? order.parts : [{ id: order.id, partReference: order.partReference, partDescription: order.partDescription }]);

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
                        {linkedOrders.length > 0 && <span className="tag bad">Pedido de peça vinculado</span>}
                      </div>

                      {linkedOrders.length > 0 && (
                        <div className="duplicate-alert parts-prep-alert">
                          <strong>Checar peças antes de programar</strong>
                          <span>
                            {linkedParts.map((part) => [part.partReference, part.partDescription].filter(Boolean).join(" - ")).filter(Boolean).join(" | ") || "Pedido vinculado sem descrição"}
                          </span>
                          <small>{linkedOrders.map((order) => `${order.orderNumber || "Pedido sem número"} · ${order.orderStatus}`).join(" / ")}</small>
                        </div>
                      )}

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
