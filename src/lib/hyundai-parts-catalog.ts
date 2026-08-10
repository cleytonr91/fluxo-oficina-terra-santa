import * as XLSX from "xlsx";
import type { HyundaiPartCatalogItem } from "@/types/domain";

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function priceFromFixedWidthRow(value: string) {
  const rawPrice = value.slice(119, 130).replace(/\D/g, "");
  return rawPrice ? Number(rawPrice) / 100 : undefined;
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
    const description = clean(hasStructuredColumns ? row[1] : firstCell.slice(18, 78));
    const structuredPrice = [...row].slice(2).map(Number).find((value) => Number.isFinite(value) && value >= 0);
    const salePrice = hasStructuredColumns ? structuredPrice : priceFromFixedWidthRow(firstCell);

    if (!reference || !description) return;
    if (/REFER[ÊE]NCIA|CODIGO|C[ÓO]D\.? ITEM/.test(reference)) return;

    byReference.set(reference, { reference, description, salePrice });
  });

  return [...byReference.values()].sort((left, right) => left.reference.localeCompare(right.reference));
}
