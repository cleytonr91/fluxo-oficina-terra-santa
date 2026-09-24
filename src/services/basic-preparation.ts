import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { collections } from "@/lib/firebase/collections";

type BasicPreparedVehicle = {
  id: string; client: string; plate: string; chassi: string; model: string;
  eventId: string; phone: string; service: string; consultant: string;
  technician: string; appointmentDate: string; appointmentTime: string;
  importedNote: string; sourceFileName: string; importedBy: string;
};

export async function saveBasicPreparedVehicle(vehicle: BasicPreparedVehicle) {
  if (!vehicle.client.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(vehicle.appointmentDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(vehicle.appointmentTime)) {
    throw new Error("Confira cliente, data e horário do agendamento no arquivo.");
  }
  const db = getFirebaseDb();
  // Reuse the original appointment ID; a retry must never reset an existing chip.
  const flowRef = doc(db, collections.vehiclesFlow, vehicle.id);
  const eventRef = doc(db, collections.flowEvents, `basic-preparation-${vehicle.id}`);
  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(flowRef);
    if (existing.exists()) {
      const saved = existing.data();
      if (saved.appointmentDate !== vehicle.appointmentDate || saved.clientName !== vehicle.client) {
        throw new Error("O identificador deste agendamento já está em uso. Nenhum dado foi substituído.");
      }
      return;
    }
    transaction.set(flowRef, {
      appointmentId: vehicle.id,
      importedEventId: vehicle.eventId,
      origin: "agendado", currentLane: "preparacao_confirmada", status: "ativo",
      appointmentDate: vehicle.appointmentDate, appointmentTime: vehicle.appointmentTime,
      clientName: vehicle.client, plate: vehicle.plate, chassi: vehicle.chassi,
      model: vehicle.model, phone: vehicle.phone, serviceLabel: vehicle.service,
      consultantName: vehicle.consultant, technicianName: vehicle.technician,
      importedNotes: vehicle.importedNote, sourceFileName: vehicle.sourceFileName,
      preparationMode: "basic", priority: "normal", washType: "nao",
      roadTestRequired: false, chiefPresenceRequired: false, customerWaits: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    transaction.set(eventRef, {
      vehicleFlowId: vehicle.id, toLane: "preparacao_confirmada",
      actionBy: vehicle.importedBy,
      actionNote: "Veículo adicionado pela preparação básica, sem consulta de peças ou outros veículos",
      createdAt: serverTimestamp(),
    });
  });
}
