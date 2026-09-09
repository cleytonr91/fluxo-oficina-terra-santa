"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;

    const removeOfflineVersion = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const hadOfflineVersion = registrations.length > 0;
        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ("caches" in window) {
          const cacheNames = await window.caches.keys();
          await Promise.all(cacheNames.filter((name) => name.startsWith("fluxo-oficina-")).map((name) => window.caches.delete(name)));
        }

        if (hadOfflineVersion && navigator.serviceWorker.controller && !new URL(window.location.href).searchParams.has("online")) {
          const updatedUrl = new URL(window.location.href);
          updatedUrl.searchParams.set("online", "20260909");
          window.location.replace(updatedUrl);
        }
      } catch (error) {
        console.error("[app-update] Falha ao remover a versão offline antiga", error);
      }
    };
    void removeOfflineVersion();
  }, []);

  return null;
}
