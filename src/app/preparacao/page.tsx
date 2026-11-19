import { ProtectedPage } from "@/components/protected-page";
import { PreparationWorkspace } from "@/components/preparation-workspace";


export default function PreparacaoPage() {
  return (
    <ProtectedPage
      title="Preparação"
      subtitle="Oficina, garantia e separação de peças para o próximo dia."
    >
      <PreparationWorkspace />
    </ProtectedPage>
  );
}
