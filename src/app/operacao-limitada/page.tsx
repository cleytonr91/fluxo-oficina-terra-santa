import { ProtectedPage } from "@/components/protected-page";

export default function LimitedPage() {
  return <ProtectedPage title="Operação limitada"><main className="page-wrap"><p>As páginas do seu perfil estão temporariamente suspensas.</p></main></ProtectedPage>;
}
