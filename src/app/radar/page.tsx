"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { downloadFarolPdf } from "@/lib/farol-pdf";
import { historicalSalesResults } from "@/lib/balcao-indicators";
import { listVehicleFlowsForMonth, saveFarolChannelRevenue, saveFarolDailyResult, saveFarolGrossProfit, saveFarolMonthlyPlan, saveFarolObservation, saveFarolRevenue, saveFarolServiceProductivity, subscribeFarolChannelRevenue, subscribeFarolDailyResultsForMonth, subscribeFarolGrossProfit, subscribeFarolMonthlyPlans, subscribeFarolObservationsForMonth, subscribeFarolRevenue, subscribeFarolServiceProductivity, subscribePartsCounterEntriesForMonth, subscribePartsSalesGoals, type FarolChannelRevenue, type FarolDailyResult, type FarolGrossProfit, type FarolMonthlyPlan, type FarolObservation, type FarolOperationalDay, type FarolOperationalDayType, type FarolRevenue, type FarolServiceProductivity } from "@/services/firestore";
import type { PartsCounterEntry, PartsSalesGoal, VehicleFlow } from "@/types/domain";


type DailyResult = {
  day: string;
  weekDay: string;
  shopGoal: number;
  shopDone: number | null;
  revisionCount?: number | null;
  shopPreviousYear?: number | null;
  beautyGoal: number;
  beautyDone: number | null;
  beautyPreviousYear?: number | null;
  special?: "today" | "holiday" | "future";
  operationalLabel?: string;
};

type ChannelRevenue = {
  channel: "Oficina Produtiva" | "Acessórios" | "Embelezamento" | "Funilaria" | "Balcão";
  key: keyof Omit<FarolChannelRevenue, "id" | "month" | "updatedBy" | "updatedAt">;
  total: number;
};

type ProductivityMetric = {
  label: string;
  current: number;
  lastYear: number;
  type: "currency" | "number";
  note: string;
};

type GrossProfitMonth = {
  month: string;
  label: string;
  planned: number;
  realized: number;
  previousYear: number;
  margin: number;
};

type ProductivityPerson = {
  name: string;
  beauty: number;
  revision: number;
  repair: number;
  diagnosis: number;
  total: number;
};

type ConsultantServiceDetail = {
  category: "Adicionais" | "Embelezamento";
  tmo: string;
  service: string;
  quantity: number;
  amount: number;
};

type ConsultantServicePerformance = {
  id: string;
  name: string;
  revisions: number;
  revisionSales: number;
  additionalSales: number;
  beautySales: number;
  details: ConsultantServiceDetail[];
};

type BalcaoSummary = {
  sold: number;
  lost: number;
  expectation: number;
  projectedOrders: number;
  salesDailyAverage: number;
  goal: number;
  dailyGoal: number;
  todaySales: number;
  pf: number;
  pj: number;
  destinations: Array<{ state: string; total: number; pf: number; pj: number }>;
};

type FarolPdfReportKey = "goals" | "daily" | "counter" | "revenue" | "gross-profit" | "channels" | "productivity" | "consultants";
type FarolDataStatus = "Parcial" | "Fechado" | "Sem fechamento" | "Sem base";

const farolPdfReports: Array<{ key: FarolPdfReportKey; label: string }> = [
  { key: "goals", label: "Metas mensais e operação" },
  { key: "daily", label: "Resultado Diário" },
  { key: "counter", label: "Balcão de Peças" },
  { key: "revenue", label: "Faturamento" },
  { key: "gross-profit", label: "Lucro Bruto" },
  { key: "channels", label: "Faturamento por Canal" },
  { key: "productivity", label: "Produtividade e TKM de Serviços" },
  { key: "consultants", label: "Resultados por Consultor" },
];

const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

function parseCurrencyInput(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  return Math.max(0, Number(normalized) || 0);
}

function parsePercentInput(value: string) {
  return Math.max(0, Number(value.trim().replace(",", ".")) || 0);
}

function normalizePercentValue(value: number) {
  return value > 100 ? value / 100 : value;
}

function formatUpdatedAt(value?: unknown) {
  if (!value || typeof value !== "object" || !("toDate" in value) || typeof value.toDate !== "function") return "base inicial";
  return value.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function businessDayWeight(date: Date) {
  const weekDay = date.getDay();
  if (weekDay === 0) return 0;
  return weekDay === 6 ? 0.5 : 1;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function operationalDayWeight(date: Date, operationalDays: FarolOperationalDay[]) {
  const exception = operationalDays.find((item) => item.date === localDateKey(date));
  if (exception?.type === "holiday" || exception?.type === "closed") return 0;
  if (exception?.type === "half") return 0.5;
  if (exception?.type === "full") return 1;
  return businessDayWeight(date);
}

function buildMonthSummary(selectedMonth: string, today: Date, operationalDays: FarolOperationalDay[] = []) {
  const [year, month] = selectedMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const selectedOrder = year * 12 + month;
  const currentOrder = today.getFullYear() * 12 + today.getMonth() + 1;
  let businessDays = 0;
  let passedDays = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const weight = operationalDayWeight(new Date(year, month - 1, day), operationalDays);
    businessDays += weight;
    if (selectedOrder < currentOrder || (selectedOrder === currentOrder && day <= today.getDate())) passedDays += weight;
  }

  return {
    today: today.toLocaleDateString("pt-BR"),
    businessDays,
    passedDays,
    remainingDays: Math.max(0, businessDays - passedDays),
  };
}

function formatDayCount(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function timestampDate(value: VehicleFlow["createdAt"] | VehicleFlow["deliveredAt"]) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  const candidate = value as unknown as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") return candidate.toDate();
  return null;
}

function partsDate(value: PartsCounterEntry["createdAt"] | PartsCounterEntry["occurredOn"]) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value.includes("T") ? value : `${value}T12:00:00`);
  const candidate = value as unknown as { toDate?: () => Date };
  return typeof candidate.toDate === "function" ? candidate.toDate() : null;
}

function partsEntryMonth(entry: PartsCounterEntry) {
  const date = partsDate(entry.occurredOn ?? entry.createdAt);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
}

function partsEntryDateKey(entry: PartsCounterEntry) {
  const date = partsDate(entry.occurredOn ?? entry.createdAt);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
}

function partsEntryTotal(entry: PartsCounterEntry) {
  return entry.items.reduce((total, item) => total + item.quantity * item.unitPrice, 0) + (entry.freightAmount ?? 0);
}

function projectedOrderTotal(entry: PartsCounterEntry, selectedMonth: string) {
  const monthEnd = `${selectedMonth}-31`;
  const itemsTotal = entry.items.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
  const eligibleItemsTotal = entry.items.reduce((total, item) => {
    if (!item.expectedArrivalDate || item.expectedArrivalDate > monthEnd) return total;
    return total + item.quantity * item.unitPrice;
  }, 0);
  const freightShare = itemsTotal ? (eligibleItemsTotal / itemsTotal) * (entry.freightAmount ?? 0) : 0;
  return eligibleItemsTotal + freightShare;
}

function belongsToMonth(vehicle: VehicleFlow, selectedMonth: string) {
  const dates = [timestampDate(vehicle.createdAt), timestampDate(vehicle.deliveredAt)].filter(Boolean) as Date[];
  const timestampMatches = dates.some((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` === selectedMonth);
  return timestampMatches || vehicle.appointmentDate?.slice(0, 7) === selectedMonth;
}

const july2026FinancialRows: DailyResult[] = [
  { weekDay: "QUA", day: "01/jul", shopGoal: 6667, shopDone: 7933, revisionCount: 5, beautyGoal: 1458, beautyDone: 1500 },
  { weekDay: "QUI", day: "02/jul", shopGoal: 6667, shopDone: 11532, revisionCount: 13, beautyGoal: 1458, beautyDone: 1780 },
  { weekDay: "SEX", day: "03/jul", shopGoal: 6667, shopDone: 11480, revisionCount: 16, beautyGoal: 1458, beautyDone: 2506 },
  { weekDay: "SAB", day: "04/jul", shopGoal: 3333, shopDone: 5608, revisionCount: 3, beautyGoal: 729, beautyDone: 770 },
  { weekDay: "SEG", day: "06/jul", shopGoal: 6667, shopDone: 9160, revisionCount: 11, beautyGoal: 1458, beautyDone: 1320 },
  { weekDay: "TER", day: "07/jul", shopGoal: 6667, shopDone: 8349, revisionCount: 14, beautyGoal: 1458, beautyDone: 1010 },
  { weekDay: "QUA", day: "08/jul", shopGoal: 6667, shopDone: null, beautyGoal: 1458, beautyDone: null },
  { weekDay: "QUI", day: "09/jul", shopGoal: 6667, shopDone: 17029, revisionCount: 14, beautyGoal: 1458, beautyDone: 1310 },
  { weekDay: "SEX", day: "10/jul", shopGoal: 6667, shopDone: 9527, revisionCount: 14, beautyGoal: 1458, beautyDone: 1040 },
  { weekDay: "SAB", day: "11/jul", shopGoal: 3333, shopDone: 5887, revisionCount: 7, beautyGoal: 729, beautyDone: 494 },
  { weekDay: "SEG", day: "13/jul", shopGoal: 6667, shopDone: 4827, revisionCount: 9, beautyGoal: 1458, beautyDone: 774 },
  { weekDay: "TER", day: "14/jul", shopGoal: 6667, shopDone: 11511, revisionCount: 14, beautyGoal: 1458, beautyDone: 2370 },
  { weekDay: "QUA", day: "15/jul", shopGoal: 6667, shopDone: 4395, revisionCount: 6, beautyGoal: 1458, beautyDone: 340 },
  { weekDay: "QUI", day: "16/jul", shopGoal: 6667, shopDone: 7826, revisionCount: 8, beautyGoal: 1458, beautyDone: 2927 },
  { weekDay: "SEX", day: "17/jul", shopGoal: 6667, shopDone: 6289, revisionCount: 11, beautyGoal: 1458, beautyDone: 2240 },
  { weekDay: "SAB", day: "18/jul", shopGoal: 3333, shopDone: 3521, revisionCount: 3, beautyGoal: 729, beautyDone: 1580 },
  { weekDay: "SEG", day: "20/jul", shopGoal: 6667, shopDone: 11722, revisionCount: 13, beautyGoal: 1458, beautyDone: 820 },
  { weekDay: "TER", day: "21/jul", shopGoal: 6667, shopDone: 11559, revisionCount: 13, beautyGoal: 1458, beautyDone: 3070 },
  { weekDay: "QUA", day: "22/jul", shopGoal: 6667, shopDone: 9431, revisionCount: 9, beautyGoal: 1458, beautyDone: 920 },
  { weekDay: "QUI", day: "23/jul", shopGoal: 6667, shopDone: 9338, revisionCount: 17, beautyGoal: 1458, beautyDone: 3070 },
  { weekDay: "SEX", day: "24/jul", shopGoal: 6667, shopDone: 9285, revisionCount: 14, beautyGoal: 1458, beautyDone: 1305 },
  { weekDay: "SAB", day: "25/jul", shopGoal: 3333, shopDone: 3781, revisionCount: 4, beautyGoal: 729, beautyDone: 360 },
  { weekDay: "SEG", day: "27/jul", shopGoal: 6667, shopDone: 8253, revisionCount: 12, beautyGoal: 1458, beautyDone: 2820 },
  { weekDay: "TER", day: "28/jul", shopGoal: 6667, shopDone: 11824, revisionCount: 15, beautyGoal: 1458, beautyDone: 1040 },
  { weekDay: "QUA", day: "29/jul", shopGoal: 6667, shopDone: 9785, revisionCount: 15, beautyGoal: 1458, beautyDone: 1180 },
  { weekDay: "QUI", day: "30/jul", shopGoal: 6667, shopDone: 10414, revisionCount: 14, beautyGoal: 1458, beautyDone: 1380 },
  { weekDay: "SEX", day: "31/jul", shopGoal: 6667, shopDone: 6209, revisionCount: 10, beautyGoal: 1458, beautyDone: 1370 },
];

const dailyPreviousYearResults: Record<string, Record<number, { shop: number; beauty: number }>> = {
  "2025-08": {
    1: { shop: 5522, beauty: 480 },
    2: { shop: 1404, beauty: 0 },
    4: { shop: 8189, beauty: 1385 },
    5: { shop: 7475, beauty: 1120 },
    6: { shop: 4261, beauty: 60 },
    7: { shop: 6384, beauty: 1150 },
    8: { shop: 7282, beauty: 830 },
    9: { shop: 2760, beauty: 400 },
    11: { shop: 5942, beauty: 2240 },
    12: { shop: 11017, beauty: 2160 },
    13: { shop: 4410, beauty: 2170 },
    14: { shop: 3946, beauty: 879 },
    15: { shop: 10891, beauty: 930 },
    16: { shop: 1511, beauty: 530 },
    18: { shop: 6333, beauty: 900 },
    19: { shop: 6328, beauty: 1225 },
    20: { shop: 6576, beauty: 1169 },
    21: { shop: 4675, beauty: 1120 },
    22: { shop: 4344, beauty: 2230 },
    23: { shop: 3683, beauty: 330 },
    25: { shop: 5993, beauty: 2070 },
    26: { shop: 5806, beauty: 370 },
    27: { shop: 8859, beauty: 2010 },
    28: { shop: 5928, beauty: 1340 },
    29: { shop: 6056, beauty: 2130 },
    30: { shop: 3084, beauty: 3350 },
  },
};

const channelDefinitions: Array<Omit<ChannelRevenue, "total">> = [
  { channel: "Oficina Produtiva", key: "oficinaProdutiva" },
  { channel: "Acessórios", key: "acessorios" },
  { channel: "Embelezamento", key: "embelezamento" },
  { channel: "Funilaria", key: "funilaria" },
  { channel: "Balcão", key: "balcao" },
];

const channelRevenueBaseline: Record<string, Omit<FarolChannelRevenue, "id" | "updatedBy" | "updatedAt">> = {
  "2026-08": { month: "2026-08", oficinaProdutiva: 132012.77, acessorios: 0, embelezamento: 12592.67, funilaria: 15400, balcao: 22275.12 },
};

const monthlyTrend = [
  { month: "2025-01", label: "Jan/25", parts: 241108.24, services: 246289.65, total: 487397.89 },
  { month: "2025-02", label: "Fev/25", parts: 223302, services: 211887, total: 435189 },
  { month: "2025-03", label: "Mar/25", parts: 247638.1, services: 198178.92, total: 445817.02 },
  { month: "2025-04", label: "Abr/25", parts: 281201.09, services: 234402.04, total: 515603.13 },
  { month: "2025-05", label: "Mai/25", parts: 372002.8, services: 266928.45, total: 638931.25 },
  { month: "2025-06", label: "Jun/25", parts: 284073.81, services: 209736.28, total: 493810.09 },
  { month: "2025-07", label: "Jul/25", parts: 380146.58, services: 274569.81, total: 654716.39 },
  { month: "2025-08", label: "Ago/25", parts: 272387.63, services: 226228.86, total: 498616.49 },
  { month: "2025-09", label: "Set/25", parts: 308081.85, services: 250528.65, total: 558610.5 },
  { month: "2025-10", label: "Out/25", parts: 365392.23, services: 259119.86, total: 624512.09 },
  { month: "2025-11", label: "Nov/25", parts: 331809.81, services: 236757.54, total: 568567.35 },
  { month: "2025-12", label: "Dez/25", parts: 280929.29, services: 261207.24, total: 542136.53 },
  { month: "2026-01", label: "Jan/26", parts: 323918.21, services: 277066.15, total: 600984.36 },
  { month: "2026-02", label: "Fev/26", parts: 409043.72, services: 233893.49, total: 642937.21 },
  { month: "2026-03", label: "Mar/26", parts: 341570.1, services: 214654.11, total: 556224.21 },
  { month: "2026-04", label: "Abr/26", parts: 335258.4, services: 249645.91, total: 584904.31 },
  { month: "2026-05", label: "Mai/26", parts: 393241.62, services: 270270.79, total: 663512.41 },
  { month: "2026-06", label: "Jun/26", parts: 408626.59, services: 249430.37, total: 658056.96 },
  { month: "2026-07", label: "Jul/26", parts: 414682.19, services: 321911, total: 736593.19 },
  { month: "2026-08", label: "Ago/26", parts: 112413.6, services: 70138.61, total: 182552.21 },
];

const grossProfitTrend: GrossProfitMonth[] = [
  { month: "2026-01", label: "Jan", planned: 282264.93, realized: 306966.65, previousYear: 225188.02, margin: 53.89 },
  { month: "2026-02", label: "Fev", planned: 230405.81, realized: 279127.55, previousYear: 216509.83, margin: 46.84 },
  { month: "2026-03", label: "Mar", planned: 279191.39, realized: 244476.86, previousYear: 220775.76, margin: 44.97 },
  { month: "2026-04", label: "Abr", planned: 266895.83, realized: 235579.73, previousYear: 245068.65, margin: 43.8 },
  { month: "2026-05", label: "Mai", planned: 272944.44, realized: 304937.56, previousYear: 262659.27, margin: 49.72 },
  { month: "2026-06", label: "Jun", planned: 266895.83, realized: 275505.68, previousYear: 224693.3, margin: 45.17 },
  { month: "2026-07", label: "Jul", planned: 288244.79, realized: 184033.77, previousYear: 288424.89, margin: 56.32 },
];

const serviceReportSnapshots: Record<string, { revisions: number; revisionSales: number; mechanicsSales: number; additionalSales: number; beautySales: number; productiveShop: number; totalServices: number; tkmServices?: number; tkmAdditional?: number; tkmBeauty?: number }> = {
  "2025-07": {
    revisions: 263,
    revisionSales: 87968,
    mechanicsSales: 36409,
    additionalSales: 44853,
    beautySales: 46800,
    productiveShop: 169230,
    totalServices: 274673,
    tkmServices: 682,
    tkmAdditional: 171,
    tkmBeauty: 178,
  },
  "2026-07": {
    revisions: 281,
    revisionSales: 114710.32,
    mechanicsSales: 27828.88,
    additionalSales: 84660.52,
    beautySales: 40332.37,
    productiveShop: 227510,
    totalServices: 321911,
    tkmServices: 853,
    tkmAdditional: 301,
    tkmBeauty: 144,
  },
  "2025-08": {
    revisions: 238,
    revisionSales: 73866,
    mechanicsSales: 31128,
    additionalSales: 51851,
    beautySales: 29289,
    productiveShop: 156845,
    totalServices: 226801,
    tkmServices: 651,
    tkmAdditional: 218,
    tkmBeauty: 123,
  },
  "2026-08": {
    revisions: 71,
    revisionSales: 28239.26,
    mechanicsSales: 17444.7,
    additionalSales: 21100.65,
    beautySales: 12202.09,
    productiveShop: 66784.61,
    totalServices: 70138.61,
  },
};

const consultantServicePerformance: Record<string, ConsultantServicePerformance[]> = {
  "2026-08": [
    {
      id: "295",
      name: "Eliane Ribeiro",
      revisions: 110,
      revisionSales: 31548.73,
      additionalSales: 29824.24,
      beautySales: 16738.18,
      details: [
        { category: "Adicionais", tmo: "LCE-HMB", service: "Limpeza de caixa evaporadora", quantity: 42, amount: 11030 },
        { category: "Adicionais", tmo: "LIE-HMB", service: "Limpeza de injeção eletrônica / descarbonização", quantity: 5, amount: 2250 },
        { category: "Adicionais", tmo: "HG-HMB", service: "Higienização / sanitização do ar", quantity: 4, amount: 680 },
        { category: "Adicionais", tmo: "LL-HMB", service: "Limpeza e lubrificação das lonas de freio", quantity: 4, amount: 1200 },
        { category: "Adicionais", tmo: "PFD-HMB", service: "Substituição das pastilhas de freio dianteiras", quantity: 2, amount: 444.96 },
        { category: "Adicionais", tmo: "SV-HMB", service: "Substituição das velas", quantity: 4, amount: 750 },
        { category: "Adicionais", tmo: "A-HMB", service: "Alinhamento", quantity: 2, amount: 243.2 },
        { category: "Adicionais", tmo: "AB-HMB", service: "Alinhamento e balanceamento", quantity: 54, amount: 11348.08 },
        { category: "Adicionais", tmo: "FF-HMB", service: "Substituição e limpeza do fluido de freio", quantity: 7, amount: 1878 },
        { category: "Embelezamento", tmo: "EST05", service: "Lavagem dos bancos e hidratação", quantity: 11, amount: 3267.48 },
        { category: "Embelezamento", tmo: "EST01", service: "Lavagem de motor verniz", quantity: 67, amount: 9593.45 },
        { category: "Embelezamento", tmo: "EST03", service: "Lavagem dos bancos", quantity: 3, amount: 1127.25 },
        { category: "Embelezamento", tmo: "EST12", service: "Lavagem simples + aspiração", quantity: 19, amount: 1370 },
        { category: "Embelezamento", tmo: "EST06", service: "Vitrificação da pintura", quantity: 1, amount: 480 },
        { category: "Embelezamento", tmo: "EST26", service: "Polimento", quantity: 1, amount: 300 },
        { category: "Embelezamento", tmo: "LAV03", service: "Serviço de lavagem comp. + polimento", quantity: 1, amount: 600 },
      ],
    },
    {
      id: "1395",
      name: "Rosangela Soares",
      revisions: 127,
      revisionSales: 31020.62,
      additionalSales: 39778.04,
      beautySales: 26506.75,
      details: [
        { category: "Adicionais", tmo: "LCE-HMB", service: "Limpeza de caixa evaporadora", quantity: 36, amount: 3685.56 },
        { category: "Adicionais", tmo: "LIE-HMB", service: "Limpeza de injeção eletrônica", quantity: 17, amount: 6965 },
        { category: "Adicionais", tmo: "FF-HMB", service: "Substituição e limpeza do fluido de freio", quantity: 8, amount: 1837.48 },
        { category: "Adicionais", tmo: "AB-HMB", service: "Alinhamento e balanceamento", quantity: 64, amount: 13513 },
        { category: "Adicionais", tmo: "LL-HMB", service: "Limpeza e lubrificação das lonas de freio", quantity: 4, amount: 1338 },
        { category: "Adicionais", tmo: "PFD-HMB", service: "Substituição das pastilhas de freio dianteiras", quantity: 5, amount: 1024 },
        { category: "Adicionais", tmo: "SC-HMB", service: "Substituição das correias", quantity: 6, amount: 1610 },
        { category: "Adicionais", tmo: "SV-HMB", service: "Substituição das velas", quantity: 14, amount: 2555 },
        { category: "Adicionais", tmo: "HG-HMB", service: "Higienização / sanitização do ar", quantity: 48, amount: 7250 },
        { category: "Embelezamento", tmo: "CC-HMB-PCBG35", service: "Película Pro Carbono G35", quantity: 1, amount: 600 },
        { category: "Embelezamento", tmo: "EST26", service: "Polimento", quantity: 1, amount: 400 },
        { category: "Embelezamento", tmo: "EST12", service: "Lavagem simples + aspiração", quantity: 21, amount: 1636.48 },
        { category: "Embelezamento", tmo: "EST06", service: "Vitrificação da pintura", quantity: 2, amount: 2400 },
        { category: "Embelezamento", tmo: "EST05", service: "Lavagem dos bancos e hidratação", quantity: 15, amount: 4830 },
        { category: "Embelezamento", tmo: "EST03", service: "Lavagem dos bancos", quantity: 4, amount: 1190.27 },
        { category: "Embelezamento", tmo: "EST01", service: "Lavagem de motor verniz", quantity: 90, amount: 12950 },
        { category: "Embelezamento", tmo: "CC-HMB-PTPBG35", service: "Película térmica para-brisa G35", quantity: 2, amount: 1200 },
        { category: "Embelezamento", tmo: "CC-HMB-PTPB", service: "Película térmica para-brisa G70", quantity: 1, amount: 500 },
        { category: "Embelezamento", tmo: "EST19", service: "Proteção de pintura", quantity: 1, amount: 800 },
      ],
    },
    {
      id: "1959",
      name: "Cleverton Macedo",
      revisions: 1,
      revisionSales: 190.89,
      additionalSales: 0,
      beautySales: 70,
      details: [
        { category: "Embelezamento", tmo: "EST12", service: "Lavagem simples + aspiração", quantity: 1, amount: 70 },
      ],
    },
  ],
};

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatDeltaPercent(value: number) {
  const signal = value > 0 ? "+" : "";
  return `${signal}${value.toFixed(1).replace(".", ",")}%`;
}

function buildFinancialRows(selectedMonth: string, shopMonthlyGoal: number, beautyMonthlyGoal: number, today: Date, enteredResults: FarolDailyResult[], operationalDays: FarolOperationalDay[] = []) {
  const resultByDay = new Map(enteredResults.filter((item) => item.month === selectedMonth).map((item) => [item.day, item]));
  const julyLegacyByDay = selectedMonth === "2026-07" ? new Map(july2026FinancialRows.map((row) => [Number(row.day.slice(0, 2)), row])) : new Map<number, DailyResult>();

  const [year, month] = selectedMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const businessDays = buildMonthSummary(selectedMonth, today, operationalDays).businessDays;
  const previousYearKey = `${year - 1}-${String(month).padStart(2, "0")}`;
  const previousYearResults = dailyPreviousYearResults[previousYearKey] ?? {};
  const shopFullDayGoal = businessDays ? shopMonthlyGoal / businessDays : 0;
  const beautyFullDayGoal = businessDays ? beautyMonthlyGoal / businessDays : 0;
  const rows: DailyResult[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month - 1, day);
    const exception = operationalDays.find((item) => item.date === localDateKey(date));
    const weight = operationalDayWeight(date, operationalDays);
    if (!weight && !exception) continue;

    const dateOrder = new Date(year, month - 1, day).getTime();
    const todayOrder = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const special: DailyResult["special"] = exception?.type === "holiday" || exception?.type === "closed" ? "holiday" : dateOrder === todayOrder ? "today" : dateOrder > todayOrder ? "future" : undefined;
    const previousYearResult = previousYearResults[day];
    const entered = resultByDay.get(day);
    const legacy = julyLegacyByDay.get(day);
    rows.push({
      weekDay: date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase(),
      day: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
      shopGoal: shopFullDayGoal * weight,
      shopDone: entered ? entered.revision + entered.generalMechanics + entered.alignmentBalancing : legacy?.shopDone ?? null,
      revisionCount: entered?.revisionCount ?? legacy?.revisionCount ?? null,
      shopPreviousYear: previousYearResult?.shop ?? null,
      beautyGoal: beautyFullDayGoal * weight,
      beautyDone: entered ? entered.beauty : legacy?.beautyDone ?? null,
      beautyPreviousYear: previousYearResult?.beauty ?? null,
      special,
      operationalLabel: exception?.label || (exception?.type === "holiday" ? "Feriado" : exception?.type === "closed" ? "Sem operação" : undefined),
    });
  }

  return rows;
}

function formatCompactCurrency(value: number) {
  if (value >= 1000000) return `R$ ${(value / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (value >= 1000) return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

function sumRows(rows: DailyResult[], field: "shopGoal" | "shopDone" | "beautyGoal" | "beautyDone") {
  return rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
}

function areaSummary(goal: number, done: number, passedDays: number, businessDays: number) {
  const balance = done - goal;
  const dailyAverage = passedDays ? done / passedDays : 0;
  const projection = dailyAverage * businessDays;
  const percent = goal ? (done / goal) * 100 : 0;

  return { goal, done, balance, projection, percent };
}

function variation(current: number, previous: number) {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

function productivityType(vehicle: VehicleFlow): keyof Pick<ProductivityPerson, "beauty" | "revision" | "repair" | "diagnosis"> {
  const label = (vehicle.serviceLabel ?? "").toLowerCase();
  if (label.includes("embelez") || label.includes("lavagem")) return "beauty";
  if (label.includes("diagnóstico") || label.includes("diagnostico")) return "diagnosis";
  if (label.includes("reparo") || label.includes("mecân") || label.includes("mecan") || label.includes("funilar")) return "repair";
  return "revision";
}

function serviceTypeForFlow(vehicle: VehicleFlow) {
  const type = productivityType(vehicle);
  if (type === "diagnosis") return "diagnosis";
  if (type === "repair") return "repair";
  return "revision";
}

function monthFromDate(value: VehicleFlow["appointmentDate"] | VehicleFlow["deliveredAt"]) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 7);
  const date = timestampDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
}

function appointmentDateTime(vehicle: VehicleFlow) {
  if (!vehicle.appointmentDate || !vehicle.appointmentTime) return null;
  const normalizedTime = vehicle.appointmentTime.slice(0, 5).padStart(5, "0");
  const date = new Date(`${vehicle.appointmentDate}T${normalizedTime}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRealNoShow(vehicle: VehicleFlow, referenceDate: Date) {
  if (vehicle.status === "cancelado" || vehicle.attendanceStartedAt || vehicle.deliveredAt) return false;
  const appointment = appointmentDateTime(vehicle);
  if (!appointment) return false;
  return referenceDate.getTime() - appointment.getTime() > 60 * 60 * 1000;
}

const productivityPeople = {
  consultantName: ["Rosangela", "Cleverton", "Eliane", "Luan"],
  technicianName: ["Ayslan", "Gilvan", "Wesley", "Hernando", "Elimarcos", "Igo"],
} satisfies Record<"consultantName" | "technicianName", string[]>;

const productivityAliases: Record<string, string[]> = {
  Ayslan: ["ayslan", "aylan"],
};

function normalizePersonName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function buildProductivity(vehicles: VehicleFlow[], selectedMonth: string, personKey: "consultantName" | "technicianName") {
  const allowedPeople = productivityPeople[personKey];
  const accountablePeople = [...allowedPeople, "Não identificado"];
  const grouped = new Map<string, ProductivityPerson>(accountablePeople.map((name) => [name, { name, beauty: 0, revision: 0, repair: 0, diagnosis: 0, total: 0 }]));

  vehicles
    .filter((vehicle) => monthFromDate(vehicle.deliveredAt) === selectedMonth)
    .forEach((vehicle) => {
      const sourceName = vehicle[personKey]?.trim();
      const sourceTokens = sourceName ? normalizePersonName(sourceName).split(/\s+/) : [];
      const type = productivityType(vehicle);
      const identifiedName = allowedPeople.find((candidate) => {
        const aliases = productivityAliases[candidate] ?? [normalizePersonName(candidate)];
        return aliases.some((alias) => sourceTokens.includes(alias));
      });
      const name = identifiedName ?? (personKey === "technicianName" && type === "beauty" ? "Igo" : "Não identificado");

      const current = grouped.get(name)!;
      current[type] += 1;
      current.total += 1;
      grouped.set(name, current);
    });

  return accountablePeople.map((name) => grouped.get(name)!);
}

export default function FarolGerencialPage() {
  const { profile } = useAuth();
  const canManageReports = profile?.role === "admin";
  const farolPrintRef = useRef<HTMLElement | null>(null);
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [partsEntries, setPartsEntries] = useState<PartsCounterEntry[]>([]);
  const [partsGoals, setPartsGoals] = useState<PartsSalesGoal[]>([]);
  const [dailyResults, setDailyResults] = useState<FarolDailyResult[]>([]);
  const [revenueEntries, setRevenueEntries] = useState<FarolRevenue[]>([]);
  const [grossProfitEntries, setGrossProfitEntries] = useState<FarolGrossProfit[]>([]);
  const [channelRevenueEntries, setChannelRevenueEntries] = useState<FarolChannelRevenue[]>([]);
  const [serviceProductivityEntries, setServiceProductivityEntries] = useState<FarolServiceProductivity[]>([]);
  const [monthlyPlans, setMonthlyPlans] = useState<FarolMonthlyPlan[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()));
  const [comparePreviousYear, setComparePreviousYear] = useState(true);
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [observationValues, setObservationValues] = useState<Record<string, string>>({});
  const [activeObservation, setActiveObservation] = useState<{ key: string; label: string } | null>(null);
  const [observationValueDraft, setObservationValueDraft] = useState("");
  const [observationCommentDraft, setObservationCommentDraft] = useState("");
  const [savingObservation, setSavingObservation] = useState("");
  const [activeDailyResult, setActiveDailyResult] = useState(false);
  const [dailyResultDraft, setDailyResultDraft] = useState({ day: 1, revision: "", revisionCount: "", generalMechanics: "", alignmentBalancing: "", beauty: "" });
  const [savingDailyResult, setSavingDailyResult] = useState(false);
  const [activeRevenueEntry, setActiveRevenueEntry] = useState(false);
  const [revenueDraft, setRevenueDraft] = useState({ month: "", parts: "", services: "" });
  const [savingRevenueEntry, setSavingRevenueEntry] = useState(false);
  const [activeGrossProfitEntry, setActiveGrossProfitEntry] = useState(false);
  const [grossProfitDraft, setGrossProfitDraft] = useState({ month: "", planned: "", realized: "", previousYear: "", margin: "" });
  const [savingGrossProfitEntry, setSavingGrossProfitEntry] = useState(false);
  const [activeChannelRevenueEntry, setActiveChannelRevenueEntry] = useState(false);
  const [channelRevenueDraft, setChannelRevenueDraft] = useState({ month: "", oficinaProdutiva: "", acessorios: "", embelezamento: "", funilaria: "", balcao: "" });
  const [savingChannelRevenueEntry, setSavingChannelRevenueEntry] = useState(false);
  const [activeServiceProductivityEntry, setActiveServiceProductivityEntry] = useState(false);
  const [serviceProductivityDraft, setServiceProductivityDraft] = useState({ month: "", revisions: "", revisionSales: "", mechanicsSales: "", additionalSales: "", beautySales: "" });
  const [savingServiceProductivityEntry, setSavingServiceProductivityEntry] = useState(false);
  const [activeMonthlyPlan, setActiveMonthlyPlan] = useState(false);
  const [monthlyPlanDraft, setMonthlyPlanDraft] = useState<{ month: string; shopGoal: string; beautyGoal: string; status: "partial" | "closed"; operationalDays: FarolOperationalDay[] }>({ month: "", shopGoal: "", beautyGoal: "", status: "partial", operationalDays: [] });
  const [savingMonthlyPlan, setSavingMonthlyPlan] = useState(false);
  const [dailyResultCollapsed, setDailyResultCollapsed] = useState(false);
  const [balcaoRefreshToken, setBalcaoRefreshToken] = useState(0);
  const [refreshingBalcao, setRefreshingBalcao] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfSelectorOpen, setPdfSelectorOpen] = useState(false);
  const [selectedPdfReports, setSelectedPdfReports] = useState<FarolPdfReportKey[]>(() => farolPdfReports.map((report) => report.key));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadVehicles() {
      setLoading(true);
      setError("");

      try {
        const data = await listVehicleFlowsForMonth(selectedMonth);
        if (!active) return;
        setVehicles(data);
      } catch (currentError) {
        if (!active) return;
        setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar o Farol Gerencial.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadVehicles();
    return () => {
      active = false;
    };
  }, [selectedMonth]);

  useEffect(() => subscribeFarolObservationsForMonth(selectedMonth, (items: FarolObservation[]) => {
    setObservations(Object.fromEntries(items.map((item) => [item.indicatorKey, item.text])));
    setObservationValues(Object.fromEntries(items.map((item) => [item.indicatorKey, item.value ?? ""])));
  }, (currentError) => setError(currentError.message)), [selectedMonth]);

  useEffect(() => subscribePartsCounterEntriesForMonth(selectedMonth, (items) => {
    setPartsEntries(items);
    setRefreshingBalcao(false);
  }, (currentError) => {
    setRefreshingBalcao(false);
    setError(currentError.message);
  }), [balcaoRefreshToken, selectedMonth]);
  useEffect(() => subscribePartsSalesGoals(setPartsGoals, (currentError) => setError(currentError.message)), [balcaoRefreshToken]);
  useEffect(() => subscribeFarolDailyResultsForMonth(selectedMonth, setDailyResults, (currentError) => setError(currentError.message)), [selectedMonth]);
  useEffect(() => subscribeFarolRevenue(setRevenueEntries, (currentError) => setError(currentError.message)), []);
  useEffect(() => subscribeFarolGrossProfit(setGrossProfitEntries, (currentError) => setError(currentError.message)), []);
  useEffect(() => subscribeFarolChannelRevenue(setChannelRevenueEntries, (currentError) => setError(currentError.message)), []);
  useEffect(() => subscribeFarolServiceProductivity(setServiceProductivityEntries, (currentError) => setError(currentError.message)), []);
  useEffect(() => subscribeFarolMonthlyPlans(setMonthlyPlans, (currentError) => setError(currentError.message)), []);

  const selectedMonthlyPlan = monthlyPlans.find((item) => item.month === selectedMonth);
  const shopMonthlyGoal = selectedMonthlyPlan?.shopGoal ?? 160000;
  const beautyMonthlyGoal = selectedMonthlyPlan?.beautyGoal ?? 35000;
  const operationalDays = selectedMonthlyPlan?.operationalDays ?? [];
  const monthSummary = useMemo(() => buildMonthSummary(selectedMonth, new Date(), operationalDays), [operationalDays, selectedMonth]);
  const financialRows = useMemo(() => buildFinancialRows(selectedMonth, shopMonthlyGoal, beautyMonthlyGoal, new Date(), dailyResults, operationalDays), [beautyMonthlyGoal, dailyResults, operationalDays, selectedMonth, shopMonthlyGoal]);
  const dailyRowsByHalf = useMemo(() => [financialRows.slice(0, 13), financialRows.slice(13)], [financialRows]);
  const shop = useMemo(() => areaSummary(shopMonthlyGoal, sumRows(financialRows, "shopDone"), monthSummary.passedDays, monthSummary.businessDays), [financialRows, monthSummary, shopMonthlyGoal]);
  const beauty = useMemo(() => areaSummary(beautyMonthlyGoal, sumRows(financialRows, "beautyDone"), monthSummary.passedDays, monthSummary.businessDays), [beautyMonthlyGoal, financialRows, monthSummary]);
  const productivityMetrics = useMemo<ProductivityMetric[]>(() => {
    const entries = dailyResults.filter((item) => item.month === selectedMonth);
    const manualEntry = serviceProductivityEntries.find((item) => item.month === selectedMonth);
    const snapshot = manualEntry ?? serviceReportSnapshots[selectedMonth];
    const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
    const previousManualEntry = serviceProductivityEntries.find((item) => item.month === `${selectedYear - 1}-${String(selectedMonthNumber).padStart(2, "0")}`);
    const previousSnapshot = previousManualEntry ?? serviceReportSnapshots[`${selectedYear - 1}-${String(selectedMonthNumber).padStart(2, "0")}`];
    const useDailyResults = !manualEntry && entries.length > 0;
    const previousProductiveShop = previousSnapshot ? ("productiveShop" in previousSnapshot ? previousSnapshot.productiveShop : previousSnapshot.revisionSales + previousSnapshot.mechanicsSales + previousSnapshot.additionalSales) : 0;
    const previousTotalServices = previousSnapshot ? ("totalServices" in previousSnapshot ? previousSnapshot.totalServices : previousProductiveShop + previousSnapshot.beautySales) : 0;
    const previousTkmBeauty = previousSnapshot ? ("tkmBeauty" in previousSnapshot ? previousSnapshot.tkmBeauty ?? (previousSnapshot.revisions ? previousSnapshot.beautySales / previousSnapshot.revisions : 0) : (previousSnapshot.revisions ? previousSnapshot.beautySales / previousSnapshot.revisions : 0)) : 0;
    const previousTkmAdditional = previousSnapshot ? ("tkmAdditional" in previousSnapshot ? previousSnapshot.tkmAdditional ?? (previousSnapshot.revisions ? previousSnapshot.additionalSales / previousSnapshot.revisions : 0) : (previousSnapshot.revisions ? previousSnapshot.additionalSales / previousSnapshot.revisions : 0)) : 0;
    const previousTkmServices = previousSnapshot ? ("tkmServices" in previousSnapshot ? previousSnapshot.tkmServices ?? (previousSnapshot.revisions ? previousTotalServices / previousSnapshot.revisions : 0) : (previousSnapshot.revisions ? previousTotalServices / previousSnapshot.revisions : 0)) : 0;
    if (!useDailyResults && !snapshot) return [
      { label: "Vendas de revisão", current: 0, lastYear: previousSnapshot?.revisionSales ?? 0, type: "currency", note: "Valor da categoria Revisão." },
      { label: "Revisões", current: 0, lastYear: previousSnapshot?.revisions ?? 0, type: "number", note: "Quantidade lida da categoria Revisão." },
      { label: "Embelezamento", current: 0, lastYear: previousSnapshot?.beautySales ?? 0, type: "currency", note: "Vendas de embelezamento." },
      { label: "TKM embelezamento", current: 0, lastYear: previousTkmBeauty, type: "currency", note: "Embelezamento dividido por revisões." },
      { label: "Serviços adicionais", current: 0, lastYear: previousSnapshot?.additionalSales ?? 0, type: "currency", note: "Vendas de alinhamento e balanceamento." },
      { label: "TKM serv. adicionais", current: 0, lastYear: previousTkmAdditional, type: "currency", note: "Alinhamento e balanceamento divididos por revisões." },
      { label: "Oficina produtiva", current: 0, lastYear: previousProductiveShop, type: "currency", note: "Revisão, mecânica e serviços adicionais." },
      { label: "Fat. total serviços", current: 0, lastYear: previousTotalServices, type: "currency", note: "Faturamento total de serviços." },
      { label: "TKM serviços", current: 0, lastYear: previousTkmServices, type: "currency", note: "TKM geral de serviços." },
    ];

    const revisions = useDailyResults ? entries.reduce((total, item) => total + item.revisionCount, 0) : snapshot!.revisions;
    const revisionSales = useDailyResults ? entries.reduce((total, item) => total + item.revision, 0) : snapshot!.revisionSales;
    const mechanicsSales = useDailyResults ? entries.reduce((total, item) => total + item.generalMechanics, 0) : snapshot!.mechanicsSales;
    const additionalSales = useDailyResults ? entries.reduce((total, item) => total + item.alignmentBalancing, 0) : snapshot!.additionalSales;
    const beautySales = useDailyResults ? entries.reduce((total, item) => total + item.beauty, 0) : snapshot!.beautySales;
    const productiveShop = manualEntry || useDailyResults ? revisionSales + mechanicsSales + additionalSales : ("productiveShop" in snapshot! ? snapshot!.productiveShop : revisionSales + mechanicsSales + additionalSales);
    const totalServices = manualEntry || useDailyResults ? productiveShop + beautySales : ("totalServices" in snapshot! ? snapshot!.totalServices : productiveShop + beautySales);
    const perRevision = (value: number) => revisions ? value / revisions : 0;
    const legacySnapshot = snapshot && "tkmServices" in snapshot ? snapshot : undefined;
    const tkmServices = manualEntry || useDailyResults ? perRevision(totalServices) : legacySnapshot?.tkmServices ?? perRevision(totalServices);
    const tkmAdditional = manualEntry || useDailyResults ? perRevision(additionalSales) : legacySnapshot?.tkmAdditional ?? perRevision(additionalSales);
    const tkmBeauty = manualEntry || useDailyResults ? perRevision(beautySales) : legacySnapshot?.tkmBeauty ?? perRevision(beautySales);
    return [
      { label: "Vendas de revisão", current: revisionSales, lastYear: previousSnapshot?.revisionSales ?? 0, type: "currency", note: "Valor da categoria Revisão." },
      { label: "Revisões", current: revisions, lastYear: previousSnapshot?.revisions ?? 0, type: "number", note: "Quantidade lida da categoria Revisão." },
      { label: "Serviços adicionais", current: additionalSales, lastYear: previousSnapshot?.additionalSales ?? 0, type: "currency", note: "Vendas de alinhamento e balanceamento." },
      { label: "TKM serv. adicionais", current: tkmAdditional, lastYear: previousTkmAdditional, type: "currency", note: "Alinhamento e balanceamento divididos por revisões." },
      { label: "Embelezamento", current: beautySales, lastYear: previousSnapshot?.beautySales ?? 0, type: "currency", note: "Vendas de embelezamento." },
      { label: "TKM embelezamento", current: tkmBeauty, lastYear: previousTkmBeauty, type: "currency", note: "Embelezamento dividido por revisões." },
      { label: "Oficina produtiva", current: productiveShop, lastYear: previousProductiveShop, type: "currency", note: "Revisão, mecânica e serviços adicionais." },
      { label: "Fat. total serviços", current: totalServices, lastYear: previousTotalServices, type: "currency", note: "Faturamento total de serviços." },
      { label: "TKM serviços", current: tkmServices, lastYear: previousTkmServices, type: "currency", note: "TKM geral de serviços." },
    ];
  }, [dailyResults, selectedMonth, serviceProductivityEntries]);

  const operation = useMemo(() => {
    const periodVehicles = vehicles.filter((vehicle) => belongsToMonth(vehicle, selectedMonth));
    const appointments = periodVehicles.filter((vehicle) => vehicle.origin === "agendado" && monthFromDate(vehicle.appointmentDate) === selectedMonth);
    const delivered = vehicles.filter((vehicle) => monthFromDate(vehicle.deliveredAt) === selectedMonth);
    const onTime = delivered.filter((vehicle) => vehicle.deliveredOnTime).length;
    const typeCount = (type: "revision" | "repair" | "diagnosis") => appointments.filter((vehicle) => serviceTypeForFlow(vehicle) === type).length;
    const budgetVehicles = periodVehicles.filter((vehicle) => vehicle.budgetStatus);
    const approvedBudgets = budgetVehicles.filter((vehicle) => vehicle.budgetAuthorized).length;
    const referenceDate = new Date();
    const realNoShows = appointments.filter((vehicle) => isRealNoShow(vehicle, referenceDate)).length;
    const percentage = (value: number, base: number) => base ? formatPercent((value / base) * 100) : "0%";

    return [
      { label: "Agendamentos", value: appointments.length },
      { label: "% revisão", value: percentage(typeCount("revision"), appointments.length) },
      { label: "% reparo", value: percentage(typeCount("repair"), appointments.length) },
      { label: "% diagnósticos", value: percentage(typeCount("diagnosis"), appointments.length) },
      { label: "Passagens", value: delivered.length },
      { label: "% no prazo", value: percentage(onTime, delivered.length) },
      { label: "No-show real", value: realNoShows },
      { label: "Orçamento complementar", value: budgetVehicles.length },
      { label: "Orçamentos aprovados", value: percentage(approvedBudgets, budgetVehicles.length) },
    ];
  }, [selectedMonth, vehicles]);

  const consultantProductivity = useMemo(() => buildProductivity(vehicles, selectedMonth, "consultantName"), [selectedMonth, vehicles]);
  const mechanicProductivity = useMemo(() => buildProductivity(vehicles, selectedMonth, "technicianName"), [selectedMonth, vehicles]);

  const balcaoSummary = useMemo<BalcaoSummary>(() => {
    const monthEntries = partsEntries.filter((entry) => partsEntryMonth(entry) === selectedMonth);
    const sales = monthEntries.filter((entry) => entry.entryType === "venda");
    const lost = monthEntries.filter((entry) => entry.entryType === "venda_perdida");
    const orders = partsEntries.filter((entry) => entry.entryType === "pedido");
    const detailedSold = sales.reduce((total, entry) => total + partsEntryTotal(entry), 0);
    const sold = historicalSalesResults[selectedMonth] ?? detailedSold;
    const goalRecord = partsGoals.find((item) => item.month === selectedMonth);
    const goal = goalRecord?.targetAmount ?? 0;
    const businessDays = goalRecord?.businessDays ?? monthSummary.businessDays;
    const passedBusinessDays = Math.min(monthSummary.passedDays, businessDays);
    const remainingBusinessDays = Math.max(0, businessDays - passedBusinessDays);
    const dailyGoal = businessDays ? goal / businessDays : 0;
    const salesDailyAverage = passedBusinessDays ? sold / passedBusinessDays : 0;
    const projectedOrders = orders.reduce((total, entry) => total + projectedOrderTotal(entry, selectedMonth), 0);
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const customerTotal = (customerType: "PF" | "PJ") => sales.filter((entry) => entry.customerType === customerType).reduce((total, entry) => total + partsEntryTotal(entry), 0);
    const destinationMap = new Map<string, { state: string; total: number; pf: number; pj: number }>();
    sales.forEach((entry) => {
      const state = entry.destinationState?.trim().toUpperCase();
      if (!state) return;
      const entryValue = partsEntryTotal(entry);
      const current = destinationMap.get(state) ?? { state, total: 0, pf: 0, pj: 0 };
      current.total += entryValue;
      current[entry.customerType.toLowerCase() as "pf" | "pj"] += entryValue;
      destinationMap.set(state, current);
    });

    return {
      sold,
      lost: lost.reduce((total, entry) => total + partsEntryTotal(entry), 0),
      expectation: sold + salesDailyAverage * remainingBusinessDays + projectedOrders,
      projectedOrders,
      salesDailyAverage,
      goal,
      dailyGoal,
      todaySales: sales.filter((entry) => partsEntryDateKey(entry) === todayKey).reduce((total, entry) => total + partsEntryTotal(entry), 0),
      pf: customerTotal("PF"),
      pj: customerTotal("PJ"),
      destinations: [...destinationMap.values()].sort((left, right) => right.total - left.total).slice(0, 3),
    };
  }, [monthSummary.businessDays, monthSummary.passedDays, partsEntries, partsGoals, selectedMonth]);

  function refreshBalcaoReport() {
    setRefreshingBalcao(true);
    setError("");
    setBalcaoRefreshToken((current) => current + 1);
  }

  const monthProgress = monthSummary.businessDays ? (monthSummary.passedDays / monthSummary.businessDays) * 100 : 0;
  const configuredStatus: FarolDataStatus = !selectedMonthlyPlan ? "Sem base" : selectedMonthlyPlan.status === "closed" ? "Fechado" : "Parcial";
  const dailyStatus: FarolDataStatus = !dailyResults.length && selectedMonth !== "2026-07" ? "Sem base" : selectedMonthlyPlan?.status === "closed" ? "Fechado" : "Parcial";
  const operationStatus: FarolDataStatus = !vehicles.length ? "Sem base" : selectedMonthlyPlan?.status === "closed" ? "Fechado" : selectedMonth < monthKey(new Date()) ? "Sem fechamento" : "Parcial";
  const reportStatus = (hasData: boolean): FarolDataStatus => !hasData ? "Sem base" : selectedMonthlyPlan?.status === "closed" ? "Fechado" : selectedMonth < monthKey(new Date()) ? "Sem fechamento" : "Parcial";
  const grossProfitMonths = useMemo(() => {
    const entryByMonth = new Map(grossProfitEntries.map((item) => [item.month, item]));
    const months = grossProfitTrend.map((item) => {
      const entry = entryByMonth.get(item.month);
      return entry ? { ...item, planned: entry.planned, realized: entry.realized, previousYear: entry.previousYear, margin: normalizePercentValue(entry.margin) } : item;
    });
    grossProfitEntries.filter((entry) => !months.some((item) => item.month === entry.month)).forEach((entry) => {
      months.push({ month: entry.month, label: monthNames[Number(entry.month.slice(5)) - 1].slice(0, 3), planned: entry.planned, realized: entry.realized, previousYear: entry.previousYear, margin: normalizePercentValue(entry.margin) });
    });
    return months.sort((a, b) => a.month.localeCompare(b.month));
  }, [grossProfitEntries]);
  const currentGrossProfit = grossProfitMonths.find((item) => item.month === selectedMonth) ?? { month: selectedMonth, label: monthNames[Number(selectedMonth.slice(5)) - 1].slice(0, 3), planned: 0, realized: 0, previousYear: 0, margin: 0 };
  const channelRevenueByMonth = useMemo(() => {
    const entries = new Map<string, Omit<FarolChannelRevenue, "id" | "updatedBy" | "updatedAt">>(Object.entries(channelRevenueBaseline));
    channelRevenueEntries.forEach((item) => entries.set(item.month, item));
    return entries;
  }, [channelRevenueEntries]);
  const currentChannelRevenue = channelRevenueByMonth.get(selectedMonth) ?? { month: selectedMonth, oficinaProdutiva: 0, acessorios: 0, embelezamento: 0, funilaria: 0, balcao: 0 };
  const channelRows = channelDefinitions
    .map((item) => ({ ...item, total: currentChannelRevenue[item.key] }))
    .sort((left, right) => right.total - left.total || left.channel.localeCompare(right.channel, "pt-BR"));
  const previousYearChannelRevenue = channelRevenueByMonth.get(`${Number(selectedMonth.slice(0, 4)) - 1}-${selectedMonth.slice(5)}`);
  const previousThreeChannelRevenue = [-1, -2, -3].map((offset) => {
    const [year, month] = selectedMonth.split("-").map(Number);
    return channelRevenueByMonth.get(monthKey(new Date(year, month - 1 + offset, 1)));
  }).filter((item): item is Omit<FarolChannelRevenue, "id" | "updatedBy" | "updatedAt"> => Boolean(item));
  const channelAverages = channelDefinitions.map((item) => ({ ...item, total: previousThreeChannelRevenue.length ? previousThreeChannelRevenue.reduce((sum, entry) => sum + entry[item.key], 0) / previousThreeChannelRevenue.length : 0 }));
  const selectedChannelUpdate = channelRevenueEntries.find((item) => item.month === selectedMonth)?.updatedAt;

  const observationItems = [
    { key: "shop", label: "Oficina Produtiva" },
    { key: "beauty", label: "Embelezamento Oficina" },
    ...operation.map((item) => ({ key: item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: item.label })),
  ];

  function canEditReport() {
    if (canManageReports) return true;
    setError("Somente Administradores podem incluir ou alterar relatórios no Farol.");
    return false;
  }

  async function saveObservation(key: string, label: string) {
    if (!canEditReport()) return;
    setSavingObservation(key);
    try {
      await saveFarolObservation({ month: selectedMonth, indicatorKey: key, indicatorLabel: label, text: observationCommentDraft, value: observationValueDraft, updatedBy: profile?.name });
      setObservations((current) => ({ ...current, [key]: observationCommentDraft }));
      setObservationValues((current) => ({ ...current, [key]: observationValueDraft }));
      setActiveObservation(null);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar a observação.");
    } finally {
      setSavingObservation("");
    }
  }

  function openObservation(key: string, label: string) {
    if (!canEditReport()) return;
    setActiveObservation({ key, label });
    setObservationValueDraft(observationValues[key] ?? "");
    setObservationCommentDraft(observations[key] ?? "");
  }

  function openMonthlyPlanEditor() {
    if (!canEditReport()) return;
    const existing = monthlyPlans.find((item) => item.month === selectedMonth);
    setMonthlyPlanDraft({
      month: selectedMonth,
      shopGoal: String(existing?.shopGoal ?? shopMonthlyGoal),
      beautyGoal: String(existing?.beautyGoal ?? beautyMonthlyGoal),
      status: existing?.status ?? "partial",
      operationalDays: existing?.operationalDays ?? [],
    });
    setActiveMonthlyPlan(true);
  }

  function addOperationalDay() {
    const [year, month] = monthlyPlanDraft.month.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const usedDates = new Set(monthlyPlanDraft.operationalDays.map((item) => item.date));
    const availableDay = Array.from({ length: daysInMonth }, (_, index) => index + 1)
      .find((day) => !usedDates.has(`${monthlyPlanDraft.month}-${String(day).padStart(2, "0")}`));
    if (!availableDay) return;
    setMonthlyPlanDraft((current) => ({
      ...current,
      operationalDays: [...current.operationalDays, { date: `${current.month}-${String(availableDay).padStart(2, "0")}`, type: "holiday", label: "" }],
    }));
  }

  function updateOperationalDay(index: number, patch: Partial<FarolOperationalDay>) {
    setMonthlyPlanDraft((current) => ({
      ...current,
      operationalDays: current.operationalDays.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  async function saveMonthlyPlan() {
    if (!canEditReport() || !monthlyPlanDraft.month) return;
    setSavingMonthlyPlan(true);
    try {
      await saveFarolMonthlyPlan({
        month: monthlyPlanDraft.month,
        shopGoal: parseCurrencyInput(monthlyPlanDraft.shopGoal),
        beautyGoal: parseCurrencyInput(monthlyPlanDraft.beautyGoal),
        status: monthlyPlanDraft.status,
        operationalDays: monthlyPlanDraft.operationalDays,
        updatedBy: profile?.name,
      });
      setSelectedMonth(monthlyPlanDraft.month);
      setActiveMonthlyPlan(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar as metas e o calendário.");
    } finally {
      setSavingMonthlyPlan(false);
    }
  }

  function openDailyResult() {
    if (!canEditReport()) return;
    const today = new Date();
    const selectedIsCurrent = selectedMonth === monthKey(today);
    const firstBusinessDay = financialRows[0] ? Number(financialRows[0].day.slice(0, 2)) : 1;
    const day = selectedIsCurrent ? Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()) : firstBusinessDay;
    const existing = dailyResults.find((item) => item.month === selectedMonth && item.day === day);
    setDailyResultDraft({ day, revision: existing ? String(existing.revision) : "", revisionCount: existing ? String(existing.revisionCount) : "", generalMechanics: existing ? String(existing.generalMechanics) : "", alignmentBalancing: existing ? String(existing.alignmentBalancing) : "", beauty: existing ? String(existing.beauty) : "" });
    setActiveDailyResult(true);
  }

  async function saveDailyResult() {
    if (!canEditReport()) return;
    setSavingDailyResult(true);
    try {
      await saveFarolDailyResult({
        month: selectedMonth,
        day: Number(dailyResultDraft.day),
        revision: Number(dailyResultDraft.revision.replace(",", ".")),
        revisionCount: Number(dailyResultDraft.revisionCount),
        generalMechanics: Number(dailyResultDraft.generalMechanics.replace(",", ".")),
        alignmentBalancing: Number(dailyResultDraft.alignmentBalancing.replace(",", ".")),
        beauty: Number(dailyResultDraft.beauty.replace(",", ".")),
        updatedBy: profile?.name,
      });
      setActiveDailyResult(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o resultado diário.");
    } finally {
      setSavingDailyResult(false);
    }
  }

  function openRevenueEntry() {
    if (!canEditReport()) return;
    const existing = revenueEntries.find((item) => item.month === selectedMonth) ?? monthlyTrend.find((item) => item.month === selectedMonth);
    setRevenueDraft({ month: selectedMonth, parts: existing ? String(existing.parts) : "", services: existing ? String(existing.services) : "" });
    setActiveRevenueEntry(true);
  }

  async function saveRevenueEntry() {
    if (!canEditReport()) return;
    setSavingRevenueEntry(true);
    try {
      await saveFarolRevenue({
        month: revenueDraft.month,
        parts: parseCurrencyInput(revenueDraft.parts),
        services: parseCurrencyInput(revenueDraft.services),
        updatedBy: profile?.name,
      });
      setActiveRevenueEntry(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o faturamento.");
    } finally {
      setSavingRevenueEntry(false);
    }
  }

  function openGrossProfitEntry() {
    if (!canEditReport()) return;
    const existing = grossProfitEntries.find((item) => item.month === selectedMonth) ?? grossProfitTrend.find((item) => item.month === selectedMonth);
    setGrossProfitDraft({
      month: selectedMonth,
      planned: existing ? String(existing.planned) : "",
      realized: existing ? String(existing.realized) : "",
      previousYear: existing ? String(existing.previousYear) : "",
      margin: existing ? String(existing.margin) : "",
    });
    setActiveGrossProfitEntry(true);
  }

  async function saveGrossProfitEntry() {
    if (!canEditReport()) return;
    setSavingGrossProfitEntry(true);
    try {
      await saveFarolGrossProfit({
        month: grossProfitDraft.month,
        planned: parseCurrencyInput(grossProfitDraft.planned),
        realized: parseCurrencyInput(grossProfitDraft.realized),
        previousYear: parseCurrencyInput(grossProfitDraft.previousYear),
        margin: parsePercentInput(grossProfitDraft.margin),
        updatedBy: profile?.name,
      });
      setActiveGrossProfitEntry(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o lucro bruto.");
    } finally {
      setSavingGrossProfitEntry(false);
    }
  }

  function openChannelRevenueEntry() {
    if (!canEditReport()) return;
    const existing = channelRevenueByMonth.get(selectedMonth);
    setChannelRevenueDraft({
      month: selectedMonth,
      oficinaProdutiva: existing ? String(existing.oficinaProdutiva) : "",
      acessorios: existing ? String(existing.acessorios) : "",
      embelezamento: existing ? String(existing.embelezamento) : "",
      funilaria: existing ? String(existing.funilaria) : "",
      balcao: existing ? String(existing.balcao) : "",
    });
    setActiveChannelRevenueEntry(true);
  }

  async function saveChannelRevenueEntry() {
    if (!canEditReport()) return;
    setSavingChannelRevenueEntry(true);
    try {
      await saveFarolChannelRevenue({
        month: channelRevenueDraft.month,
        oficinaProdutiva: parseCurrencyInput(channelRevenueDraft.oficinaProdutiva),
        acessorios: parseCurrencyInput(channelRevenueDraft.acessorios),
        embelezamento: parseCurrencyInput(channelRevenueDraft.embelezamento),
        funilaria: parseCurrencyInput(channelRevenueDraft.funilaria),
        balcao: parseCurrencyInput(channelRevenueDraft.balcao),
        updatedBy: profile?.name,
      });
      setActiveChannelRevenueEntry(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o faturamento por canal.");
    } finally {
      setSavingChannelRevenueEntry(false);
    }
  }

  function openServiceProductivityEntry() {
    if (!canEditReport()) return;
    const existing = serviceProductivityEntries.find((item) => item.month === selectedMonth) ?? serviceReportSnapshots[selectedMonth];
    setServiceProductivityDraft({
      month: selectedMonth,
      revisions: existing ? String(existing.revisions) : "",
      revisionSales: existing ? String(existing.revisionSales) : "",
      mechanicsSales: existing ? String(existing.mechanicsSales) : "",
      additionalSales: existing ? String(existing.additionalSales) : "",
      beautySales: existing ? String(existing.beautySales) : "",
    });
    setActiveServiceProductivityEntry(true);
  }

  async function saveServiceProductivityEntry() {
    if (!canEditReport()) return;
    setSavingServiceProductivityEntry(true);
    try {
      await saveFarolServiceProductivity({
        month: serviceProductivityDraft.month,
        revisions: Number(serviceProductivityDraft.revisions),
        revisionSales: parseCurrencyInput(serviceProductivityDraft.revisionSales),
        mechanicsSales: parseCurrencyInput(serviceProductivityDraft.mechanicsSales),
        additionalSales: parseCurrencyInput(serviceProductivityDraft.additionalSales),
        beautySales: parseCurrencyInput(serviceProductivityDraft.beautySales),
        updatedBy: profile?.name,
      });
      setActiveServiceProductivityEntry(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar a produtividade e o TKM.");
    } finally {
      setSavingServiceProductivityEntry(false);
    }
  }

  async function generatePdf() {
    if (!selectedPdfReports.length) return;
    setPdfLoading(true);
    try {
      if (selectedPdfReports.includes("daily") && dailyResultCollapsed) {
        setDailyResultCollapsed(false);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      const root = farolPrintRef.current;
      const reports = farolPdfReports
        .filter((report) => selectedPdfReports.includes(report.key))
        .map((report) => ({
          ...report,
          element: root?.querySelector<HTMLElement>(`[data-farol-pdf-report="${report.key}"]`) ?? null,
        }));
      await downloadFarolPdf({
        monthLabel: monthLabel(selectedMonth),
        reports,
      });
      setPdfSelectorOpen(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível gerar o PDF do Farol.");
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <ProtectedPage
      title="Farol Gerencial"
      subtitle="Acompanhamento diário de metas, realizado, projeção e operação."
    >
      <main ref={farolPrintRef} className="page-wrap farol-page">
        {error && <div className="duplicate-alert"><strong>Erro no farol gerencial</strong><span>{error}</span></div>}

        <section className="farol-period-bar">
          <div className="farol-month-selector"><label htmlFor="farol-month">Mês de referência</label><input id="farol-month" type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></div>
          <div><span>Hoje</span><strong>{monthSummary.today}</strong></div>
          <div><span>Dias úteis</span><strong>{formatDayCount(monthSummary.businessDays)}</strong></div>
          <div><span>Passados</span><strong>{formatDayCount(monthSummary.passedDays)}</strong></div>
          <div><span>Restantes</span><strong>{formatDayCount(monthSummary.remainingDays)}</strong></div>
          <div><span>Avanço do mês</span><strong>{formatPercent(monthProgress)}</strong></div>
          {canManageReports && <button data-html2canvas-ignore="true" data-pdf-hide="true" className="farol-plan-button" type="button" onClick={openMonthlyPlanEditor} aria-label="Configurar metas e calendário" title="Configurar metas e calendário operacional">⚙</button>}
          <button data-html2canvas-ignore="true" className="farol-pdf-button" type="button" onClick={() => setPdfSelectorOpen(true)} disabled={pdfLoading} aria-label={pdfLoading ? "Gerando relatório PDF" : "Gerar relatório PDF"} title={pdfLoading ? "Gerando PDF..." : "Gerar relatório PDF"}>
            <svg viewBox="0 0 32 36" aria-hidden="true"><path d="M6 2h13l7 7v25H6z" /><path d="M19 2v8h7" /><text x="16" y="27" textAnchor="middle">PDF</text></svg>
          </button>
        </section>

        <section className="farol-main-grid" data-farol-pdf-report="goals">
          <GoalCard title="M.O Oficina Produtiva" tone="shop" summary={shop} dailyGoal={monthSummary.businessDays ? shopMonthlyGoal / monthSummary.businessDays : 0} status={configuredStatus} onConfigure={openMonthlyPlanEditor} />
          <GoalCard title="Embelezamento Oficina" tone="beauty" summary={beauty} dailyGoal={monthSummary.businessDays ? beautyMonthlyGoal / monthSummary.businessDays : 0} status={configuredStatus} onConfigure={openMonthlyPlanEditor} />
          <aside className="farol-operation-panel">
            <div className="panel-head farol-report-head tone-operation">
              <div><div className="farol-report-title-row"><h2 className="panel-title">Operação do período</h2><ReportAddButton onClick={() => openObservation("operation", "Operação do período")} /></div><p className="comment">Dados do fluxo interno.</p></div>
              <DataStatusTag status={loading ? "Parcial" : operationStatus} />
            </div>
            <div className="farol-operation-groups">
              <article className="farol-operation-group">
                <span>Agendamentos / No-show</span>
                <div className="farol-operation-pair">
                  <div><strong>{loading ? "..." : operation.find((item) => item.label === "Agendamentos")?.value}</strong><small>Agendamentos</small></div>
                  <div><strong>{loading ? "..." : operation.find((item) => item.label === "No-show real")?.value}</strong><small>No-show real</small></div>
                </div>
              </article>
              <article className="farol-operation-group farol-operation-passages">
                <span>Passagens</span>
                <div className="farol-operation-pair"><div><strong>{loading ? "..." : operation.find((item) => item.label === "Passagens")?.value}</strong><small>Entregas do mês</small></div><div><strong>{loading ? "..." : operation.find((item) => item.label === "% no prazo")?.value}</strong><small>No prazo</small></div></div>
                <div className="farol-operation-types">
                  <small>Rev. <b>{operation.find((item) => item.label === "% revisão")?.value}</b></small>
                  <small>Reparo <b>{operation.find((item) => item.label === "% reparo")?.value}</b></small>
                  <small>Diag. <b>{operation.find((item) => item.label === "% diagnósticos")?.value}</b></small>
                </div>
              </article>
              <article className="farol-operation-group">
                <span>Orçamento Complementar</span>
                <div className="farol-operation-pair">
                  <div><strong>{loading ? "..." : operation.find((item) => item.label === "Orçamento complementar")?.value}</strong><small>Solicitados</small></div>
                  <div><strong>{loading ? "..." : operation.find((item) => item.label === "Orçamentos aprovados")?.value}</strong><small>Aprovados</small></div>
                </div>
              </article>
            </div>
          </aside>
        </section>

        <section className="panel farol-table-panel farol-daily-panel" data-farol-pdf-report="daily">
          <div className="panel-head farol-report-head tone-month">
            <div className="farol-report-title-row"><h2 className="panel-title">Resultado Diário</h2><ReportAddButton onClick={openDailyResult} /></div>
            <div className="farol-daily-panel-actions"><DataStatusTag status={dailyStatus} /><button data-pdf-hide="true" type="button" className="farol-collapse-button" onClick={() => setDailyResultCollapsed((current) => !current)} aria-expanded={!dailyResultCollapsed}>{dailyResultCollapsed ? "Expandir" : "Recolher"}</button></div>
          </div>
          {!dailyResultCollapsed && <div className="farol-daily-result-layout">
            <DailyResultLineChart rows={financialRows} />
            <div className="farol-daily-two-rows">
              {dailyRowsByHalf.map((dailyRow, rowIndex) => (
                <div className="farol-daily-row" key={`${selectedMonth}-row-${rowIndex}`}>
                  {dailyRow.map((row) => (
                    <article key={row.day} className={`farol-day-card ${row.special ? `row-${row.special}` : ""}`}>
                      <div className="farol-day-head"><strong>{row.day}</strong><i aria-hidden="true">|</i><span>{row.weekDay}</span>{row.operationalLabel ? <><i aria-hidden="true">|</i><b title={row.operationalLabel}>{row.operationalLabel}</b></> : row.revisionCount !== null && row.revisionCount !== undefined && <><i aria-hidden="true">|</i><b>REV {row.revisionCount}</b></>}</div>
                      <div className="farol-day-lines">
                        <div><span>OP</span><strong className={row.shopDone !== null && row.shopDone >= row.shopGoal ? "good-text" : row.shopDone === null ? "" : "bad-text"}>{formatCurrency(row.shopDone)}</strong><em>M {formatCurrency(row.shopGoal)}</em><small>AA {formatCurrency(row.shopPreviousYear ?? null)}</small></div>
                        <div><span>EMB</span><strong className={row.beautyDone !== null && row.beautyDone >= row.beautyGoal ? "good-text" : row.beautyDone === null ? "" : "bad-text"}>{formatCurrency(row.beautyDone)}</strong><em>M {formatCurrency(row.beautyGoal)}</em><small>AA {formatCurrency(row.beautyPreviousYear ?? null)}</small></div>
                      </div>
                    </article>
                  ))}
                </div>
              ))}
            </div>
          </div>}
        </section>

        <section className="panel farol-table-panel" data-farol-pdf-report="counter">
          <div className="panel-head farol-report-head tone-counter">
            <div><div className="farol-report-title-row"><h2 className="panel-title">Balcão de Peças</h2><button data-html2canvas-ignore="true" data-pdf-hide="true" type="button" className={`farol-report-add farol-report-refresh ${refreshingBalcao ? "is-loading" : ""}`} onClick={refreshBalcaoReport} disabled={refreshingBalcao} aria-label="Atualizar dados do Balcão de Peças" title="Buscar os lançamentos mais recentes da página Balcão">↻</button></div><p className="comment">Indicadores espelhados do módulo Balcão para {monthLabel(selectedMonth)}.</p></div>
            {refreshingBalcao ? <span className="tag">atualizando...</span> : <DataStatusTag status={reportStatus(Boolean(balcaoSummary.goal || balcaoSummary.sold || partsEntries.length))} />}
          </div>
          <div className="farol-balcao-grid">
            <article><span>Meta</span><strong>{formatCurrency(balcaoSummary.goal)}</strong><small>{balcaoSummary.goal ? `${formatPercent((balcaoSummary.sold / balcaoSummary.goal) * 100)} atingido · ${formatCurrency(balcaoSummary.dailyGoal)}/dia` : "Sem meta cadastrada"}</small></article>
            <article><span>Vendas realizadas</span><strong>{formatCurrency(balcaoSummary.sold)}</strong><small>Hoje: {formatCurrency(balcaoSummary.todaySales)}</small></article>
            <article><span>Vendas perdidas</span><strong className="bad-text">{formatCurrency(balcaoSummary.lost)}</strong></article>
            <article><span>Projeção de vendas</span><strong>{formatCurrency(balcaoSummary.expectation)}</strong><small>Média de {formatCurrency(balcaoSummary.salesDailyAverage)}/dia + {formatCurrency(balcaoSummary.projectedOrders)} em pedidos previstos</small></article>
            <article className="farol-balcao-profile-card">
              <span>Perfil PF e PJ</span>
              <div className="farol-balcao-profile-values"><div><b>PF</b><strong>{formatCurrency(balcaoSummary.pf)}</strong></div><div><b>PJ</b><strong>{formatCurrency(balcaoSummary.pj)}</strong></div></div>
              <div className="farol-balcao-profile-bar"><i style={{ width: `${balcaoSummary.pf + balcaoSummary.pj ? (balcaoSummary.pf / (balcaoSummary.pf + balcaoSummary.pj)) * 100 : 0}%` }} /></div>
            </article>
            <article className="farol-balcao-destinations-card">
              <span>Destinos das vendas</span>
              <div className="farol-balcao-destination-list">
                {balcaoSummary.destinations.map((destination) => <div key={destination.state}><b>{destination.state}</b><small>PF {formatPercent(destination.total ? (destination.pf / destination.total) * 100 : 0)} · PJ {formatPercent(destination.total ? (destination.pj / destination.total) * 100 : 0)}</small><strong>{formatCurrency(destination.total)}</strong></div>)}
                {!balcaoSummary.destinations.length && <small>Sem destinos informados no mês.</small>}
              </div>
            </article>
          </div>
        </section>

        <section className="panel farol-table-panel" data-farol-pdf-report="revenue">
          <div className="panel-head farol-report-head tone-comparison">
            <div className="farol-report-title-row"><h2 className="panel-title">Faturamento</h2><ReportAddButton onClick={openRevenueEntry} /><DataStatusTag status={reportStatus(revenueEntries.some((item) => item.month === selectedMonth) || monthlyTrend.some((item) => item.month === selectedMonth))} /></div>
            <label className="farol-compare-toggle" data-pdf-hide="true"><input type="checkbox" checked={comparePreviousYear} onChange={(event) => setComparePreviousYear(event.target.checked)} /><span>Comparar ano anterior</span></label>
          </div>
          <MonthlyOperationChart selectedMonth={selectedMonth} comparePreviousYear={comparePreviousYear} revenueEntries={revenueEntries} />
        </section>

        <section className="panel farol-table-panel" data-farol-pdf-report="gross-profit">
            <div className="panel-head farol-report-head tone-profit">
              <div className="farol-report-title-row"><h2 className="panel-title">Lucro Bruto</h2><ReportAddButton onClick={openGrossProfitEntry} /><DataStatusTag status={reportStatus(Boolean(currentGrossProfit.realized || currentGrossProfit.planned))} /></div>
              <span className="tag">{monthLabel(selectedMonth)}</span>
            </div>
            <div className="farol-lb-grid">
              <div className="farol-lb-summary-list">
                <article className="farol-lb-summary-row">
                  <div><span>LB realizado</span><strong>{formatCurrency(currentGrossProfit.realized)}</strong><small className="farol-lb-meta-caption">Atingimento da meta <b className={currentGrossProfit.realized >= currentGrossProfit.planned ? "good-text" : "bad-text"}>{formatPercent((currentGrossProfit.realized / currentGrossProfit.planned) * 100)}</b></small></div>
                </article>
                <article className="farol-lb-summary-row">
                  <div><span>Meta LB</span><strong>{formatCurrency(currentGrossProfit.planned)}</strong><small>{Number(selectedMonth.slice(0, 4)) - 1}: {formatCurrency(currentGrossProfit.previousYear)}</small></div>
                </article>
                <article className="farol-lb-summary-row">
                  <div><span>Margem bruta</span><div className="farol-lb-value-row"><strong>LB sobre receita líquida</strong><b className="good-text">{currentGrossProfit.margin.toFixed(1).replace(".", ",")}%</b></div><small>Margem realizada no período</small></div>
                </article>
              </div>
              <GrossProfitChart items={grossProfitMonths.filter((item) => item.month.startsWith(selectedMonth.slice(0, 4)) && item.month <= selectedMonth)} lastUpdated={grossProfitEntries.find((item) => item.month === selectedMonth)?.updatedAt} />
            </div>
        </section>

        <section className="panel farol-table-panel" data-farol-pdf-report="channels">
          <div className="panel-head farol-report-head tone-revenue">
            <div className="farol-report-title-row"><h2 className="panel-title">Faturamento por Canal</h2><ReportAddButton onClick={openChannelRevenueEntry} /><DataStatusTag status={reportStatus(channelRows.some((item) => item.total > 0))} /></div>
            <span className="tag">{monthLabel(selectedMonth)} • {formatDayCount(monthSummary.passedDays)} dias úteis</span>
          </div>
          <ChannelRevenueChart current={channelRows} lastUpdated={selectedChannelUpdate} />
          <div className="farol-channel-grid">
            {channelRows.map((item) => {
              const total = channelRows.reduce((sum, current) => sum + current.total, 0);
              const share = total ? (item.total / total) * 100 : 0;
              const previous = previousYearChannelRevenue?.[item.key];
              const average = channelAverages.find((averageItem) => averageItem.key === item.key)?.total ?? 0;

              return (
                <article key={item.channel} className="farol-channel-card">
                  <div className="farol-channel-head">
                    <strong>{item.channel}</strong>
                    <span>{formatPercent(share)}</span>
                  </div>
                  <div className="farol-channel-bar"><i style={{ width: `${item.total ? Math.max(4, share) : 0}%` }} /></div>
                  <div className="farol-channel-result"><span>Total do canal</span><strong>{formatCurrency(item.total)}</strong></div>
                  <div className="farol-channel-deltas"><small>AA: <b className={previous === undefined ? "" : variation(item.total, previous) >= 0 ? "good-text" : "bad-text"}>{previous === undefined ? "—" : formatDeltaPercent(variation(item.total, previous))}</b></small><small>Média 3M: <b>{previousThreeChannelRevenue.length ? formatCurrency(average) : "—"}</b></small></div>
                </article>
              );
            })}
          </div>
          <div className="farol-channel-footer"><span>Total da loja <strong>{formatCurrency(channelRows.reduce((sum, item) => sum + item.total, 0))}</strong></span><span>Faturamento por dia útil <strong>{formatCurrency(monthSummary.passedDays ? channelRows.reduce((sum, item) => sum + item.total, 0) / monthSummary.passedDays : 0)}</strong></span></div>
        </section>

        <section className="panel farol-table-panel" data-farol-pdf-report="productivity">
          <div className="panel-head farol-report-head tone-productivity">
            <div><div className="farol-report-title-row"><h2 className="panel-title">Produtividade e TKM de Serviços</h2><ReportAddButton onClick={openServiceProductivityEntry} /><DataStatusTag status={reportStatus(productivityMetrics.some((item) => item.current > 0))} /></div><p className="comment">TKM usa revisões como base. Passagens são contabilizadas por O.S. distinta e permanecem separadas por função.</p></div>
            <span className="tag">{monthLabel(selectedMonth)}</span>
          </div>
          <div className="farol-productivity-grid farol-productivity-focus">
            {[
              { title: "Revisões", value: productivityMetrics.find((item) => item.label === "Vendas de revisão")!, support: productivityMetrics.find((item) => item.label === "Revisões")!, supportLabel: "Quant. revisões" },
              { title: "Embelezamento Oficina", value: productivityMetrics.find((item) => item.label === "Embelezamento")!, support: productivityMetrics.find((item) => item.label === "TKM embelezamento")!, supportLabel: "TKM" },
              { title: "Serviços adicionais", value: productivityMetrics.find((item) => item.label === "Serviços adicionais")!, support: productivityMetrics.find((item) => item.label === "TKM serv. adicionais")!, supportLabel: "TKM" },
              { title: "Oficina Produtiva", value: productivityMetrics.find((item) => item.label === "Oficina produtiva")!, support: null, supportLabel: "" },
              { title: "Total de Serviços", value: productivityMetrics.find((item) => item.label === "Fat. total serviços")!, support: productivityMetrics.find((item) => item.label === "TKM serviços")!, supportLabel: "TKM serviços" },
            ].map((item) => (
              <article key={item.title} className="farol-productivity-card farol-productivity-focus-card" title={`${item.value.note}${item.support ? ` ${item.support.note}` : ""}`} aria-label={`${item.title}. ${item.value.note}${item.support ? ` ${item.support.note}` : ""}`}>
                <span>{item.title}</span>
                <div className="farol-productivity-result-row">
                  <strong>{formatCurrency(item.value.current)}</strong>
                  <small>{Number(selectedMonth.slice(0, 4)) - 1}: {formatCurrency(item.value.lastYear)}</small>
                  <b className={variation(item.value.current, item.value.lastYear) >= 0 ? "good-text" : "bad-text"}>{formatDeltaPercent(variation(item.value.current, item.value.lastYear))}</b>
                </div>
                {item.support && <div className="farol-productivity-support-row"><span>{item.supportLabel}</span><strong>{item.support.type === "currency" ? formatCurrency(item.support.current) : item.support.current.toLocaleString("pt-BR")}</strong><small>{Number(selectedMonth.slice(0, 4)) - 1}: {item.support.type === "currency" ? formatCurrency(item.support.lastYear) : item.support.lastYear.toLocaleString("pt-BR")}</small><b className={variation(item.support.current, item.support.lastYear) >= 0 ? "good-text" : "bad-text"}>{formatDeltaPercent(variation(item.support.current, item.support.lastYear))}</b></div>}
              </article>
            ))}
          </div>
          <div className="farol-productivity-sections">
            <ProductivityTable title="Passagens por consultor" rows={consultantProductivity} emptyText="Nenhuma passagem de consultor no período selecionado." />
            <ProductivityTable title="Passagens por mecânico" rows={mechanicProductivity} emptyText="Nenhuma passagem de mecânico no período selecionado." />
          </div>
        </section>

        <section className="panel farol-table-panel" data-farol-pdf-report="consultants">
          <div className="panel-head farol-report-head tone-consultant">
            <div><div className="farol-report-title-row"><h2 className="panel-title">Resultados por Consultor</h2><ReportAddButton onClick={() => openObservation("consultant-results", "Resultados por Consultor")} /><DataStatusTag status={reportStatus(Boolean(consultantServicePerformance[selectedMonth]?.length))} /></div><p className="comment">Serviços iguais são consolidados por descrição, mesmo quando vierem de modelos diferentes.</p></div>
            <span className="tag">{monthLabel(selectedMonth)}</span>
          </div>
          <ConsultantServiceReport selectedMonth={selectedMonth} />
        </section>

        {pdfSelectorOpen && (
          <div className="farol-report-modal-backdrop" role="presentation" onClick={() => !pdfLoading && setPdfSelectorOpen(false)}>
            <section className="farol-report-modal farol-pdf-selector-modal" role="dialog" aria-modal="true" aria-labelledby="farol-pdf-selector-title" onClick={(event) => event.stopPropagation()}>
              <div className="farol-report-modal-head"><div><span>Exportar PDF</span><h2 id="farol-pdf-selector-title">Escolha os relatórios</h2></div><button type="button" onClick={() => setPdfSelectorOpen(false)} aria-label="Fechar" disabled={pdfLoading}>×</button></div>
              <label className="farol-pdf-select-all"><input type="checkbox" checked={selectedPdfReports.length === farolPdfReports.length} onChange={(event) => setSelectedPdfReports(event.target.checked ? farolPdfReports.map((report) => report.key) : [])} /><span>Selecionar todos</span></label>
              <div className="farol-pdf-report-list">
                {farolPdfReports.map((report) => (
                  <label key={report.key}><input type="checkbox" checked={selectedPdfReports.includes(report.key)} onChange={(event) => setSelectedPdfReports((current) => event.target.checked ? [...current, report.key] : current.filter((key) => key !== report.key))} /><span>{report.label}</span></label>
                ))}
              </div>
              <div className="farol-report-modal-actions"><button type="button" className="ghost-btn" onClick={() => setPdfSelectorOpen(false)} disabled={pdfLoading}>Cancelar</button><button type="button" className="primary-btn" onClick={() => void generatePdf()} disabled={pdfLoading || !selectedPdfReports.length}>{pdfLoading ? "Gerando PDF..." : `Gerar PDF (${selectedPdfReports.length})`}</button></div>
            </section>
          </div>
        )}

        {activeObservation && (
          <div className="farol-report-modal-backdrop" role="presentation" onClick={() => setActiveObservation(null)}>
            <section className="farol-report-modal" role="dialog" aria-modal="true" aria-labelledby="farol-report-modal-title" onClick={(event) => event.stopPropagation()}>
              <div className="farol-report-modal-head"><div><span>Adicionar ao relatório</span><h2 id="farol-report-modal-title">{activeObservation.label}</h2></div><button type="button" onClick={() => setActiveObservation(null)} aria-label="Fechar">×</button></div>
              <label><span>Número do relatório</span><input value={observationValueDraft} onChange={(event) => setObservationValueDraft(event.target.value)} placeholder="Ex.: 138 ou R$ 10.000" /></label>
              <label><span>Comentário</span><textarea value={observationCommentDraft} onChange={(event) => setObservationCommentDraft(event.target.value)} placeholder="Registre o contexto desse resultado..." rows={4} /></label>
              <div className="farol-report-modal-actions"><button type="button" className="ghost-btn" onClick={() => setActiveObservation(null)}>Cancelar</button><button type="button" className="primary-btn" onClick={() => void saveObservation(activeObservation.key, activeObservation.label)} disabled={savingObservation === activeObservation.key}>{savingObservation === activeObservation.key ? "Salvando..." : "Salvar"}</button></div>
            </section>
          </div>
        )}

        {activeRevenueEntry && (
          <div className="farol-report-modal-backdrop" role="presentation" onClick={() => setActiveRevenueEntry(false)}>
            <section className="farol-report-modal" role="dialog" aria-modal="true" aria-labelledby="farol-revenue-modal-title" onClick={(event) => event.stopPropagation()}>
              <div className="farol-report-modal-head"><div><span>Atualizar relatório</span><h2 id="farol-revenue-modal-title">Faturamento</h2></div><button type="button" onClick={() => setActiveRevenueEntry(false)} aria-label="Fechar">×</button></div>
              <label><span>Mês de referência</span><input type="month" value={revenueDraft.month} onChange={(event) => setRevenueDraft((current) => ({ ...current, month: event.target.value }))} /></label>
              <div className="farol-revenue-form-grid">
                <label><span>Peças</span><input inputMode="decimal" value={revenueDraft.parts} onChange={(event) => setRevenueDraft((current) => ({ ...current, parts: event.target.value }))} placeholder="Ex.: 323.918,19" /></label>
                <label><span>Serviços (M.O.)</span><input inputMode="decimal" value={revenueDraft.services} onChange={(event) => setRevenueDraft((current) => ({ ...current, services: event.target.value }))} placeholder="Ex.: 277.065,15" /></label>
              </div>
              <div className="farol-revenue-total-preview"><span>Total calculado</span><strong>{formatCurrency(parseCurrencyInput(revenueDraft.parts) + parseCurrencyInput(revenueDraft.services))}</strong></div>
              <div className="farol-report-modal-actions"><button type="button" className="ghost-btn" onClick={() => setActiveRevenueEntry(false)}>Cancelar</button><button type="button" className="primary-btn" onClick={() => void saveRevenueEntry()} disabled={!revenueDraft.month || savingRevenueEntry}>{savingRevenueEntry ? "Salvando..." : "Salvar faturamento"}</button></div>
            </section>
          </div>
        )}

        {activeGrossProfitEntry && (
          <div className="farol-report-modal-backdrop" role="presentation" onClick={() => setActiveGrossProfitEntry(false)}>
            <section className="farol-report-modal" role="dialog" aria-modal="true" aria-labelledby="farol-gross-profit-modal-title" onClick={(event) => event.stopPropagation()}>
              <div className="farol-report-modal-head"><div><span>Atualizar relatório</span><h2 id="farol-gross-profit-modal-title">Lucro Bruto</h2></div><button type="button" onClick={() => setActiveGrossProfitEntry(false)} aria-label="Fechar">×</button></div>
              <label><span>Mês de referência</span><input type="month" value={grossProfitDraft.month} onChange={(event) => setGrossProfitDraft((current) => ({ ...current, month: event.target.value }))} /></label>
              <div className="farol-revenue-form-grid">
                <label><span>Meta LB</span><input inputMode="decimal" value={grossProfitDraft.planned} onChange={(event) => setGrossProfitDraft((current) => ({ ...current, planned: event.target.value }))} placeholder="Ex.: 288.244,79" /></label>
                <label><span>LB realizado</span><input inputMode="decimal" value={grossProfitDraft.realized} onChange={(event) => setGrossProfitDraft((current) => ({ ...current, realized: event.target.value }))} placeholder="Ex.: 184.033,77" /></label>
                <label><span>LB ano anterior</span><input inputMode="decimal" value={grossProfitDraft.previousYear} onChange={(event) => setGrossProfitDraft((current) => ({ ...current, previousYear: event.target.value }))} placeholder="Ex.: 288.424,89" /></label>
                <label><span>Margem bruta (%)</span><input inputMode="decimal" value={grossProfitDraft.margin} onChange={(event) => setGrossProfitDraft((current) => ({ ...current, margin: event.target.value }))} placeholder="Ex.: 56,32" /></label>
              </div>
              <div className="farol-revenue-total-preview"><span>Variação sobre o ano anterior</span><strong className={variation(parseCurrencyInput(grossProfitDraft.realized), parseCurrencyInput(grossProfitDraft.previousYear)) >= 0 ? "good-text" : "bad-text"}>{formatDeltaPercent(variation(parseCurrencyInput(grossProfitDraft.realized), parseCurrencyInput(grossProfitDraft.previousYear)))}</strong></div>
              <div className="farol-report-modal-actions"><button type="button" className="ghost-btn" onClick={() => setActiveGrossProfitEntry(false)}>Cancelar</button><button type="button" className="primary-btn" onClick={() => void saveGrossProfitEntry()} disabled={!grossProfitDraft.month || savingGrossProfitEntry}>{savingGrossProfitEntry ? "Salvando..." : "Salvar lucro bruto"}</button></div>
            </section>
          </div>
        )}

        {activeChannelRevenueEntry && (
          <div className="farol-report-modal-backdrop" role="presentation" onClick={() => setActiveChannelRevenueEntry(false)}>
            <section className="farol-report-modal farol-channel-modal" role="dialog" aria-modal="true" aria-labelledby="farol-channel-modal-title" onClick={(event) => event.stopPropagation()}>
              <div className="farol-report-modal-head"><div><span>Atualizar relatório</span><h2 id="farol-channel-modal-title">Faturamento por Canal</h2></div><button type="button" onClick={() => setActiveChannelRevenueEntry(false)} aria-label="Fechar">×</button></div>
              <label><span>Mês de referência</span><input type="month" value={channelRevenueDraft.month} onChange={(event) => setChannelRevenueDraft((current) => ({ ...current, month: event.target.value }))} /></label>
              <div className="farol-channel-form-grid">
                {channelDefinitions.map((channel) => <label key={channel.key}><span>{channel.channel}</span><input inputMode="decimal" value={channelRevenueDraft[channel.key]} onChange={(event) => setChannelRevenueDraft((current) => ({ ...current, [channel.key]: event.target.value }))} placeholder="R$ 0,00" /></label>)}
              </div>
              <div className="farol-revenue-total-preview"><span>Total calculado</span><strong>{formatCurrency(channelDefinitions.reduce((sum, channel) => sum + parseCurrencyInput(channelRevenueDraft[channel.key]), 0))}</strong></div>
              <div className="farol-report-modal-actions"><button type="button" className="ghost-btn" onClick={() => setActiveChannelRevenueEntry(false)}>Cancelar</button><button type="button" className="primary-btn" onClick={() => void saveChannelRevenueEntry()} disabled={!channelRevenueDraft.month || savingChannelRevenueEntry}>{savingChannelRevenueEntry ? "Salvando..." : "Salvar canais"}</button></div>
            </section>
          </div>
        )}

        {activeServiceProductivityEntry && (
          <div className="farol-report-modal-backdrop" role="presentation" onClick={() => setActiveServiceProductivityEntry(false)}>
            <section className="farol-report-modal farol-productivity-modal" role="dialog" aria-modal="true" aria-labelledby="farol-productivity-modal-title" onClick={(event) => event.stopPropagation()}>
              <div className="farol-report-modal-head"><div><span>Atualizar relatório</span><h2 id="farol-productivity-modal-title">Produtividade e TKM</h2></div><button type="button" onClick={() => setActiveServiceProductivityEntry(false)} aria-label="Fechar">×</button></div>
              <label><span>Mês de competência</span><input type="month" value={serviceProductivityDraft.month} onChange={(event) => setServiceProductivityDraft((current) => ({ ...current, month: event.target.value }))} /></label>
              <div className="farol-channel-form-grid">
                <label><span>Quantidade de revisões</span><input inputMode="numeric" value={serviceProductivityDraft.revisions} onChange={(event) => setServiceProductivityDraft((current) => ({ ...current, revisions: event.target.value }))} placeholder="Ex.: 281" /></label>
                <label><span>Vendas de revisão</span><input inputMode="decimal" value={serviceProductivityDraft.revisionSales} onChange={(event) => setServiceProductivityDraft((current) => ({ ...current, revisionSales: event.target.value }))} placeholder="R$ 114.710,32" /></label>
                <label><span>Mecânica geral e demais</span><input inputMode="decimal" value={serviceProductivityDraft.mechanicsSales} onChange={(event) => setServiceProductivityDraft((current) => ({ ...current, mechanicsSales: event.target.value }))} placeholder="R$ 27.828,88" /></label>
                <label><span>Serviços adicionais</span><input inputMode="decimal" value={serviceProductivityDraft.additionalSales} onChange={(event) => setServiceProductivityDraft((current) => ({ ...current, additionalSales: event.target.value }))} placeholder="R$ 84.660,52" /></label>
                <label><span>Embelezamento</span><input inputMode="decimal" value={serviceProductivityDraft.beautySales} onChange={(event) => setServiceProductivityDraft((current) => ({ ...current, beautySales: event.target.value }))} placeholder="R$ 40.332,37" /></label>
              </div>
              <div className="farol-revenue-total-preview"><span>Oficina produtiva / total de serviços</span><strong>{formatCurrency(parseCurrencyInput(serviceProductivityDraft.revisionSales) + parseCurrencyInput(serviceProductivityDraft.mechanicsSales) + parseCurrencyInput(serviceProductivityDraft.additionalSales))} / {formatCurrency(parseCurrencyInput(serviceProductivityDraft.revisionSales) + parseCurrencyInput(serviceProductivityDraft.mechanicsSales) + parseCurrencyInput(serviceProductivityDraft.additionalSales) + parseCurrencyInput(serviceProductivityDraft.beautySales))}</strong></div>
              <div className="farol-report-modal-actions"><button type="button" className="ghost-btn" onClick={() => setActiveServiceProductivityEntry(false)}>Cancelar</button><button type="button" className="primary-btn" onClick={() => void saveServiceProductivityEntry()} disabled={!serviceProductivityDraft.month || savingServiceProductivityEntry}>{savingServiceProductivityEntry ? "Salvando..." : "Salvar produtividade"}</button></div>
            </section>
          </div>
        )}

        {activeMonthlyPlan && (
          <div className="farol-report-modal-backdrop" role="presentation" onClick={() => setActiveMonthlyPlan(false)}>
            <section className="farol-report-modal farol-monthly-plan-modal" role="dialog" aria-modal="true" aria-labelledby="farol-monthly-plan-title" onClick={(event) => event.stopPropagation()}>
              <div className="farol-report-modal-head"><div><span>Fase 1 · Base dos indicadores</span><h2 id="farol-monthly-plan-title">Metas e calendário operacional</h2></div><button type="button" onClick={() => setActiveMonthlyPlan(false)} aria-label="Fechar">×</button></div>
              <div className="farol-monthly-plan-grid">
                <label><span>Mês de competência</span><input type="month" value={monthlyPlanDraft.month} onChange={(event) => {
                  const month = event.target.value;
                  const existing = monthlyPlans.find((item) => item.month === month);
                  setMonthlyPlanDraft({ month, shopGoal: String(existing?.shopGoal ?? 160000), beautyGoal: String(existing?.beautyGoal ?? 35000), status: existing?.status ?? "partial", operationalDays: existing?.operationalDays ?? [] });
                }} /></label>
                <label><span>Situação do mês</span><select value={monthlyPlanDraft.status} onChange={(event) => setMonthlyPlanDraft((current) => ({ ...current, status: event.target.value as "partial" | "closed" }))}><option value="partial">Parcial / em andamento</option><option value="closed">Fechado</option></select></label>
                <label><span>Meta M.O Oficina Produtiva</span><input inputMode="decimal" value={monthlyPlanDraft.shopGoal} onChange={(event) => setMonthlyPlanDraft((current) => ({ ...current, shopGoal: event.target.value }))} placeholder="R$ 160.000,00" /></label>
                <label><span>Meta Embelezamento</span><input inputMode="decimal" value={monthlyPlanDraft.beautyGoal} onChange={(event) => setMonthlyPlanDraft((current) => ({ ...current, beautyGoal: event.target.value }))} placeholder="R$ 35.000,00" /></label>
              </div>
              <div className="farol-operational-calendar-head"><div><strong>Exceções do calendário</strong><small>Sábado vale meio dia por padrão. Cadastre somente feriados, dias fechados ou jornadas diferentes.</small></div><button type="button" className="ghost-btn" onClick={addOperationalDay}>+ Adicionar dia</button></div>
              <div className="farol-operational-days">
                {monthlyPlanDraft.operationalDays.map((item, index) => <div key={`${item.date}-${index}`} className="farol-operational-day-row">
                  <input aria-label="Data" type="date" min={`${monthlyPlanDraft.month}-01`} max={`${monthlyPlanDraft.month}-${String(new Date(Number(monthlyPlanDraft.month.slice(0, 4)), Number(monthlyPlanDraft.month.slice(5)), 0).getDate()).padStart(2, "0")}`} value={item.date} onChange={(event) => updateOperationalDay(index, { date: event.target.value })} />
                  <select aria-label="Tipo do dia" value={item.type} onChange={(event) => updateOperationalDay(index, { type: event.target.value as FarolOperationalDayType })}><option value="holiday">Feriado</option><option value="closed">Sem operação</option><option value="half">Meio expediente</option><option value="full">Expediente completo</option></select>
                  <input aria-label="Descrição" value={item.label ?? ""} onChange={(event) => updateOperationalDay(index, { label: event.target.value })} placeholder="Descrição opcional" />
                  <button type="button" onClick={() => setMonthlyPlanDraft((current) => ({ ...current, operationalDays: current.operationalDays.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="Remover exceção">×</button>
                </div>)}
                {!monthlyPlanDraft.operationalDays.length && <p>Nenhuma exceção cadastrada para este mês.</p>}
              </div>
              <div className="farol-plan-preview"><span>Dias úteis ponderados</span><strong>{formatDayCount(buildMonthSummary(monthlyPlanDraft.month, new Date(), monthlyPlanDraft.operationalDays).businessDays)}</strong><span>Meta diária OP</span><strong>{formatCurrency(parseCurrencyInput(monthlyPlanDraft.shopGoal) / Math.max(1, buildMonthSummary(monthlyPlanDraft.month, new Date(), monthlyPlanDraft.operationalDays).businessDays))}</strong><span>Meta diária EMB</span><strong>{formatCurrency(parseCurrencyInput(monthlyPlanDraft.beautyGoal) / Math.max(1, buildMonthSummary(monthlyPlanDraft.month, new Date(), monthlyPlanDraft.operationalDays).businessDays))}</strong></div>
              <p className="farol-plan-existing-goals">As metas de Balcão e Lucro Bruto continuam sendo configuradas nos botões + dos respectivos relatórios.</p>
              <div className="farol-report-modal-actions"><button type="button" className="ghost-btn" onClick={() => setActiveMonthlyPlan(false)}>Cancelar</button><button type="button" className="primary-btn" onClick={() => void saveMonthlyPlan()} disabled={!monthlyPlanDraft.month || savingMonthlyPlan}>{savingMonthlyPlan ? "Salvando..." : "Salvar configuração"}</button></div>
            </section>
          </div>
        )}

        {activeDailyResult && (
          <div className="farol-report-modal-backdrop" role="presentation" onClick={() => setActiveDailyResult(false)}>
            <section className="farol-report-modal farol-daily-input-modal" role="dialog" aria-modal="true" aria-labelledby="farol-daily-input-title" onClick={(event) => event.stopPropagation()}>
              <div className="farol-report-modal-head"><div><span>Resumo de Serviços</span><h2 id="farol-daily-input-title">Lançar resultado diário</h2></div><button type="button" onClick={() => setActiveDailyResult(false)} aria-label="Fechar">×</button></div>
              <p className="farol-daily-input-help">Leia também a coluna <strong>Qtde</strong> de Revisão do relatório. OP é calculada automaticamente: Revisão + Mecânica (incluindo as demais categorias) + Alinhamento/Balanceamento. Embelezamento é lançado separadamente.</p>
              <label><span>Dia</span><input type="number" min="1" max={new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5)), 0).getDate()} value={dailyResultDraft.day} onChange={(event) => setDailyResultDraft((current) => ({ ...current, day: Number(event.target.value) }))} /></label>
              <div className="farol-daily-input-grid">
                <label><span>Revisão</span><input inputMode="decimal" value={dailyResultDraft.revision} onChange={(event) => setDailyResultDraft((current) => ({ ...current, revision: event.target.value }))} placeholder="R$ 0,00" /></label>
                <label><span>Qtde. de revisões</span><input type="number" min="0" step="1" value={dailyResultDraft.revisionCount} onChange={(event) => setDailyResultDraft((current) => ({ ...current, revisionCount: event.target.value }))} placeholder="Ex.: 6" /></label>
                <label><span>Mecânica e demais categorias</span><input inputMode="decimal" value={dailyResultDraft.generalMechanics} onChange={(event) => setDailyResultDraft((current) => ({ ...current, generalMechanics: event.target.value }))} placeholder="R$ 0,00" /></label>
                <label><span>Alinhamento / balanceamento</span><input inputMode="decimal" value={dailyResultDraft.alignmentBalancing} onChange={(event) => setDailyResultDraft((current) => ({ ...current, alignmentBalancing: event.target.value }))} placeholder="R$ 0,00" /></label>
                <label><span>Embelezamento</span><input inputMode="decimal" value={dailyResultDraft.beauty} onChange={(event) => setDailyResultDraft((current) => ({ ...current, beauty: event.target.value }))} placeholder="R$ 0,00" /></label>
              </div>
              <div className="farol-daily-input-total"><span>OP calculada</span><strong>{formatCurrency(Number(dailyResultDraft.revision.replace(",", ".")) + Number(dailyResultDraft.generalMechanics.replace(",", ".")) + Number(dailyResultDraft.alignmentBalancing.replace(",", ".")))}</strong><span>EMB</span><strong>{formatCurrency(Number(dailyResultDraft.beauty.replace(",", ".")))}</strong></div>
              <div className="farol-report-modal-actions"><button type="button" className="ghost-btn" onClick={() => setActiveDailyResult(false)}>Cancelar</button><button type="button" className="primary-btn" onClick={() => void saveDailyResult()} disabled={savingDailyResult}>{savingDailyResult ? "Salvando..." : "Salvar resultado"}</button></div>
            </section>
          </div>
        )}
      </main>
    </ProtectedPage>
  );
}

function ProductivityTable({ title, rows, emptyText }: { title: string; rows: ProductivityPerson[]; emptyText: string }) {
  return (
    <div className="farol-productivity-section">
      <div className="farol-productivity-section-head"><h3>{title}</h3><span>{rows.reduce((sum, row) => sum + row.total, 0)} passagens</span></div>
      {rows.length ? (
        <div className="farol-productivity-table-wrap">
          <table className="farol-productivity-table">
            <thead><tr><th>Profissional</th><th>Embelezamento</th><th>Revisão</th><th>Reparo</th><th>Diagnóstico</th><th>Total</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.beauty}</td><td>{row.revision}</td><td>{row.repair}</td><td>{row.diagnosis}</td><td><strong>{row.total}</strong></td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="farol-productivity-empty">{emptyText}</p>}
    </div>
  );
}

function ConsultantServiceReport({ selectedMonth }: { selectedMonth: string }) {
  const reports = consultantServicePerformance[selectedMonth] ?? [];
  const [sortBy, setSortBy] = useState<"alphabetical" | "quantity" | "tkm">("alphabetical");
  const tkm = (value: number, revisions: number) => revisions ? value / revisions : 0;
  const sortedDetails = (details: ConsultantServiceDetail[]) => [...details].sort((left, right) => {
    if (sortBy === "quantity") return right.quantity - left.quantity || right.amount - left.amount;
    if (sortBy === "tkm") return tkm(right.amount, right.quantity) - tkm(left.amount, left.quantity) || right.quantity - left.quantity;
    return left.service.localeCompare(right.service, "pt-BR", { sensitivity: "base" }) || left.tmo.localeCompare(right.tmo, "pt-BR");
  });

  if (!reports.length) return <p className="farol-productivity-empty">Ainda não há relatório de vendas por consultor para este mês.</p>;

  return (
    <div className="farol-consultant-report">
      <div className="farol-consultant-view-options" role="group" aria-label="Ordenar serviços dos consultores">
        <div className="farol-consultant-view-label"><span>Ordenar serviços:</span></div>
        <div className="farol-consultant-view-buttons">
          <button type="button" aria-pressed={sortBy === "alphabetical"} className={sortBy === "alphabetical" ? "active" : ""} onClick={() => setSortBy("alphabetical")}>A–Z</button>
          <button type="button" aria-pressed={sortBy === "quantity"} className={sortBy === "quantity" ? "active" : ""} onClick={() => setSortBy("quantity")} title="Ordena pela quantidade vendida">+ Vendidos</button>
          <button type="button" aria-pressed={sortBy === "tkm"} className={sortBy === "tkm" ? "active" : ""} onClick={() => setSortBy("tkm")}>TKM</button>
        </div>
      </div>
      <div className="farol-consultant-report-grid">
        {reports.map((consultant) => (
          <article key={consultant.id} className="farol-consultant-report-card">
            <header><div><span>{consultant.id}</span><h3>{consultant.name}</h3></div><strong>{consultant.revisions} revisões</strong></header>
            <div className="farol-consultant-summary">
              <div><span>Revisões</span><strong>{formatCurrency(consultant.revisionSales)}</strong><small>{consultant.revisions} recebidas</small></div>
              <div><span>Serviços adicionais</span><strong>{formatCurrency(consultant.additionalSales)}</strong><small>TKM {formatCurrency(tkm(consultant.additionalSales, consultant.revisions))}</small></div>
              <div><span>Embelezamento</span><strong>{formatCurrency(consultant.beautySales)}</strong><small>TKM {formatCurrency(tkm(consultant.beautySales, consultant.revisions))}</small></div>
            </div>
            <div className="farol-consultant-services">
              <div className="farol-consultant-services-head"><span>Vendas por serviço</span><div><small>Quant.</small><small>Vendas</small><small>TKM</small></div></div>
              {sortedDetails(consultant.details).map((service) => <div key={`${service.tmo}-${service.service}`} className="farol-consultant-service-row"><span className={service.category === "Adicionais" ? "is-additional" : "is-beauty"}>{service.tmo}</span><strong>{service.service}</strong><b>{service.quantity}</b><em>{formatCurrency(service.amount)}</em><i>{formatCurrency(service.quantity ? service.amount / service.quantity : 0)}</i></div>)}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function DailyResultLineChart({ rows }: { rows: DailyResult[] }) {
  const [mode, setMode] = useState<"shop" | "beauty">("shop");
  const [showProjection, setShowProjection] = useState(false);
  const goalField = mode === "shop" ? "shopGoal" : "beautyGoal";
  const doneField = mode === "shop" ? "shopDone" : "beautyDone";
  const previousField = mode === "shop" ? "shopPreviousYear" : "beautyPreviousYear";
  let cumulativeGoal = 0;
  let cumulativeDone = 0;
  let cumulativePrevious = 0;
  const goalSeries: Array<{ index: number; value: number }> = [];
  const doneSeries: Array<{ index: number; value: number }> = [];
  const previousSeries: Array<{ index: number; value: number }> = [];

  rows.forEach((row, index) => {
    cumulativeGoal += row[goalField] ?? 0;
    goalSeries.push({ index, value: cumulativeGoal });
    const done = row[doneField];
    if (done !== null) {
      cumulativeDone += done;
      doneSeries.push({ index, value: cumulativeDone });
    }
    const previous = row[previousField];
    if (previous !== null && previous !== undefined) {
      cumulativePrevious += previous;
      previousSeries.push({ index, value: cumulativePrevious });
    }
  });

  const width = 720;
  const height = 210;
  const padding = { top: 14, right: 18, bottom: 30, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number) => padding.left + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * plotWidth);
  const lastDone = doneSeries.at(-1);
  const completedGoal = doneSeries.reduce((total, point) => total + (rows[point.index]?.[goalField] ?? 0), 0);
  const pace = completedGoal && lastDone ? lastDone.value / completedGoal : 0;
  let projectedValue = lastDone?.value ?? 0;
  const projectionSeries = lastDone ? rows.slice(lastDone.index).map((row, offset) => {
    const index = lastDone.index + offset;
    if (index > lastDone.index) projectedValue += row[goalField] * pace;
    return { index, value: projectedValue };
  }) : [];
  const maxValue = Math.max(...goalSeries.map((point) => point.value), ...doneSeries.map((point) => point.value), ...previousSeries.map((point) => point.value), ...projectionSeries.map((point) => point.value), 1);
  const y = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
  const points = (series: Array<{ index: number; value: number }>) => series.map((point) => `${x(point.index)},${y(point.value)}`).join(" ");

  return (
    <aside className="farol-daily-chart">
      <div className="farol-daily-chart-head"><div><span>Evolução acumulada</span><strong>Realizado × Meta × Realizado AA</strong></div><div className="farol-daily-chart-toggle"><button type="button" className={mode === "shop" ? "active" : ""} onClick={() => setMode("shop")}>Oficina</button><button type="button" className={mode === "beauty" ? "active" : ""} onClick={() => setMode("beauty")}>Embelezamento</button><button type="button" className={showProjection ? "active projection-toggle" : "projection-toggle"} onClick={() => setShowProjection((current) => !current)}>Projeção</button></div></div>
      <div className="farol-daily-chart-legend"><span><i className="done" />Realizado</span><span><i className="goal" />Meta</span><span className={!previousSeries.length ? "is-muted" : ""}><i className="previous" />Realizado AA</span>{showProjection && <span className={!projectionSeries.length ? "is-muted" : ""}><i className="projection" />Projeção</span>}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Evolução diária acumulada de ${mode === "shop" ? "Oficina" : "Embelezamento"}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={ratio}><line className="grid-line" x1={padding.left} x2={width - padding.right} y1={y(maxValue * ratio)} y2={y(maxValue * ratio)} /><text className="axis-value" x={padding.left - 8} y={y(maxValue * ratio) + 4} textAnchor="end">{formatCompactCurrency(maxValue * ratio)}</text></g>)}
        <polyline className="goal-line" points={points(goalSeries)} />
        {doneSeries.length > 1 && <polyline className="done-line" points={points(doneSeries)} />}
        {previousSeries.length > 1 && <polyline className="previous-line" points={points(previousSeries)} />}
        {showProjection && projectionSeries.length > 1 && <polyline className="projection-line" points={points(projectionSeries)} />}
        {goalSeries.filter((point) => point.index <= (lastDone?.index ?? -1)).map((point) => <circle key={`goal-${point.index}`} className="goal-point" cx={x(point.index)} cy={y(point.value)} r="1.8" />)}
        {doneSeries.map((point) => <circle key={`done-${point.index}`} className="done-point" cx={x(point.index)} cy={y(point.value)} r="2.2" />)}
        {previousSeries.map((point) => <circle key={`previous-${point.index}`} className="previous-point" cx={x(point.index)} cy={y(point.value)} r="1.8" />)}
        {showProjection && projectionSeries.filter((point) => point.index > (lastDone?.index ?? -1)).map((point) => <circle key={`projection-${point.index}`} className="projection-point" cx={x(point.index)} cy={y(point.value)} r="1.5" />)}
        {rows.map((row, index) => <text className="axis-day" key={row.day} x={x(index)} y={height - 10} textAnchor="middle">{row.day.split("/")[0]}</text>)}
      </svg>
      {!doneSeries.length && <p>Os resultados aparecerão conforme os valores diários forem preenchidos.</p>}
      {!previousSeries.length && <p className="farol-aa-missing">Base diária do ano anterior ainda não informada.</p>}
      {showProjection && !projectionSeries.length && <p className="farol-aa-missing">Informe ao menos um resultado diário para calcular a projeção.</p>}
    </aside>
  );
}

function GoalCard({
  title,
  tone,
  summary,
  dailyGoal,
  status,
  onConfigure,
}: {
  title: string;
  tone: "shop" | "beauty";
  summary: ReturnType<typeof areaSummary>;
  dailyGoal: number;
  status: FarolDataStatus;
  onConfigure: () => void;
}) {
  const color = tone === "shop" ? "#65ad42" : "#3472c7";
  const percent = Math.min(100, summary.percent);

  return (
    <article className={`farol-goal-card ${tone}`}>
      <div className="farol-goal-head">
        <div><span>Meta mensal</span><div className="farol-report-title-row"><h2>{title}</h2><ReportAddButton onClick={onConfigure} /></div></div>
        <div className="farol-goal-status"><DataStatusTag status={status} /><strong>{formatPercent(summary.percent)}</strong></div>
      </div>
      <div className="farol-goal-body">
        <div className="farol-donut">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="farol-donut-track" cx="60" cy="60" r="51" pathLength="100" />
            <circle className="farol-donut-progress" cx="60" cy="60" r="51" pathLength="100" stroke={color} strokeDasharray={`${percent} ${100 - percent}`} />
          </svg>
          <div><strong>{formatPercent(summary.percent)}</strong><span>realizado</span></div>
        </div>
        <div className="farol-money-grid">
          <div><span>Meta mês</span><strong>{formatCurrency(summary.goal)}</strong></div>
          <div><span>Realizado</span><strong>{formatCurrency(summary.done)}</strong></div>
          <div><span>Saldo</span><strong className={summary.balance >= 0 ? "good-text" : "bad-text"}>{formatCurrency(summary.balance)}</strong></div>
          <div><span>Projeção</span><strong>{formatCurrency(summary.projection)}</strong></div>
          <div><span>Meta dia</span><strong>{formatCurrency(dailyGoal)}</strong></div>
          <div><span>Ritmo</span><strong>{summary.projection >= summary.goal ? "Acima" : "Abaixo"}</strong></div>
        </div>
      </div>
    </article>
  );
}

function DataStatusTag({ status }: { status: FarolDataStatus }) {
  const tone = status === "Fechado" ? "closed" : status === "Parcial" ? "partial" : status === "Sem fechamento" ? "warning" : "empty";
  return <span className={`farol-data-status ${tone}`}>{status}</span>;
}

function ReportAddButton({ onClick }: { onClick: () => void }) {
  const { profile } = useAuth();
  if (profile?.role !== "admin") return null;
  return <button data-html2canvas-ignore="true" data-pdf-hide="true" type="button" className="farol-report-add" onClick={onClick} aria-label="Adicionar número e comentário">+</button>;
}

function MonthlyOperationChart({ selectedMonth, comparePreviousYear, revenueEntries }: { selectedMonth: string; comparePreviousYear: boolean; revenueEntries: FarolRevenue[] }) {
  const selectedYear = selectedMonth.slice(0, 4);
  const entryByMonth = new Map(revenueEntries.map((item) => [item.month, item]));
  const mergedTrend = monthlyTrend.map((item) => {
    const entry = entryByMonth.get(item.month);
    return entry ? { ...item, parts: entry.parts, services: entry.services, total: entry.parts + entry.services } : item;
  });
  revenueEntries.filter((entry) => !mergedTrend.some((item) => item.month === entry.month)).forEach((entry) => {
    mergedTrend.push({ month: entry.month, label: monthLabel(entry.month), parts: entry.parts, services: entry.services, total: entry.parts + entry.services });
  });
  mergedTrend.sort((a, b) => a.month.localeCompare(b.month));
  const visibleTrend = mergedTrend.filter((item) => item.month.startsWith(selectedYear) && item.month <= selectedMonth);
  const previousByMonth = new Map(mergedTrend.map((item) => [item.month, item]));
  const previousTrend = visibleTrend.map((item) => previousByMonth.get(`${Number(selectedYear) - 1}-${item.month.slice(5)}`));
  const max = Math.max(...visibleTrend.map((item) => item.total), ...previousTrend.map((item) => item?.total ?? 0), 1);
  const lastRevenueUpdate = revenueEntries.filter((item) => item.month.startsWith(selectedYear) && item.month <= selectedMonth).sort((a, b) => {
    const left = a.updatedAt && typeof a.updatedAt === "object" && "toMillis" in a.updatedAt && typeof a.updatedAt.toMillis === "function" ? a.updatedAt.toMillis() : 0;
    const right = b.updatedAt && typeof b.updatedAt === "object" && "toMillis" in b.updatedAt && typeof b.updatedAt.toMillis === "function" ? b.updatedAt.toMillis() : 0;
    return right - left;
  })[0]?.updatedAt;

  return (
    <div className="farol-monthly-operation-chart" aria-label="Peças, serviços e total por mês">
      <div className="farol-monthly-operation-legend"><span><i className="parts" />Peças</span><span><i className="services" />Serviços (M.O.)</span><span><i className="total" />Total</span>{comparePreviousYear && <span><i className="previous-year" />Referência do ano anterior</span>}<small className="farol-revenue-last-update">Última atualização: {formatUpdatedAt(lastRevenueUpdate)}</small></div>
      <div className="farol-monthly-operation-scroll">
        <div className="farol-monthly-operation-months">
          {visibleTrend.map((item, index) => {
            const previous = previousTrend[index];
            return (
              <article key={item.month} className="farol-monthly-operation-month">
                <div className="farol-monthly-operation-bars">
                  <div className="farol-monthly-bar-set"><div>
                    <span className="farol-monthly-bar-column"><i className="parts" style={{ height: `${Math.max(5, (item.parts / max) * 100)}%` }} title={`Peças: ${formatCurrency(item.parts)}`} />{comparePreviousYear && previous && <em className="farol-previous-marker" style={{ bottom: `${(previous.parts / max) * 100}%` }} title={`Peças no ano anterior: ${formatCurrency(previous.parts)}`} />}</span>
                    <span className="farol-monthly-bar-column"><i className="services" style={{ height: `${Math.max(5, (item.services / max) * 100)}%` }} title={`Serviços: ${formatCurrency(item.services)}`} />{comparePreviousYear && previous && <em className="farol-previous-marker" style={{ bottom: `${(previous.services / max) * 100}%` }} title={`Serviços no ano anterior: ${formatCurrency(previous.services)}`} />}</span>
                    <span className="farol-monthly-bar-column"><i className="total" style={{ height: `${Math.max(5, (item.total / max) * 100)}%` }} title={`Total: ${formatCurrency(item.total)}`} />{comparePreviousYear && previous && <em className="farol-previous-marker" style={{ bottom: `${(previous.total / max) * 100}%` }} title={`Total no ano anterior: ${formatCurrency(previous.total)}`} />}</span>
                  </div></div>
                </div>
                <strong>{monthLabel(item.month)}</strong>
                <div className="farol-monthly-operation-values"><span>Peças <b>{formatCurrency(item.parts)}</b></span><span>Serviços <b>{formatCurrency(item.services)}</b></span><span>Total <b>{formatCurrency(item.total)}</b></span></div>
              </article>
            );
          })}
          {!visibleTrend.length && <p className="farol-productivity-empty">Sem histórico mensal para o ano selecionado.</p>}
        </div>
      </div>
    </div>
  );
}

function ChannelRevenueChart({ current, lastUpdated }: { current: ChannelRevenue[]; lastUpdated?: unknown }) {
  const total = current.reduce((sum, item) => sum + item.total, 0);
  const colors = ["#2f7d55", "#d9a441", "#2c6fbb", "#9a6335", "#168075"];
  const shares = current.map((item) => total ? (item.total / total) * 100 : 0);
  const slices = current.map((item, index) => ({
    ...item,
    share: shares[index],
    start: shares.slice(0, index).reduce((sum, share) => sum + share, 0),
    color: colors[index % colors.length],
  }));

  return (
    <div className="farol-channel-chart" aria-label="Distribuição do faturamento por canal">
      <div className="farol-channel-chart-head"><div><span>Distribuição do mês</span><strong>Participação por canal</strong></div><small className="farol-revenue-last-update">Última atualização: {formatUpdatedAt(lastUpdated)}</small></div>
      <div className="farol-channel-pie-layout">
        <div className="farol-channel-pie" role="img" aria-label={slices.map((item) => `${item.channel}: ${formatCurrency(item.total)}, ${formatPercent(item.share)}`).join(". ")}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="farol-channel-pie-track" cx="60" cy="60" r="52" pathLength="100" />
            {slices.map((item) => item.share > 0 && <circle key={item.key} className="farol-channel-pie-slice" cx="60" cy="60" r="52" pathLength="100" stroke={item.color} strokeDasharray={`${item.share} ${100 - item.share}`} strokeDashoffset={-item.start} />)}
          </svg>
          <div><span>Total</span><strong>{formatCurrency(total)}</strong></div>
        </div>
        <div className="farol-channel-pie-legend">
          {slices.map((item) => (
            <article key={item.key} style={{ "--channel-color": item.color } as CSSProperties}>
              <i />
              <span>{item.channel}</span>
              <strong>{formatCurrency(item.total)}</strong>
              <b>{formatPercent(item.share)}</b>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function GrossProfitChart({ items, lastUpdated }: { items: GrossProfitMonth[]; lastUpdated?: unknown }) {
  const max = Math.max(...items.flatMap((item) => [item.planned, item.realized, item.previousYear]), 1);

  return (
    <div className="farol-lb-chart" aria-label="Lucro bruto planejado, realizado e margem bruta por mês">
      <div className="farol-lb-legend">
        <span><i className="planned" />Planejado</span>
        <span><i className="realized" />Realizado</span>
        <span><i className="previous" />Realizado AA</span>
        <span><i className="margin" />MB %</span>
        <small className="farol-revenue-last-update">Última atualização: {formatUpdatedAt(lastUpdated)}</small>
      </div>
      <div className="farol-lb-bars" style={{ "--farol-lb-month-count": items.length } as CSSProperties}>
        {items.map((item) => (
          <div key={item.month} className="farol-lb-month">
            <div className="farol-lb-columns">
              <i className="planned" title={`Planejado: ${formatCurrency(item.planned)}`} style={{ height: `${Math.max(8, (item.planned / max) * 100)}%` }} />
              <i className="realized" title={`Realizado: ${formatCurrency(item.realized)}`} style={{ height: `${Math.max(8, (item.realized / max) * 100)}%` }} />
              <i className="previous" title={`Realizado AA: ${formatCurrency(item.previousYear)}`} style={{ height: `${Math.max(8, (item.previousYear / max) * 100)}%` }} />
            </div>
            <strong>{item.label}</strong>
            <span>{formatPercent((item.realized / item.planned) * 100)}</span>
            <small>{item.margin.toFixed(0)}% MB</small>
          </div>
        ))}
      </div>
    </div>
  );
}

