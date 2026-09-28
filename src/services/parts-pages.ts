import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, where, type QueryConstraint } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { PartOrder, VehicleFlow } from "@/types/domain";

export const PARTS_PAGE_SIZE = 50;
export type PartsScope = "active" | "archive" | "scheduling" | "schedulingHistory";

export async function loadPartsPage(scope: PartsScope, cursor?: string) {
  const constraints: QueryConstraint[] = [
    scope.startsWith("scheduling") ? where("orderStatus", "==", "disponivel")
      : scope === "archive" ? where("trackingState", "in", ["completed", "cancelled"])
        : where("trackingState", "==", "active"),
    orderBy(documentId()), limit(PARTS_PAGE_SIZE),
  ];
  if (scope.startsWith("scheduling")) constraints.push(where("trackingState", "==", scope === "schedulingHistory" ? "completed" : "active"));
  if (cursor) constraints.push(startAfter(cursor));
  const snapshot = await getDocs(query(collection(getFirebaseDb(), "partOrders"), ...constraints));
  const orders = snapshot.docs.map(item => ({ ...item.data(), id: item.id } as PartOrder));
  const vehicles: VehicleFlow[] = [];
  for (const id of new Set(orders.map(item => item.vehicleFlowId).filter(Boolean))) {
    const vehicle = await loadPartsVehicle(id);
    if (vehicle) vehicles.push(vehicle);
  }
  return {
    orders, vehicles,
    cursor: snapshot.size === PARTS_PAGE_SIZE ? snapshot.docs.at(-1)?.id : undefined,
  };
}

export async function loadPartsVehicle(id: string) {
  if (!id) return undefined;
  const result = await getDoc(doc(getFirebaseDb(), "vehiclesFlow", id));
  return result.exists() ? { ...result.data(), id: result.id } as VehicleFlow : undefined;
}

export async function loadPartById(id: string) {
  if (!id || id.includes("/")) return undefined;
  const result = await getDoc(doc(getFirebaseDb(), "partOrders", id));
  return result.exists() && result.data().orderStatus ? { ...result.data(), id: result.id } as PartOrder : undefined;
}
