"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { basicConsultants, basicLanes, basicTechnicians } from "@/lib/basic-flow";
import { PartCatalogFields } from "@/components/part-catalog-fields";
import { RoadTestFormModal } from "@/components/road-test-form-modal";
import { canEditChip, chipDate, loadChipCatalog, loadChipHistory, loadChipOrders, saveChipAction, type ChipAction } from "@/services/chip-details";
import type { FlowLane, PartOrder, PartOrderItem, PartOrderKind, VehicleFlow, WashType } from "@/types/domain";
import styles from "./chip-details-modal.module.css";

const washNames = { nao: "Não", simples: "Lavagem Simples", motor: "Lavagem de Motor", motor_bancos: "Lavagem Motor + Bancos" };
const services = [...Array.from({ length: 10 }, (_, i) => `Revisão ${String(i+1).padStart(2, "0")}`), "Diagnóstico", "Reparo Geral", "Recall", "Combinado", "Embelezamento"];
const statusNames: Record<string, string> = { solicitado_oficina: "Solicitado à oficina", necessidade_identificada: "Solicitado à oficina", aguardando_pecas: "Solicitado à oficina", pedido_realizado: "Pedido realizado", back_order: "Back order", em_transito: "Em trânsito", recebido: "Recebido", disponivel: "Disponível para agendamento", disponivel_execucao: "Disponível para execução", cancelado: "Cancelado" };
function format(value: unknown) { return chipDate(value)?.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) ?? "-"; }
type History = Awaited<ReturnType<typeof loadChipHistory>>;

function SaveChipButton({ text, action, disabled, saving, onSave }: { text: string; action: ChipAction; disabled: boolean; saving: boolean; onSave: (action: ChipAction) => Promise<void> }) {
  return <button className="primary-btn" type="button" disabled={saving || disabled} onClick={() => void onSave(action)}>{saving ? "Salvando..." : text}</button>;
}

export function ChipDetailsModal({ vehicle, onClose, initialParts = false, connectionReady = true }: { vehicle: VehicleFlow; onClose: () => void; initialParts?: boolean; connectionReady?: boolean }) {
  const { profile, user } = useAuth();
  const [plate, setPlate] = useState(vehicle.plate ?? "");
  const [consultant, setConsultant] = useState(vehicle.consultantName ?? "");
  const [technician, setTechnician] = useState(vehicle.technicianName ?? "");
  const [service, setService] = useState(vehicle.serviceLabel ?? "");
  const [wash, setWash] = useState<WashType>(vehicle.washType ?? "nao");
  const [waits, setWaits] = useState(vehicle.customerWaits);
  const [immobilized, setImmobilized] = useState(vehicle.vehicleImmobilized ?? false);
  const [reason, setReason] = useState(vehicle.immobilizationReason ?? "");
  const [promise, setPromise] = useState("");
  const [promiseNote, setPromiseNote] = useState("");
  const [stage, setStage] = useState<FlowLane>("aguardando_servico");
  const [stageNote, setStageNote] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [partsOpen, setPartsOpen] = useState(initialParts);
  const [parts, setParts] = useState<PartOrderItem[]>([{ id: "peca-1", partReference: "", partDescription: "" }]);
  const [kind, setKind] = useState<PartOrderKind | "">("");
  const [orders, setOrders] = useState<PartOrder[] | null>(null);
  const [ordersLimited, setOrdersLimited] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [ordersLoading, setOrdersLoading] = useState(initialParts);
  const [history, setHistory] = useState<History | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [roadTest, setRoadTest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false), ordersLock = useRef(false), historyLock = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const editVersion = useRef(vehicle.updatedAt);
  const ownMutation = useRef<string | null>(null);
  const latestVehicle = useRef(vehicle);
  const allowed = (action: ChipAction["kind"]) => canEditChip(profile?.role, action);

  useEffect(() => {
    latestVehicle.current = vehicle;
    if (ownMutation.current && vehicle.updatedAt && (vehicle as VehicleFlow & { chipMutationId?: string }).chipMutationId === ownMutation.current) {
      editVersion.current = vehicle.updatedAt; ownMutation.current = null;
    }
  }, [vehicle]);

  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { document.body.style.overflow = previous; active?.focus(); };
  }, []);
  async function fetchOrders(force = false) {
    if ((!force && orders !== null) || ordersLock.current) return;
    ordersLock.current = true;
    try {
      const result = await loadChipOrders(vehicle);
      setOrders(result.orders); setOrdersLimited(result.limited ?? false);
      const own = result.orders.find(order => order.id === vehicle.id);
      if (own) { setParts(own.parts?.length ? own.parts : [{ id: "peca-1", partReference: own.partReference ?? "", partDescription: own.partDescription ?? "" }]); setKind(own.orderKind ?? ""); }
    } catch (error) { setOrdersError(error instanceof Error ? error.message : "Não foi possível carregar os pedidos."); }
    finally { ordersLock.current = false; setOrdersLoading(false); }
  }
  function openOrders(force = false) {
    if ((!force && orders !== null) || ordersLock.current) return;
    setOrdersLoading(true); setOrdersError("");
    void fetchOrders(force);
  }
  useEffect(() => {
    // fetchOrders changes state only after the network promise settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialParts) void fetchOrders();
    // Opening a specific chip is the only automatic trigger; live updates do not reload orders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(action: ChipAction, rethrow = false) {
    if (lock.current || !user || !profile || !connectionReady || !navigator.onLine) {
      if (rethrow) throw new Error("Aguarde a operação atual e confira seu acesso antes de salvar.");
      return;
    }
    lock.current = true; setSaving(true); setMessage("");
    try {
      const saved = await saveChipAction({ ...vehicle, updatedAt: editVersion.current }, action, { uid: user.uid, name: profile.name, role: profile.role });
      ownMutation.current = saved.chipMutationId;
      if (latestVehicle.current.updatedAt && (latestVehicle.current as VehicleFlow & { chipMutationId?: string }).chipMutationId === saved.chipMutationId) {
        editVersion.current = latestVehicle.current.updatedAt; ownMutation.current = null;
      }
      setMessage("Alteração salva.");
      if (action.kind === "promise") { setPromise(""); setPromiseNote(""); }
      if (action.kind === "stage") setStageNote("");
      if (action.kind === "parts") { setOrders(null); setPartsOpen(false); }
      if (action.kind === "cancel") onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");
      if (rethrow) throw error;
    } finally { lock.current = false; setSaving(false); }
  }
  async function historyPage(more = false) {
    if (historyLock.current) return;
    historyLock.current = true; setHistoryLoading(true); setHistoryError("");
    try {
      const page = await loadChipHistory(vehicle.id, more ? history?.cursor : undefined);
      setHistory(old => ({ ...page, events: more ? [...(old?.events ?? []), ...page.events] : page.events }));
    } catch (error) { setHistoryError(error instanceof Error ? error.message : "Não foi possível carregar o histórico."); }
    finally { historyLock.current = false; setHistoryLoading(false); }
  }
  function selection(label: string, value: string, values: string[], onChange: (value: string) => void) {
    return <label className="field"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)}><option value="">Selecionar</option>{[...new Set([...values, ...(value ? [value] : [])])].map(item => <option key={item}>{item}</option>)}</select></label>;
  }
  const saveButton = (text: string, action: ChipAction, disabled = false) => <SaveChipButton text={text} action={action} disabled={disabled || !connectionReady || !allowed(action.kind)} saving={saving} onSave={save} />;
  const timeline = [
    ...(history?.events ?? []).filter(event => vehicle.noShow || !/NO-SHOW identificado automaticamente/i.test(event.actionNote ?? "")).map(event => ({ id: event.id, label: basicLanes.find(l => l.id === event.toLane)?.label || event.toLane, actor: event.actionBy, date: event.createdAt, note: event.actionNote })),
    ...(vehicle.promiseHistory ?? []).filter(item => !("chipDetailVersion" in item)).map((item, index) => ({ id: `promise-${index}`, label: "Previsão de entrega", actor: item.changedBy, date: item.changedAt, note: `${format(item.promisedDeliveryAt)} · ${item.note || "Sem observação"}` })),
  ].sort((a,b) => (chipDate(b.date)?.getTime() ?? 0) - (chipDate(a.date)?.getTime() ?? 0));
  return <>
    <div className="modal-backdrop"><section ref={dialog} tabIndex={-1} className={`flow-modal ${styles.details}`} role="dialog" aria-modal="true" aria-labelledby="chip-details-title" onKeyDown={event => {
      if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="modal-head"><div><strong id="chip-details-title">Detalhes do veículo</strong><span>{vehicle.clientName} · {vehicle.plate || "Sem placa"}</span></div><button type="button" className="ghost-btn icon-btn" disabled={saving} aria-label="Fechar detalhes" onClick={onClose}>×</button></div>
      {message && <p className={styles.message} role="status">{message}</p>}
      {!connectionReady && <p className={styles.message} role="alert">A conexão do quadro precisa ser restabelecida antes de salvar alterações.</p>}
      <div className="detail-grid modal-detail-grid">{[["Placa",vehicle.plate],["Chassi",vehicle.chassi],["Telefone",vehicle.phone],["Modelo",vehicle.model],["Consultor",vehicle.consultantName],["Técnico",vehicle.technicianName],["Etapa",basicLanes.find(l=>l.id===vehicle.currentLane)?.label],["Previsão atual",format(vehicle.promisedDeliveryAt)],["Cliente aguarda",vehicle.customerWaits?"Sim":"Não"],["Lavagem",washNames[vehicle.washType]],["Lavagem realizada",vehicle.washDone?"Sim":"Não"]].map(([label,value])=><div className="detail" key={label}><span>{label}</span>{value || "-"}</div>)}</div>
      <section className="history-box road-test-entry-box"><h3>Ficha de Teste de Rodagem</h3><button className="primary-btn" onClick={()=>setRoadTest(true)}>Abrir ficha</button></section>
      <section className="history-box"><h3>Placa do veículo</h3><div className="correction-grid"><label className="field"><span>Placa</span><input value={plate} onChange={e=>setPlate(e.target.value.toUpperCase())}/></label>{saveButton("Salvar placa",{kind:"plate",value:plate},!plate.trim())}</div></section>
      {allowed("consultant") && <section className="history-box"><h3>Consultor responsável</h3><div className="correction-grid">{selection("Consultor",consultant,basicConsultants,setConsultant)}{saveButton("Salvar consultor",{kind:"consultant",value:consultant},!consultant)}</div></section>}
      <section className="history-box"><h3>Técnico designado</h3><div className="correction-grid">{selection("Técnico",technician,basicTechnicians,setTechnician)}{saveButton("Salvar técnico",{kind:"technician",value:technician},!technician)}</div></section>
      <section className="history-box"><h3>Tipo de serviço</h3><div className="correction-grid">{selection("Serviço",service,services,setService)}{saveButton("Salvar serviço",{kind:"service",value:service},!service)}</div></section>
      <section className="history-box"><h3>Tipo da lavagem</h3><div className="correction-grid"><label className="field"><span>Lavagem</span><select value={wash} onChange={e=>setWash(e.target.value as WashType)}>{Object.entries(washNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{saveButton("Salvar lavagem",{kind:"wash",value:wash})}</div>
        {['aguardando_servico','orcamento_complementar'].includes(vehicle.currentLane) && vehicle.washType !== 'nao' && !vehicle.washDone && <div className={styles.actions}>{saveButton("Adiantar lavagem",{kind:"advanceWash"})}</div>}
      </section>
      {allowed("wait") && <section className="history-box"><h3>Cliente aguarda na loja</h3><div className="correction-grid"><label className="field"><span>Cliente aguarda?</span><select value={String(waits)} onChange={e=>setWaits(e.target.value==='true')}><option value="false">Não</option><option value="true">Sim</option></select></label>{saveButton("Salvar indicação",{kind:"wait",value:waits})}</div></section>}
      <section className="history-box"><h3>Veículo imobilizado</h3><div className={`correction-grid immobilization-grid${immobilized ? " has-reason" : ""}`}><label className="field"><span>Imobilizado?</span><select disabled={!allowed("immobilize")} value={String(immobilized)} onChange={e=>setImmobilized(e.target.value==='true')}><option value="false">Não</option><option value="true">Sim</option></select></label>{immobilized && <label className="field"><span>Motivo</span><select disabled={!allowed("immobilize")} value={reason} onChange={e=>setReason(e.target.value as typeof reason)}><option value="">Selecionar</option><option value="aguardando_pecas">Aguardando Peças</option><option value="aguardando_decisao">Aguardando Decisão</option></select></label>}{allowed("immobilize") && saveButton("Salvar imobilização",{kind:"immobilize",value:immobilized,reason},immobilized && !reason)}</div></section>
      <section className="history-box"><h3>Pedido de peças</h3><button className="primary-btn" disabled={ordersLoading} onClick={()=>{setPartsOpen(!partsOpen); if(!partsOpen) openOrders();}}>{partsOpen?"Recolher pedidos":"Abrir pedidos de peças"}</button>
        {partsOpen && <div className={styles.parts}><p role="status">{ordersLoading?"Carregando pedidos...":ordersError || (orders?.length ? "" : "Nenhum pedido vinculado encontrado.")}</p>{ordersLimited && <p>Há mais pedidos vinculados do que o limite desta consulta.</p>}
          <button className="primary-btn" disabled={ordersLoading||saving} onClick={()=>openOrders(true)}>Atualizar pedidos</button>
          {orders?.map(order=><article className={styles.order} key={order.id}><strong>{statusNames[order.orderStatus] || order.orderStatus}</strong><dl>{[["Tipo",order.orderKind],["Origem",order.orderSource],["Pedido",order.orderNumber],["Nota fiscal",order.invoiceNumber],["Previsão de chegada",order.expectedArrivalDate],["Solicitado por",order.requestedBy],["Atualizado por",order.updatedBy],["Atualizado em",format(order.updatedAt)],["Agendamento",order.scheduledReturnDate],["Observação",order.schedulingNote]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||"-"}</dd></div>)}</dl><ul>{(order.parts?.length?order.parts:[{id:"first",partReference:order.partReference,partDescription:order.partDescription}]).map(part=><li key={part.id}>{part.partReference} · {part.partDescription}</li>)}</ul></article>)}
          <label className="field"><span>Tipo do pedido</span><select value={kind} onChange={e=>setKind(e.target.value as PartOrderKind)}><option value="">Selecionar</option><option value="garantia">Garantia</option><option value="campanha">Campanha</option><option value="externo">Externo</option></select></label>
          {parts.map((part,index)=><div className="part-item-row" key={part.id}><PartCatalogFields index={index} reference={part.partReference??""} description={part.partDescription??""} loadCatalog={loadChipCatalog} onChange={value=>setParts(items=>items.map(item=>item.id===part.id?{...item,...value}:item))}/><button className="primary-btn" disabled={parts.length<=1||saving} onClick={()=>setParts(items=>items.filter(item=>item.id!==part.id))}>Remover</button></div>)}
          <div className={styles.actions}><button className="primary-btn" disabled={saving||parts.length>=50} onClick={()=>setParts(items=>[...items,{id:crypto.randomUUID(),partReference:"",partDescription:""}])}>+ Adicionar peça</button>{saveButton("Salvar pedido de peças",{kind:"parts",orderKind:kind as PartOrderKind,parts},!kind||ordersLoading||!!ordersError)}</div>
        </div>}
      </section>
      <section className="history-box"><h3>Observações</h3><p>Agenda: {vehicle.importedNotes||"-"}</p><p>Recebimento: {vehicle.receiveNote||"-"}</p><p>Peças: {vehicle.partsNote||"-"}</p></section>
      <section className="history-box"><h3>Histórico do chip</h3><button className="primary-btn" disabled={historyLoading} onClick={()=>void historyPage()}>{historyLoading?"Carregando...":history?"Atualizar histórico":"Carregar histórico"}</button>{historyError && <p role="alert">{historyError}</p>}
        {history && <><ul className="chip-history-list">{timeline.map(event=><li key={event.id}><strong>{event.label}</strong><span>{event.actor||"Operador não identificado"} · {format(event.date)}</span><p>{event.note}</p></li>)}</ul>{!timeline.length&&<p>Nenhuma movimentação registrada.</p>}{history.cursor&&<button className="primary-btn" disabled={historyLoading} onClick={()=>void historyPage(true)}>Carregar anteriores</button>}</>}
      </section>
      <section className="history-box correction-box"><h3>Corrigir etapa</h3><div className="correction-grid"><label className="field"><span>Enviar para</span><select value={stage} onChange={e=>setStage(e.target.value as FlowLane)}>{basicLanes.filter(l=>l.id!=="entregue").map(l=><option key={l.id} value={l.id}>{l.label}</option>)}</select></label><label className="field"><span>Motivo da correção</span><textarea value={stageNote} onChange={e=>setStageNote(e.target.value)}/></label></div>{saveButton("Aplicar correção de etapa",{kind:"stage",value:stage,note:stageNote},!stageNote.trim())}</section>
      <section className="history-box promise-update-box"><h3>Nova previsão de entrega</h3><div className="promise-update-grid"><label className="field"><span>Data e hora</span><input type="datetime-local" value={promise} onChange={e=>setPromise(e.target.value)}/></label><label className="field"><span>Motivo</span><input value={promiseNote} onChange={e=>setPromiseNote(e.target.value)}/></label></div>{saveButton("Salvar nova previsão",{kind:"promise",value:promise,note:promiseNote},!promise||!promiseNote.trim())}</section>
      {allowed("cancel")&&<section className="history-box"><h3>Excluir chip</h3><label className="field"><span>Motivo</span><input value={cancelNote} onChange={e=>setCancelNote(e.target.value)}/></label><button className="primary-btn" disabled={saving||!cancelNote.trim()} onClick={()=>{if(window.confirm(`Excluir o chip de ${vehicle.clientName}? O histórico será preservado.`))void save({kind:"cancel",note:cancelNote});}}>Excluir chip</button></section>}
      <div className="modal-actions"><button className="primary-btn" disabled={saving} onClick={onClose}>Fechar</button></div>
    </section></div>
    {roadTest&&<RoadTestFormModal vehicle={vehicle} onClose={()=>setRoadTest(false)} onSave={async value=>{await save({kind:"roadTest",value},true);}}/>}
  </>;
}
