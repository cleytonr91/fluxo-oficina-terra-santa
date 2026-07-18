"use client";

import { FormEvent, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { collections } from "@/lib/firebase/collections";
import { getFirebaseDb } from "@/lib/firebase/client";

type PublicPart = {
  id: string;
  partReference?: string;
  partDescription?: string;
};

type PublicPartOrder = {
  id: string;
  plate?: string;
  customerId?: string;
  parts?: PublicPart[];
  partReference?: string;
  partDescription?: string;
  status?: string;
  internalStatus?: string;
  expectedArrivalDate?: string;
  invoiceNumber?: string;
  orderNumber?: string;
  availableForScheduling?: boolean;
};

type PublicLookup = {
  plate?: string;
  customerId?: string;
  orders?: Record<string, PublicPartOrder>;
};

const partsWhatsappNumber = "558440030161";

const statusSteps = [
  "Pedido em análise",
  "Peça solicitada à montadora",
  "Aguardando disponibilidade da montadora",
  "A caminho da concessionária",
  "Peça recebida pela concessionária",
  "Disponível para agendamento",
];

function normalizeLookup(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function formatDate(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function whatsappLink(text: string) {
  return `https://wa.me/${partsWhatsappNumber}?text=${encodeURIComponent(text)}`;
}

function orderParts(order: PublicPartOrder) {
  if (order.parts?.length) return order.parts;
  return [{
    id: order.id,
    partReference: order.partReference,
    partDescription: order.partDescription,
  }];
}

export default function MinhaPecaPage() {
  const [plate, setPlate] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [lookup, setLookup] = useState<PublicLookup | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const orders = useMemo(() => {
    return Object.values(lookup?.orders ?? {})
      .filter((order) => order.internalStatus !== "cancelado")
      .sort((a, b) => Number(Boolean(b.availableForScheduling)) - Number(Boolean(a.availableForScheduling)));
  }, [lookup]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLookup(null);
    setSearched(false);

    const lookupId = `${normalizeLookup(plate)}_${normalizeLookup(customerId)}`;
    if (lookupId === "_") {
      setError("Informe placa e ID Cliente para consultar.");
      return;
    }

    setLoading(true);
    try {
      const snapshot = await getDoc(doc(getFirebaseDb(), collections.publicPartLookups, lookupId));
      setLookup(snapshot.exists() ? snapshot.data() as PublicLookup : null);
      setSearched(true);
    } catch {
      setError("Não foi possível consultar agora. Tente novamente em instantes.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="public-parts-page">
      <section className="public-parts-shell">
        <header className="public-parts-head">
          <span>Terra Santa Hyundai</span>
          <h1>Minha Peça</h1>
          <p>Acompanhe o andamento da sua solicitação usando a placa do veículo e o ID Cliente informado na ordem de serviço.</p>
        </header>

        <form className="public-parts-form" onSubmit={handleSearch}>
          <label>
            <span>Placa do veículo</span>
            <input
              value={plate}
              placeholder="Ex.: RRB7F91"
              onChange={(event) => setPlate(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>ID Cliente</span>
            <input
              value={customerId}
              placeholder="Ex.: 368124"
              onChange={(event) => setCustomerId(event.target.value.toUpperCase())}
            />
          </label>
          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? "Consultando..." : "Consultar peça"}
          </button>
        </form>

        {error && <div className="public-parts-alert bad">{error}</div>}

        {searched && !orders.length && !error && (
          <div className="public-parts-alert">
            Nenhum pedido foi encontrado para os dados informados. Confira placa e ID Cliente ou fale com o setor de peças.
          </div>
        )}

        {orders.length > 0 && (
          <section className="public-parts-results">
            {orders.map((order) => {
              const currentStep = Math.max(0, statusSteps.indexOf(order.status || "Pedido em análise"));
              const available = Boolean(order.availableForScheduling);
              const message = `Olá, gostaria de solicitar agendamento para a peça disponível. Placa: ${plate}. ID Cliente: ${customerId}.`;

              return (
                <article key={order.id} className={`public-part-card ${available ? "available" : ""}`}>
                  <div className="public-part-card-head">
                    <div>
                      <strong>{order.status || "Pedido em análise"}</strong>
                      <span>Previsão: {formatDate(order.expectedArrivalDate)}</span>
                    </div>
                    {available && <b>Disponível</b>}
                  </div>

                  <div className="public-part-list">
                    {orderParts(order).map((part) => (
                      <div key={part.id || `${part.partReference}-${part.partDescription}`} className="public-part-item">
                        <span>{part.partReference || "-"}</span>
                        <strong>{part.partDescription || "Peça em acompanhamento"}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="public-timeline">
                    {statusSteps.map((step, index) => (
                      <div key={step} className={index <= currentStep ? "done" : ""}>
                        <i />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>

                  <div className="public-parts-actions">
                    {available && (
                      <a className="primary-btn" href={whatsappLink(message)} target="_blank" rel="noreferrer">
                        Solicitar agendamento
                      </a>
                    )}
                    <a
                      className="ghost-btn"
                      href={whatsappLink(`Olá, tenho uma dúvida sobre minha peça. Placa: ${plate}. ID Cliente: ${customerId}.`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Tire sua dúvida
                    </a>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </section>
    </main>
  );
}
