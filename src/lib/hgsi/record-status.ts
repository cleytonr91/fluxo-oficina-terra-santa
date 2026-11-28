function normalizeRecordStatus(value?: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isValidHgsiRecordStatus(status?: string) {
  const normalized = normalizeRecordStatus(status);
  if (!normalized) return false;
  if (normalized.includes("invalido") || normalized.includes("nao valido")) return false;
  if (normalized.includes("nao respondido")) return false;
  if (normalized.includes("sem autorizacao")) return false;

  return normalized.includes("registro valido")
    || normalized === "valido"
    || normalized.includes(" valido")
    || /(^| )respondido( |$)/.test(normalized)
    || normalized.includes("entrevista realizada");
}
