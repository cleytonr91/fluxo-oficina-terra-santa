import { CardapioCatalog } from "@/components/cardapio-catalog";
import { ProtectedPage } from "@/components/protected-page";

export default function CardapioPage() {
  return (
    <ProtectedPage
      title="Cardápio"
      subtitle="Planos e programas Hyundai disponíveis para consulta de toda a equipe."
    >
      <CardapioCatalog />
    </ProtectedPage>
  );
}
