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
};

type HgsiAnswerImport = {
  chassi: string;
  osNumber: string;
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
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
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

function needsTreatment(vehicle: VehicleFlow) {
  return Boolean(
    vehicle.partsOrdered
    || vehicle.futureNote
    || vehicle.deliveredOnTime === false
    || (typeof vehicle.internalNps === "number" && vehicle.internalNps <= 7),
  );
}

function average(values: Array<number | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return "-";
  return (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1);
}

function VehicleCard({
  vehicle,
  answer,
  validRecord,
}: {
  vehicle: VehicleFlow;
  answer?: HgsiAnswerImport;
  validRecord?: boolean;
}) {
  const attention = needsTreatment(vehicle);
  const phoneLink = whatsappUrl(vehicle.phone);

  return (
    <article className={`post-card ${attention ? "attention" : ""}`}>
      <div className="post-card-top">
        <div>
          {phoneLink ? (
            <a className="client client-link" href={phoneLink} target="_blank" rel="noreferrer">
              {vehicle.clientName ?? "Cliente sem nome"}
            </a>
          ) : (
            <h3 className="client">{vehicle.clientName ?? "Cliente sem nome"}</h3>
          )}
          <p className="model">{vehicle.chassi ?? "Chassi não informado"}</p>
        </div>
        <span className="plate">{vehicle.plate ?? "-"}</span>
      </div>

      <div className="detail-grid">
        <div className="detail"><span>Consultor</span>{consultantDisplayName(vehicle.consultantName)}</div>
        <div className="detail"><span>Passagem</span>{formatDate(vehicle.deliveredAt)}</div>
        <div className="detail"><span>NPS interno</span>{vehicle.internalNps ?? "-"}</div>
        <div className="detail"><span>Prazo</span>{vehicle.deliveredOnTime ? "No prazo" : "Fora do prazo"}</div>
      </div>

      <div className="tag-row">
        {validRecord && <span className="tag good">Registro válido</span>}
        {answer && <span className="tag">Respondido HGSI</span>}
        {answer?.nps !== undefined && <span className={`tag ${answer.nps <= 7 ? "bad" : "good"}`}>NPS {answer.nps}</span>}
        {vehicle.partsOrdered && <span className="tag warn">Pedido de peça</span>}
        {vehicle.futureNote && <span className="tag bad">Pendência/observação</span>}
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
        })));
        setHgsiAnswers(savedAnswers.map((answer) => ({
          chassi: normalizeChassi(answer.chassi),
          osNumber: answer.osNumber ?? "",
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

  const validChassis = useMemo(() => {
    return new Set(hgsiRecords.filter((record) => record.valid).map((record) => record.chassi).filter(Boolean));
  }, [hgsiRecords]);

  const answersByChassi = useMemo(() => {
    const mapped = new Map<string, HgsiAnswerImport>();
    hgsiAnswers.forEach((answer) => {
      if (answer.chassi) mapped.set(answer.chassi, answer);
    });
    return mapped;
  }, [hgsiAnswers]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => (
      consultantFilter === "Todos" || consultantDisplayName(vehicle.consultantName) === consultantFilter
    ));
  }, [consultantFilter, vehicles]);

  const deliveredVehicles = filteredVehicles;
  const validRecordVehicles = filteredVehicles.filter((vehicle) => validChassis.has(normalizeChassi(vehicle.chassi)));
  const answeredVehicles = filteredVehicles.filter((vehicle) => answersByChassi.has(normalizeChassi(vehicle.chassi)));
  const pendingValidVehicles = validRecordVehicles.filter((vehicle) => !answersByChassi.has(normalizeChassi(vehicle.chassi)));
  const treatmentVehicles = pendingValidVehicles.filter(needsTreatment);
  const requestReadyVehicles = pendingValidVehicles.filter((vehicle) => !needsTreatment(vehicle));

  const consultantStats = useMemo(() => {
    return consultants.map((consultant) => {
      const consultantVehicles = vehicles.filter((vehicle) => consultantDisplayName(vehicle.consultantName) === consultant);
      const answered = consultantVehicles
        .map((vehicle) => answersByChassi.get(normalizeChassi(vehicle.chassi)))
        .filter((answer): answer is HgsiAnswerImport => Boolean(answer));

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
  }, [answersByChassi, vehicles]);

  const metrics = [
    { label: "Veículos entregues", value: deliveredVehicles.length },
    { label: "Registro válido Route", value: validRecordVehicles.length },
    { label: "Solicitar resposta HGSI", value: requestReadyVehicles.length },
    { label: "Tratar antes", value: treatmentVehicles.length },
    { label: "Clientes responderam", value: answeredVehicles.length },
  ];

  async function importHgsiRecords(file?: File) {
    if (!file) return;

    try {
      const rows = await parseRows(file);
      const records = rows.map((row) => {
        const status = String(findColumn(row, ["status", "registro"]));
        const chassi = String(findColumn(row, ["chassi", "vin"])).trim().toUpperCase();
        const osNumber = String(findColumn(row, ["o.s", "os", "ordem"])).trim();

        return {
          chassi,
          osNumber,
          status,
          valid: normalizeText(status).includes("valido"),
          rawPayload: row,
        };
      });

      await saveHgsiRecords({
        sourceFileName: file.name,
        importedBy: profile?.name ?? user?.email ?? user?.uid,
        records,
      });

      setHgsiRecords(records);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível ler a planilha de status HGSI.");
    }
  }

  async function importHgsiAnswers(file?: File) {
    if (!file) return;

    try {
      const rows = await parseRows(file);
      const answers = rows.map((row) => {
        const chassi = String(findColumn(row, ["chassi", "vin"])).trim().toUpperCase();
        const osNumber = String(findColumn(row, ["o.s", "os", "ordem"])).trim();

        return {
          chassi,
          osNumber,
          nps: numberFrom(row, ["nps", "nota"]),
          installationScore: numberFrom(row, ["instalacao", "instalacoes"]),
          consultantScore: numberFrom(row, ["consultor"]),
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
              <strong>{deliveredVehicles.length}</strong>
            </div>
            <div className="funnel-stage-body">
              {loading ? (
                <p className="empty">Carregando clientes...</p>
              ) : deliveredVehicles.length ? deliveredVehicles.map((vehicle) => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  validRecord={validChassis.has(normalizeChassi(vehicle.chassi))}
                  answer={answersByChassi.get(normalizeChassi(vehicle.chassi))}
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
              <strong>{validRecordVehicles.length}</strong>
            </div>
            <div className="funnel-subhead">
              <span>{requestReadyVehicles.length} solicitar resposta</span>
              <span>{treatmentVehicles.length} tratar antes</span>
            </div>
            <div className="funnel-stage-body">
              {hgsiRecords.length === 0 ? (
                <p className="empty">Importe o Status Route para identificar registros válidos.</p>
              ) : pendingValidVehicles.length ? pendingValidVehicles.map((vehicle) => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
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
              <strong>{answeredVehicles.length}</strong>
            </div>
            <div className="funnel-stage-body">
              {hgsiAnswers.length === 0 ? (
                <p className="empty">Importe a planilha de respostas HGSI.</p>
              ) : answeredVehicles.length ? answeredVehicles.map((vehicle) => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  validRecord={validChassis.has(normalizeChassi(vehicle.chassi))}
                  answer={answersByChassi.get(normalizeChassi(vehicle.chassi))}
                />
              )) : (
                <p className="empty">Nenhuma resposta vinculada aos veículos filtrados.</p>
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
