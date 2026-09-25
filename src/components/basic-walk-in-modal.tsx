"use client";

import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import { basicConsultants, basicTechnicians, basicLanes } from "@/lib/basic-flow";
import { createBasicWalkIn, findBasicWalkInConflict, type BasicWalkInInput } from "@/services/basic-walk-in";
import type { VehicleFlow, WashType } from "@/types/domain";
import styles from "./basic-flow-board.module.css";

export function BasicWalkInModal({ day, vehicles, ready, onClose, onCreated }: { day: string; vehicles: VehicleFlow[]; ready: boolean; onClose: () => void; onCreated: () => void }) {
  const { user, profile } = useAuth();
  const [form,setForm] = useState<BasicWalkInInput>({ client:'',phone:'',plate:'',chassi:'',model:'',service:'Revisão 01',consultant:'',technician:'',washType:'simples',promised:'',note:'',day });
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
  const lock = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || !navigator.onLine || !user || !profile) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const conflict = findBasicWalkInConflict(form,vehicles);
      if (conflict && (conflict.currentLane !== 'preparacao_confirmada' || conflict.appointmentDate === form.day)) throw new Error(`Já existe um chip ativo: ${conflict.clientName}, ${conflict.plate || 'sem placa'}, ${basicLanes.find(l=>l.id===conflict.currentLane)?.label ?? conflict.currentLane}. Use esse chip para receber o veículo.`);
      if (conflict && !window.confirm(`Existe um agendamento de ${conflict.appointmentDate} para ${conflict.clientName}. Receber esse mesmo chip como passante hoje, sem duplicar?`)) return;
      await createBasicWalkIn(form,{uid:user.uid,name:profile.name,role:profile.role},conflict);
      onCreated();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível cadastrar.'); }
    finally { lock.current = false; setSaving(false); }
  }
  const field = (key: 'client'|'phone'|'plate'|'chassi'|'model', label: string) => <label className="field"><span>{label}</span><input required={key==='client'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
  return <div className={styles.overlay}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="walk-in-title"><div className="modal-head"><div><strong id="walk-in-title">Cadastrar passante</strong><span>Recebimento de hoje</span></div><button type="button" className="ghost-btn icon-btn" aria-label="Fechar cadastro" disabled={saving} onClick={onClose}>×</button></div>
    <form onSubmit={submit} className={styles.form}>
      {field('client','Cliente')}{field('phone','Telefone')}{field('plate','Placa')}{field('chassi','Chassi')}{field('model','Modelo')}
      <label>Tipo de atendimento<select value={form.service} onChange={e=>setForm({...form,service:e.target.value,technician:e.target.value==='Embelezamento'?'Igo':form.technician})}>{[...Array.from({length:10},(_,i)=>`Revisão ${String(i+1).padStart(2,'0')}`),'Diagnóstico','Reparo Geral','Recall','Combinado','Embelezamento'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Consultor<select required value={form.consultant} onChange={e=>setForm({...form,consultant:e.target.value})}><option value="">Selecionar</option>{basicConsultants.map(name=><option key={name}>{name}</option>)}</select></label>
      <label>Técnico<select required value={form.technician} onChange={e=>setForm({...form,technician:e.target.value})}><option value="">Selecionar</option>{basicTechnicians.map(name=><option key={name}>{name}</option>)}</select></label>
      <label>Previsão de entrega<input type="datetime-local" required value={form.promised} onChange={e=>setForm({...form,promised:e.target.value})}/></label>
      <label>Tipo de lavagem<select value={form.washType} onChange={e=>setForm({...form,washType:e.target.value as WashType})}><option value="nao">Sem lavagem</option><option value="simples">Lavagem simples</option><option value="motor">Lavagem de motor</option><option value="motor_bancos">Motor + bancos</option></select></label>
      <label>Observação<textarea value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
      {error&&<p className={styles.error} role="alert">{error}</p>}{!ready&&<p className={styles.error}>Aguarde a conexão do quadro antes de cadastrar.</p>}
      <footer><button type="button" className="ghost-btn" disabled={saving} onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving||!ready}>{saving?'Cadastrando...':'Cadastrar passante'}</button></footer>
    </form>
  </section></div>;
}
