"use client";

import { useState } from "react";

export type ManualFlowStep = {
  title: string;
  text: string;
};

export type ManualContent = {
  title: string;
  audience: string;
  objective: string;
  steps: string[];
  rules: string[];
  flow: ManualFlowStep[];
};

export function OperationManual({ manual }: { manual: ManualContent }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="ghost-btn" onClick={() => setOpen(true)}>
        Manual
      </button>

      {open && (
        <div className="modal-backdrop" role="presentation">
          <section className="flow-modal manual-modal" role="dialog" aria-modal="true" aria-label={manual.title}>
            <div className="modal-head">
              <div>
                <strong>{manual.title}</strong>
                <span>{manual.audience}</span>
              </div>
              <button type="button" className="ghost-btn icon-btn" aria-label="Fechar" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            <section className="manual-section">
              <h3>Objetivo</h3>
              <p>{manual.objective}</p>
            </section>

            <section className="manual-section">
              <h3>Passo a passo</h3>
              <ol>
                {manual.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>

            <section className="manual-section">
              <h3>Regras importantes</h3>
              <ul>
                {manual.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </section>

            <section className="manual-section">
              <h3>Fluxograma</h3>
              <div className="manual-flow">
                {manual.flow.map((step, index) => (
                  <div key={step.title} className="manual-flow-step">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step.title}</strong>
                    <p>{step.text}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="modal-actions">
              <button type="button" className="primary-btn" onClick={() => setOpen(false)}>
                Entendi
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
