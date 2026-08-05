"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { downloadRoadTestPdf } from "@/lib/road-test-pdf";
import type { RoadTestFormData, RoadTestSection, VehicleFlow } from "@/types/domain";

type SectionKey = "reception" | "internal" | "quality" | "delivery";

const sectionTabs: Array<{ id: SectionKey; label: string; shortLabel: string }> = [
  { id: "reception", label: "Teste na recepção", shortLabel: "Recepção" },
  { id: "internal", label: "Direcionamento ao técnico", shortLabel: "Direcionamento" },
  { id: "quality", label: "Controle de qualidade", shortLabel: "Qualidade" },
  { id: "delivery", label: "Teste de saída", shortLabel: "Saída" },
];

function emptySection(performedBy = ""): RoadTestSection {
  return {
    date: "",
    kmOut: "",
    kmIn: "",
    departureTime: "",
    arrivalTime: "",
    impressions: ["", ""],
    performedBy,
    accompaniedByClient: false,
    clientSignatureDataUrl: "",
  };
}

function initialForm(vehicle: VehicleFlow): RoadTestFormData {
  const technician = vehicle.technicianName ?? "";
  const existing = vehicle.roadTestForm;

  return {
    serviceOrder: existing?.serviceOrder ?? "",
    clientRequests: existing?.clientRequests ?? [vehicle.importedNotes ?? vehicle.receiveNote ?? "", ""],
    reception: { ...emptySection(technician), ...existing?.reception },
    internal: { ...emptySection(technician), ...existing?.internal },
    quality: { ...emptySection(), ...existing?.quality },
    delivery: { ...emptySection(technician), ...existing?.delivery },
    updatedBy: existing?.updatedBy,
    updatedAt: existing?.updatedAt,
  };
}

function SignaturePad({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function prepareCanvas() {
      const target = canvasRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      target.width = Math.max(Math.round(rect.width * ratio), 1);
      target.height = Math.max(Math.round(rect.height * ratio), 1);
      const context = target.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.2;
      context.strokeStyle = "#132b4f";

      if (value) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = value;
      }
    }

    prepareCanvas();
    const observer = new ResizeObserver(prepareCanvas);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [value]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.setPointerCapture(event.pointerId);
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
    drawingRef.current = true;
  }

  function draw(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
  }

  function finishDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !drawingRef.current) return;
    drawingRef.current = false;
    canvas.releasePointerCapture(event.pointerId);
    onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="signature-box">
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        aria-label="Área para assinatura do cliente"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
      />
      <button type="button" className="ghost-btn signature-clear-btn" onClick={clear}>Limpar assinatura</button>
    </div>
  );
}

export function RoadTestFormModal({
  vehicle,
  onClose,
  onSave,
}: {
  vehicle: VehicleFlow;
  onClose: () => void;
  onSave: (form: RoadTestFormData) => Promise<void>;
}) {
  const [form, setForm] = useState(() => initialForm(vehicle));
  const [activeSection, setActiveSection] = useState<SectionKey>("reception");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const section = form[activeSection];
  const showsClient = activeSection === "reception" || activeSection === "delivery";

  function updateSection(patch: Partial<RoadTestSection>) {
    setForm((current) => ({
      ...current,
      [activeSection]: { ...current[activeSection], ...patch },
    }));
  }

  function updateImpression(index: 0 | 1, value: string) {
    const impressions: [string, string] = [...section.impressions];
    impressions[index] = value;
    updateSection({ impressions });
  }

  function updateClientRequest(index: 0 | 1, value: string) {
    const clientRequests: [string, string] = [...form.clientRequests];
    clientRequests[index] = value;
    setForm((current) => ({ ...current, clientRequests }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await onSave(form);
      setMessage("Ficha salva no chip.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar a ficha.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function exportPdf() {
    setExporting(true);
    setMessage("");
    try {
      await onSave(form);
      await downloadRoadTestPdf(vehicle, form);
      setMessage("PDF gerado com os dados atuais.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível gerar o PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="modal-backdrop road-test-backdrop" role="presentation">
      <section className="flow-modal road-test-modal" role="dialog" aria-modal="true" aria-label="Ficha de teste de rodagem">
        <div className="modal-head">
          <div>
            <strong>Ficha de Teste de Rodagem</strong>
            <span>{vehicle.clientName} · {vehicle.plate?.startsWith("SEMPLACA") ? "Sem placa" : vehicle.plate}</span>
          </div>
          <button type="button" className="ghost-btn icon-btn" aria-label="Fechar ficha" onClick={onClose}>×</button>
        </div>

        <div className="road-test-summary">
          <div><span>Cliente</span><strong>{vehicle.clientName || "-"}</strong></div>
          <div><span>Placa</span><strong>{vehicle.plate?.startsWith("SEMPLACA") ? "-" : vehicle.plate || "-"}</strong></div>
          <div><span>Veículo</span><strong>{vehicle.model || "-"}</strong></div>
          <div><span>Chassi</span><strong>{vehicle.chassi || "-"}</strong></div>
          <label className="field road-test-order-field">
            <span>Nº da O.S.</span>
            <input value={form.serviceOrder} placeholder="Informar O.S." onChange={(event) => setForm((current) => ({ ...current, serviceOrder: event.target.value.toUpperCase() }))} />
          </label>
        </div>

        <div className="road-test-tabs" role="tablist" aria-label="Etapas do teste de rodagem">
          {sectionTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeSection === tab.id}
              className={activeSection === tab.id ? "active" : ""}
              onClick={() => setActiveSection(tab.id)}
              title={tab.label}
            >
              {tab.shortLabel}
            </button>
          ))}
        </div>

        <div className="road-test-scroll">
          {activeSection === "reception" && (
            <section className="road-test-section">
              <h3>Solicitação do cliente</h3>
              {[0, 1].map((index) => (
                <label key={index} className="field">
                  <span>Relato {index + 1}</span>
                  <textarea value={form.clientRequests[index as 0 | 1]} onChange={(event) => updateClientRequest(index as 0 | 1, event.target.value)} />
                </label>
              ))}
            </section>
          )}

          <section className="road-test-section">
            <h3>{sectionTabs.find((tab) => tab.id === activeSection)?.label}</h3>
            <div className="road-test-trip-grid">
              <label className="field"><span>Data</span><input type="date" value={section.date} onChange={(event) => updateSection({ date: event.target.value })} /></label>
              <label className="field"><span>KM saída</span><input inputMode="numeric" value={section.kmOut} onChange={(event) => updateSection({ kmOut: event.target.value.replace(/[^0-9.,]/g, "") })} /></label>
              <label className="field"><span>KM chegada</span><input inputMode="numeric" value={section.kmIn} onChange={(event) => updateSection({ kmIn: event.target.value.replace(/[^0-9.,]/g, "") })} /></label>
              <label className="field"><span>Hora saída</span><input type="time" value={section.departureTime} onChange={(event) => updateSection({ departureTime: event.target.value })} /></label>
              <label className="field"><span>Hora chegada</span><input type="time" value={section.arrivalTime} onChange={(event) => updateSection({ arrivalTime: event.target.value })} /></label>
            </div>

            <div className="road-test-impressions">
              {[0, 1].map((index) => (
                <label key={index} className="field">
                  <span>Impressão do teste {index + 1}</span>
                  <textarea value={section.impressions[index as 0 | 1]} onChange={(event) => updateImpression(index as 0 | 1, event.target.value)} />
                </label>
              ))}
            </div>

            <label className="field">
              <span>Realizado por</span>
              <input value={section.performedBy} onChange={(event) => updateSection({ performedBy: event.target.value })} />
            </label>

            {showsClient && (
              <div className="road-test-client-signature">
                <label className="modal-check">
                  <input type="checkbox" checked={Boolean(section.accompaniedByClient)} onChange={(event) => updateSection({ accompaniedByClient: event.target.checked })} />
                  Cliente acompanhou o teste
                </label>
                <div>
                  <span className="field-label">Assinatura do cliente</span>
                  <SignaturePad
                    value={section.clientSignatureDataUrl}
                    onChange={(clientSignatureDataUrl) => updateSection({
                      clientSignatureDataUrl,
                      clientSignedAt: clientSignatureDataUrl ? new Date().toISOString() : undefined,
                    })}
                  />
                  <small>Assinatura eletrônica presencial vinculada a este atendimento.</small>
                </div>
              </div>
            )}
          </section>
        </div>

        {message && <p className="road-test-message" role="status">{message}</p>}

        <div className="modal-actions road-test-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>Fechar</button>
          <button type="button" className="ghost-btn" disabled={saving || exporting} onClick={save}>{saving ? "Salvando..." : "Salvar ficha"}</button>
          <button type="button" className="primary-btn" disabled={saving || exporting} onClick={exportPdf}>{exporting ? "Gerando..." : "Exportar PDF"}</button>
        </div>
      </section>
    </div>
  );
}
