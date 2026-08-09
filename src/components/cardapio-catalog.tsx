"use client";

import { useState } from "react";
import { MaintenancePlans } from "@/components/maintenance-plans";
import { MyHyundaiCare } from "@/components/my-hyundai-care";

type CatalogSection = "maintenance" | "care";

export function CardapioCatalog() {
  const [section, setSection] = useState<CatalogSection>("maintenance");

  return (
    <main className="manual-page page-wrap">
      <nav className="cardapio-sections" aria-label="Seções do cardápio">
        <button type="button" className={section === "maintenance" ? "active" : ""} onClick={() => setSection("maintenance")}>
          <span aria-hidden="true">◆</span>
          <div>
            <strong>Planos de manutenção</strong>
            <small>Valores, tempos e itens por revisão</small>
          </div>
        </button>
        <button type="button" className={section === "care" ? "active" : ""} onClick={() => setSection("care")}>
          <span aria-hidden="true">H</span>
          <div>
            <strong>MY HYUNDAI CARE</strong>
            <small>Pacotes de revisões planejadas</small>
          </div>
        </button>
      </nav>

      {section === "maintenance" ? <MaintenancePlans embedded /> : <MyHyundaiCare />}
    </main>
  );
}
