"use client";

import { useEffect, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { listUserProfiles, updateUserProfile } from "@/services/firestore";
import type { UserProfile, UserRole } from "@/types/domain";

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

export default function AdminPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  const canManage = profile?.role === "admin" || profile?.role === "gerente";

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      setLoading(true);
      setError("");

      try {
        const data = await listUserProfiles();
        if (!active) return;
        setUsers(data.sort((a, b) => Number(a.active) - Number(b.active) || a.name.localeCompare(b.name)));
      } catch (currentError) {
        if (!active) return;
        setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar usuários.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadUsers();
    return () => {
      active = false;
    };
  }, []);

  async function saveUser(user: UserProfile) {
    setSavingId(user.id);
    setError("");

    try {
      await updateUserProfile({
        userId: user.id,
        role: user.role,
        active: user.active,
      });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar usuário.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <ProtectedPage title="Administração" subtitle="Usuários, funções e acesso operacional.">
      <main className="page-wrap">
        {!canManage && (
          <div className="duplicate-alert">
            <strong>Acesso restrito</strong>
            <span>Apenas administrador ou gerente pode alterar usuários.</span>
          </div>
        )}

        {error && <div className="duplicate-alert"><strong>Erro</strong><span>{error}</span></div>}

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Usuários cadastrados</h2>
            <span className="tag">{users.length}</span>
          </div>
          <div className="panel-body stack">
            {loading ? (
              <p className="empty">Carregando usuários...</p>
            ) : users.length ? users.map((user) => (
              <article key={user.id} className="chip admin-user-chip">
                <div className="chip-top">
                  <div>
                    <h3 className="client">{user.name}</h3>
                    <p className="model">{user.email ?? "Sem e-mail"}</p>
                  </div>
                  <span className={`tag ${user.active ? "good" : "bad"}`}>{user.active ? "Ativo" : "Aguardando aprovação"}</span>
                </div>

                <div className="admin-user-controls">
                  <label className="field">
                    <span>Função</span>
                    <select
                      value={user.role}
                      disabled={!canManage}
                      onChange={(event) => setUsers((current) => current.map((item) => (
                        item.id === user.id ? { ...item, role: event.target.value as UserRole } : item
                      )))}
                    >
                      {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                  </label>

                  <label className="check-line modal-check">
                    <input
                      type="checkbox"
                      checked={user.active}
                      disabled={!canManage}
                      onChange={(event) => setUsers((current) => current.map((item) => (
                        item.id === user.id ? { ...item, active: event.target.checked } : item
                      )))}
                    />
                    Usuário ativo
                  </label>

                  <button
                    className="primary-btn"
                    type="button"
                    disabled={!canManage || savingId === user.id}
                    onClick={() => saveUser(user)}
                  >
                    {savingId === user.id ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </article>
            )) : (
              <p className="empty">Nenhum usuário cadastrado.</p>
            )}
          </div>
        </section>
      </main>
    </ProtectedPage>
  );
}
