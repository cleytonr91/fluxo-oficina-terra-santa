"use client";

import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/context/auth-context";
import { canAccessPath, defaultPathForRole } from "@/lib/access-control";

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, loading, logout, changeOwnPassword } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const hasPageAccess = Boolean(profile?.active && canAccessPath(profile.role, pathname, profile.allowedPaths));

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    } else if (!loading && user && profile?.active && !canAccessPath(profile.role, pathname, profile.allowedPaths)) {
      router.replace(defaultPathForRole(profile.role, profile.allowedPaths));
    }
  }, [loading, pathname, profile, router, user]);

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

  if (!profile?.active) {
    return (
      <main className="pending-access-page">
        <section className="pending-access-card">
          <strong>Acesso aguardando autorização</strong>
          <p>
            Seu cadastro foi recebido, mas ainda precisa ser aprovado pelo administrador do sistema.
            Assim que seu perfil for validado, o acesso será liberado.
          </p>
          <button type="button" className="primary-btn" onClick={logout}>
            Sair
          </button>
        </section>
      </main>
    );
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setChangingPassword(true);
    try {
      await changeOwnPassword(newPassword);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Não foi possível trocar a senha.");
    } finally {
      setChangingPassword(false);
    }
  }

  if (profile.mustChangePassword) {
    return (
      <main className="pending-access-page">
        <section className="pending-access-card">
          <strong>Crie uma nova senha</strong>
          <p>O administrador redefiniu seu acesso. Escolha uma senha pessoal para continuar.</p>
          <form onSubmit={handlePasswordChange} className="stack">
            <label className="field"><span>Nova senha</span><input type="password" minLength={6} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            {passwordError && <span className="tag bad">{passwordError}</span>}
            <button type="submit" className="primary-btn" disabled={changingPassword}>{changingPassword ? "Salvando..." : "Salvar nova senha"}</button>
          </form>
          <button type="button" className="ghost-btn" onClick={logout}>Sair</button>
        </section>
      </main>
    );
  }

  if (!hasPageAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f7f4] px-6 text-[#1f2927]">
        <div className="rounded-lg border border-[#d8ded8] bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-bold uppercase text-[#60706a]">Acesso restrito</p>
          <p className="mt-2 text-lg font-semibold">Direcionando para sua área de trabalho...</p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
