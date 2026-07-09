import { ProtectedPage } from "@/components/protected-page";
import { PreparationImport } from "@/components/preparation-import";

export default function PreparacaoPage() {
  return (
    <ProtectedPage
      title="Preparação do Dia Seguinte"
      subtitle="Importar agenda, conferir serviços e preparar a atuação da oficina antes da recepção."
    >
      <PreparationImport />
    </ProtectedPage>
  );
}
