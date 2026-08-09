"use client";

import { useMemo, useState } from "react";
import careData from "@/data/my-hyundai-care.json";

type CarePlan = (typeof careData.plans)[number];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function MyHyundaiCare() {
  const [family, setFamily] = useState("Todos");
  const [query, setQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState(careData.plans[0]?.model ?? "");

  const families = useMemo(
    () => ["Todos", ...Array.from(new Set(careData.plans.map((plan) => plan.family)))],
    [],
  );

  const filteredPlans = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return careData.plans.filter((plan) => {
      const matchesFamily = family === "Todos" || plan.family === family;
      const matchesQuery = !normalizedQuery || `${plan.model} ${plan.years}`.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      return matchesFamily && matchesQuery;
    });
  }, [family, query]);

  const selectedPlan = (filteredPlans.find((plan) => plan.model === selectedModel) ?? filteredPlans[0]) as CarePlan | undefined;

  function selectFamily(nextFamily: string) {
    setFamily(nextFamily);
    const firstPlan = careData.plans.find((plan) => nextFamily === "Todos" || plan.family === nextFamily);
    if (firstPlan) setSelectedModel(firstPlan.model);
  }

  return (
    <>
      <section className="maintenance-browser manual-page-browser care-browser">
        <aside className="maintenance-sidebar">
          <label className="maintenance-search">
            <span className="sr-only">Buscar modelo ou ano</span>
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar modelo ou ano" />
          </label>

          <div className="maintenance-families" aria-label="Segmentar por modelo">
            <span>Modelos</span>
            {families.map((item) => {
              const count = item === "Todos" ? careData.plans.length : careData.plans.filter((plan) => plan.family === item).length;
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
                onClick={() => setSelectedModel(plan.model)}
              >
                <strong>{plan.model}</strong>
                <small>Ano-modelo {plan.years}</small>
              </button>
            ))}
            {!filteredPlans.length && <p>Nenhum modelo encontrado. Tente outro termo.</p>}
          </div>
        </aside>

        <div className="maintenance-detail care-detail">
          {selectedPlan ? (
            <>
              <div className="maintenance-detail-head care-detail-head">
                <div>
                  <span className="maintenance-family-tag">MY HYUNDAI CARE · {selectedPlan.family}</span>
                  <h2>{selectedPlan.model}</h2>
                  <p>Ano-modelo {selectedPlan.years}</p>
                </div>
                <div className={`care-validity ${selectedPlan.validUntil === "30/06/2026" ? "expired" : ""}`}>
                  <span>Preços válidos até</span>
                  <strong>{selectedPlan.validUntil}</strong>
                </div>
              </div>

              <div className="care-intro">
                <div>
                  <span>Revisões planejadas</span>
                  <h3>Escolha o período do programa</h3>
                  <p>Compare o valor público com o preço especial do My Hyundai Care.</p>
                </div>
                <strong>4 opções</strong>
              </div>

              <div className="care-package-grid">
                {selectedPlan.packages.map((item) => (
                  <article key={item.revisions}>
                    <header>
                      <span>Plano</span>
                      <strong>{item.revisions}</strong>
                    </header>
                    <div className="care-program-price">
                      <span>Preço My Hyundai Care</span>
                      <strong>{money.format(item.programPrice)}</strong>
                    </div>
                    <dl>
                      <div>
                        <dt>Preço público</dt>
                        <dd>{money.format(item.publicPrice)}</dd>
                      </div>
                      <div className="care-saving">
                        <dt>Economia</dt>
                        <dd>{money.format(item.discount)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              {selectedPlan.validUntil === "30/06/2026" && (
                <p className="care-validity-note">
                  Atenção: o documento de origem informa vigência até 30/06/2026 para esta versão.
                </p>
              )}
            </>
          ) : (
            <div className="maintenance-empty">Selecione um modelo para consultar os preços.</div>
          )}
        </div>
      </section>

      <footer className="manual-page-footer">
        <span>Fonte: Tabelas de Preços do Programa · My Hyundai Care</span>
        <span>Vigência geral: <strong>até 31/12/2026</strong></span>
      </footer>
    </>
  );
}
