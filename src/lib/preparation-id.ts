export function preparationId(eventId: string) {
  const value = eventId.trim();
  if (!value || /^(null|undefined)$/i.test(value)) {
    throw new Error("Agendamento sem numero de evento. Confira o arquivo antes de importar.");
  }
  return `agenda-${encodeURIComponent(value)}`;
}
