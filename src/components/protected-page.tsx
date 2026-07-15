import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import type { ManualContent } from "@/components/operation-manual";

export function ProtectedPage({
  title,
  subtitle,
  manual,
  children,
}: {
  title: string;
  subtitle?: string;
  manual?: ManualContent;
  children: ReactNode;
}) {
  return (
    <AuthGate>
      <div className="app-shell">
        <AppHeader title={title} subtitle={subtitle} manual={manual} />
        {children}
      </div>
    </AuthGate>
  );
}
