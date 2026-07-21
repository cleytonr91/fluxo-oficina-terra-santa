"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import type { ManualContent } from "@/components/operation-manual";
import { listActiveVehicleFlows } from "@/services/firestore";
import type { VehicleFlow } from "@/types/domain";

const manual: ManualContent = {
  title: "Manual do Farol Gerencial",
  audience: "Uso principal: gerência e coordenação",
  objective: "Acompanhar resultado financeiro diário, ritmo da oficina, gargalos do fluxo e metas do mês.",
  steps: [
    "Abra o Farol para uma visão consolidada da operação.",
    "Confira meta, realizado, diferença, projeção e percentual atingido por área.",
    "Compare o resultado financeiro com volume, entrega, no-show, orçamento e pedidos de peças.",
    "Use os desvios em vermelho para cobrar ação das áreas responsáveis.",
  ],
  rules: [
    "O Farol é uma página de leitura gerencial, não de movimentação de chips.",
    "Os valores financeiros serão alimentados por importação do acompanhamento ou integração com o Linx.",
    "Indicadores operacionais dependem da disciplina de uso nas páginas Fluxo, Peças e Pós-serviço.",
  ],
  flow: [
    { title: "Coletar dados", text: "Sistema reúne valores financeiros e dados do fluxo." },
    { title: "Comparar metas", text: "Calcula meta, realizado, diferença e projeção." },
    { title: "Analisar gargalos", text: "Cruza resultado com volume, atrasos, no-show e peças." },
    { title: "Agir", text: "Gerência direciona cobrança para consultores, oficina, peças ou lavagem." },
  ],
};

type DailyResult = {
  day: string;
  weekDay: string;
  shopGoal: number;
  shopDone: number | null;
  beautyGoal: number;
  beautyDone: number | null;
  special?: "today" | "holiday" | "future";
};

type ChannelRevenue = {
  channel: "Oficina Produtiva" | "Funilaria" | "Acessórios" | "Embelezamento" | "Balcão" | "Total";
  parts: number;
  services: number;
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
  label: string;
  planned: number;
  realized: number;
  previousYear: number;
  margin: number;
};

const monthSummary = {
  month: "Julho",
  today: "20/07/2026",
  businessDays: 22,
  passedDays: 14,
  remainingDays: 8,
};

const financialRows: DailyResult[] = [
  { weekDay: "SEG", day: "01/jul", shopGoal: 7273, shopDone: 9210, beautyGoal: 1591, beautyDone: 1224 },
  { weekDay: "TER", day: "02/jul", shopGoal: 7273, shopDone: 6747, beautyGoal: 1591, beautyDone: 2100 },
  { weekDay: "QUA", day: "03/jul", shopGoal: 7273, shopDone: 4929, beautyGoal: 1591, beautyDone: 887 },
  { weekDay: "QUI", day: "04/jul", shopGoal: 0, shopDone: null, beautyGoal: 0, beautyDone: null, special: "holiday" },
  { weekDay: "SEX", day: "05/jul", shopGoal: 7273, shopDone: 7458, beautyGoal: 1591, beautyDone: 1250 },
  { weekDay: "SAB", day: "06/jul", shopGoal: 3636, shopDone: 1519, beautyGoal: 795, beautyDone: 520 },
  { weekDay: "SEG", day: "08/jul", shopGoal: 7273, shopDone: 7033, beautyGoal: 1591, beautyDone: 750 },
  { weekDay: "TER", day: "09/jul", shopGoal: 7273, shopDone: 6283, beautyGoal: 1591, beautyDone: 1749 },
  { weekDay: "QUA", day: "10/jul", shopGoal: 7273, shopDone: 10012, beautyGoal: 1591, beautyDone: 1010 },
  { weekDay: "QUI", day: "11/jul", shopGoal: 7273, shopDone: 8834, beautyGoal: 1591, beautyDone: 850 },
  { weekDay: "SEX", day: "12/jul", shopGoal: 7273, shopDone: 4239, beautyGoal: 1591, beautyDone: 1660 },
  { weekDay: "SAB", day: "13/jul", shopGoal: 3636, shopDone: 2615, beautyGoal: 795, beautyDone: 610 },
  { weekDay: "SEG", day: "15/jul", shopGoal: 3636, shopDone: 9087, beautyGoal: 1591, beautyDone: 1820 },
  { weekDay: "TER", day: "16/jul", shopGoal: 7273, shopDone: 6433, beautyGoal: 1591, beautyDone: 1660 },
  { weekDay: "QUA", day: "17/jul", shopGoal: 7273, shopDone: 9248, beautyGoal: 1591, beautyDone: 2159 },
  { weekDay: "QUI", day: "18/jul", shopGoal: 7273, shopDone: 7633, beautyGoal: 1591, beautyDone: 2400 },
  { weekDay: "SEX", day: "19/jul", shopGoal: 7273, shopDone: 8793, beautyGoal: 1591, beautyDone: 1120 },
  { weekDay: "SAB", day: "20/jul", shopGoal: 3636, shopDone: 7082, beautyGoal: 795, beautyDone: 960, special: "today" },
  { weekDay: "SEG", day: "22/jul", shopGoal: 7273, shopDone: 9140, beautyGoal: 1591, beautyDone: 870 },
  { weekDay: "TER", day: "23/jul", shopGoal: 7273, shopDone: 8123, beautyGoal: 1591, beautyDone: 600 },
  { weekDay: "QUA", day: "24/jul", shopGoal: 0, shopDone: null, beautyGoal: 0, beautyDone: null, special: "holiday" },
  { weekDay: "QUI", day: "25/jul", shopGoal: 7273, shopDone: null, beautyGoal: 1591, beautyDone: null, special: "future" },
  { weekDay: "SEX", day: "26/jul", shopGoal: 7273, shopDone: null, beautyGoal: 1591, beautyDone: null, special: "future" },
  { weekDay: "SAB", day: "27/jul", shopGoal: 3636, shopDone: null, beautyGoal: 795, beautyDone: null, special: "future" },
  { weekDay: "SEG", day: "29/jul", shopGoal: 7273, shopDone: null, beautyGoal: 1591, beautyDone: null, special: "future" },
  { weekDay: "TER", day: "30/jul", shopGoal: 7273, shopDone: null, beautyGoal: 1591, beautyDone: null, special: "future" },
];

const june2026: ChannelRevenue[] = [
  { channel: "Oficina Produtiva", parts: 260324.95, services: 174513.33, total: 434838.28 },
  { channel: "Funilaria", parts: 56504.55, services: 11265.24, total: 67769.79 },
  { channel: "Acessórios", parts: 59829, services: 22800, total: 82629 },
  { channel: "Embelezamento", parts: 0, services: 41050.4, total: 41050.4 },
  { channel: "Balcão", parts: 32151.2, services: 0, total: 32151.2 },
  { channel: "Total", parts: 408809.7, services: 249628.97, total: 658438.67 },
];

const may2026: ChannelRevenue[] = [
  { channel: "Oficina Produtiva", parts: 230577.29, services: 161491.16, total: 392068.45 },
  { channel: "Funilaria", parts: 54298.61, services: 22297.69, total: 76596.3 },
  { channel: "Acessórios", parts: 64811.71, services: 38370, total: 103181.71 },
  { channel: "Embelezamento", parts: 0, services: 48145.48, total: 48145.48 },
  { channel: "Balcão", parts: 43642.88, services: 0, total: 43642.88 },
  { channel: "Total", parts: 393330.49, services: 270304.33, total: 663634.82 },
];

const june2025: ChannelRevenue[] = [
  { channel: "Oficina Produtiva", parts: 199167.2, services: 119002.99, total: 318170.19 },
  { channel: "Funilaria", parts: 66881.67, services: 23566, total: 90447.67 },
  { channel: "Acessórios", parts: 14392.1, services: 18457.9, total: 32850 },
  { channel: "Embelezamento", parts: 0, services: 48709.39, total: 48709.39 },
  { channel: "Balcão", parts: 3632.84, services: 0, total: 3632.84 },
  { channel: "Total", parts: 284073.81, services: 209736.28, total: 493810.09 },
];

const monthlyTrend = [
  { label: "Jan/26", total: 633691.08 },
  { label: "Fev/26", total: 639068.4 },
  { label: "Mar/26", total: 559610.54 },
  { label: "Abr/26", total: 589008.96 },
  { label: "Mai/26", total: 663634.82 },
  { label: "Jun/26", total: 658438.67 },
];

const grossProfitTrend: GrossProfitMonth[] = [
  { label: "Jan", planned: 282264.93, realized: 306966.65, previousYear: 225188.02, margin: 53.89 },
  { label: "Fev", planned: 230405.81, realized: 279127.55, previousYear: 216509.83, margin: 46.84 },
  { label: "Mar", planned: 279191.39, realized: 244476.86, previousYear: 220775.76, margin: 44.97 },
  { label: "Abr", planned: 266895.83, realized: 235579.73, previousYear: 245068.65, margin: 43.8 },
  { label: "Mai", planned: 272944.44, realized: 304937.56, previousYear: 262659.27, margin: 49.72 },
  { label: "Jun", planned: 266895.83, realized: 275505.68, previousYear: 224693.3, margin: 45.17 },
  { label: "Jul", planned: 288244.79, realized: 184033.77, previousYear: 288424.89, margin: 56.32 },
];

const productivityMetrics: ProductivityMetric[] = [
  { label: "Revisões", current: 138, lastYear: 263, type: "number", note: "Base usada para calcular TKM." },
  { label: "TKM serviços", current: 869, lastYear: 682, type: "currency", note: "Serviços totais divididos por revisões." },
  { label: "TKM serv. adicionais", current: 319, lastYear: 171, type: "currency", note: "Adicionais divididos por revisões." },
  { label: "TKM estética", current: 143, lastYear: 178, type: "currency", note: "Embelezamento oficina dividido por revisões." },
  { label: "Oficina produtiva", current: 109600, lastYear: 169230, type: "currency", note: "Mão de obra e serviços da oficina." },
  { label: "Fat. total serviços", current: 155204, lastYear: 274673, type: "currency", note: "Serviços totais do período." },
];

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

function sumRows(field: "shopGoal" | "shopDone" | "beautyGoal" | "beautyDone") {
  return financialRows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
}

function areaSummary(goal: number, done: number, passedDays: number, businessDays: number) {
  const missing = goal - done;
  const dailyAverage = passedDays ? done / passedDays : 0;
  const projection = dailyAverage * businessDays;
  const percent = goal ? (done / goal) * 100 : 0;

  return { goal, done, missing, projection, percent };
}

function getChannel(rows: ChannelRevenue[], channel: ChannelRevenue["channel"]) {
  return rows.find((item) => item.channel === channel);
}

function variation(current: number, previous: number) {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

function isDeliveredToday(vehicle: VehicleFlow) {
  return vehicle.currentLane === "entregue";
}

export default function FarolGerencialPage() {
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadVehicles() {
      setLoading(true);
      setError("");

      try {
        const data = await listActiveVehicleFlows({ includeDelivered: true });
        if (!active) return;
        setVehicles(data);
      } catch (currentError) {
        if (!active) return;
        setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar o farol gerencial.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadVehicles();
    return () => {
      active = false;
    };
  }, []);

  const shop = useMemo(() => areaSummary(160000, sumRows("shopDone"), monthSummary.passedDays, monthSummary.businessDays), []);
  const beauty = useMemo(() => areaSummary(35000, sumRows("beautyDone"), monthSummary.passedDays, monthSummary.businessDays), []);

  const operation = useMemo(() => {
    const delivered = vehicles.filter(isDeliveredToday);
    const onTime = delivered.filter((vehicle) => vehicle.deliveredOnTime).length;

    return [
      { label: "Recebidos", value: vehicles.filter((vehicle) => vehicle.attendanceStartedAt).length },
      { label: "Entregues", value: delivered.length },
      { label: "No-show", value: vehicles.filter((vehicle) => vehicle.noShow).length },
      { label: "Orçamentos", value: vehicles.filter((vehicle) => vehicle.budgetStatus).length },
      { label: "Peças", value: vehicles.filter((vehicle) => vehicle.partsOrdered).length },
      { label: "No prazo", value: delivered.length ? formatPercent((onTime / delivered.length) * 100) : "0%" },
    ];
  }, [vehicles]);

  const monthProgress = (monthSummary.passedDays / monthSummary.businessDays) * 100;
  const currentTotal = getChannel(june2026, "Total");
  const lastYearTotal = getChannel(june2025, "Total");
  const currentGrossProfit = grossProfitTrend.find((item) => item.label === "Jun");

  return (
    <ProtectedPage
      title="Farol Gerencial"
      subtitle="Acompanhamento diário de metas, realizado, projeção e operação."
      manual={manual}
    >
      <main className="page-wrap farol-page">
        {error && <div className="duplicate-alert"><strong>Erro no farol gerencial</strong><span>{error}</span></div>}

        <section className="farol-period-bar">
          <div><span>Mês</span><strong>{monthSummary.month}</strong></div>
          <div><span>Hoje</span><strong>{monthSummary.today}</strong></div>
          <div><span>Dias úteis</span><strong>{monthSummary.businessDays}</strong></div>
          <div><span>Passados</span><strong>{monthSummary.passedDays}</strong></div>
          <div><span>Restantes</span><strong>{monthSummary.remainingDays}</strong></div>
          <div><span>Avanço do mês</span><strong>{formatPercent(monthProgress)}</strong></div>
        </section>

        <section className="farol-main-grid">
          <GoalCard title="Oficina Produtiva" tone="shop" summary={shop} dailyGoal={7273} />
          <GoalCard title="Embelezamento Oficina" tone="beauty" summary={beauty} dailyGoal={1591} />
          <aside className="farol-operation-panel">
            <div className="panel-head">
              <h2 className="panel-title">Operação do Dia</h2>
              <span className="tag good">{loading ? "..." : "ao vivo"}</span>
            </div>
            <div className="farol-operation-grid">
              {operation.map((item) => (
                <div key={item.label}><strong>{loading ? "..." : item.value}</strong><span>{item.label}</span></div>
              ))}
            </div>
            <p className="comment">Cruza o resultado financeiro com o andamento real dos chips no fluxo.</p>
          </aside>
        </section>

        {currentTotal && lastYearTotal && (
          <section className="panel farol-table-panel">
            <div className="panel-head">
              <h2 className="panel-title">Comparativo com a própria operação</h2>
              <span className="tag">Junho 2026 x Junho 2025</span>
            </div>
            <div className="farol-history-grid">
              <ComparisonCard label="Peças" current={currentTotal.parts} previous={lastYearTotal.parts} />
              <ComparisonCard label="Serviços" current={currentTotal.services} previous={lastYearTotal.services} />
              <ComparisonCard label="Faturamento total" current={currentTotal.total} previous={lastYearTotal.total} />
            </div>
            <MiniTrendChart />
          </section>
        )}

        {currentGrossProfit && (
          <section className="panel farol-table-panel">
            <div className="panel-head">
              <h2 className="panel-title">Lucro Bruto PV4R</h2>
              <span className="tag">Competência Junho</span>
            </div>
            <div className="farol-lb-grid">
              <ComparisonCard label="LB realizado" current={currentGrossProfit.realized} previous={currentGrossProfit.previousYear} />
              <article className="farol-comparison-card">
                <span>Meta LB</span>
                <strong>{formatCurrency(currentGrossProfit.planned)}</strong>
                <small>Atingimento</small>
                <b className={currentGrossProfit.realized >= currentGrossProfit.planned ? "good-text" : "bad-text"}>
                  {formatPercent((currentGrossProfit.realized / currentGrossProfit.planned) * 100)}
                </b>
              </article>
              <article className="farol-comparison-card">
                <span>Margem bruta</span>
                <strong>{currentGrossProfit.margin.toFixed(1).replace(".", ",")}%</strong>
                <small>LB sobre receita líquida total</small>
                <b className="good-text">MB</b>
              </article>
              <GrossProfitChart />
            </div>
          </section>
        )}

        <section className="panel farol-table-panel">
          <div className="panel-head">
            <h2 className="panel-title">Faturamento por Canal</h2>
            <span className="tag">Junho 2026</span>
          </div>
          <div className="farol-channel-grid">
            {june2026.filter((item) => item.channel !== "Total").map((item) => {
              const previousMonth = getChannel(may2026, item.channel);
              const lastYear = getChannel(june2025, item.channel);
              const share = currentTotal ? (item.total / currentTotal.total) * 100 : 0;
              const monthDelta = previousMonth ? variation(item.total, previousMonth.total) : 0;
              const yearDelta = lastYear ? variation(item.total, lastYear.total) : 0;

              return (
                <article key={item.channel} className="farol-channel-card">
                  <div className="farol-channel-head">
                    <strong>{item.channel}</strong>
                    <span>{formatPercent(share)}</span>
                  </div>
                  <div className="farol-channel-bar"><i style={{ width: `${Math.max(4, share)}%` }} /></div>
                  <div className="farol-stack-bar" aria-label={`Composição de ${item.channel}`}>
                    <i className="parts" style={{ width: `${item.total ? (item.parts / item.total) * 100 : 0}%` }} />
                    <i className="services" style={{ width: `${item.total ? (item.services / item.total) * 100 : 0}%` }} />
                  </div>
                  <div className="farol-channel-values">
                    <div><span>Peças</span><strong>{formatCurrency(item.parts)}</strong></div>
                    <div><span>Serviços</span><strong>{formatCurrency(item.services)}</strong></div>
                    <div><span>Total</span><strong>{formatCurrency(item.total)}</strong></div>
                  </div>
                  <div className="farol-channel-deltas">
                    <span className={monthDelta >= 0 ? "good-text" : "bad-text"}>Mês: {formatDeltaPercent(monthDelta)}</span>
                    <span className={yearDelta >= 0 ? "good-text" : "bad-text"}>Ano anterior: {formatDeltaPercent(yearDelta)}</span>
                  </div>
                  {previousMonth && lastYear && <MiniSparkline values={[lastYear.total, previousMonth.total, item.total]} />}
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel farol-table-panel">
          <div className="panel-head">
            <h2 className="panel-title">Produtividade e TKM</h2>
            <span className="tag">Julho 2026 x Julho 2025</span>
          </div>
          <div className="farol-productivity-grid">
            {productivityMetrics.map((item) => {
              const delta = variation(item.current, item.lastYear);
              const currentText = item.type === "currency" ? formatCurrency(item.current) : item.current.toLocaleString("pt-BR");
              const previousText = item.type === "currency" ? formatCurrency(item.lastYear) : item.lastYear.toLocaleString("pt-BR");

              return (
                <article key={item.label} className="farol-productivity-card">
                  <span>{item.label}</span>
                  <strong>{currentText}</strong>
                  <small>2025: {previousText}</small>
                  <b className={delta >= 0 ? "good-text" : "bad-text"}>{formatDeltaPercent(delta)}</b>
                  <p>{item.note}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel farol-table-panel">
          <div className="panel-head">
            <h2 className="panel-title">Tabela do Mês</h2>
            <span className="tag">dados demonstrativos</span>
          </div>
          <div className="farol-table-wrap">
            <table className="farol-table">
              <thead>
                <tr>
                  <th>Dia</th><th>Semana</th><th>Meta oficina</th><th>Realizado oficina</th><th>Diferença</th>
                  <th>Meta embelez.</th><th>Real. embelez.</th><th>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {financialRows.map((row) => {
                  const shopDiff = row.shopDone === null ? null : row.shopDone - row.shopGoal;
                  const beautyDiff = row.beautyDone === null ? null : row.beautyDone - row.beautyGoal;

                  return (
                    <tr key={row.day} className={row.special ? `row-${row.special}` : ""}>
                      <td>{row.day}</td><td>{row.weekDay}</td><td>{formatCurrency(row.shopGoal)}</td>
                      <td className={row.shopDone !== null && row.shopDone >= row.shopGoal ? "good-cell" : row.shopDone === null ? "" : "bad-cell"}>{formatCurrency(row.shopDone)}</td>
                      <td className={shopDiff !== null && shopDiff >= 0 ? "good-text" : shopDiff === null ? "" : "bad-text"}>{formatCurrency(shopDiff)}</td>
                      <td>{formatCurrency(row.beautyGoal)}</td>
                      <td className={row.beautyDone !== null && row.beautyDone >= row.beautyGoal ? "good-cell" : row.beautyDone === null ? "" : "bad-cell"}>{formatCurrency(row.beautyDone)}</td>
                      <td className={beautyDiff !== null && beautyDiff >= 0 ? "good-text" : beautyDiff === null ? "" : "bad-text"}>{formatCurrency(beautyDiff)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </ProtectedPage>
  );
}

function GoalCard({
  title,
  tone,
  summary,
  dailyGoal,
}: {
  title: string;
  tone: "shop" | "beauty";
  summary: ReturnType<typeof areaSummary>;
  dailyGoal: number;
}) {
  const color = tone === "shop" ? "#65ad42" : "#3472c7";
  const percent = Math.min(100, summary.percent);

  return (
    <article className={`farol-goal-card ${tone}`}>
      <div className="farol-goal-head">
        <div><span>Meta mensal</span><h2>{title}</h2></div>
        <strong>{formatPercent(summary.percent)}</strong>
      </div>
      <div className="farol-goal-body">
        <div className="farol-donut" style={{ "--value": `${percent * 3.6}deg`, "--accent": color } as CSSProperties}>
          <strong>{formatPercent(summary.percent)}</strong><span>realizado</span>
        </div>
        <div className="farol-money-grid">
          <div><span>Meta mês</span><strong>{formatCurrency(summary.goal)}</strong></div>
          <div><span>Realizado</span><strong>{formatCurrency(summary.done)}</strong></div>
          <div><span>Falta p/ bater</span><strong className={summary.missing <= 0 ? "good-text" : "bad-text"}>{formatCurrency(summary.missing)}</strong></div>
          <div><span>Projeção</span><strong>{formatCurrency(summary.projection)}</strong></div>
          <div><span>Meta dia</span><strong>{formatCurrency(dailyGoal)}</strong></div>
          <div><span>Ritmo</span><strong>{summary.projection >= summary.goal ? "Acima" : "Abaixo"}</strong></div>
        </div>
      </div>
    </article>
  );
}

function ComparisonCard({ label, current, previous }: { label: string; current: number; previous: number }) {
  const delta = variation(current, previous);

  return (
    <article className="farol-comparison-card">
      <span>{label}</span>
      <strong>{formatCurrency(current)}</strong>
      <small>2025: {formatCurrency(previous)}</small>
      <b className={delta >= 0 ? "good-text" : "bad-text"}>{formatDeltaPercent(delta)}</b>
    </article>
  );
}

function MiniTrendChart() {
  const max = Math.max(...monthlyTrend.map((item) => item.total));

  return (
    <div className="farol-mini-chart" aria-label="Evolução mensal do faturamento total em 2026">
      {monthlyTrend.map((item) => (
        <div key={item.label} className="farol-mini-bar">
          <span style={{ height: `${Math.max(8, (item.total / max) * 100)}%` }} />
          <small>{item.label}</small>
          <b>{formatCurrency(item.total)}</b>
        </div>
      ))}
    </div>
  );
}

function GrossProfitChart() {
  const max = Math.max(...grossProfitTrend.flatMap((item) => [item.planned, item.realized]));

  return (
    <div className="farol-lb-chart" aria-label="Lucro bruto planejado, realizado e margem bruta por mês">
      <div className="farol-lb-legend">
        <span><i className="planned" />Planejado</span>
        <span><i className="realized" />Realizado</span>
        <span><i className="margin" />MB %</span>
      </div>
      <div className="farol-lb-bars">
        {grossProfitTrend.map((item) => (
          <div key={item.label} className="farol-lb-month">
            <div className="farol-lb-columns">
              <i className="planned" style={{ height: `${Math.max(8, (item.planned / max) * 100)}%` }} />
              <i className="realized" style={{ height: `${Math.max(8, (item.realized / max) * 100)}%` }} />
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

function MiniSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = 8 + index * 42;
      const y = 34 - ((value - min) / range) * 24;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="farol-sparkline">
      <svg viewBox="0 0 100 40" role="img" aria-label="Tendência: ano anterior, mês anterior e mês atual">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.split(" ").map((point) => {
          const [cx, cy] = point.split(",");
          return <circle key={point} cx={cx} cy={cy} r="3.5" fill="currentColor" />;
        })}
      </svg>
      <span>2025</span><span>Mai</span><span>Jun</span>
    </div>
  );
}
