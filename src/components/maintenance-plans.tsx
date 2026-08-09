"use client";

import { useMemo, useState } from "react";
import maintenanceData from "@/data/maintenance-plans.json";

type MaintenancePlan = (typeof maintenanceData.plans)[number];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function yearRange(years: number[]) {
  if (!years.length) return "Ano não informado";
  return years.length === 1 ? String(years[0]) : `${years[0]}–${years.at(-1)}`;
}

export function MaintenancePlans({ embedded = false }: { embedded?: boolean }) {
  const [family, setFamily] = useState("Todos");
  const [query, setQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState(maintenanceData.plans[0]?.model ?? "");
  const [revision, setRevision] = useState(0);

  const families = useMemo(
    () => ["Todos", ...Array.from(new Set(maintenanceData.plans.map((plan) => plan.family)))],
    [],
  );

  const filteredPlans = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return maintenanceData.plans.filter((plan) => {
      const matchesFamily = family === "Todos" || plan.family === family;
      const matchesQuery = !normalizedQuery || `${plan.model} ${plan.years.join(" ")}`.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      return matchesFamily && matchesQuery;
    });
  }, [family, query]);

  const selectedPlan = (filteredPlans.find((plan) => plan.model === selectedModel) ?? filteredPlans[0]) as MaintenancePlan | undefined;
  const includedItems = selectedPlan?.items.filter((item) => item.revisions[revision]) ?? [];

  function selectPlan(plan: MaintenancePlan) {
    setSelectedModel(plan.model);
    setRevision(0);
  }

  function selectFamily(nextFamily: string) {
    setFamily(nextFamily);
    const firstPlan = maintenanceData.plans.find((plan) => nextFamily === "Todos" || plan.family === nextFamily);
    if (firstPlan) selectPlan(firstPlan);
  }

  const content = (
    <>
      <section className="maintenance-browser manual-page-browser">
        <aside className="maintenance-sidebar">
          <label className="maintenance-search">
            <span className="sr-only">Buscar modelo ou ano</span>
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar modelo ou ano" />
          </label>

          <div className="maintenance-families" aria-label="Segmentar por modelo">
            <span>Modelos</span>
            {families.map((item) => {
              const count = item === "Todos" ? maintenanceData.plans.length : maintenanceData.plans.filter((plan) => plan.family === item).length;
              return (
                <button type="button" key={item} className={family === item ? "active" : ""} onClick={() => selectFamily(item)}>
                  <span>{item}</span>
                  <small>{count}</small>
                </button>
              );
            })}
          </div>

          <div className="maintenance-model-list">
            <span>{filteredPlans.length} {filteredPlans.length === 1 ? "versão encontrada" : "versões encontradas"}</span>
            {filteredPlans.map((plan) => (
              <button
                type="button"
                key={plan.model}
                className={selectedPlan?.model === plan.model ? "active" : ""}
                onClick={() => selectPlan(plan)}
              >
                <strong>{plan.model}</strong>
                <small>{yearRange(plan.years)}</small>
              </button>
            ))}
            {!filteredPlans.length && <p>Nenhum modelo encontrado. Tente outro termo.</p>}
          </div>
        </aside>

        <div className="maintenance-detail">
          {selectedPlan ? (
            <>
              <div className="maintenance-detail-head">
                <div>
                  <span className="maintenance-family-tag">{selectedPlan.family}</span>
                  <h2>{selectedPlan.model}</h2>
                  <p>Anos-modelo {yearRange(selectedPlan.years)}</p>
                </div>
              </div>

              <section className="revision-picker" aria-label="Selecionar revisão">
                <div>
                  <span>Escolha a revisão</span>
                  <small>Intervalos de 10.000 km</small>
                </div>
                <div className="revision-options">
                  {selectedPlan.totals.map((total, index) => (
                    <button type="button" key={index} className={revision === index ? "active" : ""} onClick={() => setRevision(index)}>
                      <span>{index + 1}ª</span>
                      <small>{(index + 1) * 10} mil km</small>
                      <strong>{total == null ? "—" : money.format(total)}</strong>
                    </button>
                  ))}
                </div>
              </section>

              <div className="maintenance-summary">
                <div className="maintenance-price-card">
                  <span>Valor total da {revision + 1}ª revisão</span>
                  <strong>{selectedPlan.totals[revision] == null ? "Consulte" : money.format(selectedPlan.totals[revision])}</strong>
                  <small>Peças, mão de obra e lavagem cortesia</small>
                </div>
                <div>
                  <span>Tempo de operação</span>
                  <strong>{selectedPlan.operationTimes[revision] || "—"}</strong>
                </div>
                <div>
                  <span>Itens substituídos</span>
                  <strong>{includedItems.length}</strong>
                </div>
              </div>

              <section className="maintenance-items">
                <div className="maintenance-section-title">
                  <div>
                    <span>Incluso no plano</span>
                    <h3>Itens substituídos</h3>
                  </div>
                  <small>{revision + 1}ª revisão · {(revision + 1) * 10}.000 km</small>
                </div>
                <div className="maintenance-item-grid">
                  {includedItems.map((item) => (
                    <article key={`${item.name}-${item.partNumber}`}>
                      <span className="maintenance-check" aria-hidden="true">✓</span>
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {item.partNumber && <>PN {item.partNumber} · </>}
                          Quantidade {item.quantity ?? "—"}
                        </p>
                      </div>
                      {item.unitPrice != null && <small>{money.format(item.unitPrice)} / un.</small>}
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="maintenance-empty">Selecione um modelo para consultar o plano.</div>
          )}
        </div>
      </section>

      <footer className="manual-page-footer">
        <span>Fonte: Planos de Manutenção Hyundai · Jul–Dez 2026</span>
        <span>Vigência dos valores: <strong>01/07 a 31/12/2026</strong></span>
      </footer>
    </>
  );

  return embedded ? content : <main className="manual-page page-wrap">{content}</main>;
}
