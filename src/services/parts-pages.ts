import { collection, doc, documentId, endAt, getDoc, getDocs, limit, orderBy, query, startAfter, startAt, where, type QueryConstraint } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { PartOrder, VehicleFlow } from "@/types/domain";

export const PARTS_PAGE_SIZE = 50;
export type PartsScope = "active" | "archive" | "scheduling" | "schedulingHistory";

export type PartsSearchResult = {
  orders: PartOrder[];
  vehicles: VehicleFlow[];
  vehiclesWithoutOrder: VehicleFlow[];
};

function normalizeSearchValue(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function partOrderFromSnapshot(item: { id: string; data: () => Record<string, unknown> }) {
  const data = item.data();
  return data.orderStatus ? { ...data, id: item.id } as PartOrder : undefined;
}

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

export async function searchPartOrders(value: string): Promise<PartsSearchResult> {
  const db = getFirebaseDb();
  const cleaned = value.trim();
  const normalized = normalizeSearchValue(value);
  const ordersById = new Map<string, PartOrder>();
  const vehiclesById = new Map<string, VehicleFlow>();

  if (!cleaned) return { orders: [], vehicles: [], vehiclesWithoutOrder: [] };

  const isPlateSearch = /^[A-Z]{3}(?:\d{4}|\d[A-Z]\d{2})$/.test(normalized);
  const snapshots = isPlateSearch
    ? await Promise.all([
      getDocs(query(collection(db, "partOrders"), where("plate", "==", normalized), limit(25))),
      getDocs(query(collection(db, "vehiclesFlow"), where("plate", "==", normalized), limit(25))),
    ])
    : await Promise.all([...new Set([cleaned, cleaned.toUpperCase()])].flatMap((candidate) => [
      getDocs(query(collection(db, "partOrders"), orderBy("clientName"), startAt(candidate), endAt(`${candidate}\uf8ff`), limit(25))),
      getDocs(query(collection(db, "vehiclesFlow"), orderBy("clientName"), startAt(candidate), endAt(`${candidate}\uf8ff`), limit(25))),
    ]));

  snapshots.forEach((snapshot, index) => {
    const isOrderSnapshot = isPlateSearch ? index === 0 : index % 2 === 0;
    snapshot.docs.forEach((item) => {
      if (isOrderSnapshot) {
        const order = partOrderFromSnapshot(item);
        if (order) ordersById.set(order.id, order);
      } else {
        vehiclesById.set(item.id, { ...item.data(), id: item.id } as VehicleFlow);
      }
    });
  });

  await Promise.all([...vehiclesById.values()].map(async (vehicle) => {
    const [orderWithVehicleId, orderWithSameId] = await Promise.all([
      getDocs(query(collection(db, "partOrders"), where("vehicleFlowId", "==", vehicle.id), limit(25))),
      getDoc(doc(db, "partOrders", vehicle.id)),
    ]);
    orderWithVehicleId.docs.forEach((item) => {
      const order = partOrderFromSnapshot(item);
      if (order) ordersById.set(order.id, order);
    });
    if (orderWithSameId.exists()) {
      const order = partOrderFromSnapshot(orderWithSameId);
      if (order) ordersById.set(order.id, order);
    }
  }));

  await Promise.all([...ordersById.values()].map(async (order) => {
    if (!order.vehicleFlowId || vehiclesById.has(order.vehicleFlowId)) return;
    const vehicle = await loadPartsVehicle(order.vehicleFlowId);
    if (vehicle) vehiclesById.set(vehicle.id, vehicle);
  }));

  const linkedVehicleIds = new Set([...ordersById.values()].map((order) => order.vehicleFlowId).filter(Boolean));
  const vehiclesWithoutOrder = [...vehiclesById.values()].filter((vehicle) => (
    vehicle.partsOrdered && !linkedVehicleIds.has(vehicle.id) && !ordersById.has(vehicle.id)
  ));

  return {
    orders: [...ordersById.values()],
    vehicles: [...vehiclesById.values()],
    vehiclesWithoutOrder,
  };
}
