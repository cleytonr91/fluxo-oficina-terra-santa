import { listDeliveredVehicleFlowsForMonth, listDeliveredVehicleFlowsForPeriod, listHgsiAnswersForMonth, listHgsiRecords, listHgsiRecordsForMonth, listPostServiceCasesForMonth } from "@/services/firestore";

export async function loadPostServiceMonth(month: string, closed: boolean, period?: { start: string; end: string }) {
  // Closed campaigns need survey results only, never operational history.
  if (closed) {
    return { vehicles: [], records: [], history: [], cases: [], answers: await listHgsiAnswersForMonth(month) };
  }
  const [vehicles, records, history, answers, cases] = await Promise.all([
    period ? listDeliveredVehicleFlowsForPeriod(period.start, period.end) : listDeliveredVehicleFlowsForMonth(month),
    listHgsiRecordsForMonth(month), listHgsiRecords(), listHgsiAnswersForMonth(month), listPostServiceCasesForMonth(month),
  ]);
  return { vehicles, records, history, answers, cases };
}
