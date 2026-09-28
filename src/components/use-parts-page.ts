"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadPartsPage, type PartsScope } from "@/services/parts-pages";
import type { PartOrder, VehicleFlow } from "@/types/domain";

export function usePartsPage(scope: PartsScope, userId?: string) {
  const [orders, setOrders] = useState<PartOrder[]>([]);
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async (after?: string) => {
    if (!userId || busy.current) return;
    busy.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const page = await loadPartsPage(scope, after);
      if (request !== generation.current) return;
      setOrders(current => after ? [...new Map([...current, ...page.orders].map(item => [item.id, item])).values()] : page.orders);
      setCursor(page.cursor);
      setVehicles(current => after ? [...new Map([...current, ...page.vehicles].map(item => [item.id, item])).values()] : page.vehicles);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Falha ao carregar pedidos.");
    } finally {
      if (request === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [scope, userId]);

  useEffect(() => {
    const requestGeneration = generation;
    // A deferred first read avoids a duplicate request in Strict Mode.
    const timer = setTimeout(() => { void load(); }, 0);
    return () => { clearTimeout(timer); requestGeneration.current++; busy.current = false; };
  }, [load]);

  return { orders, setOrders, vehicles, setVehicles, loading, error, hasMore: Boolean(cursor), refresh: () => load(), more: () => cursor ? load(cursor) : Promise.resolve() };
}
