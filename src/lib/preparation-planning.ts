import maintenance from "@/data/maintenance-plans.json";
import type { Appointment } from "@/components/preparation-import";

export type PickPart = { code: string; name: string; quantity: number; source: string };
export type Campaign = { id: string; code: string; name: string; kind: "campanha" | "recall"; tmo: string; parts: PickPart[]; active: boolean; version: number };
export type WorkshopPreparation = { technician: string; roadTest: boolean; note: string; repairParts: PickPart[] };
export type WarrantyPreparation = { status: "pendente" | "sem_pendencias" | "com_pendencias" | "garantia" | "recall"; note: string; campaigns: Campaign[]; parts?: PickPart[] };
export type PartsPreparation = { apoloCode?: string; modelYear: string; planId: string; revision: number; revisionParts?: PickPart[]; plate?: string; chassi?: string; extraParts: PickPart[]; note: string; ready: boolean; sourceVersion: string };
export type Preparation = {
  id: string; date: string; appointment: Appointment; sourceFile: string;
  workshop: WorkshopPreparation; warranty: WarrantyPreparation; parts: PartsPreparation;
  workshopVersion: number; warrantyVersion: number; partsVersion: number;
  sent: boolean; updatedBy?: string;
};
export type Section = "workshop" | "warranty" | "parts";
export const plans = maintenance.plans;
export const planKey = (plan: (typeof plans)[number]) => `${plan.model}-${plan.years.join("-")}`;
export const sourceVersion = (p: Preparation) => `${p.workshopVersion}:${p.warrantyVersion}`;
export const canPrepare = (role?: string) => ["admin", "gerente", "chefe_oficina"].includes(role ?? "");
export const canWarranty = (role?: string) => ["admin", "gerente", "garantista"].includes(role ?? "");
export const canPick = (role?: string) => ["admin", "gerente", "estoquista"].includes(role ?? "");
export function createPreparation(appointment: Appointment, sourceFile: string): Preparation {
  return { id: appointment.id, date: appointment.date, appointment, sourceFile,
    workshop: { technician: "", roadTest: appointment.roadTest, note: "", repairParts: [] },
    warranty: { status: "pendente", note: "", campaigns: [] },
    parts: { modelYear: appointment.modelYear ?? "", planId: "", revision: 0, extraParts: [], note: "", ready: false, sourceVersion: "0:0" },
    workshopVersion: 0, warrantyVersion: 0, partsVersion: 0, sent: false };
}
export function validateParts(parts: PickPart[]) {
  if (parts.length > 80) throw new Error("Limite de 80 peças por lista.");
  if (parts.some(p => !p.code.trim() || !p.name.trim() || !Number.isFinite(p.quantity) || p.quantity <= 0)) throw new Error("Preencha código, descrição e quantidade positiva de cada peça.");
}
export function separationParts(p: Preparation): PickPart[] {
  const plan = plans.find(plan => planKey(plan) === p.parts.planId);
  const revisionParts: PickPart[] = plan && p.parts.revision > 0 ? plan.items.filter(item => item.revisions[p.parts.revision - 1]).map(item => ({code:item.partNumber,name:item.name,quantity:item.quantity ?? 0,source:`${p.parts.revision}ª revisão`})) : [];
  const rows = [...(p.parts.revisionParts ?? revisionParts), ...p.workshop.repairParts.map(x=>({...x,source:"Reparo"})), ...p.warranty.campaigns.flatMap(c=>c.parts.map(x=>({...x,source:`${c.kind === "recall" ? "Recall" : "Campanha"} ${c.code}`}))), ...(p.warranty.parts ?? []).map(x=>({...x,source:p.warranty.status === "recall" ? "Recall" : "Garantia"})), ...p.parts.extraParts.map(x=>({...x,source:"Peças adicionais"}))];
  const result = new Map<string, PickPart>();
  for (const part of rows) { const key = part.code.trim().toUpperCase(); const prior = result.get(key); if (prior) { prior.quantity = Math.round((prior.quantity + part.quantity)*1000)/1000; if (!prior.source.includes(part.source)) prior.source += ` + ${part.source}`; } else result.set(key,{...part,code:key}); }
  return [...result.values()];
}
export function pickingIssues(p: Preparation): string[] {
  const issues: string[]=[];
  if (!p.parts.modelYear.trim()) issues.push("Informe o ano/modelo.");
  if (!p.appointment.client.trim() || !(p.parts.plate ?? p.appointment.plate).trim() || (p.parts.plate ?? p.appointment.plate).startsWith("SEMPLACA") || !(p.parts.chassi ?? p.appointment.chassi).trim()) issues.push("Confira nome, placa e chassi do agendamento.");
  if (p.warranty.status === "pendente") issues.push("Aguarde a conferência de campanha/recall.");
  if (/revis/i.test(p.appointment.service) && !p.parts.planId) issues.push("Selecione o modelo do cardápio e a revisão.");
  if (p.parts.planId) { const plan=plans.find(x=>planKey(x)===p.parts.planId); if (!plan || p.parts.revision < 1 || p.parts.revision > plan.operationTimes.length || !Number.isInteger(p.parts.revision)) issues.push("Confira a revisão selecionada."); if(plan && !plan.years.includes(Number(p.parts.modelYear))) issues.push("O ano informado não corresponde ao plano escolhido."); }
  try {validateParts(separationParts(p));} catch(e) {issues.push((e as Error).message);}
  if (!separationParts(p).length) issues.push("Nenhuma peça indicada para separação.");
  return issues;
}
export function validateSection(p: Preparation, section: Section) {
  if(section==="workshop") validateParts(p.workshop.repairParts);
  if(section==="warranty") {
    if(p.warranty.status==="com_pendencias" && !p.warranty.campaigns.length) throw new Error("Inclua a campanha ou recall identificado.");
    if(["pendente", "sem_pendencias"].includes(p.warranty.status) && (p.warranty.campaigns.length || p.warranty.parts?.length)) throw new Error("Selecione Garantia ou Recall para manter as peças ou campanhas indicadas.");
    validateParts(p.warranty.parts ?? []);
    for(const c of p.warranty.campaigns) { if(!c.code.trim() || !c.name.trim() || !c.tmo.trim()) throw new Error("Preencha código, nome e TMO da campanha."); validateParts(c.parts); }
  }
  if(section==="parts") { validateParts(p.parts.extraParts); if(p.parts.revisionParts)validateParts(p.parts.revisionParts); if(p.parts.ready && pickingIssues(p).length) throw new Error(pickingIssues(p).join(" ")); }
}

// Suggestions never overwrite a saved choice, and ambiguous versions require confirmation.
export function suggestedPlans(model: string, year: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/(\d)[,.](\d)/g, "$1.$2");
  const input = normalize(model);
  const parsedYear = year.match(/(?:19|20)\d{2}/g)?.at(-1);
  if (!parsedYear) return [];
  const family = input.match(/HB20X?|CRETA|AZERA|IONIQ|IX35|KONA|PALISADE|SANTA FE|ELANTRA|TUCSON|I20|I30|HD\s*80|\bHR\b/)?.[0];
  if (!family) return [];
  const engine = input.match(/\b[123]\.[0-9]/)?.[0];
  const turbo = /TGDI|T-GDI|TURBO|TCI/.test(input);
  const candidates = plans.filter(p => {
    const label = normalize(p.model);
    return p.years.includes(Number(parsedYear)) && label.includes(family)
      && (!engine || !/\b[123]\.[0-9]/.test(label) || label.includes(engine))
      && (!turbo || /TGDI|T-GDI|TURBO|TCI/.test(label))
      && (!/MPI/.test(input) || !/TGDI|T-GDI|TURBO|TCI/.test(label));
  });
  const exact = candidates.filter(p => normalize(p.model) === input);
  return exact.length ? exact : candidates;
}
