"use client";

import { useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { listActiveVehicleFlows } from "@/services/firestore";
import type { VehicleFlow } from "@/types/domain";

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

  const indicators = useMemo(() => {
    const delivered = vehicles.filter((vehicle) => vehicle.currentLane === "entregue");
    const onTime = delivered.filter((vehicle) => vehicle.deliveredOnTime).length;
    const npsValues = delivered.map((vehicle) => vehicle.internalNps).filter((value): value is number => typeof value === "number");
    const nps = npsValues.length ? Math.round(npsValues.reduce((sum, value) => sum + value, 0) / npsValues.length) : 0;
    const attention = vehicles.filter((vehicle) => vehicle.priority === "alta" || vehicle.customerWaits || vehicle.deliveredOnTime === false || vehicle.partsOrdered).length;
    const consultants = new Set(vehicles.map((vehicle) => vehicle.consultantName).filter(Boolean));

    return [
      ["Recebidos por consultor", String(consultants.size ? Math.round(vehicles.length / consultants.size) : 0), "Média de veículos no fluxo por consultor"],
      ["Entregas no prazo", delivered.length ? `${Math.round((onTime / delivered.length) * 100)}%` : "0%", "Promessa cumprida dentro do horário combinado"],
      ["No-show", String(vehicles.filter((vehicle) => vehicle.noShow).length), "Agendamentos preparados sem comparecimento"],
      ["Clientes em atenção", String(attention), "Casos com alerta para atuação rápida"],
      ["NPS interno", String(nps), "Termômetro informado na entrega"],
      ["Entregues", String(delivered.length), "Veículos concluídos no período carregado"],
    ];
  }, [vehicles]);

  return (
    <ProtectedPage
      title="Farol Gerencial"
      subtitle="Indicadores para enxergar volume, prazo, gargalos, satisfação e atuação por área."
    >
      <main className="page-wrap">
        {error && <div className="duplicate-alert"><strong>Erro no farol gerencial</strong><span>{error}</span></div>}

        <section className="metrics-grid">
          {indicators.map(([label, value]) => (
            <div key={label} className="metric">
              <strong>{loading ? "..." : value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </section>

        <section className="compact-grid">
          {indicators.map(([label, value, description]) => (
            <article key={label} className="panel">
              <div className="panel-head">
                <h2 className="panel-title">{label}</h2>
                <span className="tag good">{loading ? "..." : value}</span>
              </div>
              <div className="panel-body">
                <p className="comment">{description}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf0ec]">
                  <div className="h-full rounded-full bg-[#2f7d55]" style={{ width: label === "No-show" ? "22%" : "76%" }} />
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>
    </ProtectedPage>
  );
}
