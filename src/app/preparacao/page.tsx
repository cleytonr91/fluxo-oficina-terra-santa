import { ProtectedPage } from "@/components/protected-page";
import { PreparationImport } from "@/components/preparation-import";


export default function PreparacaoPage() {
  return (
    <ProtectedPage
      title="Preparação"
      subtitle="Agenda e inclusão de veículos no fluxo."
    >
      <PreparationImport />
    </ProtectedPage>
  );
}
