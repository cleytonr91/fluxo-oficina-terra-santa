import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import * as XLSX from "xlsx";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

const PORTAL_BASE_URL = "https://routepesquisa.com.br/hgsi/";
const POST_SALES_QUESTIONNAIRE = "6";
const DEALERSHIP_CODE = "239";
const DEALERSHIP_USER_TYPE = "CO";

const campaignMonthNames: Record<string, string> = {
  janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
  julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};

type ParsedWorkbook = {
  rows: Record<string, unknown>[];
  campaignMonth: string;
  headerFound: boolean;
};

type HgsiRecordInput = {
  chassi: string;
  osNumber: string;
  status: string;
  valid: boolean;
  sourceMonth: string;
  clientName?: string;
  plate?: string;
  serviceLabel?: string;
  consultantName?: string;
  rawPayload: Record<string, unknown>;
};

type HgsiAnswerInput = {
  questionnaireId?: string;
  chassi: string;
  osNumber: string;
  responseStatus?: string;
  sourceMonth: string;
  clientName?: string;
  plate?: string;
  serviceLabel?: string;
  consultantName?: string;
  serviceDate?: string;
  answerDate?: string;
  nps?: number;
  recommendation?: boolean;
  installationScore?: number;
  consultantScore?: number;
  deadlineScore?: number;
  serviceQualityScore?: number;
  priceAlignmentScore?: number;
  washScore?: number;
  correctServiceScore?: number;
  correctService?: boolean;
  rawPayload: Record<string, unknown>;
};

type PortalExport = {
  buffer: Buffer;
  fileName: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function documentKey(...parts: string[]) {
  return parts
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "registro-sem-identificador";
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

function exactTextFrom(row: Record<string, unknown>, terms: string[]) {
  const entries = Object.entries(row);
  for (const term of terms) {
    const normalizedTerm = normalizeText(term);
    const entry = entries.find(([key]) => normalizeText(key) === normalizedTerm);
    const value = String(entry?.[1] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function serviceDateFromRow(row: Record<string, unknown>) {
  return exactTextFrom(row, ["datas servico", "data servico", "servico"])
    || textFrom(row, ["datas servico", "data servico"]);
}

function numberFrom(row: Record<string, unknown>, terms: string[]) {
  const raw = String(findColumn(row, terms) ?? "");
  if (!/\d/.test(raw)) return undefined;
  const parsed = Number(raw.replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boolFrom(row: Record<string, unknown>, terms: string[]) {
  const value = normalizeText(findColumn(row, terms));
  if (!value) return undefined;
  if (["nao", "n", "no", "incorreto", "0"].some((term) => value === term || value.includes(term))) return false;
  if (["sim", "s", "yes", "correto", "1"].some((term) => value === term || value.includes(term))) return true;
  return undefined;
}

function consultantDisplayName(name?: string) {
  const normalized = normalizeText(name);
  if (normalized.includes("cleverton") || normalized.includes("luan")) return "Luan";
  if (normalized.includes("rosangela")) return "Rosangela";
  if (normalized.includes("eliane")) return "Eliane";
  return name?.trim().split(/\s+/)[0] || "Sem consultor";
}

function isValidHgsiRecordStatus(status?: string) {
  const normalized = normalizeText(status);
  if (!normalized || normalized.includes("invalido") || normalized.includes("nao valido")) return false;
  return normalized.includes("registro valido") || normalized === "valido" || normalized.includes(" valido");
}

function campaignMonthFromLabel(value: string) {
  const normalized = normalizeText(value);
  const match = normalized.match(/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(\d{4})/);
  return match ? `${match[2]}-${campaignMonthNames[match[1]]}` : "";
}

function campaignMonthFromMatrix(matrix: unknown[][]) {
  const title = matrix.flat().map(normalizeText).find((value) => (value.includes("pos-vendas") || value.includes("pos vendas")) && /\b\d{4}\b/.test(value));
  return title ? campaignMonthFromLabel(title) : "";
}

export function parseHgsiWorkbook(buffer: Buffer): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("A planilha HGSI não possui uma aba legível.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: "" });
  const campaignMonth = campaignMonthFromMatrix(matrix);
  const headerIndex = matrix.findIndex((row) => {
    const cells = row.map(normalizeText);
    return cells.some((cell) => cell.includes("chassi") || cell.includes("vin"))
      && cells.some((cell) => cell.includes("status") || cell.includes("registro") || cell.includes("nota") || cell.includes("nps"));
  });

  const secondaryHeaderIndex = headerIndex < 0
    ? matrix.findIndex((row) => row.map(normalizeText).some((cell) => cell.includes("chassi") || cell.includes("vin")))
    : -1;
  const effectiveHeaderIndex = headerIndex >= 0 ? headerIndex : secondaryHeaderIndex;
  if (effectiveHeaderIndex < 0) return { rows: [], campaignMonth, headerFound: false };

  const childHeader = matrix[effectiveHeaderIndex];
  const parentHeader = effectiveHeaderIndex > 0 ? matrix[effectiveHeaderIndex - 1] : [];
  const headers = childHeader.map((header, index) => {
    const child = String(header ?? "").trim();
    const parent = headerIndex < 0 ? String(parentHeader[index] ?? "").trim() : "";
    if (parent && child) return `${parent} ${child}`;
    return child || parent || `COLUNA_${index}`;
  });
  const rows = matrix.slice(effectiveHeaderIndex + 1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
  return { rows, campaignMonth, headerFound: true };
}

function mapRecords(parsed: ParsedWorkbook, fallbackMonth: string): HgsiRecordInput[] {
  const sourceMonth = parsed.campaignMonth || fallbackMonth;
  return parsed.rows.map((row) => {
    const status = textFrom(row, ["status", "registro"]);
    return {
      chassi: textFrom(row, ["chassi", "vin"]).toUpperCase(),
      osNumber: textFrom(row, ["o.s", "os", "ordem"]),
      status,
      valid: isValidHgsiRecordStatus(status),
      sourceMonth,
      clientName: textFrom(row, ["cliente", "nome"]),
      plate: textFrom(row, ["placa"]),
      serviceLabel: textFrom(row, ["servico", "serviço", "tipo"]),
      consultantName: consultantDisplayName(textFrom(row, ["consultor responsavel", "consultor tecnico", "consultor"])),
      rawPayload: row,
    };
  }).filter((record) => record.chassi || record.osNumber);
}

function mapAnswers(parsed: ParsedWorkbook, fallbackMonth: string): HgsiAnswerInput[] {
  const fileMonth = parsed.campaignMonth || fallbackMonth;
  return parsed.rows.map((row) => ({
    questionnaireId: textFrom(row, ["questionario"]),
    chassi: textFrom(row, ["chassi", "vin"]).toUpperCase(),
    osNumber: textFrom(row, ["o.s", "os", "ordem"]),
    responseStatus: textFrom(row, ["status da pesquisa", "status entrevista", "status", "situacao", "situação"]),
    sourceMonth: fileMonth,
    clientName: textFrom(row, ["dados do cliente nome", "cliente nome"]),
    plate: textFrom(row, ["placa"]),
    serviceLabel: textFrom(row, ["dados do cliente veiculo", "veiculo", "veículo", "servico", "serviço", "tipo"]),
    consultantName: consultantDisplayName(textFrom(row, ["consultor responsavel", "consultor tecnico", "consultor"])),
    serviceDate: serviceDateFromRow(row),
    answerDate: textFrom(row, ["datas entrevista", "data entrevista", "entrevista", "data resposta", "respondido"]),
    nps: numberFrom(row, ["indice hgsi", "índice hgsi", "nps", "nota"]),
    recommendation: boolFrom(row, ["q1.3", "1.3", "recomendacao concessionaria", "recomendação concessionária", "recomendacao", "recomendação", "recomenda", "recomendaria"]),
    installationScore: numberFrom(row, ["q2 instalacoes", "q2 instalações", "instalacoes", "instalações"]),
    consultantScore: numberFrom(row, ["q3 consultor"]),
    deadlineScore: numberFrom(row, ["q4 tempo", "tempo", "prazo", "prazos"]),
    serviceQualityScore: numberFrom(row, ["q5 qualidade", "qualidade"]),
    priceAlignmentScore: numberFrom(row, ["q6 preco", "q6 preço", "preco", "preço", "preços", "alinhamento"]),
    washScore: numberFrom(row, ["q5.3.2 lavagem", "lavagem"]),
    correctServiceScore: numberFrom(row, ["q14.3 correto na primeira vez", "correto na primeira vez", "servico correto", "serviço correto"]),
    correctService: boolFrom(row, ["correto na primeira vez", "servico correto", "serviço correto", "servico realizado"]),
    rawPayload: row,
  })).filter((answer) => answer.chassi || answer.osNumber || answer.questionnaireId);
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  capture(headers: Headers) {
    const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
    const values = extendedHeaders.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
    values.flatMap((value) => value.split(/,(?=\s*[^;,]+=)/)).forEach((cookie) => {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    });
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

async function portalFetch(jar: CookieJar, path: string, init: RequestInit = {}) {
  let url = new URL(path, PORTAL_BASE_URL);
  let method = init.method ?? "GET";
  let body = init.body;
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const response = await fetch(url, {
      ...init,
      method,
      body,
      redirect: "manual",
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), ...(jar.header() ? { Cookie: jar.header() } : {}) },
      cache: "no-store",
    });
    jar.capture(response.headers);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    url = new URL(location, url);
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method.toUpperCase() === "POST")) {
      method = "GET";
      body = undefined;
    }
  }
  throw new Error("O portal HGSI redirecionou mais vezes do que o esperado.");
}

function selectOptions(html: string, fieldName: string) {
  const selectMatch = html.match(new RegExp(`<select[^>]*name=["']${fieldName}["'][^>]*>([\\s\\S]*?)<\\/select>`, "i"));
  if (!selectMatch) return [];
  return [...selectMatch[1].matchAll(/<option\b([^>]*)value=["']([^"']*)["']([^>]*)>([\s\S]*?)<\/option>/gi)].map((match) => ({
    value: match[2],
    label: decodeHtml(match[4].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
    selected: /\bselected\b/i.test(`${match[1]} ${match[3]}`),
  }));
}

function exportedFileName(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename=["']?([^"';]+)["']?/i);
  const value = utfMatch?.[1] ?? plainMatch?.[1];
  return value ? decodeURIComponent(value.trim()) : fallback;
}

async function downloadPortalExports(user: string, password: string) {
  const jar = new CookieJar();
  const loginBody = new URLSearchParams({ Usuario: user, Senha: password });
  const loginResponse = await portalFetch(jar, "Login/Index", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: loginBody,
  });
  if (!loginResponse.ok) throw new Error(`O login no portal HGSI falhou (${loginResponse.status}).`);

  const statusPage = await portalFetch(jar, "StatusRegistro/");
  const statusHtml = await statusPage.text();
  if (!statusPage.ok || /name=["']Usuario["']/i.test(statusHtml)) throw new Error("O portal HGSI não aceitou o login configurado.");
  const periods = selectOptions(statusHtml, "Perido").filter((option) => option.value && campaignMonthFromLabel(option.label));
  const selectedPeriod = periods.find((option) => option.selected) ?? periods[0];
  if (!selectedPeriod) throw new Error("Não foi possível identificar o período vigente no portal HGSI.");
  const sourceMonth = campaignMonthFromLabel(selectedPeriod.label);
  if (!sourceMonth) throw new Error(`O período HGSI não pôde ser convertido em mês: ${selectedPeriod.label}.`);

  const filterBody = new URLSearchParams({
    Perido: selectedPeriod.value,
    TipoQuest: POST_SALES_QUESTIONNAIRE,
    TipoUsuario: DEALERSHIP_USER_TYPE,
    CodAux: DEALERSHIP_CODE,
  });
  const filteredResponse = await portalFetch(jar, "StatusRegistro/Index", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: filterBody,
  });
  const filteredHtml = await filteredResponse.text();
  if (!filteredResponse.ok || !/pos[\s\-–—]*vendas/.test(normalizeText(filteredHtml))) {
    throw new Error("O filtro Pós-Vendas não foi confirmado pelo portal HGSI.");
  }

  const [recordsResponse, answersResponse] = await Promise.all([
    portalFetch(jar, "StatusRegistro/Exportar"),
    portalFetch(jar, "Entrevistas/Exportar"),
  ]);
  if (!recordsResponse.ok) throw new Error(`Falha ao baixar o status de registros (${recordsResponse.status}).`);
  if (!answersResponse.ok) throw new Error(`Falha ao baixar as respostas (${answersResponse.status}).`);
  const records: PortalExport = {
    buffer: Buffer.from(await recordsResponse.arrayBuffer()),
    fileName: exportedFileName(recordsResponse, `status-registro-${sourceMonth}.xls`),
  };
  const answers: PortalExport = {
    buffer: Buffer.from(await answersResponse.arrayBuffer()),
    fileName: exportedFileName(answersResponse, `respostas-${sourceMonth}.xls`),
  };
  if (!records.buffer.length || !answers.buffer.length) throw new Error("O portal HGSI retornou um arquivo vazio.");
  return { records, answers, sourceMonth, periodLabel: selectedPeriod.label };
}

async function deleteStaleDocuments(collectionName: string, sourceMonth: string, desiredIds: Set<string>) {
  const db = getFirebaseAdminDb();
  const snapshot = await db.collection(collectionName).where("sourceMonth", "==", sourceMonth).get();
  const stale = snapshot.docs.filter((item) => !desiredIds.has(item.id));
  for (let start = 0; start < stale.length; start += 450) {
    const batch = db.batch();
    stale.slice(start, start + 450).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  return stale.length;
}

async function saveRecords(records: HgsiRecordInput[], sourceFileName: string, sourceHash: string) {
  const db = getFirebaseAdminDb();
  const importBatchId = `hgsi-records-${records[0]?.sourceMonth ?? "sem-mes"}-${sourceHash.slice(0, 16)}`;
  const desiredIds = new Set<string>();
  for (let start = 0; start < Math.max(records.length, 1); start += 450) {
    const batch = db.batch();
    if (start === 0) batch.set(db.collection(collections.importBatches).doc(importBatchId), withoutUndefined({
      sourceFileName, sourceKind: "hgsi_records", importedBy: "automacao_hgsi", importedAt: FieldValue.serverTimestamp(),
      totalRows: records.length, sourceHash, notes: "Importacao automatica de status de registros Route/HGSI",
    }), { merge: true });
    records.slice(start, start + 450).forEach((record, offset) => {
      const index = start + offset;
      const id = documentKey(record.chassi || "sem-chassi", record.osNumber || `linha-${index}`, record.sourceMonth || "sem-mes");
      desiredIds.add(id);
      batch.set(db.collection(collections.hgsiRecords).doc(id), withoutUndefined({
        importBatchId, chassi: record.chassi, osNumber: record.osNumber, recordStatus: record.status,
        isValidRecord: record.valid, sourceMonth: record.sourceMonth, clientName: record.clientName,
        plate: record.plate, serviceLabel: record.serviceLabel, consultantName: record.consultantName,
        rawPayload: record.rawPayload, importedAt: FieldValue.serverTimestamp(),
      }), { merge: true });
    });
    await batch.commit();
  }
  const removed = await deleteStaleDocuments(collections.hgsiRecords, records[0].sourceMonth, desiredIds);
  return { importBatchId, removed };
}

async function saveAnswers(answers: HgsiAnswerInput[], sourceMonth: string, sourceFileName: string, sourceHash: string) {
  const db = getFirebaseAdminDb();
  const importBatchId = `hgsi-answers-${sourceMonth}-${sourceHash.slice(0, 16)}`;
  const desiredIds = new Set<string>();
  for (let start = 0; start < Math.max(answers.length, 1); start += 450) {
    const batch = db.batch();
    if (start === 0) batch.set(db.collection(collections.importBatches).doc(importBatchId), withoutUndefined({
      sourceFileName, sourceKind: "hgsi_answers", importedBy: "automacao_hgsi", importedAt: FieldValue.serverTimestamp(),
      totalRows: answers.length, sourceHash, notes: "Importacao automatica de respostas HGSI",
    }), { merge: true });
    answers.slice(start, start + 450).forEach((answer, offset) => {
      const index = start + offset;
      const id = documentKey(answer.chassi || "sem-chassi", answer.osNumber || answer.questionnaireId || `linha-${index}`, answer.sourceMonth || "sem-mes", answer.answerDate || `linha-${index}`);
      desiredIds.add(id);
      batch.set(db.collection(collections.hgsiAnswers).doc(id), withoutUndefined({
        importBatchId, questionnaireId: answer.questionnaireId, chassi: answer.chassi, osNumber: answer.osNumber,
        responseStatus: answer.responseStatus, sourceMonth: answer.sourceMonth, clientName: answer.clientName,
        plate: answer.plate, serviceLabel: answer.serviceLabel, consultantName: answer.consultantName,
        serviceDate: answer.serviceDate, answerDate: answer.answerDate, nps: answer.nps,
        recommendation: answer.recommendation, installationScore: answer.installationScore,
        consultantScore: answer.consultantScore, deadlineScore: answer.deadlineScore,
        serviceQualityScore: answer.serviceQualityScore, priceAlignmentScore: answer.priceAlignmentScore,
        washScore: answer.washScore, correctServiceScore: answer.correctServiceScore,
        correctService: answer.correctService, rawPayload: answer.rawPayload, importedAt: FieldValue.serverTimestamp(),
      }), { merge: true });
    });
    await batch.commit();
  }
  const removed = await deleteStaleDocuments(collections.hgsiAnswers, sourceMonth, desiredIds);
  return { importBatchId, removed };
}

export async function runAutomaticHgsiImport() {
  const user = process.env.HGSI_PORTAL_USER;
  const password = process.env.HGSI_PORTAL_PASSWORD;
  if (!user || !password) throw new Error("As credenciais protegidas do portal HGSI não estão configuradas.");
  const exported = await downloadPortalExports(user, password);
  const parsedRecords = parseHgsiWorkbook(exported.records.buffer);
  const parsedAnswers = parseHgsiWorkbook(exported.answers.buffer);
  if (!parsedRecords.headerFound || !parsedRecords.rows.length) throw new Error("O relatório de status HGSI não contém registros reconhecíveis; a base atual foi preservada.");
  if (!parsedAnswers.headerFound) throw new Error("O relatório de respostas HGSI não possui o formato esperado; a base atual foi preservada.");
  const recordMonth = parsedRecords.campaignMonth || exported.sourceMonth;
  const answerMonth = parsedAnswers.campaignMonth || exported.sourceMonth;
  if (recordMonth !== exported.sourceMonth || answerMonth !== exported.sourceMonth) {
    throw new Error("Os relatórios baixados não correspondem ao período vigente; a base atual foi preservada.");
  }
  const records = mapRecords(parsedRecords, exported.sourceMonth);
  const answers = mapAnswers(parsedAnswers, exported.sourceMonth);
  if (!records.length) throw new Error("Nenhum registro HGSI válido para importação foi encontrado; a base atual foi preservada.");
  const recordsHash = createHash("sha256").update(exported.records.buffer).digest("hex");
  const answersHash = createHash("sha256").update(exported.answers.buffer).digest("hex");
  const recordResult = await saveRecords(records, exported.records.fileName, recordsHash);
  const answerResult = await saveAnswers(answers, exported.sourceMonth, exported.answers.fileName, answersHash);
  return {
    sourceMonth: exported.sourceMonth,
    periodLabel: exported.periodLabel,
    records: records.length,
    answers: answers.length,
    removedStaleRecords: recordResult.removed,
    removedStaleAnswers: answerResult.removed,
    recordImportBatchId: recordResult.importBatchId,
    answerImportBatchId: answerResult.importBatchId,
  };
}
