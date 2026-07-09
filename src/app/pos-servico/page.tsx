"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ProtectedPage } from "@/components/protected-page";
import { listActiveVehicleFlows } from "@/services/firestore";
import type { VehicleFlow } from "@/types/domain";

const lanes = [
  "Solicitar resposta da pesquisa HGSI",
  "Tratar antes da pesquisa",
  "Pendência acordada",
  "Não solicitar pesquisa",
  "Clientes que já responderam",
];

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

function parseRows(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
  });
}

function postLane(vehicle: VehicleFlow) {
  if (typeof vehicle.internalNps === "number" && vehicle.internalNps >= 9 && vehicle.deliveredOnTime && !vehicle.partsOrdered && !vehicle.futureNote) {
    return "Solicitar resposta da pesquisa HGSI";
  }

  if (vehicle.partsOrdered || vehicle.futureNote) return "Pendência acordada";
  if (vehicle.deliveredOnTime === false || (typeof vehicle.internalNps === "number" && vehicle.internalNps <= 7)) return "Tratar antes da pesquisa";
  return "Solicitar resposta da pesquisa HGSI";
}

function whatsappUrl(phone?: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}`;
}

export default function PosServicoPage() {
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [hgsiRecords, setHgsiRecords] = useState<HgsiRecordImport[]>([]);
  const [hgsiAnswers, setHgsiAnswers] = useState<HgsiAnswerImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDelivered() {
      setLoading(true);
      setError("");

      try {
        const data = await listActiveVehicleFlows();
        if (!active) return;
        setVehicles(data.filter((vehicle) => vehicle.currentLane === "entregue"));
      } catch (currentError) {
        if (!active) return;
        setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar o pós-serviço.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDelivered();
    return () => {
      active = false;
    };
  }, []);

  const consultantStats = useMemo(() => {
    const grouped = new Map<string, VehicleFlow[]>();
    vehicles.forEach((vehicle) => {
      const consultant = vehicle.consultantName || "Sem consultor";
      grouped.set(consultant, [...(grouped.get(consultant) ?? []), vehicle]);
    });

    return Array.from(grouped.entries()).map(([consultant, items]) => {
      const npsValues = items.map((item) => item.internalNps).filter((value): value is number => typeof value === "number");
      const nps = npsValues.length ? Math.round(npsValues.reduce((sum, value) => sum + value, 0) / npsValues.length) : 0;
      const onTime = items.filter((item) => item.deliveredOnTime).length;

      return {
        consultant,
        answered: items.length,
        nps,
        onTime,
      };
    });
  }, [vehicles]);

  const validChassis = useMemo(() => {
    return new Set(hgsiRecords.filter((record) => record.valid).map((record) => record.chassi).filter(Boolean));
  }, [hgsiRecords]);

  const answeredChassis = useMemo(() => {
    return new Set(hgsiAnswers.map((answer) => answer.chassi).filter(Boolean));
  }, [hgsiAnswers]);

  async function importHgsiRecords(file?: File) {
    if (!file) return;

    try {
      const rows = await parseRows(file);
      setHgsiRecords(rows.map((row) => {
        const status = String(findColumn(row, ["status", "registro"]));
        const chassi = String(findColumn(row, ["chassi", "vin"])).trim().toUpperCase();
        const osNumber = String(findColumn(row, ["o.s", "os", "ordem"])).trim();

        return {
          chassi,
          osNumber,
          status,
          valid: normalizeText(status).includes("valido"),
        };
      }));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível ler a planilha de status HGSI.");
    }
  }

  async function importHgsiAnswers(file?: File) {
    if (!file) return;

    try {
      const rows = await parseRows(file);
      setHgsiAnswers(rows.map((row) => {
        const chassi = String(findColumn(row, ["chassi", "vin"])).trim().toUpperCase();
        const osNumber = String(findColumn(row, ["o.s", "os", "ordem"])).trim();
        const npsValue = Number(findColumn(row, ["nps", "nota"]));

        return {
          chassi,
          osNumber,
          nps: Number.isFinite(npsValue) ? npsValue : undefined,
          raw: row,
        };
      }));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível ler a planilha de respostas HGSI.");
    }
  }

  return (
    <ProtectedPage
      title="Pós-serviço HGSI"
      subtitle="Clientes entregues, tratativas, pendências e preparação para pesquisa."
    >
      <main className="page-wrap">
        <section className="metrics-grid">
          <div className="metric"><strong>{vehicles.length}</strong><span>veículos entregues</span></div>
          <div className="metric"><strong>{vehicles.filter((item) => postLane(item) === "Solicitar resposta da pesquisa HGSI").length}</strong><span>solicitar HGSI</span></div>
          <div className="metric"><strong>{vehicles.filter((item) => postLane(item) === "Tratar antes da pesquisa").length}</strong><span>tratar antes</span></div>
          <div className="metric"><strong>15</strong><span>meta por consultor</span></div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Importações HGSI</h2>
            <span className="tag">{hgsiRecords.length + hgsiAnswers.length}</span>
          </div>
          <div className="panel-body import-row">
            <label className="file-button">
              <input accept=".xls,.xlsx" type="file" onChange={(event) => importHgsiRecords(event.target.files?.[0])} />
              <strong>Status de registros HGSI</strong>
              <span>{hgsiRecords.length} registro(s)</span>
            </label>
            <label className="file-button">
              <input accept=".xls,.xlsx" type="file" onChange={(event) => importHgsiAnswers(event.target.files?.[0])} />
              <strong>Respostas HGSI</strong>
              <span>{hgsiAnswers.length} resposta(s)</span>
            </label>
          </div>
        </section>

        {error && <div className="duplicate-alert"><strong>Erro no pós-serviço</strong><span>{error}</span></div>}

        <section className="grid gap-3 xl:grid-cols-[1fr_380px]">
          <div className="kanban">
            {lanes.map((lane) => {
              const laneVehicles = vehicles.filter((vehicle) => {
                const chassi = (vehicle.chassi ?? "").toUpperCase();
                const answered = answeredChassis.has(chassi);
                if (lane === "Clientes que já responderam") return answered;
                if (answered) return false;
                if (lane === "Não solicitar pesquisa") return hgsiRecords.length > 0 && !validChassis.has(chassi);
                return postLane(vehicle) === lane;
              });

              return (
                <section key={lane} className="lane">
                  <div className="lane-head">
                    <h2 className="lane-title">{lane}</h2>
                    <span className="lane-count">{laneVehicles.length}</span>
                  </div>
                  <div className="lane-body">
                    {loading ? (
                      <p className="empty">Carregando clientes...</p>
                    ) : laneVehicles.length ? laneVehicles.map((vehicle) => (
                      <article key={vehicle.id} className={`chip ${postLane(vehicle) === "Tratar antes da pesquisa" ? "atencao" : ""}`}>
                        <div className="chip-top">
                          <div>
                            {whatsappUrl(vehicle.phone) ? (
                              <a className="client client-link" href={whatsappUrl(vehicle.phone)} target="_blank" rel="noreferrer">
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
                          <div className="detail"><span>Consultor</span>{vehicle.consultantName ?? "-"}</div>
                          <div className="detail"><span>Serviço</span>{vehicle.serviceLabel ?? "-"}</div>
                          <div className="detail"><span>NPS interno</span>{vehicle.internalNps ?? "-"}</div>
                          <div className="detail"><span>Prazo</span>{vehicle.deliveredOnTime ? "No prazo" : "Fora do prazo"}</div>
                        </div>
                        <div className="tag-row">
                          {vehicle.partsOrdered && <span className="tag warn">Pedido de peça</span>}
                          {vehicle.futureNote && <span className="tag bad">Observação futura</span>}
                          {validChassis.has((vehicle.chassi ?? "").toUpperCase()) && <span className="tag good">Registro válido</span>}
                          {answeredChassis.has((vehicle.chassi ?? "").toUpperCase()) && <span className="tag">Respondido HGSI</span>}
                          {!vehicle.partsOrdered && !vehicle.futureNote && <span className="tag good">Sem pendência</span>}
                        </div>
                      </article>
                    )) : (
                      <p className="empty">Sem clientes neste bolsão</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          <aside className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Pesquisas respondidas por consultor</h2>
            </div>
            <div className="panel-body stack">
              {consultantStats.length ? consultantStats.map((item) => (
                <article key={item.consultant} className="chip">
                  <div className="chip-top">
                    <h3 className="client">{item.consultant}</h3>
                    <span className="plate">{item.answered}/15</span>
                  </div>
                  <div className="detail-grid">
                    <div className="detail"><span>NPS</span>{item.nps}</div>
                    <div className="detail"><span>Prazos</span>{item.onTime}/{item.answered}</div>
                    <div className="detail"><span>Serviço correto</span>-</div>
                    <div className="detail"><span>Lavagem</span>-</div>
                  </div>
                </article>
              )) : (
                <p className="empty">Sem entregas registradas.</p>
              )}
            </div>
          </aside>
        </section>
      </main>
    </ProtectedPage>
  );
}
