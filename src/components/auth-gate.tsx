"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/context/auth-context";

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f7f4] px-6 text-[#1f2927]">
        <div className="rounded-lg border border-[#d8ded8] bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-bold uppercase text-[#60706a]">Carregando</p>
          <p className="mt-2 text-lg font-semibold">Validando acesso ao sistema...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
