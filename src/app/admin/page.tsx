"use client";

import { useEffect, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { allowedPathsForRole, pageOptions, roleOptions } from "@/lib/access-control";
import { listUserProfiles, updateUserProfile } from "@/services/firestore";
import type { UserProfile, UserRole } from "@/types/domain";

export default function AdminPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pagesUserId, setPagesUserId] = useState<string | null>(null);
  const canManage = profile?.role === "admin" || profile?.role === "gerente";

  useEffect(() => {
    let active = true;
    listUserProfiles().then((data) => {
      if (active) setUsers(data.map((user) => ({ ...user, allowedPaths: user.allowedPaths ?? allowedPathsForRole(user.role) })).sort((a, b) => Number(a.active) - Number(b.active) || a.name.localeCompare(b.name)));
    }).catch((currentError) => {
      if (active) setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar usuários.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function saveUser(user: UserProfile) {
    setSavingId(user.id); setError(""); setMessage("");
    try {
      await updateUserProfile({ userId: user.id, name: user.name.trim(), role: user.role, active: user.active, allowedPaths: user.allowedPaths ?? [] });
      setMessage(`Usuário ${user.name} salvo.`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar usuário.");
    } finally { setSavingId(""); }
  }

  async function resetPassword(user: UserProfile) {
    setSavingId(`${user.id}-password`); setError(""); setMessage("");
    try {
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) throw new Error("Sua sessão expirou. Entre novamente.");
      const response = await fetch("/api/admin/reset-password", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ userId: user.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível resetar a senha.");
      setMessage(`Senha de ${user.name} redefinida para 123456. No próximo acesso, o usuário deverá criar uma nova senha.`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível resetar a senha.");
    } finally { setSavingId(""); }
  }

  function updateUser(id: string, change: Partial<UserProfile>) {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...change } : user));
  }

  return (
    <ProtectedPage title="Administração" subtitle="Usuários, perfis, páginas e acesso operacional.">
      <main className="page-wrap">
        {!canManage && <div className="duplicate-alert"><strong>Acesso restrito</strong><span>Apenas administrador ou gerente pode alterar usuários.</span></div>}
        {error && <div className="duplicate-alert"><strong>Erro</strong><span>{error}</span></div>}
        {message && <div className="success-alert" role="status"><strong>Concluído</strong><span>{message}</span></div>}
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">Usuários cadastrados</h2><span className="tag">{users.length}</span></div>
          <div className="panel-body stack">
            {loading ? <p className="empty">Carregando usuários...</p> : users.length ? users.map((user) => (
              <article key={user.id} className="chip admin-user-chip">
                <div className="chip-top"><div><label className="field"><span>Nome</span><input value={user.name} disabled={!canManage} onChange={(event) => updateUser(user.id, { name: event.target.value })} /></label><p className="model">{user.email ?? "Sem e-mail"}</p></div><span className={`tag ${user.active ? "good" : "bad"}`}>{user.active ? "Ativo" : "Aguardando aprovação"}</span></div>
                <div className="admin-user-controls">
                  <label className="field"><span>Perfil</span><select value={user.role} disabled={!canManage} onChange={(event) => updateUser(user.id, { role: event.target.value as UserRole })}>{user.role === "gerente" && <option value="gerente">Gerente</option>}{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                  <label className="check-line modal-check"><input type="checkbox" checked={user.active} disabled={!canManage} onChange={(event) => updateUser(user.id, { active: event.target.checked })} />Usuário ativo</label>
                  <button className="primary-btn" type="button" disabled={!canManage || savingId === user.id} onClick={() => saveUser(user)}>{savingId === user.id ? "Salvando..." : "Salvar"}</button>
                  <button className="ghost-btn" type="button" disabled={!canManage || savingId === `${user.id}-password`} onClick={() => resetPassword(user)}>{savingId === `${user.id}-password` ? "Resetando..." : "Resetar senha"}</button>
                </div>
                <div className="admin-pages-summary">
                  <div><span className="admin-pages-label">Páginas permitidas</span><small>{(user.allowedPaths ?? []).length} de {pageOptions.length} selecionadas</small></div>
                  <button className="ghost-btn admin-pages-button" type="button" disabled={!canManage} onClick={() => setPagesUserId(user.id)}>Configurar páginas</button>
                </div>
              </article>
            )) : <p className="empty">Nenhum usuário cadastrado.</p>}
          </div>
        </section>
        {pagesUserId && (() => {
          const selectedUser = users.find((user) => user.id === pagesUserId);
          if (!selectedUser) return null;
          return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPagesUserId(null); }}>
            <section className="admin-pages-modal" role="dialog" aria-modal="true" aria-labelledby="admin-pages-title">
              <div className="admin-pages-modal-head"><div><span className="eyebrow">Permissões de acesso</span><h2 id="admin-pages-title">Páginas de {selectedUser.name}</h2><p>Escolha apenas as áreas necessárias para este usuário.</p></div><button className="ghost-btn" type="button" onClick={() => setPagesUserId(null)}>Fechar</button></div>
              <div className="admin-page-options">{pageOptions.map((page) => <label key={page.path} className="admin-page-option"><input type="checkbox" checked={(selectedUser.allowedPaths ?? []).includes(page.path)} onChange={(event) => { const paths = selectedUser.allowedPaths ?? []; updateUser(selectedUser.id, { allowedPaths: event.target.checked ? [...paths, page.path] : paths.filter((path) => path !== page.path) }); }} /><span>{page.label}</span></label>)}</div>
              <div className="admin-pages-modal-foot"><span>{(selectedUser.allowedPaths ?? []).length} páginas selecionadas</span><button className="primary-btn" type="button" onClick={() => setPagesUserId(null)}>Concluir</button></div>
            </section>
          </div>;
        })()}
      </main>
    </ProtectedPage>
  );
}
