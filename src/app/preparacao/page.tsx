import { ProtectedPage } from "@/components/protected-page";
import { PreparationImport } from "@/components/preparation-import";
import type { ManualContent } from "@/components/operation-manual";

const manual: ManualContent = {
  title: "Manual da Preparação",
  audience: "Uso principal: chefe de oficina",
  objective: "Preparar a agenda do dia seguinte, validar os atendimentos e definir a atuação da oficina antes da chegada dos clientes.",
  steps: [
    "Importe a planilha de agendamento do Syonet.",
    "Confirme a data que será preparada.",
    "Confira cliente, placa, modelo, serviço e observação importada.",
    "Indique o técnico responsável, prioridade e necessidade de teste de rodagem.",
    "Marque se o chefe de oficina precisa ouvir o relato do cliente.",
    "Clique em Confirmar preparação para enviar o veículo ao Fluxo do dia.",
  ],
  rules: [
    "A preparação só migra para o fluxo quando for confirmada.",
    "Duplicidade de chassi deve ser analisada antes de confirmar.",
    "Prioridade deve ser usada apenas como Alta ou Normal.",
    "Observações da agenda devem ser lidas antes de distribuir técnico.",
  ],
  flow: [
    { title: "Importar agenda", text: "Carrega os veículos agendados para o dia escolhido." },
    { title: "Validar dados", text: "Confere serviço, observação, chassi e placa." },
    { title: "Preparar oficina", text: "Define técnico, prioridade e teste de rodagem." },
    { title: "Confirmar", text: "Envia o chip para Agendamento do Dia no fluxo." },
  ],
};

export default function PreparacaoPage() {
  return (
    <ProtectedPage
      title="Preparação do Dia Seguinte"
      subtitle="Importar agenda, conferir serviços e preparar a atuação da oficina antes da recepção."
      manual={manual}
    >
      <PreparationImport />
    </ProtectedPage>
  );
}
