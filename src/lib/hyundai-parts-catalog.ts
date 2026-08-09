import * as XLSX from "xlsx";
import type { HyundaiPartCatalogItem } from "@/types/domain";

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function parseHyundaiPartsCatalog(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const byReference = new Map<string, HyundaiPartCatalogItem>();

  rows.forEach((row) => {
    const firstCell = String(row[0] ?? "");
    const hasStructuredColumns = clean(row[1]).length > 0;
    const reference = clean(hasStructuredColumns ? row[0] : firstCell.slice(0, 18));
    const description = clean(hasStructuredColumns ? row[1] : firstCell.slice(18, 73));

    if (!reference || !description) return;
    if (/REFER[ÊE]NCIA|CODIGO|C[ÓO]D\.? ITEM/.test(reference)) return;

    byReference.set(reference, { reference, description });
  });

  return [...byReference.values()].sort((left, right) => left.reference.localeCompare(right.reference));
}
