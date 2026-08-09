import { MaintenancePlans } from "@/components/maintenance-plans";
import { ProtectedPage } from "@/components/protected-page";

export default function CardapioPage() {
  return (
    <ProtectedPage
      title="Cardápio"
      subtitle="Planos de manutenção disponíveis para consulta de toda a equipe."
    >
      <MaintenancePlans />
    </ProtectedPage>
  );
}
