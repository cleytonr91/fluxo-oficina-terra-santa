import Link from "next/link";
import { ProtectedPage } from "@/components/protected-page";

const modules = [
  ["PreparaÃ§Ã£o", "Chefe de oficina", "Agenda importada, tÃ©cnico, prioridade e teste de rodagem.", "/preparacao"],
  ["Fluxo", "Equipe operacional", "Recebimento, serviÃ§o, orÃ§amento, lavagem e entrega.", "/fluxo"],
  ["Funilaria", "Sinistro", "Processos, aprovações, execução, faturamento e pagamento.", "/funilaria"],
  ["PÃ³s-serviÃ§o", "Qualidade", "Tratativas, pendÃªncias, HGSI e clientes respondidos.", "/pos-servico"],
  ["Farol", "GestÃ£o", "Prazo, volume, no-show, consultores, tÃ©cnicos e NPS.", "/radar"],
];

const activity = [
  ["DANIEL ALMEIDA SANTOS", "QMI8B56", "RevisÃ£o 06 + Recall", "Gilvan", "preparado"],
  ["TATIANA TATIANA", "SUC9B66", "Reparo geral", "Elimarcos", "passante"],
  ["RENATA", "STJ9I62", "PÃ³s-serviÃ§o HGSI", "Eliane", "atenÃ§Ã£o"],
];

export default function Home() {
  return (
    <ProtectedPage
      title="Painel da Oficina"
      subtitle="VisÃ£o inicial do sistema oficial, com os atalhos do fluxo e os prÃ³ximos blocos do MVP."
    >
      <main className="page-wrap">
        <section className="metrics-grid">
          <div className="metric"><strong>0</strong><span>agenda importada</span></div>
          <div className="metric"><strong>0</strong><span>em fluxo hoje</span></div>
          <div className="metric"><strong>0</strong><span>pÃ³s-serviÃ§o aberto</span></div>
          <div className="metric"><strong>4</strong><span>mÃ³dulos oficiais</span></div>
        </section>

        <section className="compact-grid">
          {modules.map(([title, owner, description, href]) => (
            <Link key={href} href={href} className="panel no-underline text-inherit">
              <div className="panel-head">
                <h2 className="panel-title">{title}</h2>
                <span className="tag good">{owner}</span>
              </div>
              <div className="panel-body">
                <p className="comment">{description}</p>
              </div>
            </Link>
          ))}
        </section>

        <section className="mt-4 grid gap-3 lg:grid-cols-[1fr_360px]">
          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Fluxo operacional</h2>
              <span className="tag">modelo visual</span>
            </div>
            <div className="panel-body">
              <div className="kanban">
                {["PreparaÃ§Ã£o", "Fluxo", "PÃ³s-serviÃ§o", "Farol"].map((lane, index) => (
                  <section key={lane} className="lane">
                    <div className="lane-head">
                      <h3 className="lane-title">{lane}</h3>
                      <span className="lane-count">{index === 0 ? 2 : index === 2 ? 1 : 0}</span>
                    </div>
                    <div className="lane-body">
                      {activity
                        .filter((_, itemIndex) => itemIndex === index || (index === 0 && itemIndex === 1))
                        .map(([client, plate, service, owner, status]) => (
                          <article key={`${client}-${lane}`} className={`chip ${status === "atenÃ§Ã£o" ? "atencao" : ""}`}>
                            <div className="chip-top">
                              <div>
                                <h4 className="client">{client}</h4>
                                <p className="model">{service}</p>
                              </div>
                              <span className="plate">{plate}</span>
                            </div>
                            <div className="detail-grid">
                              <div className="detail"><span>ResponsÃ¡vel</span>{owner}</div>
                              <div className="detail"><span>Status</span>{status}</div>
                            </div>
                          </article>
                        ))}
                      {index === 1 || index === 3 ? <p className="empty">Sem itens nesta etapa</p> : null}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>

          <aside className="stack">
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">PrÃ³ximos blocos</h2>
              </div>
              <div className="panel-body stack">
                {[
                  "ImportaÃ§Ã£o real da planilha Excel",
                  "Cadastro controlado de usuÃ¡rios",
                  "PermissÃµes por funÃ§Ã£o",
                  "Chips reais vindos do Firestore",
                ].map((item, index) => (
                  <div key={item} className="detail">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {item}
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </main>
    </ProtectedPage>
  );
}
