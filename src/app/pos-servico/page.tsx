"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ProtectedPage } from "@/components/protected-page";
import type { ManualContent } from "@/components/operation-manual";
import { useAuth } from "@/context/auth-context";
import { listActiveVehicleFlows, listHgsiAnswers, listHgsiRecords, listPostServiceCases, saveHgsiAnswers, saveHgsiRecords, savePostServiceTreatment } from "@/services/firestore";
import type { PostCaseType, PostServiceCase, TreatmentStatus, VehicleFlow } from "@/types/domain";

const consultants = ["Cleverton", "Rosangela", "Eliane"];
const surveyGoal = 15;

const manual: ManualContent = {
  title: "Manual do Pós-serviço HGSI",
  audience: "Uso principal: coordenador de qualidade",
  objective: "Acompanhar clientes entregues, cruzar registros válidos e respostas HGSI, tratar pendências e medir impacto por consultor.",
  steps: [
    "Importe a planilha de Status Registro para identificar clientes aptos à pesquisa.",
    "Importe a planilha de entrevistas para atualizar clientes que já responderam.",
    "Analise veículos entregues e registros válidos antes da resposta HGSI.",
    "Registre tratativas, observações do cliente e necessidade de GPV quando houver risco.",
    "Use os indicadores por consultor para acompanhar meta, nota HGSI, NPS e serviço correto.",
  ],
  rules: [
    "Chassi com pelo menos um registro válido indica cliente apto à pesquisa.",
    "Registro válido com pendência deve ser tratado antes da solicitação da pesquisa.",
    "Clientes já respondidos devem sair da fila de tratativa pré-pesquisa.",
    "Pendência real ocorre quando há pedido de peças, NPS baixo ou pendência marcada na entrega.",
  ],
  flow: [
    { title: "Entregues", text: "Clientes vêm do quadro Entregue do fluxo." },
    { title: "Registro válido", text: "Planilha Route/HGSI define aptidão." },
    { title: "Tratativa", text: "Qualidade registra ação e observação." },
    { title: "Resposta HGSI", text: "Planilha de entrevistas alimenta indicadores por consultor." },
  ],
};

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
  correctServiceScore?: number;
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
  hasPendingIssue?: boolean;
  futureNote?: string;
};

type TreatmentForm = {
  treatmentBy: string;
  customerObservation: string;
  gpvRequired: boolean;
  treatmentStatus: TreatmentStatus;
  caseType: PostCaseType;
};

function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function findColumn(row: Record<string, unknown>, terms: string[]) {
  const entries = Object.entries(row);

  for (const term of terms) {
    const normalizedTerm = normalizeText(term);
    const entry = entries.find(([key]) => normalizeText(key).includes(normalizedTerm));
    if (entry) return entry[1];
  }

  return "";
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
      const secondaryHeaderIndex = matrix.findIndex((row) => {
        const normalizedCells = row.map(normalizeText);
        return normalizedCells.some((cell) => cell.includes("chassi") || cell.includes("vin"));
      });

      if (secondaryHeaderIndex < 0) {
        return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
      }

      const parentHeader = matrix[Math.max(0, secondaryHeaderIndex - 1)] ?? [];
      const childHeader = matrix[secondaryHeaderIndex];
      const headers = childHeader.map((header, index) => {
        const parent = String(parentHeader[index] ?? "").trim();
        const child = String(header ?? "").trim();
        if (parent && child) return `${parent} ${child}`;
        return child || parent || `COLUNA_${index}`;
      });

      return matrix.slice(secondaryHeaderIndex + 1)
        .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
        .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
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
    hasPendingIssue: vehicle.hasPendingIssue,
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
    || item.hasPendingIssue
    || (typeof item.internalNps === "number" && item.internalNps < 8),
  );
}

function averageNumber(values: Array<number | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatScore(value: number | null, digits = 1) {
  if (value === null) return "-";
  return value.toFixed(digits);
}

function hgsiValue(answer: HgsiAnswerImport) {
  if (typeof answer.nps !== "number" || !Number.isFinite(answer.nps)) return undefined;
  return answer.nps <= 10 ? answer.nps * 100 : answer.nps;
}

function tenPointValue(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 10 ? value / 100 : value;
}

function scoreTone(value: number | null, scale: "ten" | "thousand" = "ten") {
  if (value === null) return "muted";
  if (scale === "thousand") {
    if (value >= 950) return "good";
    if (value >= 800) return "warn";
    return "bad";
  }
  if (value >= 9) return "good";
  if (value >= 8) return "warn";
  return "bad";
}

function scoreWidth(value: number | null, scale: "ten" | "thousand" = "ten") {
  if (value === null) return "0%";
  const max = scale === "thousand" ? 1000 : 10;
  return `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
}

function consultantFullName(name: string) {
  if (name === "Rosangela") return "Rosangela Santos de Jesus";
  if (name === "Eliane") return "Eliane Ribeiro";
  if (name === "Cleverton") return "Jose Cleverton Macedo";
  return name;
}

function answerComment(answer: HgsiAnswerImport) {
  return textFrom(answer.raw, [
    "comentarios ou sugestao",
    "comentário",
    "comentarios",
    "sugestao",
    "qual motivo",
    "motivo",
  ]);
}

function displayAnswerConsultant(answer: HgsiAnswerImport) {
  return consultantDisplayName(answer.consultantName || String(answer.raw?.Consultor ?? answer.raw?.consultor ?? ""));
}

function FunnelCard({
  item,
  answer,
  validRecord,
  treatment,
  onTreatment,
}: {
  item: FunnelItem;
  answer?: HgsiAnswerImport;
  validRecord?: boolean;
  treatment?: PostServiceCase;
  onTreatment: (item: FunnelItem) => void;
}) {
  const attention = needsTreatment(item);
  const phoneLink = whatsappUrl(item.phone);
  const hasDeliveryRecord = item.source === "fluxo" && (
    item.futureNote
    || item.partsOrdered
    || item.hasPendingIssue
    || item.deliveredOnTime === false
    || typeof item.internalNps === "number"
  );
  const internalNpsAttention = typeof item.internalNps === "number" && item.internalNps < 8;

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
        {item.hasPendingIssue && <span className="tag bad">Pendência</span>}
        {internalNpsAttention && <span className="tag bad">NPS interno baixo</span>}
        {item.futureNote && <span className="tag">Observação</span>}
        {treatment && <span className="tag good">Tratativa registrada</span>}
        {treatment?.gpvRequired && <span className="tag bad">GPV</span>}
        {!attention && <span className="tag good">Sem pendência</span>}
      </div>

      {hasDeliveryRecord && (
        <div className="post-card-note">
          <strong>Registro da entrega</strong>
          <span>Prazo: {item.deliveredOnTime === false ? "fora do prazo" : "no prazo"}</span>
          <span>Pedido de peça: {item.partsOrdered ? "sim" : "não"}</span>
          <span>Pendência: {item.hasPendingIssue || internalNpsAttention || item.partsOrdered ? "sim" : "não"}</span>
          <span>NPS interno: {item.internalNps ?? "-"}</span>
          {item.futureNote && <p>{item.futureNote}</p>}
        </div>
      )}

      {treatment?.customerObservation && (
        <p className="post-card-note">{treatment.customerObservation}</p>
      )}

      <button className="ghost-btn post-treatment-btn" type="button" onClick={() => onTreatment(item)}>
        Tratativa
      </button>
    </article>
  );
}

export default function PosServicoPage() {
  const { profile, user } = useAuth();
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [hgsiRecords, setHgsiRecords] = useState<HgsiRecordImport[]>([]);
  const [hgsiAnswers, setHgsiAnswers] = useState<HgsiAnswerImport[]>([]);
  const [postCases, setPostCases] = useState<PostServiceCase[]>([]);
  const [treatmentItem, setTreatmentItem] = useState<FunnelItem | null>(null);
  const [treatmentForm, setTreatmentForm] = useState<TreatmentForm>({
    treatmentBy: "",
    customerObservation: "",
    gpvRequired: false,
    treatmentStatus: "em_tratativa",
    caseType: "tratar_antes_pesquisa",
  });
  const [consultantFilter, setConsultantFilter] = useState("Todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPostServiceData() {
      setLoading(true);
      setError("");

      try {
        const [flowData, savedRecords, savedAnswers, savedCases] = await Promise.all([
          listActiveVehicleFlows({ includeDelivered: true }),
          listHgsiRecords(),
          listHgsiAnswers(),
          listPostServiceCases(),
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
          correctServiceScore: answer.correctServiceScore,
          correctService: answer.correctService,
          raw: answer.rawPayload ?? {},
        })).filter((answer) => answer.chassi || answer.osNumber));
        setPostCases(savedCases);
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

  const casesByItemKey = useMemo(() => {
    const mapped = new Map<string, PostServiceCase>();
    postCases.forEach((postCase) => {
      mapped.set(postCase.vehicleFlowId, postCase);
    });
    return mapped;
  }, [postCases]);

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
      const hgsiScores = answered.map(hgsiValue);
      const hgsiAverage = averageNumber(hgsiScores);
      const range950 = answered.filter((answer) => {
        const value = hgsiValue(answer);
        return typeof value === "number" && value >= 950;
      }).length;
      const range800 = answered.filter((answer) => {
        const value = hgsiValue(answer);
        return typeof value === "number" && value >= 800 && value < 950;
      }).length;
      const rangeUnder800 = answered.filter((answer) => {
        const value = hgsiValue(answer);
        return typeof value === "number" && value < 800;
      }).length;
      const redFlags = answered.filter((answer) => {
        const value = hgsiValue(answer);
        return typeof value === "number" && value < 800;
      }).length;
      const correctServiceValues = answered.map((answer) => (
        tenPointValue(answer.correctServiceScore)
        ?? (answer.correctService === undefined ? undefined : answer.correctService ? 10 : 0)
      ));
      const indicatorRows = [
        { label: "NPS", count: hgsiScores.filter((value) => value !== undefined).length, value: averageNumber(hgsiScores.map((value) => (value === undefined ? undefined : value / 100))) },
        { label: "Serviço correto", count: correctServiceValues.filter((value) => value !== undefined).length, value: averageNumber(correctServiceValues) },
        { label: "Instalações", count: answered.filter((answer) => answer.installationScore !== undefined).length, value: averageNumber(answered.map((answer) => tenPointValue(answer.installationScore))) },
        { label: "Consultor", count: answered.filter((answer) => answer.consultantScore !== undefined).length, value: averageNumber(answered.map((answer) => tenPointValue(answer.consultantScore))) },
        { label: "Prazos", count: answered.filter((answer) => answer.deadlineScore !== undefined).length, value: averageNumber(answered.map((answer) => tenPointValue(answer.deadlineScore))) },
        { label: "Qualidade dos Serviços", count: answered.filter((answer) => answer.serviceQualityScore !== undefined).length, value: averageNumber(answered.map((answer) => tenPointValue(answer.serviceQualityScore))) },
        { label: "Alinhamento de Preços", count: answered.filter((answer) => answer.priceAlignmentScore !== undefined).length, value: averageNumber(answered.map((answer) => tenPointValue(answer.priceAlignmentScore))) },
        { label: "Lavagem", count: answered.filter((answer) => answer.washScore !== undefined).length, value: averageNumber(answered.map((answer) => tenPointValue(answer.washScore))) },
      ];
      const criticalComments = answered
        .map((answer) => ({
          score: hgsiValue(answer),
          clientName: answer.clientName || "Cliente",
          comment: answerComment(answer) || "Sem comentário crítico",
        }))
        .filter((item) => item.score !== undefined)
        .sort((first, second) => (first.score ?? 0) - (second.score ?? 0))
        .slice(0, 3);
      const answeredClients = answered
        .map((answer, index) => ({
          id: `${answer.chassi || answer.osNumber || answer.clientName || consultant}-${index}`,
          clientName: answer.clientName || "Cliente sem nome",
          plate: answer.plate || "-",
          answerDate: answer.answerDate,
          score: hgsiValue(answer),
        }))
        .sort((first, second) => String(second.answerDate ?? "").localeCompare(String(first.answerDate ?? "")));

      return {
        consultant,
        consultantName: consultantFullName(consultant),
        answered: answered.length,
        goalPercent: Math.round((answered.length / surveyGoal) * 100),
        goalTrackPercent: Math.min(100, Math.round((answered.length / surveyGoal) * 100)),
        hgsiAverage,
        range950,
        range800,
        rangeUnder800,
        redFlags,
        indicatorRows,
        criticalComments,
        answeredClients,
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

  function openTreatmentModal(item: FunnelItem) {
    const key = itemKey(item);
    const existing = casesByItemKey.get(key);

    setTreatmentItem(item);
    setTreatmentForm({
      treatmentBy: existing?.treatmentBy ?? profile?.name ?? "",
      customerObservation: existing?.customerObservation ?? existing?.pendingDescription ?? "",
      gpvRequired: existing?.gpvRequired ?? false,
      treatmentStatus: existing?.treatmentStatus ?? "em_tratativa",
      caseType: existing?.caseType ?? (needsTreatment(item) ? "tratar_antes_pesquisa" : "solicitar_hgsi"),
    });
  }

  async function submitTreatment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!treatmentItem) return;

    const key = itemKey(treatmentItem);
    setError("");

    try {
      await savePostServiceTreatment({
        vehicleFlowId: key,
        caseType: treatmentForm.caseType,
        treatmentStatus: treatmentForm.treatmentStatus,
        treatmentBy: treatmentForm.treatmentBy.trim(),
        customerObservation: treatmentForm.customerObservation.trim(),
        gpvRequired: treatmentForm.gpvRequired,
        assignedTo: treatmentForm.gpvRequired ? "GPV" : undefined,
        hgsiRequestAllowed: treatmentForm.caseType !== "nao_solicitar",
        hgsiRequestStatus: treatmentForm.caseType === "nao_solicitar" ? "bloqueada" : "nao_solicitada",
      });

      setPostCases((current) => {
        const nextCase: PostServiceCase = {
          id: key,
          vehicleFlowId: key,
          caseType: treatmentForm.caseType,
          pendingDescription: treatmentForm.customerObservation.trim(),
          treatmentBy: treatmentForm.treatmentBy.trim(),
          customerObservation: treatmentForm.customerObservation.trim(),
          gpvRequired: treatmentForm.gpvRequired,
          treatmentStatus: treatmentForm.treatmentStatus,
          hgsiRequestAllowed: treatmentForm.caseType !== "nao_solicitar",
          hgsiRequestStatus: treatmentForm.caseType === "nao_solicitar" ? "bloqueada" : "nao_solicitada",
          assignedTo: treatmentForm.gpvRequired ? "GPV" : undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return [...current.filter((item) => item.vehicleFlowId !== key), nextCase];
      });
      setTreatmentItem(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar a tratativa.");
    }
  }

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
          clientName: textFrom(row, ["dados do cliente nome", "cliente nome"]),
          plate: textFrom(row, ["placa"]),
          serviceLabel: textFrom(row, ["dados do cliente veiculo", "veiculo", "veículo", "servico", "serviço", "tipo"]),
          consultantName: consultantDisplayName(textFrom(row, ["consultor responsavel", "consultor tecnico", "consultor"])),
          answerDate: textFrom(row, ["datas entrevista", "data entrevista", "entrevista", "data resposta", "respondido"]),
          nps: numberFrom(row, ["indice hgsi", "índice hgsi", "nps", "nota"]),
          installationScore: numberFrom(row, ["q2 instalacoes", "q2 instalações", "instalacoes", "instalações"]),
          consultantScore: numberFrom(row, ["q3 consultor"]),
          deadlineScore: numberFrom(row, ["q4 tempo", "tempo", "prazo", "prazos"]),
          serviceQualityScore: numberFrom(row, ["q5 qualidade", "qualidade"]),
          priceAlignmentScore: numberFrom(row, ["q6 preco", "q6 preço", "preco", "preços", "alinhamento"]),
          washScore: numberFrom(row, ["q5.3.2 lavagem", "lavagem"]),
          correctServiceScore: numberFrom(row, ["q14.3 correto na primeira vez", "correto na primeira vez", "servico correto", "serviço correto"]),
          correctService: boolFrom(row, ["correto na primeira vez", "servico correto", "serviço correto", "servico realizado"]),
          rawPayload: row,
        };
      }).filter((answer) => answer.chassi || answer.osNumber);

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
      manual={manual}
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
                  treatment={casesByItemKey.get(itemKey(item))}
                  onTreatment={openTreatmentModal}
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
                  treatment={casesByItemKey.get(itemKey(item))}
                  onTreatment={openTreatmentModal}
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
                  treatment={casesByItemKey.get(itemKey(item))}
                  onTreatment={openTreatmentModal}
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
                  <div>
                    <strong>{item.consultantName}</strong>
                    <span>{item.answered} respostas de {surveyGoal} previstas ({item.goalPercent}% da meta)</span>
                  </div>
                  <mark className={`hgsi-pill ${scoreTone(item.hgsiAverage, "thousand")}`}>
                    {item.hgsiAverage === null ? "-" : Math.round(item.hgsiAverage)}
                  </mark>
                </div>

                <div className="score-progress-block">
                  <div className="score-progress-label">
                    <span>Meta de pesquisas</span>
                    <strong>{item.answered}/{surveyGoal}</strong>
                  </div>
                  <div className="goal-track">
                    <span style={{ width: `${item.goalTrackPercent}%` }} />
                  </div>
                </div>

                <div className="score-progress-block">
                  <div className="score-progress-label">
                    <span>Índice HGSI médio</span>
                    <strong>{item.hgsiAverage === null ? "-" : `${Math.round(item.hgsiAverage)}/1000`}</strong>
                  </div>
                  <div className={`hgsi-track ${scoreTone(item.hgsiAverage, "thousand")}`}>
                    <span style={{ width: scoreWidth(item.hgsiAverage, "thousand") }} />
                  </div>
                </div>

                <div className="score-range-grid">
                  <div><strong>{item.range950}</strong><span>950+</span></div>
                  <div><strong>{item.range800}</strong><span>800-949</span></div>
                  <div><strong>{item.rangeUnder800}</strong><span>&lt;800</span></div>
                  <div><strong>{item.redFlags}</strong><span>Red Flag</span></div>
                </div>

                <div className="score-stack" aria-label={`Distribuição de notas de ${item.consultant}`}>
                  <span className="good" style={{ width: `${item.answered ? (item.range950 / item.answered) * 100 : 0}%` }} />
                  <span className="warn" style={{ width: `${item.answered ? (item.range800 / item.answered) * 100 : 0}%` }} />
                  <span className="bad" style={{ width: `${item.answered ? (item.rangeUnder800 / item.answered) * 100 : 0}%` }} />
                </div>

                <div className="score-mini-grid">
                  <div><span>NPS</span><strong>{formatScore(item.indicatorRows[0].value)}</strong></div>
                  <div><span>Serviço correto</span><strong>{formatScore(item.indicatorRows[1].value)}</strong></div>
                  <div><span>Sem autorização</span><strong>0</strong></div>
                  <div><span>Recomendação</span><strong>{item.hgsiAverage === null ? "-" : `${Math.round(item.hgsiAverage / 10)}%`}</strong></div>
                </div>

                <div className="indicator-list">
                  {item.indicatorRows.map((indicator) => (
                    <div key={indicator.label} className="indicator-row">
                      <div className="indicator-label">
                        <span>{indicator.label} ({indicator.count})</span>
                        <strong>{formatScore(indicator.value)}</strong>
                      </div>
                      <div className={`indicator-track ${scoreTone(indicator.value)}`}>
                        <span style={{ width: scoreWidth(indicator.value) }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="critical-list">
                  {item.criticalComments.length ? item.criticalComments.map((comment, index) => (
                    <div key={`${comment.clientName}-${index}`} className="critical-item">
                      <strong>{Math.round(comment.score ?? 0)}</strong>
                      <span>{comment.clientName} - {comment.comment}</span>
                    </div>
                  )) : (
                    <div className="critical-item muted">
                      <strong>-</strong>
                      <span>Sem comentários críticos</span>
                    </div>
                  )}
                </div>

                <div className="answered-client-list">
                  <div className="answered-client-head">
                    <strong>Clientes que responderam</strong>
                    <span>{item.answeredClients.length}</span>
                  </div>
                  {item.answeredClients.length ? item.answeredClients.map((client) => (
                    <div key={client.id} className="answered-client-row">
                      <span>{client.clientName}</span>
                      <small>{client.plate} · {formatDate(client.answerDate)} · {client.score === undefined ? "-" : Math.round(client.score)}</small>
                    </div>
                  )) : (
                    <p className="empty answered-empty">Nenhum cliente respondeu ainda.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        {treatmentItem && (
          <div className="modal-backdrop" role="presentation">
            <form className="flow-modal" onSubmit={submitTreatment}>
              <div className="modal-head">
                <div>
                  <strong>Registrar tratativa</strong>
                  <span>{treatmentItem.clientName ?? "Cliente sem nome"} · {treatmentItem.plate ?? treatmentItem.chassi ?? treatmentItem.osNumber ?? "-"}</span>
                </div>
                <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setTreatmentItem(null)}>
                  ×
                </button>
              </div>

              <label className="field">
                <span>Quem realizou a tratativa</span>
                <input
                  required
                  value={treatmentForm.treatmentBy}
                  onChange={(event) => setTreatmentForm((current) => ({ ...current, treatmentBy: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>Situação</span>
                <select
                  value={treatmentForm.caseType}
                  onChange={(event) => setTreatmentForm((current) => ({ ...current, caseType: event.target.value as PostCaseType }))}
                >
                  <option value="solicitar_hgsi">Solicitar resposta HGSI</option>
                  <option value="tratar_antes_pesquisa">Tratar antes da pesquisa</option>
                  <option value="pendencia_acordada">Pendência acordada</option>
                  <option value="nao_solicitar">Não solicitar pesquisa</option>
                  <option value="fora_base">Fora da base</option>
                </select>
              </label>

              <label className="field">
                <span>Status da tratativa</span>
                <select
                  value={treatmentForm.treatmentStatus}
                  onChange={(event) => setTreatmentForm((current) => ({ ...current, treatmentStatus: event.target.value as TreatmentStatus }))}
                >
                  <option value="aberto">Aberto</option>
                  <option value="em_tratativa">Em tratativa</option>
                  <option value="tratado">Tratado</option>
                  <option value="sem_acao">Sem ação</option>
                </select>
              </label>

              <label className="field">
                <span>Observação do cliente</span>
                <textarea
                  value={treatmentForm.customerObservation}
                  onChange={(event) => setTreatmentForm((current) => ({ ...current, customerObservation: event.target.value }))}
                />
              </label>

              <label className="check-line modal-check">
                <input
                  type="checkbox"
                  checked={treatmentForm.gpvRequired}
                  onChange={(event) => setTreatmentForm((current) => ({ ...current, gpvRequired: event.target.checked }))}
                />
                GPV precisa tratar este cliente
              </label>

              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setTreatmentItem(null)}>
                  Cancelar
                </button>
                <button type="submit" className="primary-btn">
                  Salvar tratativa
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </ProtectedPage>
  );
}
