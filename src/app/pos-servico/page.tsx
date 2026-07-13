"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { listActiveVehicleFlows, listHgsiAnswers, listHgsiRecords, saveHgsiAnswers, saveHgsiRecords } from "@/services/firestore";
import type { VehicleFlow } from "@/types/domain";

const consultants = ["Cleverton", "Rosangela", "Eliane", "Luan"];
const surveyGoal = 15;

type HgsiRecordImport = {
  chassi: string;
  osNumber: string;
  status: string;
  valid: boolean;
  clientName?: string;
  plate?: string;
  serviceLabel?: string;
  consultantName?: string;
  raw?: Record<string, unknown>;
};

type HgsiAnswerImport = {
  chassi: string;
  osNumber: string;
  clientName?: string;
  plate?: string;
  serviceLabel?: string;
  consultantName?: string;
  answerDate?: string;
  nps?: number;
  installationScore?: number;
  consultantScore?: number;
  deadlineScore?: number;
  serviceQualityScore?: number;
  priceAlignmentScore?: number;
  washScore?: number;
  correctService?: boolean;
  raw: Record<string, unknown>;
};

type FunnelItem = {
  id: string;
  source: "fluxo" | "route" | "resposta";
  clientName?: string;
  phone?: string;
  plate?: string;
  chassi?: string;
  osNumber?: string;
  serviceLabel?: string;
  consultantName?: string;
  deliveredAt?: unknown;
  deliveredOnTime?: boolean;
  partsOrdered?: boolean;
  internalNps?: number;
  futureNote?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function findColumn(row: Record<string, unknown>, terms: string[]) {
  const entry = Object.entries(row).find(([key]) => {
    const normalizedKey = normalizeText(key);
    return terms.some((term) => normalizedKey.includes(term));
  });

  return entry?.[1] ?? "";
}

function textFrom(row: Record<string, unknown>, terms: string[]) {
  return String(findColumn(row, terms) ?? "").trim();
}

function numberFrom(row: Record<string, unknown>, terms: string[]) {
  const value = findColumn(row, terms);
  const normalized = String(value ?? "").replace(",", ".").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boolFrom(row: Record<string, unknown>, terms: string[]) {
  const value = normalizeText(findColumn(row, terms));
  if (!value) return undefined;
  if (["sim", "s", "yes", "correto", "1"].some((term) => value === term || value.includes(term))) return true;
  if (["nao", "n", "no", "incorreto", "0"].some((term) => value === term || value.includes(term))) return false;
  return undefined;
}

function parseRows(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: "" });
    const headerIndex = matrix.findIndex((row) => {
      const normalizedCells = row.map(normalizeText);
      const hasChassi = normalizedCells.some((cell) => cell.includes("chassi") || cell.includes("vin"));
      const hasStatusOrAnswer = normalizedCells.some((cell) => (
        cell.includes("status")
        || cell.includes("registro")
        || cell.includes("nota")
        || cell.includes("nps")
      ));
      return hasChassi && hasStatusOrAnswer;
    });

    if (headerIndex < 0) {
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
    }

    const headers = matrix[headerIndex].map((header, index) => String(header || `COLUNA_${index}`).trim() || `COLUNA_${index}`);

    return matrix.slice(headerIndex + 1)
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
      .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
  });
}

function normalizeChassi(value?: string) {
  return (value ?? "").trim().toUpperCase();
}

function consultantDisplayName(name?: string) {
  const normalized = normalizeText(name);
  if (normalized.includes("cleverton")) return "Cleverton";
  if (normalized.includes("rosangela")) return "Rosangela";
  if (normalized.includes("eliane")) return "Eliane";
  if (normalized.includes("luan")) return "Luan";
  return name?.trim().split(/\s+/)[0] || "Sem consultor";
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

function formatDate(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function whatsappUrl(phone?: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}`;
}

function itemKey(item: Pick<FunnelItem, "chassi" | "osNumber" | "id">) {
  return normalizeChassi(item.chassi) || item.osNumber || item.id;
}

function vehicleToItem(vehicle: VehicleFlow): FunnelItem {
  return {
    id: vehicle.id,
    source: "fluxo",
    clientName: vehicle.clientName,
    phone: vehicle.phone,
    plate: vehicle.plate,
    chassi: vehicle.chassi,
    serviceLabel: vehicle.serviceLabel,
    consultantName: vehicle.consultantName,
    deliveredAt: vehicle.deliveredAt,
    deliveredOnTime: vehicle.deliveredOnTime,
    partsOrdered: vehicle.partsOrdered,
    internalNps: vehicle.internalNps,
    futureNote: vehicle.futureNote,
  };
}

function recordToItem(record: HgsiRecordImport): FunnelItem {
  return {
    id: `route-${record.chassi || record.osNumber}`,
    source: "route",
    clientName: record.clientName,
    plate: record.plate,
    chassi: record.chassi,
    osNumber: record.osNumber,
    serviceLabel: record.serviceLabel,
    consultantName: record.consultantName,
  };
}

function answerToItem(answer: HgsiAnswerImport): FunnelItem {
  return {
    id: `resposta-${answer.chassi || answer.osNumber}`,
    source: "resposta",
    clientName: answer.clientName,
    plate: answer.plate,
    chassi: answer.chassi,
    osNumber: answer.osNumber,
    serviceLabel: answer.serviceLabel,
    consultantName: answer.consultantName,
    deliveredAt: answer.answerDate,
  };
}

function needsTreatment(item: FunnelItem) {
  return Boolean(
    item.partsOrdered
    || item.futureNote
    || item.deliveredOnTime === false
    || (typeof item.internalNps === "number" && item.internalNps <= 7),
  );
}

function average(values: Array<number | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return "-";
  return (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1);
}

function displayAnswerConsultant(answer: HgsiAnswerImport) {
  return consultantDisplayName(answer.consultantName || String(answer.raw?.Consultor ?? answer.raw?.consultor ?? ""));
}

function FunnelCard({
  item,
  answer,
  validRecord,
}: {
  item: FunnelItem;
  answer?: HgsiAnswerImport;
  validRecord?: boolean;
}) {
  const attention = needsTreatment(item);
  const phoneLink = whatsappUrl(item.phone);

  return (
    <article className={`post-card ${attention ? "attention" : ""}`}>
      <div className="post-card-top">
        <div>
          {phoneLink ? (
            <a className="client client-link" href={phoneLink} target="_blank" rel="noreferrer">
              {item.clientName ?? "Cliente sem nome"}
            </a>
          ) : (
            <h3 className="client">{item.clientName ?? "Cliente sem nome"}</h3>
          )}
          <p className="model">{item.chassi || `O.S. ${item.osNumber || "-"}`}</p>
        </div>
        <span className="plate">{item.plate ?? "-"}</span>
      </div>

      <div className="detail-grid">
        <div className="detail"><span>Consultor</span>{consultantDisplayName(item.consultantName)}</div>
        <div className="detail"><span>Passagem</span>{formatDate(item.deliveredAt)}</div>
        <div className="detail"><span>NPS interno</span>{item.internalNps ?? "-"}</div>
        <div className="detail"><span>Origem</span>{item.source === "fluxo" ? "Fluxo" : "Planilha"}</div>
      </div>

      <div className="tag-row">
        {validRecord && <span className="tag good">Registro válido</span>}
        {answer && <span className="tag">Respondido HGSI</span>}
        {answer?.nps !== undefined && <span className={`tag ${answer.nps <= 7 ? "bad" : "good"}`}>NPS {answer.nps}</span>}
        {item.partsOrdered && <span className="tag warn">Pedido de peça</span>}
        {item.futureNote && <span className="tag bad">Pendência/observação</span>}
        {!attention && <span className="tag good">Sem pendência</span>}
      </div>
    </article>
  );
}

export default function PosServicoPage() {
  const { profile, user } = useAuth();
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [hgsiRecords, setHgsiRecords] = useState<HgsiRecordImport[]>([]);
  const [hgsiAnswers, setHgsiAnswers] = useState<HgsiAnswerImport[]>([]);
  const [consultantFilter, setConsultantFilter] = useState("Todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPostServiceData() {
      setLoading(true);
      setError("");

      try {
        const [flowData, savedRecords, savedAnswers] = await Promise.all([
          listActiveVehicleFlows({ includeDelivered: true }),
          listHgsiRecords(),
          listHgsiAnswers(),
        ]);
        if (!active) return;
        setVehicles(flowData.filter((vehicle) => vehicle.currentLane === "entregue"));
        setHgsiRecords(savedRecords.map((record) => ({
          chassi: normalizeChassi(record.chassi),
          osNumber: record.osNumber,
          status: record.recordStatus,
          valid: record.isValidRecord,
          clientName: (record as { clientName?: string }).clientName,
          plate: (record as { plate?: string }).plate,
          serviceLabel: (record as { serviceLabel?: string }).serviceLabel,
          consultantName: (record as { consultantName?: string }).consultantName,
          raw: record.rawPayload ?? {},
        })));
        setHgsiAnswers(savedAnswers.map((answer) => ({
          chassi: normalizeChassi(answer.chassi),
          osNumber: answer.osNumber ?? "",
          clientName: (answer as { clientName?: string }).clientName,
          plate: (answer as { plate?: string }).plate,
          serviceLabel: (answer as { serviceLabel?: string }).serviceLabel,
          consultantName: (answer as { consultantName?: string }).consultantName,
          answerDate: answer.answerDate,
          nps: answer.nps,
          installationScore: answer.installationScore,
          consultantScore: (answer as { consultantScore?: number }).consultantScore,
          deadlineScore: answer.deadlineScore,
          serviceQualityScore: answer.serviceQualityScore,
          priceAlignmentScore: answer.priceAlignmentScore,
          washScore: answer.washScore,
          correctService: answer.correctService,
          raw: answer.rawPayload ?? {},
        })));
      } catch (currentError) {
        if (!active) return;
        setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar o pós-serviço.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPostServiceData();
    return () => {
      active = false;
    };
  }, []);

  const flowItems = useMemo(() => vehicles.map(vehicleToItem), [vehicles]);

  const answersByChassi = useMemo(() => {
    const mapped = new Map<string, HgsiAnswerImport>();
    hgsiAnswers.forEach((answer) => {
      if (answer.chassi) mapped.set(answer.chassi, answer);
    });
    return mapped;
  }, [hgsiAnswers]);

  const validRecords = useMemo(() => hgsiRecords.filter((record) => record.valid), [hgsiRecords]);
  const validChassis = useMemo(() => new Set(validRecords.map((record) => record.chassi).filter(Boolean)), [validRecords]);
  const flowKeys = useMemo(() => new Set(flowItems.map(itemKey)), [flowItems]);

  const validRecordItems = useMemo(() => {
    const matched = flowItems.filter((item) => validChassis.has(normalizeChassi(item.chassi)));
    const basic = validRecords
      .filter((record) => !flowKeys.has(record.chassi || record.osNumber))
      .map(recordToItem);
    return [...matched, ...basic];
  }, [flowItems, flowKeys, validChassis, validRecords]);

  const answeredItems = useMemo(() => {
    const answeredKeys = new Set(hgsiAnswers.map((answer) => answer.chassi || answer.osNumber).filter(Boolean));
    const matched = flowItems.filter((item) => answeredKeys.has(normalizeChassi(item.chassi)) || answeredKeys.has(item.osNumber ?? ""));
    const basic = hgsiAnswers
      .filter((answer) => !flowKeys.has(answer.chassi || answer.osNumber))
      .map(answerToItem);
    return [...matched, ...basic];
  }, [flowItems, flowKeys, hgsiAnswers]);

  const filterByConsultant = (item: FunnelItem) => (
    consultantFilter === "Todos" || consultantDisplayName(item.consultantName) === consultantFilter
  );

  const deliveredItems = flowItems.filter(filterByConsultant);
  const filteredValidRecordItems = validRecordItems.filter(filterByConsultant);
  const filteredAnsweredItems = answeredItems.filter(filterByConsultant);
  const pendingValidItems = filteredValidRecordItems.filter((item) => !answersByChassi.has(normalizeChassi(item.chassi)));
  const treatmentItems = pendingValidItems.filter(needsTreatment);
  const requestReadyItems = pendingValidItems.filter((item) => !needsTreatment(item));

  const consultantStats = useMemo(() => {
    return consultants.map((consultant) => {
      const answered = hgsiAnswers.filter((answer) => displayAnswerConsultant(answer) === consultant);

      return {
        consultant,
        answered: answered.length,
        goalPercent: Math.min(100, Math.round((answered.length / surveyGoal) * 100)),
        nps: average(answered.map((answer) => answer.nps)),
        installation: average(answered.map((answer) => answer.installationScore)),
        consultantScore: average(answered.map((answer) => answer.consultantScore)),
        deadline: average(answered.map((answer) => answer.deadlineScore)),
        serviceQuality: average(answered.map((answer) => answer.serviceQualityScore)),
        priceAlignment: average(answered.map((answer) => answer.priceAlignmentScore)),
        wash: average(answered.map((answer) => answer.washScore)),
        correctService: answered.length
          ? `${Math.round((answered.filter((answer) => answer.correctService === true).length / answered.length) * 100)}%`
          : "-",
      };
    });
  }, [hgsiAnswers]);

  const metrics = [
    { label: "Veículos entregues", value: deliveredItems.length },
    { label: "Registro válido Route", value: filteredValidRecordItems.length },
    { label: "Solicitar resposta HGSI", value: requestReadyItems.length },
    { label: "Tratar antes", value: treatmentItems.length },
    { label: "Clientes responderam", value: filteredAnsweredItems.length },
  ];

  async function importHgsiRecords(file?: File) {
    if (!file) return;

    try {
      const rows = await parseRows(file);
      const records = rows.map((row) => {
        const status = textFrom(row, ["status", "registro"]);
        const chassi = textFrom(row, ["chassi", "vin"]).toUpperCase();
        const osNumber = textFrom(row, ["o.s", "os", "ordem"]);

        return {
          chassi,
          osNumber,
          status,
          valid: normalizeText(status).includes("valido"),
          clientName: textFrom(row, ["cliente", "nome"]),
          plate: textFrom(row, ["placa"]),
          serviceLabel: textFrom(row, ["servico", "serviço", "tipo"]),
          consultantName: consultantDisplayName(textFrom(row, ["consultor responsavel", "consultor tecnico", "consultor"])),
          rawPayload: row,
        };
      });

      await saveHgsiRecords({
        sourceFileName: file.name,
        importedBy: profile?.name ?? user?.email ?? user?.uid,
        records,
      });

      setHgsiRecords(records.map((record) => ({ ...record, raw: record.rawPayload })));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível ler a planilha de status HGSI.");
    }
  }

  async function importHgsiAnswers(file?: File) {
    if (!file) return;

    try {
      const rows = await parseRows(file);
      const answers = rows.map((row) => {
        const chassi = textFrom(row, ["chassi", "vin"]).toUpperCase();
        const osNumber = textFrom(row, ["o.s", "os", "ordem"]);

        return {
          chassi,
          osNumber,
          clientName: textFrom(row, ["cliente", "nome"]),
          plate: textFrom(row, ["placa"]),
          serviceLabel: textFrom(row, ["servico", "serviço", "tipo"]),
          consultantName: consultantDisplayName(textFrom(row, ["consultor responsavel", "consultor tecnico", "consultor"])),
          answerDate: textFrom(row, ["data resposta", "data", "respondido"]),
          nps: numberFrom(row, ["nps", "nota"]),
          installationScore: numberFrom(row, ["instalacao", "instalacoes"]),
          consultantScore: numberFrom(row, ["nota consultor", "consultor"]),
          deadlineScore: numberFrom(row, ["prazo", "prazos"]),
          serviceQualityScore: numberFrom(row, ["qualidade"]),
          priceAlignmentScore: numberFrom(row, ["preco", "precos", "alinhamento"]),
          washScore: numberFrom(row, ["lavagem"]),
          correctService: boolFrom(row, ["servico correto", "servico realizado", "servico"]),
          rawPayload: row,
        };
      });

      await saveHgsiAnswers({
        sourceFileName: file.name,
        importedBy: profile?.name ?? user?.email ?? user?.uid,
        answers,
      });

      setHgsiAnswers(answers.map((answer) => ({
        ...answer,
        raw: answer.rawPayload ?? {},
      })));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível ler a planilha de respostas HGSI.");
    }
  }

  return (
    <ProtectedPage
      title="Funil HGSI"
      subtitle="Veículos entregues, registros válidos Route, clientes respondidos e indicadores por consultor."
    >
      <main className="page-wrap post-funnel-page">
        <section className="post-toolbar">
          <div className="metrics-grid post-metrics">
            {metrics.map((metric) => (
              <div key={metric.label} className="metric">
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
              </div>
            ))}
          </div>

          <div className="post-controls">
            <label className="flow-filter">
              <span>Consultor</span>
              <select value={consultantFilter} onChange={(event) => setConsultantFilter(event.target.value)}>
                <option>Todos</option>
                {consultants.map((consultant) => <option key={consultant}>{consultant}</option>)}
              </select>
            </label>

            <label className="file-button compact-file">
              <input accept=".xls,.xlsx" type="file" onChange={(event) => importHgsiRecords(event.target.files?.[0])} />
              <strong>Status Route</strong>
              <span>{hgsiRecords.length} registro(s)</span>
            </label>

            <label className="file-button compact-file">
              <input accept=".xls,.xlsx" type="file" onChange={(event) => importHgsiAnswers(event.target.files?.[0])} />
              <strong>Respostas HGSI</strong>
              <span>{hgsiAnswers.length} resposta(s)</span>
            </label>
          </div>
        </section>

        {error && <div className="duplicate-alert"><strong>Erro no pós-serviço</strong><span>{error}</span></div>}

        <section className="funnel-grid" aria-label="Funil pós-venda HGSI">
          <section className="funnel-stage">
            <div className="funnel-stage-head">
              <span>Área 01</span>
              <h2>Veículos entregues</h2>
              <strong>{deliveredItems.length}</strong>
            </div>
            <div className="funnel-stage-body">
              {loading ? (
                <p className="empty">Carregando clientes...</p>
              ) : deliveredItems.length ? deliveredItems.map((item) => (
                <FunnelCard
                  key={item.id}
                  item={item}
                  validRecord={validChassis.has(normalizeChassi(item.chassi))}
                  answer={answersByChassi.get(normalizeChassi(item.chassi))}
                />
              )) : (
                <p className="empty">Sem veículos entregues.</p>
              )}
            </div>
          </section>

          <section className="funnel-stage">
            <div className="funnel-stage-head">
              <span>Área 02</span>
              <h2>Aptos HGSI</h2>
              <strong>{filteredValidRecordItems.length}</strong>
            </div>
            <div className="funnel-subhead">
              <span>{requestReadyItems.length} solicitar resposta</span>
              <span>{treatmentItems.length} tratar antes</span>
            </div>
            <div className="funnel-stage-body">
              {hgsiRecords.length === 0 ? (
                <p className="empty">Importe o Status Route para identificar registros válidos.</p>
              ) : pendingValidItems.length ? pendingValidItems.map((item) => (
                <FunnelCard
                  key={item.id}
                  item={item}
                  validRecord
                />
              )) : (
                <p className="empty">Nenhum cliente pendente com registro válido.</p>
              )}
            </div>
          </section>

          <section className="funnel-stage">
            <div className="funnel-stage-head">
              <span>Área 03</span>
              <h2>Clientes que responderam</h2>
              <strong>{filteredAnsweredItems.length}</strong>
            </div>
            <div className="funnel-stage-body">
              {hgsiAnswers.length === 0 ? (
                <p className="empty">Importe a planilha de respostas HGSI.</p>
              ) : filteredAnsweredItems.length ? filteredAnsweredItems.map((item) => (
                <FunnelCard
                  key={item.id}
                  item={item}
                  validRecord={validChassis.has(normalizeChassi(item.chassi))}
                  answer={answersByChassi.get(normalizeChassi(item.chassi))}
                />
              )) : (
                <p className="empty">Nenhuma resposta vinculada ao filtro selecionado.</p>
              )}
            </div>
          </section>
        </section>

        <section className="panel consultant-scoreboard">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Indicadores por consultor</h2>
              <span className="panel-subtitle">Meta de {surveyGoal} pesquisas respondidas por consultor.</span>
            </div>
          </div>
          <div className="consultant-score-grid">
            {consultantStats.map((item) => (
              <article key={item.consultant} className="consultant-score-card">
                <div className="consultant-score-head">
                  <strong>{item.consultant}</strong>
                  <span>{item.answered}/{surveyGoal}</span>
                </div>
                <div className="goal-track">
                  <span style={{ width: `${item.goalPercent}%` }} />
                </div>
                <div className="score-grid">
                  <div><span>NPS</span><strong>{item.nps}</strong></div>
                  <div><span>Instalações</span><strong>{item.installation}</strong></div>
                  <div><span>Consultor</span><strong>{item.consultantScore}</strong></div>
                  <div><span>Prazos</span><strong>{item.deadline}</strong></div>
                  <div><span>Qualidade</span><strong>{item.serviceQuality}</strong></div>
                  <div><span>Preços</span><strong>{item.priceAlignment}</strong></div>
                  <div><span>Lavagem</span><strong>{item.wash}</strong></div>
                  <div><span>Serviço correto</span><strong>{item.correctService}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </ProtectedPage>
  );
}
