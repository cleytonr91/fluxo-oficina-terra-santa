import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";

export function ProtectedPage({
  title,
  subtitle,
  headerStatus,
  children,
}: {
  title: string;
  subtitle?: string;
  headerStatus?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthGate>
      <div className="app-shell">
        <AppHeader title={title} subtitle={subtitle} status={headerStatus} />
        {children}
      </div>
    </AuthGate>
  );
}
