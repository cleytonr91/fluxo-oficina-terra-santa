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

const monthSummary = {
  month: "Julho",
  today: "20/07/2026",
  businessDays: 22,
  passedDays: 14,
  remainingDays: 8,
  saturdayQty: 4,
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

  return (
    <ProtectedPage
      title="Farol Gerencial"
      subtitle="Acompanhamento diário de metas, realizado, projeção e operação."
      manual={manual}
    >
      <main className="page-wrap farol-page">
        {error && <div className="duplicate-alert"><strong>Erro no farol gerencial</strong><span>{error}</span></div>}

        <section className="farol-period-bar">
          <div>
            <span>Mês</span>
            <strong>{monthSummary.month}</strong>
          </div>
          <div>
            <span>Hoje</span>
            <strong>{monthSummary.today}</strong>
          </div>
          <div>
            <span>Dias úteis</span>
            <strong>{monthSummary.businessDays}</strong>
          </div>
          <div>
            <span>Passados</span>
            <strong>{monthSummary.passedDays}</strong>
          </div>
          <div>
            <span>Restantes</span>
            <strong>{monthSummary.remainingDays}</strong>
          </div>
          <div>
            <span>Avanço do mês</span>
            <strong>{formatPercent(monthProgress)}</strong>
          </div>
        </section>

        <section className="farol-main-grid">
          <GoalCard
            title="Oficina Produtiva"
            tone="shop"
            summary={shop}
            dailyGoal={7273}
          />
          <GoalCard
            title="Embelezamento Oficina"
            tone="beauty"
            summary={beauty}
            dailyGoal={1591}
          />
          <aside className="farol-operation-panel">
            <div className="panel-head">
              <h2 className="panel-title">Operação do Dia</h2>
              <span className="tag good">{loading ? "..." : "ao vivo"}</span>
            </div>
            <div className="farol-operation-grid">
              {operation.map((item) => (
                <div key={item.label}>
                  <strong>{loading ? "..." : item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <p className="comment">Cruza o resultado financeiro com o andamento real dos chips no fluxo.</p>
          </aside>
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
                  <th>Dia</th>
                  <th>Semana</th>
                  <th>Meta oficina</th>
                  <th>Realizado oficina</th>
                  <th>Diferença</th>
                  <th>Meta embelez.</th>
                  <th>Real. embelez.</th>
                  <th>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {financialRows.map((row) => {
                  const shopDiff = row.shopDone === null ? null : row.shopDone - row.shopGoal;
                  const beautyDiff = row.beautyDone === null ? null : row.beautyDone - row.beautyGoal;

                  return (
                    <tr key={row.day} className={row.special ? `row-${row.special}` : ""}>
                      <td>{row.day}</td>
                      <td>{row.weekDay}</td>
                      <td>{formatCurrency(row.shopGoal)}</td>
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
        <div>
          <span>Meta mensal</span>
          <h2>{title}</h2>
        </div>
        <strong>{formatPercent(summary.percent)}</strong>
      </div>

      <div className="farol-goal-body">
        <div
          className="farol-donut"
          style={{ "--value": `${percent * 3.6}deg`, "--accent": color } as CSSProperties}
        >
          <strong>{formatPercent(summary.percent)}</strong>
          <span>realizado</span>
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
