"use client";

import { useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { useAuth } from "@/context/auth-context";
import { listUserProfiles } from "@/services/firestore";
import type { UserProfile } from "@/types/domain";
import styles from "./estoque.module.css";
import extraStyles from "./assinatura.module.css";

type Item = { id: number; code: string; name: string; category: string; unit: string; stock: number; minimum: number; ideal: number; location: string; updated: string };
type Movement = { id: number; type: "Entrada" | "Saída" | "Ajuste"; item: string; quantity: number; operator: string; requester?: string; receiver?: string; receiverId?: string; status?: "Confirmada" | "Aguardando confirmação" | "Recusada"; date: string; color: string };

const initialItems: Item[] = [
  { id: 1, code: "CON-001", name: "Óleo lubrificante 5W30", category: "Lubrificantes", unit: "Litro", stock: 18, minimum: 20, ideal: 60, location: "Prateleira A01", updated: "Hoje, 08:42" },
  { id: 2, code: "CON-002", name: "Fluido de freio DOT 4", category: "Fluidos", unit: "Frasco", stock: 42, minimum: 15, ideal: 50, location: "Prateleira A02", updated: "Ontem, 16:20" },
  { id: 3, code: "CON-003", name: "Luva nitrílica descartável", category: "EPIs", unit: "Caixa", stock: 7, minimum: 10, ideal: 30, location: "Armário B01", updated: "Hoje, 09:15" },
  { id: 4, code: "CON-004", name: "Pano de microfibra", category: "Limpeza", unit: "Pacote", stock: 24, minimum: 12, ideal: 40, location: "Armário B02", updated: "11/08/2026" },
  { id: 5, code: "CON-005", name: "Desengraxante concentrado", category: "Limpeza", unit: "Galão", stock: 4, minimum: 6, ideal: 18, location: "Área externa", updated: "10/08/2026" },
  { id: 6, code: "CON-006", name: "Abraçadeira plástica 20cm", category: "Oficina", unit: "Pacote", stock: 31, minimum: 10, ideal: 25, location: "Gaveta C04", updated: "08/08/2026" },
];

const initialMovements: Movement[] = [
  { id: 1, type: "Saída", item: "Óleo lubrificante 5W30", quantity: 4, operator: "Carlos Mendes", requester: "Carlos Mendes", receiver: "Marcos Oliveira", status: "Confirmada", date: "Hoje, 08:42", color: "red" },
  { id: 2, type: "Entrada", item: "Fluido de freio DOT 4", quantity: 20, operator: "Marina Alves", date: "Ontem, 16:20", color: "green" },
  { id: 3, type: "Saída", item: "Luva nitrílica descartável", quantity: 3, operator: "Carlos Mendes", requester: "Carlos Mendes", receiver: "Marcos Oliveira", status: "Confirmada", date: "Hoje, 09:15", color: "red" },
  { id: 4, type: "Ajuste", item: "Pano de microfibra", quantity: 2, operator: "João Silva", date: "11/08/2026", color: "blue" },
];

function money(value: number) { return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function EstoquePage() {
  const { profile, user } = useAuth();
  const currentUser = profile?.name ?? user?.email ?? "Usuário atual";
  const [items, setItems] = useState(initialItems);
  const [movements, setMovements] = useState(initialMovements);
  const [activeTab, setActiveTab] = useState<"visao" | "itens" | "movimentos" | "inventario">("visao");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"entrada" | "saida" | "item" | null>(null);
  const [selectedItem, setSelectedItem] = useState(initialItems[0].id);
  const [quantity, setQuantity] = useState(1);
  const [newName, setNewName] = useState("");
  const [requester, setRequester] = useState(currentUser);
  const [receiver, setReceiver] = useState("");
  const [receiverId, setReceiverId] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<Movement[]>([]);

  useEffect(() => {
    const saved = window.localStorage.getItem("estoque-pending-requests");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Movement[];
        window.setTimeout(() => setPendingRequests(parsed), 0);
      } catch {
        window.localStorage.removeItem("estoque-pending-requests");
      }
    }
    listUserProfiles().then((profiles) => setUsers(profiles.filter((entry) => entry.active && entry.id !== user?.uid))).catch(() => {
      setUsers([
        { id: "demo-marcos", name: "Marcos Oliveira", email: "marcos@empresa.com", role: "estoquista", active: true } as UserProfile,
        { id: "demo-carlos", name: "Carlos Mendes", email: "carlos@empresa.com", role: "tecnico", active: true } as UserProfile,
      ]);
    });
  }, [user?.uid]);
  const [notice, setNotice] = useState("");

  const lowStock = useMemo(() => items.filter((item) => item.stock <= item.minimum), [items]);
  const allMovements = useMemo(() => {
    const byId = new Map([...movements, ...pendingRequests].map((entry) => [entry.id, entry]));
    return [...byId.values()];
  }, [movements, pendingRequests]);
  const filteredItems = items.filter((item) => `${item.name} ${item.code} ${item.category}`.toLowerCase().includes(query.toLowerCase()));

  function openMovement(type: "entrada" | "saida", id?: number) {
    const defaultReceiver = users[0];
    setSelectedItem(id ?? items[0].id);
    setQuantity(1);
    setRequester(currentUser);
    setReceiver(type === "saida" ? defaultReceiver?.name ?? "" : "");
    setReceiverId(type === "saida" ? defaultReceiver?.id ?? "" : "");
    setConfirmed(false);
    setModal(type);
  }
  function saveMovement(type: "Entrada" | "Saída") {
    const current = items.find((item) => item.id === selectedItem);
    if (!current || quantity < 1 || (type === "Saída" && quantity > current.stock)) return;
    setItems((list) => list.map((item) => item.id === selectedItem ? { ...item, stock: item.stock + (type === "Entrada" ? quantity : -quantity), updated: "Agora" } : item));
    setMovements((list) => [{ id: Date.now(), type, item: current.name, quantity, operator: currentUser, status: "Confirmada", date: "Agora", color: type === "Entrada" ? "green" : "red" }, ...list]);
    setModal(null); setNotice(`${type} registrada com sucesso.`); window.setTimeout(() => setNotice(""), 2600);
  }
  function saveExitRequest() {
    const current = items.find((item) => item.id === selectedItem);
    if (!current || !requester.trim() || !receiver.trim() || !receiverId || quantity < 1 || quantity > current.stock || !confirmed) return;
    const request = { id: Date.now(), type: "Saída" as const, item: current.name, quantity, operator: currentUser, requester, receiver, receiverId, status: "Aguardando confirmação" as const, date: "Agora", color: "red" };
    setMovements((list) => [request, ...list]);
    const nextPending = [request, ...pendingRequests];
    setPendingRequests(nextPending);
    window.localStorage.setItem("estoque-pending-requests", JSON.stringify(nextPending));
    setModal(null); setNotice("Solicitação enviada. O recebedor precisa confirmar a retirada."); window.setTimeout(() => setNotice(""), 3600);
  }
  function confirmMovement(id: number) {
    const movement = allMovements.find((entry) => entry.id === id);
    const current = movement && items.find((item) => item.name === movement.item);
    if (!movement || !current || movement.quantity > current.stock) return;
    setItems((list) => list.map((item) => item.id === current.id ? { ...item, stock: item.stock - movement.quantity, updated: "Agora" } : item));
    setMovements((list) => list.map((entry) => entry.id === id ? { ...entry, status: "Confirmada", operator: currentUser, date: "Agora" } : entry));
    const nextPending = pendingRequests.filter((entry) => entry.id !== id);
    setPendingRequests(nextPending);
    window.localStorage.setItem("estoque-pending-requests", JSON.stringify(nextPending));
    setNotice("Recebimento confirmado e estoque atualizado."); window.setTimeout(() => setNotice(""), 3200);
  }
  function refuseMovement(id: number) {
    const nextPending = pendingRequests.filter((entry) => entry.id !== id);
    setPendingRequests(nextPending);
    setMovements((list) => list.map((entry) => entry.id === id ? { ...entry, status: "Recusada", date: "Agora" } : entry));
    window.localStorage.setItem("estoque-pending-requests", JSON.stringify(nextPending));
    setNotice("Solicitação recusada. O estoque não foi alterado."); window.setTimeout(() => setNotice(""), 3200);
  }

  const myPendingRequests = pendingRequests.filter((entry) => entry.receiverId === user?.uid || entry.receiverId?.startsWith("demo-"));
  function saveItem() {
    if (!newName.trim()) return;
    setItems((list) => [...list, { id: Date.now(), code: `CON-${String(list.length + 1).padStart(3, "0")}`, name: newName, category: "Nova categoria", unit: "Unidade", stock: 0, minimum: 5, ideal: 20, location: "A definir", updated: "Agora" }]);
    setNewName(""); setModal(null); setActiveTab("itens"); setNotice("Item cadastrado. Complete os parâmetros de estoque na lista."); window.setTimeout(() => setNotice(""), 3200);
  }

  return <ProtectedPage title="Estoque de consumo" subtitle="Controle de entradas, saídas, inventários e reposição da oficina.">
    <main className={styles.page}>
      {myPendingRequests.length > 0 && <section className={extraStyles.pendingBanner}><div><span className={styles.eyebrow}>Ação necessária</span><strong>Você tem {myPendingRequests.length} retirada{myPendingRequests.length > 1 ? "s" : ""} aguardando confirmação</strong><p>Confira os itens e confirme o recebimento para efetivar a baixa no estoque.</p></div><button className={styles.primary} onClick={() => setActiveTab("movimentos")}>Ver solicitações →</button></section>}
      <section className={styles.topbar}>
        <div><span className={styles.eyebrow}>Central de materiais</span><h2>Visão geral do estoque</h2><p>Acompanhe o que está disponível e antecipe as próximas compras.</p></div>
        <div className={styles.actions}><button className={styles.secondary} onClick={() => setModal("item")}>＋ Novo item</button><button className={styles.outline} onClick={() => openMovement("saida")}>− Registrar saída</button><button className={styles.primary} onClick={() => openMovement("entrada")}>＋ Registrar entrada</button></div>
      </section>

      <section className={styles.metrics}>
        <article><span className={styles.metricIcon + " " + styles.teal}>▦</span><div><small>Itens cadastrados</small><strong>{items.length}</strong><em>+2 este mês</em></div></article>
        <article><span className={styles.metricIcon + " " + styles.blue}>◉</span><div><small>Unidades em estoque</small><strong>{items.reduce((sum, item) => sum + item.stock, 0)}</strong><em>Saldo disponível</em></div></article>
        <article><span className={styles.metricIcon + " " + styles.orange}>△</span><div><small>Abaixo do mínimo</small><strong>{lowStock.length}</strong><em className={styles.dangerText}>Requer atenção</em></div></article>
        <article><span className={styles.metricIcon + " " + styles.purple}>↗</span><div><small>Valor estimado</small><strong>{money(12480)}</strong><em>+8,4% vs. mês anterior</em></div></article>
      </section>

      <nav className={styles.tabs}>{[["visao", "Visão geral"], ["itens", "Estoque"], ["movimentos", "Movimentações"], ["inventario", "Inventário"]].map(([value, label]) => <button key={value} className={activeTab === value ? styles.activeTab : ""} onClick={() => setActiveTab(value as typeof activeTab)}>{label}{value === "itens" && <b>{items.length}</b>}</button>)}</nav>

      {activeTab === "visao" && <div className={styles.grid}>
        <section className={styles.panel + " " + styles.alertPanel}><div className={styles.panelHead}><div><span className={styles.sectionKicker}>Ação recomendada</span><h3>Itens para reposição</h3></div><button className={styles.linkBtn} onClick={() => setActiveTab("itens")}>Ver todos →</button></div><p className={styles.panelIntro}>Estes itens atingiram o estoque mínimo e podem interromper a operação.</p>{lowStock.map((item) => <div className={styles.alertRow} key={item.id}><span className={styles.itemAvatar}>▣</span><div className={styles.itemMain}><strong>{item.name}</strong><small>{item.code} · {item.location}</small></div><div className={styles.stockNumbers}><b>{item.stock} {item.unit.toLowerCase()}s</b><span>Mínimo: {item.minimum}</span></div><button className={styles.restockBtn} onClick={() => openMovement("entrada", item.id)}>Repor</button></div>)}{lowStock.length === 0 && <p className={styles.empty}>Nenhum item precisa de reposição.</p>}</section>
        <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.sectionKicker}>Últimos registros</span><h3>Movimentações recentes</h3></div><button className={styles.linkBtn} onClick={() => setActiveTab("movimentos")}>Ver histórico →</button></div><div className={styles.movementList}>{allMovements.slice(0, 4).map((move) => <div className={styles.movementRow} key={move.id}><span className={`${styles.moveIcon} ${styles[move.color]}`}>{move.type === "Entrada" ? "↓" : move.type === "Saída" ? "↑" : "↔"}</span><div><strong>{move.item}</strong><small>{move.type} de {move.quantity} · {move.operator}</small></div><time>{move.date}</time></div>)}</div></section>
        <section className={styles.panel + " " + styles.insight}><div className={styles.panelHead}><div><span className={styles.sectionKicker}>Resumo rápido</span><h3>Consumo por categoria</h3></div><span className={styles.period}>Últimos 30 dias⌄</span></div>{[["Lubrificantes", 72, "#0b8f8f"], ["Limpeza", 48, "#4c6fff"], ["EPIs", 31, "#f3a43b"], ["Oficina", 22, "#8a70db"]].map(([name, value, color]) => <div className={styles.barRow} key={name as string}><div><span>{name}</span><b>{value} un.</b></div><div className={styles.bar}><i style={{ width: `${Number(value)}%`, background: color as string }} /></div></div>)}</section>
        <section className={styles.panel + " " + styles.quick}><div className={styles.panelHead}><div><span className={styles.sectionKicker}>Atalhos</span><h3>O que você precisa fazer?</h3></div></div><div className={styles.quickGrid}><button onClick={() => setModal("item")}><span>＋</span><strong>Cadastrar item</strong><small>Adicionar novo consumo</small></button><button onClick={() => openMovement("entrada")}><span>↓</span><strong>Dar entrada</strong><small>Registrar recebimento</small></button><button onClick={() => openMovement("saida")}><span>↑</span><strong>Registrar saída</strong><small>Baixar materiais usados</small></button><button onClick={() => setActiveTab("inventario")}><span>▤</span><strong>Fazer inventário</strong><small>Conferir estoque físico</small></button></div></section>
      </div>}

      {activeTab === "itens" && <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.sectionKicker}>Catálogo de consumo</span><h3>Itens cadastrados</h3></div><div className={styles.tableTools}><input placeholder="Buscar item ou código..." value={query} onChange={(e) => setQuery(e.target.value)} /><button className={styles.filter}>☷ Filtros</button></div></div><div className={styles.tableWrap}><table><thead><tr><th>Item</th><th>Categoria</th><th>Unidade</th><th>Estoque atual</th><th>Mínimo / ideal</th><th>Localização</th><th /></tr></thead><tbody>{filteredItems.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.code}</small></td><td>{item.category}</td><td>{item.unit}</td><td><span className={`${styles.stockPill} ${item.stock <= item.minimum ? styles.stockLow : styles.stockOk}`}>{item.stock}</span></td><td>{item.minimum} / {item.ideal}</td><td>{item.location}</td><td><button className={styles.rowAction} onClick={() => openMovement("entrada", item.id)}>＋</button><button className={styles.rowAction} onClick={() => openMovement("saida", item.id)}>−</button></td></tr>)}</tbody></table></div></section>}
      {activeTab === "movimentos" && <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.sectionKicker}>Auditoria do estoque</span><h3>Histórico de movimentações</h3></div><button className={styles.primary} onClick={() => openMovement("entrada")}>＋ Nova movimentação</button></div><div className={styles.movementList + " " + styles.fullList}>{allMovements.map((move) => <div className={styles.movementRow} key={move.id}><span className={`${styles.moveIcon} ${styles[move.color]}`}>{move.type === "Entrada" ? "↓" : move.type === "Saída" ? "↑" : "↔"}</span><div><strong>{move.item}</strong><small>{move.type} de {move.quantity} · retirante: {move.requester ?? move.operator}{move.receiver ? ` · recebe: ${move.receiver}` : ""}</small>{move.status === "Aguardando confirmação" && (move.receiverId === user?.uid || move.receiverId?.startsWith("demo-")) && <div className={extraStyles.confirmActions}><button className={extraStyles.confirmBtn} onClick={() => confirmMovement(move.id)}>Confirmar recebimento</button><button className={extraStyles.refuseBtn} onClick={() => refuseMovement(move.id)}>Recusar</button></div>}</div><div className={extraStyles.movementStatus}><span className={move.status === "Aguardando confirmação" ? extraStyles.pending : move.status === "Recusada" ? extraStyles.refused : extraStyles.confirmed}>{move.status ?? "Confirmada"}</span><time>{move.date}</time></div></div>)}</div></section>}
      {activeTab === "inventario" && <section className={styles.inventory}><div className={styles.inventoryHero}><div><span className={styles.eyebrow}>Conferência física</span><h2>Inventário de estoque</h2><p>Compare o saldo do sistema com a contagem realizada no local.</p></div><button className={styles.primary} onClick={() => setNotice("Novo inventário iniciado para todos os itens.")}>Iniciar inventário</button></div><div className={styles.inventoryCards}><div><small>Último inventário</small><strong>05/08/2026</strong><span>Concluído por João Silva</span></div><div><small>Itens conferidos</small><strong>24 / 24</strong><span className={styles.goodText}>100% conferido</span></div><div><small>Divergências</small><strong>02</strong><span className={styles.dangerText}>Aguardando ajuste</span></div></div><div className={styles.panel}><div className={styles.panelHead}><div><span className={styles.sectionKicker}>Pendente de conferência</span><h3>Próximo inventário sugerido</h3></div><span className={styles.tag}>Agendado · 15/08/2026</span></div><p className={styles.panelIntro}>Recomendamos conferir primeiro os {lowStock.length} itens abaixo do mínimo e os materiais com maior consumo.</p><button className={styles.outline} onClick={() => setNotice("Checklist de inventário preparado.")}>Preparar checklist →</button></div></section>}

      {notice && <div className={styles.toast}>✓ {notice}</div>}
      {modal && <div className={styles.modalBackdrop} onClick={() => setModal(null)}><div className={styles.modal} onClick={(e) => e.stopPropagation()}><div className={styles.modalHead}><div><span className={styles.sectionKicker}>{modal === "item" ? "Catálogo" : "Movimentação"}</span><h3>{modal === "item" ? "Cadastrar novo item" : modal === "entrada" ? "Registrar entrada" : "Solicitar saída"}</h3></div><button onClick={() => setModal(null)}>×</button></div>{modal === "item" ? <><label>Nome do item<input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Filtro de óleo" /></label><label>Categoria<select><option>Nova categoria</option><option>Lubrificantes</option><option>Limpeza</option><option>EPIs</option></select></label><button className={styles.primary + " " + styles.modalAction} onClick={saveItem}>Cadastrar item</button></> : <><label>Item<select value={selectedItem} onChange={(e) => setSelectedItem(Number(e.target.value))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · saldo {item.stock}</option>)}</select></label><label>Quantidade<input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>{modal === "saida" ? <><div className={extraStyles.signatureGrid}><label>Quem está retirando<input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Nome do solicitante" /></label><label>Quem vai receber<select value={receiverId} onChange={(e) => { const selected = users.find((entry) => entry.id === e.target.value); setReceiverId(e.target.value); setReceiver(selected?.name ?? ""); }}><option value="">Selecione o usuário</option>{users.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.email ? ` · ${entry.email}` : ""}</option>)}</select></label></div><label className={extraStyles.checkLine}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Declaro que a retirada foi autorizada e o recebedor está identificado.</label><div className={extraStyles.signatureBox}><strong>Assinatura eletrônica da solicitação</strong><span>{requester || "Solicitante"} → {receiver || "Recebedor"}</span><small>O login de {receiver || "usuário selecionado"} receberá a pendência de confirmação.</small></div><button className={styles.primary + " " + styles.modalAction} onClick={saveExitRequest}>Enviar para confirmação</button></> : <><p className={styles.modalHint}>Entrada conferida por: {currentUser}</p><button className={styles.primary + " " + styles.modalAction} onClick={() => saveMovement("Entrada")}>Confirmar entrada</button></>}</>}</div></div>}
    </main>
  </ProtectedPage>;
}
