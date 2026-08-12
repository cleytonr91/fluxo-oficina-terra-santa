"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { PartCatalogFields } from "@/components/part-catalog-fields";
import { useAuth } from "@/context/auth-context";
import {
  createPartsCounterEntry,
  savePartsSalesGoal,
  subscribePartsCounterEntries,
  subscribePartsSalesGoals,
  updatePartsCounterEntry,
  updatePartsCounterEntryDetails,
} from "@/services/firestore";
import type {
  PartOrderSource,
  PartsCounterCustomerType,
  PartsCounterEntry,
  PartsCounterEntryType,
  PartsCounterItem,
  PartsCounterOrderStatus,
  PartsSalesGoal,
} from "@/types/domain";
import styles from "./balcao.module.css";

type Section = "nova" | "vendas" | "pedidos" | "indicadores";

const states = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

const sourceOptions: Array<{ value: PartOrderSource; label: string }> = [
  { value: "mobis", label: "Mobis" },
  { value: "rede_autorizada", label: "Rede" },
  { value: "natal", label: "Natal" },
  { value: "mossoro", label: "Mossoró" },
  { value: "juazeiro", label: "Juazeiro" },
];

const statusOptions: Array<{ value: PartsCounterOrderStatus; label: string }> = [
  { value: "necessario_pedido", label: "Necessário pedido" },
  { value: "pedido_realizado", label: "Pedido realizado" },
  { value: "em_transito", label: "Em trânsito" },
  { value: "recebido", label: "Recebido" },
  { value: "disponivel", label: "Disponível" },
];

const sellerOptions = [
  { value: "ALISSON", label: "Alisson" },
  { value: "FELIPE", label: "Felipe" },
];

function newItem(index = 1, availableInStock = false): PartsCounterItem {
  return {
    id: `item-${Date.now()}-${index}`,
    partReference: "",
    partDescription: "",
    quantity: 1,
    unitPrice: 0,
    availableInStock,
    orderStatus: availableInStock ? "disponivel" : "necessario_pedido",
  };
}

function currentMonth() {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}

function currentDate() {
  return new Date().toLocaleDateString("en-CA");
}

function asDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate() as Date;
  return null;
}

function entryMonth(entry: PartsCounterEntry) {
  if (entry.occurredOn) return entry.occurredOn.slice(0, 7);
  const date = asDate(entry.createdAt);
  return date ? date.toLocaleDateString("en-CA").slice(0, 7) : "";
}

function entryDate(entry: PartsCounterEntry) {
  if (entry.occurredOn) return new Date(`${entry.occurredOn}T12:00:00`);
  return asDate(entry.createdAt);
}

function formatDate(value: unknown) {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat("pt-BR").format(date) : "-";
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function entryTotal(entry: PartsCounterEntry) {
  return entry.items.reduce((total, item) => total + item.quantity * item.unitPrice, 0) + (entry.freightAmount ?? 0);
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(year, monthNumber - 1, 1)).replace(" de ", "/");
}

export default function BalcaoPage() {
  const { profile, user } = useAuth();
  const operator = (profile?.name ?? user?.email ?? "OPERADOR").toUpperCase();
  const [section, setSection] = useState<Section>("vendas");
  const [entries, setEntries] = useState<PartsCounterEntry[]>([]);
  const [goals, setGoals] = useState<PartsSalesGoal[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [sellerFilter, setSellerFilter] = useState("TODOS");
  const [entryType, setEntryType] = useState<PartsCounterEntryType>("venda");
  const [editingEntryId, setEditingEntryId] = useState("");
  const [editingReturnSection, setEditingReturnSection] = useState<Extract<Section, "vendas" | "pedidos">>("vendas");
  const [occurredOn, setOccurredOn] = useState(currentDate);
  const [clientName, setClientName] = useState("");
  const [customerType, setCustomerType] = useState<PartsCounterCustomerType>("PF");
  const [sellerName, setSellerName] = useState("ALISSON");
  const [destinationState, setDestinationState] = useState("");
  const [freightAmount, setFreightAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PartsCounterItem[]>([newItem(1, true)]);
  const [orderDrafts, setOrderDrafts] = useState<Record<string, PartsCounterItem[]>>({});
  const [savingOrderId, setSavingOrderId] = useState("");
  const [goalDraft, setGoalDraft] = useState<{ month: string; value: number } | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => subscribePartsCounterEntries(setEntries, (currentError) => setError(currentError.message)), []);
  useEffect(() => subscribePartsSalesGoals(setGoals, (currentError) => setError(currentError.message)), []);

  const sellers = useMemo(() => [...new Set(entries.map((entry) => entry.sellerName).filter(Boolean))].sort(), [entries]);
  const monthEntries = useMemo(() => entries.filter((entry) => entryMonth(entry) === month), [entries, month]);
  const sales = useMemo(() => monthEntries.filter((entry) => entry.entryType === "venda"), [monthEntries]);
  const lostSales = useMemo(() => monthEntries.filter((entry) => entry.entryType === "venda_perdida"), [monthEntries]);
  const orders = useMemo(() => entries.filter((entry) => entry.entryType === "pedido"), [entries]);
  const filteredSales = useMemo(() => sales.filter((entry) => sellerFilter === "TODOS" || entry.sellerName === sellerFilter), [sales, sellerFilter]);
  const filteredLostSales = useMemo(() => lostSales.filter((entry) => sellerFilter === "TODOS" || entry.sellerName === sellerFilter), [lostSales, sellerFilter]);

  const indicators = useMemo(() => {
    const sold = sales.reduce((total, entry) => total + entryTotal(entry), 0);
    const lost = lostSales.reduce((total, entry) => total + entryTotal(entry), 0);
    const pending = monthEntries.filter((entry) => entry.entryType === "pedido").reduce((total, entry) => total + entryTotal(entry), 0);
    const pf = sales.filter((entry) => entry.customerType === "PF").reduce((total, entry) => total + entryTotal(entry), 0);
    const pj = sold - pf;
    return { sold, lost, pending, pf, pj, expectation: sold + pending };
  }, [sales, lostSales, monthEntries]);

  const monthlyComparison = useMemo(() => {
    const result: Array<{ month: string; total: number }> = [];
    const base = new Date(`${month}-01T12:00:00`);
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(base.getFullYear(), base.getMonth() - offset, 1);
      const key = date.toLocaleDateString("en-CA").slice(0, 7);
      const total = entries.filter((entry) => entry.entryType === "venda" && entryMonth(entry) === key).reduce((sum, entry) => sum + entryTotal(entry), 0);
      result.push({ month: key, total });
    }
    return result;
  }, [entries, month]);

  const maxComparison = Math.max(...monthlyComparison.map((item) => item.total), 1);
  const pfPercent = indicators.sold ? Math.round((indicators.pf / indicators.sold) * 100) : 0;
  const goal = goals.find((item) => item.month === month)?.targetAmount ?? 0;
  const goalValue = goalDraft?.month === month ? goalDraft.value : goal;
  const goalPercent = goal ? Math.min(100, Math.round((indicators.sold / goal) * 100)) : 0;
  const dateFieldLabel = entryType === "venda" ? "Data da venda" : entryType === "pedido" ? "Data do pedido" : "Data da perda";

  function updateItem(itemId: string, patch: Partial<PartsCounterItem>) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
  }

  function changeEntryType(nextType: PartsCounterEntryType) {
    setEntryType(nextType);
    if (nextType === "venda") {
      setItems((current) => current.map((item) => ({ ...item, availableInStock: true, orderStatus: "disponivel" })));
    }
  }

  function resetForm(nextType: PartsCounterEntryType = entryType) {
    setEditingEntryId("");
    setOccurredOn(currentDate());
    setClientName("");
    setCustomerType("PF");
    setSellerName("ALISSON");
    setDestinationState("");
    setFreightAmount(0);
    setNotes("");
    setItems([newItem(1, nextType === "venda")]);
  }

  function startNewEntry(nextType: PartsCounterEntryType) {
    setEntryType(nextType);
    resetForm(nextType);
    setSection("nova");
  }

  function editEntry(entry: PartsCounterEntry, nextType: PartsCounterEntryType = entry.entryType) {
    setEditingEntryId(entry.id);
    setEditingReturnSection(entry.entryType === "pedido" ? "pedidos" : "vendas");
    setOccurredOn(nextType === entry.entryType
      ? (entry.occurredOn ?? entryDate(entry)?.toLocaleDateString("en-CA") ?? currentDate())
      : currentDate());
    setEntryType(nextType);
    setClientName(entry.clientName);
    setCustomerType(entry.customerType);
    setSellerName(entry.sellerName);
    setDestinationState(entry.destinationState ?? "");
    setFreightAmount(entry.freightAmount ?? 0);
    setNotes(entry.notes ?? "");
    setItems((orderDrafts[entry.id] ?? entry.items).map((item) => nextType === "venda"
      ? { ...item, availableInStock: true, orderStatus: "disponivel" }
      : { ...item }));
    setError("");
    setSection("nova");
  }

  function cancelEditing() {
    const returnSection = editingReturnSection;
    setEntryType("venda");
    resetForm("venda");
    setSection(returnSection);
  }

  async function submitEntry(event: FormEvent) {
    event.preventDefault();
    if (!items.length || items.some((item) => !item.partReference || !item.partDescription || item.quantity < 1)) {
      setError("PREENCHA REFERÊNCIA, DESCRIÇÃO E QUANTIDADE DE TODOS OS ITENS.");
      return;
    }
    if ((entryType === "venda" || entryType === "pedido") && !destinationState) {
      setError("INFORME O ESTADO DE DESTINO.");
      return;
    }
    if (entryType === "pedido" && items.some((item) => !item.availableInStock && !item.orderSource)) {
      setError("INFORME A ORIGEM DOS ITENS QUE PRECISAM DE PEDIDO.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const entry = {
          entryType,
          occurredOn,
          clientName,
          customerType,
          sellerName,
          destinationState: entryType === "venda" || entryType === "pedido" ? destinationState : undefined,
          freightAmount,
          notes,
          items,
        };
      if (editingEntryId) {
        await updatePartsCounterEntryDetails({ entryId: editingEntryId, entry, actionBy: operator });
      } else {
        await createPartsCounterEntry({ entry, actionBy: operator });
      }
      resetForm(entryType);
      setSection(entryType === "pedido" ? "pedidos" : "vendas");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "NÃO FOI POSSÍVEL SALVAR O LANÇAMENTO.");
    } finally {
      setSaving(false);
    }
  }

  function orderItems(entry: PartsCounterEntry) {
    return orderDrafts[entry.id] ?? entry.items;
  }

  function updateOrderItem(entry: PartsCounterEntry, itemId: string, patch: Partial<PartsCounterItem>) {
    setOrderDrafts((current) => ({
      ...current,
      [entry.id]: orderItems(entry).map((item) => item.id === itemId ? { ...item, ...patch } : item),
    }));
  }

  async function saveOrder(entry: PartsCounterEntry) {
    setSavingOrderId(entry.id);
    setError("");
    try {
      await updatePartsCounterEntry({ entryId: entry.id, entryType: "pedido", items: orderItems(entry), actionBy: operator });
      setOrderDrafts((current) => { const next = { ...current }; delete next[entry.id]; return next; });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "NÃO FOI POSSÍVEL ATUALIZAR O PEDIDO.");
    } finally {
      setSavingOrderId("");
    }
  }

  async function saveGoal(event: FormEvent) {
    event.preventDefault();
    setSavingGoal(true);
    setError("");
    try {
      await savePartsSalesGoal({ month, targetAmount: goalValue, updatedBy: operator });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "NÃO FOI POSSÍVEL SALVAR A META.");
    } finally {
      setSavingGoal(false);
    }
  }

  return (
    <ProtectedPage title="Balcão de Peças" subtitle="Vendas, pedidos e indicadores integrados ao Fluxo.">
      <main className={styles.shell}>
        <aside className={styles.sidebar} aria-label="Áreas do Balcão de Peças">
          <div className={styles.brand}><span>BP</span><div><strong>Balcão</strong><small>Peças Hyundai</small></div></div>
          {([
            ["nova", "+", "Novo lançamento"],
            ["vendas", "V", "Vendas"],
            ["pedidos", "P", "Pedidos"],
            ["indicadores", "I", "Indicadores"],
          ] as Array<[Section, string, string]>).map(([id, icon, label]) => (
            <button key={id} type="button" className={section === id ? styles.activeNav : ""} onClick={() => id === "nova" ? startNewEntry("venda") : setSection(id)}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </aside>

        <section className={styles.content}>
          {error && <div className={styles.error}>{error}</div>}

          {section === "nova" && (
            <form className={styles.panel} onSubmit={submitEntry}>
              <div className={styles.panelHead}><div><span className={styles.eyebrow}>{editingEntryId ? "EDIÇÃO DO REGISTRO" : "NOVO REGISTRO"}</span><h2>{editingEntryId ? "Editar lançamento" : "Adicionar lançamento"}</h2></div><span className={styles.uppercaseNote}>{editingEntryId ? "TODOS OS CAMPOS PODEM SER ALTERADOS" : "PREENCHIMENTO EM CAIXA ALTA"}</span></div>
              <div className={styles.formGrid}>
                <label><span>Cliente</span><input required value={clientName} onChange={(event) => setClientName(event.target.value.toUpperCase())} /></label>
                <label><span>Pessoa</span><select value={customerType} onChange={(event) => setCustomerType(event.target.value as PartsCounterCustomerType)}><option>PF</option><option>PJ</option></select></label>
                <label><span>Vendedor</span><select required value={sellerName} onChange={(event) => setSellerName(event.target.value)}>{sellerOptions.map((seller) => <option key={seller.value} value={seller.value}>{seller.label}</option>)}</select></label>
                <label><span>Tipo de lançamento</span><select value={entryType} onChange={(event) => changeEntryType(event.target.value as PartsCounterEntryType)}><option value="venda">Venda</option><option value="pedido">Pedido</option><option value="venda_perdida">Venda perdida</option></select></label>
                <label><span>{dateFieldLabel}</span><input required type="date" max={currentDate()} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
                {(entryType === "venda" || entryType === "pedido") && <label><span>Destino</span><select required value={destinationState} onChange={(event) => setDestinationState(event.target.value)}><option value="">Selecione o estado</option>{states.map((state) => <option key={state}>{state}</option>)}</select></label>}
                <label><span>Frete</span><input type="number" min="0" step="0.01" value={freightAmount} onChange={(event) => setFreightAmount(Number(event.target.value))} /></label>
              </div>

              <div className={styles.itemsHead}><div><span className={styles.eyebrow}>ITENS</span><h3>Peças do lançamento</h3></div><button type="button" className={styles.secondaryButton} onClick={() => setItems((current) => [...current, newItem(current.length + 1, entryType === "venda")])}>+ Adicionar item</button></div>
              <div className={styles.itemStack}>
                {items.map((item, index) => (
                  <article className={styles.itemCard} key={item.id}>
                    <div className={styles.itemNumber}>{String(index + 1).padStart(2, "0")}</div>
                    <div className={styles.catalogFields}>
                      <PartCatalogFields index={index} reference={item.partReference} description={item.partDescription} onChange={(value) => updateItem(item.id, { partReference: value.partReference ?? item.partReference, partDescription: value.partDescription ?? item.partDescription, unitPrice: value.salePrice ?? item.unitPrice })} />
                    </div>
                    <label><span>Quantidade</span><input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} /></label>
                    <label><span>Valor de venda</span><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(item.id, { unitPrice: Number(event.target.value) })} /></label>
                    {entryType === "pedido" && <><div className={styles.orderChoice}><label className={styles.check}><input type="checkbox" checked={item.availableInStock} onChange={(event) => updateItem(item.id, { availableInStock: event.target.checked, orderStatus: event.target.checked ? "disponivel" : "necessario_pedido" })} /><span>Disponível no estoque</span></label>{!item.availableInStock && <label><span>Origem</span><select required value={item.orderSource ?? ""} onChange={(event) => updateItem(item.id, { orderSource: event.target.value as PartOrderSource })}><option value="">Selecione</option>{sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}</div><div className={styles.orderDetails}><label><span>Status do pedido</span><select value={item.orderStatus ?? "necessario_pedido"} onChange={(event) => updateItem(item.id, { orderStatus: event.target.value as PartsCounterOrderStatus, availableInStock: event.target.value === "disponivel" })}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>NF</span><input value={item.invoiceNumber ?? ""} onChange={(event) => updateItem(item.id, { invoiceNumber: event.target.value.toUpperCase() })} /></label><label><span>Previsão de chegada</span><input type="date" value={item.expectedArrivalDate ?? ""} onChange={(event) => updateItem(item.id, { expectedArrivalDate: event.target.value })} /></label><label><span>Observações de NF e previsão</span><input value={item.orderNote ?? ""} onChange={(event) => updateItem(item.id, { orderNote: event.target.value.toUpperCase() })} /></label></div></>}
                    {items.length > 1 && <button type="button" className={styles.removeButton} aria-label={`Remover item ${index + 1}`} onClick={() => setItems((current) => current.filter((currentItem) => currentItem.id !== item.id))}>×</button>}
                  </article>
                ))}
              </div>
              <label className={styles.fullField}><span>Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value.toUpperCase())} /></label>
              <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => editingEntryId ? cancelEditing() : resetForm()}>{editingEntryId ? "Cancelar edição" : "Limpar"}</button><button className={styles.primaryButton} disabled={saving}>{saving ? "Salvando..." : editingEntryId ? "Salvar alterações" : "Lançar registro"}</button></div>
            </form>
          )}

          {section === "vendas" && (
            <div className={styles.stack}>
              <div className={styles.hero}><div><span className={styles.eyebrow}>RESULTADO COMERCIAL</span><h2>Vendas do mês</h2><p>Acompanhe volume, destino e entrega por vendedor.</p></div><button className={styles.primaryButton} type="button" onClick={() => startNewEntry("venda")}>+ Nova venda</button></div>
              <div className={styles.filters}><label><span>Mês</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label><span>Vendedor</span><select value={sellerFilter} onChange={(event) => setSellerFilter(event.target.value)}><option>TODOS</option>{sellers.map((seller) => <option key={seller}>{seller}</option>)}</select></label><div className={styles.filterTotal}><span>Total filtrado</span><strong>{money(filteredSales.reduce((total, entry) => total + entryTotal(entry), 0))}</strong></div></div>
              <div className={styles.tablePanel}><div className={styles.tableHeader}><span>Data da venda</span><span>Cliente</span><span>PF/PJ</span><span>Vendedor</span><span>Destino</span><span>Itens</span><span>Total</span><span>Ação</span></div>{filteredSales.length ? filteredSales.map((entry) => <div className={styles.tableRow} key={entry.id}><span>{formatDate(entryDate(entry))}</span><strong>{entry.clientName}</strong><span><em>{entry.customerType}</em></span><span>{entry.sellerName}</span><span>{entry.destinationState ?? "-"}</span><span>{entry.items.reduce((total, item) => total + item.quantity, 0)}</span><strong>{money(entryTotal(entry))}</strong><button type="button" className={styles.editButton} onClick={() => editEntry(entry)}>Editar</button></div>) : <p className={styles.empty}>Nenhuma venda encontrada para os filtros selecionados.</p>}</div>
              {filteredLostSales.length > 0 && <><div className={styles.listTitle}><div><span className={styles.eyebrow}>HISTÓRICO EDITÁVEL</span><h3>Vendas perdidas do mês</h3></div><strong>{money(filteredLostSales.reduce((total, entry) => total + entryTotal(entry), 0))}</strong></div><div className={styles.tablePanel}><div className={styles.tableHeader}><span>Data da perda</span><span>Cliente</span><span>PF/PJ</span><span>Vendedor</span><span>Destino</span><span>Itens</span><span>Valor</span><span>Ação</span></div>{filteredLostSales.map((entry) => <div className={styles.tableRow} key={entry.id}><span>{formatDate(entryDate(entry))}</span><strong>{entry.clientName}</strong><span><em>{entry.customerType}</em></span><span>{entry.sellerName}</span><span>{entry.destinationState ?? "-"}</span><span>{entry.items.reduce((total, item) => total + item.quantity, 0)}</span><strong>{money(entryTotal(entry))}</strong><button type="button" className={styles.editButton} onClick={() => editEntry(entry)}>Editar</button></div>)}</div></>}
              <div className={styles.sellerGrid}>{sellers.map((seller) => { const sellerSales = sales.filter((entry) => entry.sellerName === seller); const total = sellerSales.reduce((sum, entry) => sum + entryTotal(entry), 0); return <article key={seller}><span>{sellerSales.length} vendas</span><h3>{seller}</h3><strong>{money(total)}</strong></article>; })}</div>
            </div>
          )}

          {section === "pedidos" && (
            <div className={styles.stack}>
              <div className={styles.hero}><div><span className={styles.eyebrow}>ACOMPANHAMENTO</span><h2>Pedidos em andamento</h2><p>Atualize cada item até a chegada ou converta o negócio.</p></div><button className={styles.primaryButton} type="button" onClick={() => startNewEntry("pedido")}>+ Novo pedido</button></div>
              {orders.length ? orders.map((entry) => <article className={styles.orderCard} key={entry.id}><div className={styles.orderHeader}><div><span className={styles.eyebrow}>{formatDate(entryDate(entry))} · {entry.customerType} · DESTINO {entry.destinationState ?? "NÃO INFORMADO"}</span><h3>{entry.clientName}</h3><p>{entry.sellerName} · {money(entryTotal(entry))}</p></div><div className={styles.orderActions}><button type="button" className={styles.secondaryButton} disabled={savingOrderId === entry.id} onClick={() => editEntry(entry)}>Editar tudo</button><button type="button" className={styles.secondaryButton} disabled={savingOrderId === entry.id} onClick={() => editEntry(entry, "venda_perdida")}>Venda perdida</button><button type="button" className={styles.primaryButton} disabled={savingOrderId === entry.id} onClick={() => editEntry(entry, "venda")}>Transformar em venda</button></div></div><div className={styles.orderItems}>{orderItems(entry).map((item) => <div className={styles.orderLine} key={item.id}><div className={styles.orderPart}><strong>{item.partReference}</strong><span>{item.partDescription}</span><small>{item.quantity} × {money(item.unitPrice)}</small></div><label><span>Status</span><select value={item.orderStatus ?? "necessario_pedido"} onChange={(event) => updateOrderItem(entry, item.id, { orderStatus: event.target.value as PartsCounterOrderStatus, availableInStock: event.target.value === "disponivel" })}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>Origem</span><select value={item.orderSource ?? ""} onChange={(event) => updateOrderItem(entry, item.id, { orderSource: event.target.value as PartOrderSource })}><option value="">Selecione</option>{sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>NF</span><input value={item.invoiceNumber ?? ""} onChange={(event) => updateOrderItem(entry, item.id, { invoiceNumber: event.target.value.toUpperCase() })} /></label><label><span>Previsão de chegada</span><input type="date" value={item.expectedArrivalDate ?? ""} onChange={(event) => updateOrderItem(entry, item.id, { expectedArrivalDate: event.target.value })} /></label><label className={styles.noteField}><span>Observações de NF e previsão</span><input value={item.orderNote ?? ""} onChange={(event) => updateOrderItem(entry, item.id, { orderNote: event.target.value.toUpperCase() })} /></label></div>)}</div><div className={styles.saveRow}><button type="button" className={styles.secondaryButton} disabled={!orderDrafts[entry.id] || savingOrderId === entry.id} onClick={() => saveOrder(entry)}>{savingOrderId === entry.id ? "Salvando..." : "Salvar andamento"}</button></div></article>) : <div className={styles.panel}><p className={styles.empty}>Nenhum pedido em andamento.</p></div>}
            </div>
          )}

          {section === "indicadores" && (
            <div className={styles.stack}>
              <div className={styles.hero}><div><span className={styles.eyebrow}>GESTÃO COMERCIAL</span><h2>Indicadores do Balcão</h2><p>Vendas, perdas, expectativa e meta em uma única visão.</p></div><label className={styles.monthPicker}><span>Mês analisado</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></div>
              <div className={styles.kpiGrid}><article><span>Vendas realizadas</span><strong>{money(indicators.sold)}</strong><small>{sales.length} lançamentos</small></article><article><span>Vendas perdidas</span><strong className={styles.dangerText}>{money(indicators.lost)}</strong><small>{lostSales.length} oportunidades</small></article><article><span>Expectativa do mês</span><strong>{money(indicators.expectation)}</strong><small>Vendas + pedidos</small></article><article><span>Meta cadastrada</span><strong>{money(goal)}</strong><small>{goalPercent}% atingido</small></article></div>
              <div className={styles.dashboardGrid}><article className={styles.chartPanel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>PERFIL DE CLIENTE</span><h3>Representação PF e PJ</h3></div><strong>{money(indicators.sold)}</strong></div><div className={styles.donutWrap}><div className={styles.donut} style={{ background: `conic-gradient(#00a7a0 0 ${pfPercent}%, #003d7c ${pfPercent}% 100%)` }}><div><strong>{pfPercent}%</strong><span>PF</span></div></div><div className={styles.legend}><div><span className={styles.pfDot} />PF<strong>{money(indicators.pf)}</strong></div><div><span className={styles.pjDot} />PJ<strong>{money(indicators.pj)}</strong></div></div></div></article><article className={styles.chartPanel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>EVOLUÇÃO</span><h3>Comparativo entre os meses</h3></div></div><div className={styles.barChart}>{monthlyComparison.map((item) => <div className={styles.barColumn} key={item.month}><span>{money(item.total)}</span><div><i style={{ height: `${Math.max(4, (item.total / maxComparison) * 100)}%` }} /></div><small>{monthLabel(item.month)}</small></div>)}</div></article></div>
              <div className={styles.dashboardGrid}><article className={styles.chartPanel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>META MENSAL</span><h3>Definir objetivo de vendas</h3></div></div><form className={styles.goalForm} onSubmit={saveGoal}><label><span>Mês</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label><span>Meta de venda</span><input type="number" min="0" step="0.01" value={goalValue} onChange={(event) => setGoalDraft({ month, value: Number(event.target.value) })} /></label><button className={styles.primaryButton} disabled={savingGoal}>{savingGoal ? "Salvando..." : "Salvar meta"}</button></form><div className={styles.progress}><span style={{ width: `${goalPercent}%` }} /></div><small>{goal ? `${goalPercent}% da meta alcançada` : "Cadastre a meta para acompanhar o progresso"}</small></article><article className={styles.chartPanel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>DESTINOS</span><h3>Para onde estamos vendendo</h3></div></div><div className={styles.destinationList}>{states.map((state) => ({ state, total: sales.filter((entry) => entry.destinationState === state).reduce((sum, entry) => sum + entryTotal(entry), 0) })).filter((item) => item.total > 0).sort((a, b) => b.total - a.total).slice(0, 6).map((item) => <div key={item.state}><strong>{item.state}</strong><span><i style={{ width: `${indicators.sold ? (item.total / indicators.sold) * 100 : 0}%` }} /></span><em>{money(item.total)}</em></div>)}{!sales.some((entry) => entry.destinationState) && <p className={styles.empty}>Os destinos aparecerão após as primeiras vendas.</p>}</div></article></div>
            </div>
          )}
        </section>
      </main>
    </ProtectedPage>
  );
}
