"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import type { UserRole } from "@/types/domain";

const roles: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "Administrador" },
  { value: "gerente", label: "Gerente" },
  { value: "chefe_oficina", label: "Chefe de oficina" },
  { value: "consultor", label: "Consultor técnico" },
  { value: "tecnico", label: "Mecânico" },
  { value: "lider_lavagem", label: "Líder de posto" },
  { value: "estoquista", label: "Estoquista" },
  { value: "qualidade", label: "Coordenador de qualidade" },
];

function authErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Não foi possível concluir a ação.";
  if (error.message.includes("auth/invalid-credential")) return "E-mail ou senha inválidos.";
  if (error.message.includes("auth/email-already-in-use")) return "Este e-mail já possui acesso. Use a entrada normal.";
  if (error.message.includes("auth/weak-password")) return "A senha precisa ter pelo menos 6 caracteres.";
  return error.message;
}

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login, createFirstAccess } = useAuth();
  const [mode, setMode] = useState<"entrar" | "primeiro-acesso">("entrar");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("consultor");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/fluxo");
  }, [loading, router, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (mode === "entrar") {
        await login(email, password);
      } else {
        await createFirstAccess({ name, email, password, role });
      }
      router.replace("/fluxo");
    } catch (currentError) {
      setError(authErrorMessage(currentError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-wrap grid min-h-screen place-items-center">
      <section className="login-shell">
        <div className="login-brand">
          <div className="login-logo" aria-hidden="true">⚙</div>
          <p className="eyebrow">Terra Santa Hyundai</p>
          <h1>Fluxo Oficina</h1>
        </div>

        <section className="panel login-panel">
          <div className="panel-head">
            <h2 className="panel-title">Acesso</h2>
            <span className="tag">Firebase</span>
          </div>
          <div className="panel-body">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("entrar")} className={mode === "entrar" ? "primary-btn" : "ghost-btn"}>
                Entrar
              </button>
              <button type="button" onClick={() => setMode("primeiro-acesso")} className={mode === "primeiro-acesso" ? "primary-btn" : "ghost-btn"}>
                Solicitar acesso
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 toolbar-grid">
              {mode === "primeiro-acesso" && (
                <>
                  <label className="field">
                    <span>Nome</span>
                    <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do colaborador" />
                  </label>
                  <label className="field">
                    <span>Função</span>
                    <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                      {roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                </>
              )}

              <label className="field">
                <span>E-mail</span>
                <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@empresa.com" />
              </label>
              <label className="field">
                <span>Senha</span>
                <input required type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" />
              </label>
              {error && <p className="tag bad rounded-md">{error}</p>}
              <button type="submit" disabled={submitting || loading} className="primary-btn">
                {submitting || loading ? "Aguarde..." : mode === "entrar" ? "Entrar no sistema" : "Enviar solicitação"}
              </button>
            </form>
          </div>
        </section>
      </section>
    </main>
  );
}
