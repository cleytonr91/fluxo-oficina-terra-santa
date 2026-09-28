import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { HyundaiPartCatalogItem } from "@/types/domain";

const key = "hyundai-catalog-v2";
let request: Promise<HyundaiPartCatalogItem[]> | undefined;
export function clearCatalogCache() {
  request = undefined;
  try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
}

export function loadCachedCatalog() {
  return request ??= (async () => {
    const db = getFirebaseDb();
    const meta = await getDoc(doc(db, "partsCatalog", "meta"));
    const data = meta.data();
    const count = Number(data?.chunkCount);
    if (!meta.exists() || !Number.isInteger(count) || count < 0 || count > 100) throw new Error("Catálogo indisponível. Use o preenchimento manual.");
    const version = `${data?.contentHash ?? ""}:${data?.importedAt?.toMillis?.() ?? ""}:${count}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) ?? "null");
      if (cached?.version === version && Array.isArray(cached.items)) return cached.items as HyundaiPartCatalogItem[];
    } catch { /* Fall back to bounded chunk reads. */ }
    const items: HyundaiPartCatalogItem[] = [];
    for (let index = 0; index < count; index++) {
      const chunk = await getDoc(doc(db, "partsCatalog", `chunk-${String(index).padStart(3, "0")}`));
      if (!chunk.exists()) throw new Error("Catálogo incompleto. Tente novamente após a importação.");
      items.push(...(chunk.data().items ?? []));
    }
    try { localStorage.setItem(key, JSON.stringify({ version, items })); } catch { /* In-memory cache remains available. */ }
    return items;
  })().catch(error => { request = undefined; throw error; });
}

export async function importCachedCatalog(input: { items: HyundaiPartCatalogItem[]; sourceFileName: string; importedBy?: string }) {
  const normalized = [...input.items].sort((a, b) => a.reference.localeCompare(b.reference));
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized)));
  const contentHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  const db = getFirebaseDb(), ref = doc(db, "partsCatalog", "meta"), meta = await getDoc(ref);
  if (meta.data()?.contentHash === contentHash) return;
  const count = Math.ceil(normalized.length / 700);
  if (!count || count > 100) throw new Error("O catálogo deve ter entre 1 e 70.000 itens.");
  const batch = writeBatch(db);
  for (let index = 0; index < count; index++) batch.set(doc(db, "partsCatalog", `chunk-${String(index).padStart(3, "0")}`), {
    items: normalized.slice(index * 700, (index + 1) * 700), contentHash,
  });
  batch.set(ref, { itemCount: normalized.length, chunkCount: count, contentHash, sourceFileName: input.sourceFileName, importedBy: input.importedBy ?? "", importedAt: serverTimestamp() });
  await batch.commit();
  clearCatalogCache();
}
