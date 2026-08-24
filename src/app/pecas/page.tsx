"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { invalidatePartsCatalogCache, PartCatalogFields } from "@/components/part-catalog-fields";
import { useAuth } from "@/context/auth-context";
import { createStandalonePartOrder, ensurePartOrderTracking, listArchivedPartOrders, replaceHyundaiPartsCatalog, subscribeActivePartOrders, subscribePartOrders, subscribeVehicleFlowsByIds, updatePartOrder } from "@/services/firestore";
import { parseHyundaiPartsCatalog } from "@/lib/hyundai-parts-catalog";
import type { PartOrder, PartOrderItem, PartOrderKind, PartOrderSource, PartOrderStatus, VehicleFlow } from "@/types/domain";

type PartOrderFormFields = {
  customerId: string;
  orderKind: PartOrderKind | "";
  parts: PartOrderItem[];
  orderStatus: PartOrderStatus;
  orderSource: PartOrderSource | "";
  orderNumber: string;
  orderVor: boolean;
  orderDate: string;
  invoiceNumber: string;
  expectedArrivalDate: string;
  cancellationReason: string;
};

type StandalonePartOrderFormFields = PartOrderFormFields & {
  clientName: string;
  plate: string;
};

type PartOrderValidationField = "orderKind" | "orderSource" | "orderNumber" | "invoiceNumber" | "expectedArrivalDate" | "cancellationReason";
type PartOrderValidationErrors = Partial<Record<PartOrderValidationField, string>>;

type TransportInfoModal = "tip" | "contacts" | null;

const trackingLinks = {
  glovis: "https://glovistms.eslcloud.com.br/recipient_tracking",
  ceva: "https://orionbr.cevalogistics.com/Tracking/TrackingInvoice.aspx",
};

const carrierContacts = [
  { carrier: "GLOVIS", area: "Programação/Operação", name: "Marcelo Vedoveto", email: "marcelo.vedoveto@glovis.com.br", phone: "(19) 97411-1563" },
  { carrier: "GLOVIS", area: "Programação/Operação", name: "Adler Heleno", email: "adler.heleno@glovis.com.br", phone: "Sem telefone disponível" },
  { carrier: "GLOVIS", area: "Atendimento ao cliente", name: "Pamela Leite", email: "pamela.leite@glovis.com.br", phone: "(11) 91841-3151" },
  { carrier: "GLOVIS", area: "Filial Paulista", name: "Douglas Barral", email: "douglas.barral@glovis.com.br", phone: "(19) 97409-9052" },
  { carrier: "GLOVIS", area: "Filial Juiz de Fora", name: "Geraldo Junior", email: "geraldo.junior@glovis.com.br", phone: "(32) 99182-0888" },
  { carrier: "GLOVIS", area: "Filial Lages", name: "Emanuel Silva", email: "emanuel.silva@glovis.com.br", phone: "(11) 94726-8418" },
  { carrier: "GLOVIS", area: "Gestão", name: "Davi An", email: "davi.an@glovis.com.br", phone: "(11) 97207-9293" },
  { carrier: "CEVA", area: "Programação/Operação", name: "Renata Lilo", email: "ext.renata.lilo@cevalogistics.com", phone: "Sem telefone disponível" },
  { carrier: "CEVA", area: "Atendimento ao cliente", name: "Murilo Anjos", email: "ext.murilo.anjos@cevalogistics.com", phone: "(19) 98925-5917" },
  { carrier: "CEVA", area: "Gestão", name: "Rodrigo Zanardo", email: "ext.rodrigo.zanardo@cevalogistics.com", phone: "(11) 99136-9323" },
] as const;

const statusLabels: Record<PartOrderStatus, string> = {
  solicitado_oficina: "Solicitado oficina",
  necessidade_identificada: "Solicitado oficina",
  aguardando_pecas: "Solicitado oficina",
  pedido_realizado: "Pedido realizado",
  back_order: "B.O",
  em_transito: "Em trânsito",
  recebido: "Recebido",
  disponivel: "Disponível",
  cancelado: "Cancelado",
};

const statusOptions: Array<{ value: PartOrderStatus; label: string }> = [
  { value: "solicitado_oficina", label: "Solicitado oficina" },
  { value: "pedido_realizado", label: "Pedido realizado" },
  { value: "back_order", label: "B.O (Back Order)" },
  { value: "em_transito", label: "Em trânsito" },
  { value: "recebido", label: "Recebido" },
  { value: "disponivel", label: "Disponível" },
  { value: "cancelado", label: "Cancelado" },
];

const sourceOptions: Array<{ value: PartOrderSource; label: string }> = [
  { value: "mobis", label: "Mobis" },
  { value: "natal", label: "Natal" },
  { value: "mossoro", label: "Mossoró" },
  { value: "juazeiro", label: "Juazeiro" },
  { value: "rede_autorizada", label: "Rede Autorizada" },
];

const kindOptions: Array<{ value: PartOrderKind; label: string }> = [
  { value: "garantia", label: "Garantia" },
  { value: "campanha", label: "Campanha" },
  { value: "externo", label: "Externo" },
];

const emptyStandalonePartOrder: StandalonePartOrderFormFields = {
  clientName: "",
  plate: "",
  customerId: "",
  orderKind: "",
  parts: [{ id: "peca-1", partReference: "", partDescription: "" }],
  orderStatus: "solicitado_oficina",
  orderSource: "",
  orderNumber: "",
  orderVor: false,
  orderDate: new Date().toISOString().slice(0, 10),
  invoiceNumber: "",
  expectedArrivalDate: "",
  cancellationReason: "",
};


type PartsFilter = "pendentes" | "todos" | "vor" | "concluidos" | PartOrderStatus;
type PartEditSection = "dados" | "pedido" | "pecas" | "cancelamento" | "info";

type MobisReceiptItem = {
  id: string;
  mobisOrder: string;
  line: string;
  partReference: string;
  partDescription: string;
  quantity: number;
};

type MobisReceiptMatch = {
  item: MobisReceiptItem;
  candidates: PartOrder[];
  recommended?: PartOrder;
  reason: string;
};

type MobisReceiptState = {
  fileName: string;
  invoiceNumber: string;
  safe: MobisReceiptMatch[];
  doubtful: MobisReceiptMatch[];
  notFound: MobisReceiptItem[];
  error: string;
};

type MobisActionFeedback = {
  type: "success" | "error";
  message: string;
} | null;

const emptyMobisReceipt: MobisReceiptState = {
  fileName: "",
  invoiceNumber: "",
  safe: [],
  doubtful: [],
  notFound: [],
  error: "",
};

function formatDate(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate() as Date;
  }
  return null;
}

function formatDateTime(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatActionSignature(actionBy: string | undefined, value: unknown, fallback = "Operador") {
  const operator = actionBy || fallback;
  const date = toDate(value);
  if (!date) return operator;
  if (date.getHours() >= 18) return operator;
  return `${operator} · ${formatDateTime(value)}`;
}

function formatOperationalDateTime(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  if (date.getHours() >= 18) return "Fora do expediente";
  return formatDateTime(value);
}

function statusTone(status: PartOrderStatus) {
  if (status === "disponivel" || status === "recebido") return "good";
  if (status === "cancelado") return "bad";
  if (status === "em_transito" || status === "pedido_realizado" || status === "back_order") return "warn";
  return "";
}

function effectiveOrderStatus(order: PartOrder): PartOrderStatus {
  return order.cancellationReason?.trim() ? "cancelado" : order.orderStatus;
}

function isWorkshopRequestedStatus(order: PartOrder) {
  const status = effectiveOrderStatus(order);
  return status === "solicitado_oficina"
    || status === "necessidade_identificada"
    || status === "aguardando_pecas";
}

function sourceLabel(value?: PartOrderSource) {
  return sourceOptions.find((option) => option.value === value)?.label ?? "-";
}

function kindLabel(value?: PartOrderKind) {
  return kindOptions.find((option) => option.value === value)?.label ?? "-";
}

function whatsappUrl(phone?: string) {
  const digits = phone?.replace(/\D/g, "");
  if (!digits || digits.length < 10) return "";
  return `https://wa.me/55${digits.length > 11 ? digits.slice(-11) : digits}`;
}

function orderParts(order: PartOrder) {
  if (order.parts?.length) return order.parts;
  return [{ id: "peca-1", partReference: order.partReference ?? "", partDescription: order.partDescription ?? "" }];
}

function normalizeCode(value?: string) {
  return String(value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function normalizeSearchText(value?: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function hasInformedPart(order: PartOrder) {
  return orderParts(order).some((part) => (
    Boolean(part.partReference?.trim()) || Boolean(part.partDescription?.trim())
  ));
}

function isInternalCommissionOrder(order: PartOrder) {
  return normalizeSearchText(order.plate) === "LIN226"
    || normalizeSearchText(order.clientName) === "COMISSAOCLIENTES";
}

function isAutomaticallyCompletedWorkshopOrder(order: PartOrder) {
  return isWorkshopRequestedStatus(order)
    && (!hasInformedPart(order) || isInternalCommissionOrder(order));
}

function shouldShowWorkshopActionOrder(order: PartOrder) {
  return isWorkshopRequestedStatus(order) && !isAutomaticallyCompletedWorkshopOrder(order);
}

function orderTimeValue(order: PartOrder) {
  const date = toDate(order.createdAt) ?? toDate(order.updatedAt);
  return date?.getTime() ?? 0;
}

function statusTimeValue(order: PartOrder) {
  const statusDate = toDate(order.orderStatusUpdatedAt);
  if (statusDate) return statusDate.getTime();

  if (effectiveOrderStatus(order) === "pedido_realizado" && order.orderDate) {
    const orderDate = new Date(`${order.orderDate}T00:00:00`);
    if (!Number.isNaN(orderDate.getTime())) return orderDate.getTime();
  }

  const fallback = isWorkshopRequestedStatus(order)
    ? toDate(order.createdAt)
    : toDate(order.updatedAt) ?? toDate(order.createdAt);
  return fallback?.getTime() ?? Date.now();
}

function daysInCurrentStatus(order: PartOrder) {
  return Math.max(0, Math.floor((Date.now() - statusTimeValue(order)) / 86400000));
}

function daysLabel(order: PartOrder) {
  const days = daysInCurrentStatus(order);
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

function needsStatusUpdate(order: PartOrder) {
  const status = effectiveOrderStatus(order);
  const days = daysInCurrentStatus(order);
  return (status === "pedido_realizado" && days > 3)
    || (status === "em_transito" && days > 9);
}

function orderHasPart(order: PartOrder, partReference: string) {
  const reference = normalizeCode(partReference);
  return orderParts(order).some((part) => normalizeCode(part.partReference) === reference);
}

function parseMobisReceiptLines(lines: string[]) {
  const invoiceNumber = lines
    .map((line) => line.match(/NF-e\s*:\s*([0-9]+)/i)?.[1])
    .find(Boolean) ?? "";
  const items: MobisReceiptItem[] = [];
  const rowPattern = /^([0-9A-Z]+)\s+([0-9]{4})\s+([0-9A-Z]{6,20})\s+(.+?)\s+([0-9]+)$/i;

  lines.forEach((line, index) => {
    const cleanLine = line.replace(/\s+/g, " ").trim();
    const match = cleanLine.match(rowPattern);
    if (!match) return;

    const [, mobisOrder, itemLine, partReference, partDescription, quantity] = match;
    if (["Pedido", "Total", "Itens", "Peças"].some((term) => cleanLine.startsWith(term))) return;

    items.push({
      id: `${mobisOrder}-${itemLine}-${partReference}-${index}`,
      mobisOrder: mobisOrder.toUpperCase(),
      line: itemLine,
      partReference: partReference.toUpperCase(),
      partDescription: partDescription.trim().toUpperCase(),
      quantity: Number(quantity),
    });
  });

  return { invoiceNumber, items };
}

export default function PecasPage() {
  const { profile, user } = useAuth();
  const initialFocusedOrderId = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("pedido") ?? "";
  const [orders, setOrders] = useState<PartOrder[]>([]);
  const [archivedOrders, setArchivedOrders] = useState<PartOrder[]>([]);
  const [archiveLoadState, setArchiveLoadState] = useState<"idle" | "loading" | "loaded">("idle");
  const [trackingOptimized, setTrackingOptimized] = useState(false);
  const [orderForms, setOrderForms] = useState<Record<string, Partial<PartOrderFormFields>>>({});
  const [orderValidationErrors, setOrderValidationErrors] = useState<Record<string, PartOrderValidationErrors>>({});
  const [openSections, setOpenSections] = useState<Record<string, PartEditSection | undefined>>({});
  const [savingId, setSavingId] = useState("");
  const [statusFilter, setStatusFilter] = useState<PartsFilter>(initialFocusedOrderId ? "todos" : "pendentes");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedOrderId, setFocusedOrderId] = useState(initialFocusedOrderId);
  const [error, setError] = useState("");
  const [mobisReceipt, setMobisReceipt] = useState<MobisReceiptState>(emptyMobisReceipt);
  const [applyingReceiptId, setApplyingReceiptId] = useState("");
  const [mobisActionFeedback, setMobisActionFeedback] = useState<MobisActionFeedback>(null);
  const [syncingPortal, setSyncingPortal] = useState(false);
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const [transportInfoModal, setTransportInfoModal] = useState<TransportInfoModal>(null);
  const [standaloneForm, setStandaloneForm] = useState<StandalonePartOrderFormFields>(emptyStandalonePartOrder);
  const [savingStandalone, setSavingStandalone] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");

  async function ensureArchiveLoaded() {
    if (!trackingOptimized || archiveLoadState !== "idle") return;
    setArchiveLoadState("loading");
    try {
      setArchivedOrders(await listArchivedPartOrders());
      setArchiveLoadState("loaded");
    } catch (currentError) {
      setArchiveLoadState("idle");
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar o arquivo de pedidos.");
    }
  }

  function applyStatusFilter(filter: PartsFilter) {
    window.history.replaceState(null, "", "/pecas");
    setFocusedOrderId("");
    setStatusFilter(filter);
    if (["todos", "concluidos", "cancelado"].includes(filter)) void ensureArchiveLoaded();
  }

  function applySearchQuery(value: string) {
    window.history.replaceState(null, "", "/pecas");
    setFocusedOrderId("");
    if (value.trim()) {
      setStatusFilter("todos");
      void ensureArchiveLoaded();
    }
    setSearchQuery(value);
  }

  async function importPartsCatalog(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || profile?.role !== "admin") return;

    setCatalogImporting(true);
    setCatalogMessage("");
    setError("");

    try {
      const items = parseHyundaiPartsCatalog(await file.arrayBuffer());
      if (!items.length) throw new Error("Nenhum item Hyundai válido foi encontrado na planilha.");

      await replaceHyundaiPartsCatalog({
        items,
        sourceFileName: file.name,
        importedBy: profile?.name ?? user?.email ?? user?.uid,
      });
      invalidatePartsCatalogCache();
      setCatalogMessage(`${items.length.toLocaleString("pt-BR")} itens Hyundai disponíveis para pesquisa.`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível importar o catálogo Hyundai.");
    } finally {
      setCatalogImporting(false);
    }
  }

  useEffect(() => {
    if (!profile) return undefined;
    let disposed = false;
    let unsubscribe: () => void = () => undefined;
    const onError = (currentError: Error) => {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar pedidos de peças.");
    };

    void ensurePartOrderTracking(profile.role === "admin").then((optimized) => {
      if (disposed) return;
      setTrackingOptimized(optimized);
      unsubscribe = (optimized ? subscribeActivePartOrders : subscribePartOrders)((items) => {
        setOrders(items);
        setError("");
      }, onError);
    }).catch(() => {
      if (disposed) return;
      setTrackingOptimized(false);
      unsubscribe = subscribePartOrders((items) => {
        setOrders(items);
        setError("");
      }, onError);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [profile]);

  const loadedOrders = useMemo(() => {
    const unique = new Map<string, PartOrder>();
    [...orders, ...archivedOrders].forEach((order) => unique.set(order.id, order));
    return [...unique.values()];
  }, [archivedOrders, orders]);

  const orderVehicleIds = useMemo(
    () => Array.from(new Set(loadedOrders.map((order) => order.vehicleFlowId).filter(Boolean))).sort(),
    [loadedOrders],
  );
  const orderVehicleIdsKey = orderVehicleIds.join("|");

  const [orderVehicles, setOrderVehicles] = useState<VehicleFlow[]>([]);

  useEffect(() => {
    return subscribeVehicleFlowsByIds(orderVehicleIds, setOrderVehicles, () => undefined);
  // A chave evita recriar a assinatura quando apenas outros dados do pedido mudam.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderVehicleIdsKey]);

  const mergedOrders = useMemo(() => {
    const vehiclesById = new Map(orderVehicles.map((vehicle) => [vehicle.id, vehicle]));
    return loadedOrders.map((order) => {
      const vehicle = vehiclesById.get(order.vehicleFlowId);
      return {
        ...order,
        plate: order.plate || vehicle?.plate,
        chassi: order.chassi || vehicle?.chassi,
        phone: order.phone || vehicle?.phone,
        clientName: order.clientName || vehicle?.clientName,
        consultantName: order.consultantName || vehicle?.consultantName,
        technicianName: order.technicianName || vehicle?.technicianName,
      };
    });
  }, [loadedOrders, orderVehicles]);

  const vehiclesById = useMemo(() => {
    const mapped = new Map<string, VehicleFlow>();
    orderVehicles.forEach((vehicle) => mapped.set(vehicle.id, vehicle));
    return mapped;
  }, [orderVehicles]);

  function customerNameContent(order: PartOrder) {
    const name = order.clientName ?? "Cliente sem nome";
    const url = whatsappUrl(order.phone || vehiclesById.get(order.vehicleFlowId)?.phone);

    if (!url) return <strong>{name}</strong>;

    return (
      <a className="client-link" href={url} target="_blank" rel="noreferrer">
        <strong>{name}</strong>
      </a>
    );
  }

  const completedOrderIds = useMemo(() => {
    return new Set(mergedOrders
      .filter((order) => Boolean(order.schedulingCompletedAt) || isAutomaticallyCompletedWorkshopOrder(order))
      .map((order) => order.id));
  }, [mergedOrders]);

  const completedOrders = useMemo(() => (
    mergedOrders.filter((order) => completedOrderIds.has(order.id))
  ), [completedOrderIds, mergedOrders]);

  const operationalOrders = useMemo(() => (
    mergedOrders.filter((order) => !completedOrderIds.has(order.id))
  ), [completedOrderIds, mergedOrders]);

  const availableOrders = useMemo(() => (
    operationalOrders.filter((order) => (
      effectiveOrderStatus(order) === "disponivel"
    ))
  ), [operationalOrders]);

  const canceledOrders = useMemo(() => (
    mergedOrders.filter((order) => effectiveOrderStatus(order) === "cancelado")
  ), [mergedOrders]);

  const workshopActionOrders = useMemo(() => (
    operationalOrders
      .filter(shouldShowWorkshopActionOrder)
      .sort((a, b) => daysInCurrentStatus(b) - daysInCurrentStatus(a))
  ), [operationalOrders]);

  const statusUpdateOrders = useMemo(() => (
    operationalOrders
      .filter(needsStatusUpdate)
      .sort((a, b) => {
        const aLimit = effectiveOrderStatus(a) === "pedido_realizado" ? 3 : 9;
        const bLimit = effectiveOrderStatus(b) === "pedido_realizado" ? 3 : 9;
        return (daysInCurrentStatus(b) - bLimit) - (daysInCurrentStatus(a) - aLimit);
      })
  ), [operationalOrders]);

  const pendingOrders = useMemo(() => (
    [...workshopActionOrders, ...statusUpdateOrders]
  ), [statusUpdateOrders, workshopActionOrders]);

  const filteredOrders = useMemo(() => {
    if (focusedOrderId) return mergedOrders.filter((order) => order.vehicleFlowId === focusedOrderId || order.id === focusedOrderId);
    const statusOrders = statusFilter === "todos" ? mergedOrders
      : statusFilter === "pendentes" ? pendingOrders
        : statusFilter === "concluidos" ? completedOrders
          : statusFilter === "vor" ? operationalOrders.filter((order) => order.orderVor)
            : statusFilter === "disponivel" ? availableOrders
              : statusFilter === "solicitado_oficina" ? operationalOrders.filter(isWorkshopRequestedStatus)
                : operationalOrders.filter((order) => effectiveOrderStatus(order) === statusFilter);
    const normalizedQuery = normalizeSearchText(searchQuery);
    if (!normalizedQuery) return statusOrders;

    return statusOrders.filter((order) => (
      normalizeSearchText(order.plate).includes(normalizedQuery)
      || normalizeSearchText(order.clientName).includes(normalizedQuery)
    ));
  }, [availableOrders, completedOrders, focusedOrderId, mergedOrders, operationalOrders, pendingOrders, searchQuery, statusFilter]);

  const isOrderVehicleImmobilized = (order: PartOrder) => (
    vehiclesById.get(order.vehicleFlowId)?.vehicleImmobilized ?? false
  );
  const metrics = [
    { label: "pendências", value: pendingOrders.length, filter: "pendentes" as PartsFilter, state: "active" },
    { label: "solicitado oficina", value: operationalOrders.filter(isWorkshopRequestedStatus).length, filter: "solicitado_oficina" as PartsFilter, state: "" },
    { label: "pedido realizado", value: operationalOrders.filter((order) => effectiveOrderStatus(order) === "pedido_realizado").length, filter: "pedido_realizado" as PartsFilter, state: "" },
    { label: "B.O", value: operationalOrders.filter((order) => effectiveOrderStatus(order) === "back_order").length, filter: "back_order" as PartsFilter, state: "danger" },
    { label: "VOR", value: operationalOrders.filter((order) => order.orderVor).length, filter: "vor" as PartsFilter, state: "danger" },
    { label: "em trânsito", value: operationalOrders.filter((order) => effectiveOrderStatus(order) === "em_transito").length, filter: "em_transito" as PartsFilter, state: "" },
    { label: "disponíveis", value: availableOrders.length, filter: "disponivel" as PartsFilter, state: "" },
    { label: "concluídos", value: trackingOptimized && archiveLoadState !== "loaded" ? "—" : completedOrders.length, filter: "concluidos" as PartsFilter, state: "good" },
    { label: "cancelados", value: trackingOptimized && archiveLoadState !== "loaded" ? "—" : canceledOrders.length, filter: "cancelado" as PartsFilter, state: "danger" },
  ];

  function classifyMobisReceiptByQuantity(fileName: string, invoiceNumber: string, items: MobisReceiptItem[]) {
    const openOrders = operationalOrders.filter((order) => effectiveOrderStatus(order) !== "disponivel" && effectiveOrderStatus(order) !== "cancelado");
    const safe: MobisReceiptMatch[] = [];
    const doubtful: MobisReceiptMatch[] = [];
    const notFound: MobisReceiptItem[] = [];
    const groupedItems = new Map<string, MobisReceiptItem>();

    items.forEach((item) => {
      const key = `${normalizeCode(item.mobisOrder)}::${normalizeCode(item.partReference)}`;
      const current = groupedItems.get(key);

      if (!current) {
        groupedItems.set(key, item);
        return;
      }

      groupedItems.set(key, {
        ...current,
        id: `${current.id}-${item.line}`,
        quantity: current.quantity + item.quantity,
      });
    });

    groupedItems.forEach((item) => {
      const partCandidates = openOrders
        .filter((order) => orderHasPart(order, item.partReference))
        .sort((a, b) => orderTimeValue(a) - orderTimeValue(b));
      const normalizedMobisOrder = normalizeCode(item.mobisOrder);
      const exactCandidates = partCandidates.filter((order) => (
        normalizedMobisOrder
        && normalizeCode(order.orderNumber) === normalizedMobisOrder
      ));

      if (!partCandidates.length) {
        notFound.push(item);
        return;
      }

      if (!exactCandidates.length) {
        doubtful.push({
          item,
          candidates: partCandidates,
          recommended: partCandidates[0],
          reason: `Código localizado, mas o pedido Mobis ${item.mobisOrder || "não informado"} não corresponde ao pedido cadastrado`,
        });
        return;
      }

      if (exactCandidates.length > item.quantity) {
        doubtful.push({
          item,
          candidates: exactCandidates,
          recommended: exactCandidates[0],
          reason: `Pedido e código aparecem em ${exactCandidates.length} solicitações, mas somente ${item.quantity} unidade(s) foi(ram) recebida(s)`,
        });
        return;
      }

      exactCandidates.forEach((order, index) => {
        safe.push({
          item: {
            ...item,
            id: `${item.id}-${order.id}`,
            quantity: 1,
          },
          candidates: [order],
          recommended: order,
          reason: `Pedido ${item.mobisOrder} + código confirmados (${index + 1}/${exactCandidates.length})`,
        });
      });

      if (item.quantity > exactCandidates.length) {
        notFound.push({
          ...item,
          id: `${item.id}-saldo`,
          quantity: item.quantity - exactCandidates.length,
          partDescription: `${item.partDescription} - SALDO SEM COMBINAÇÃO PEDIDO + CÓDIGO`,
        });
      }
    });

    setMobisReceipt({
      fileName,
      invoiceNumber,
      safe,
      doubtful,
      notFound,
      error: "",
    });
  }

  async function handleMobisReceiptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMobisActionFeedback(null);

    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
      const data = new Uint8Array(await file.arrayBuffer());
      const documentTask = pdfjs.getDocument({ data });
      const pdf = await documentTask.promise;
      const lines: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const rows = new Map<number, Array<{ x: number; text: string }>>();

        content.items.forEach((item) => {
          if (!("str" in item) || !item.str.trim()) return;
          const transform = item.transform as number[];
          const y = Math.round(transform[5]);
          const x = transform[4];
          const current = rows.get(y) ?? [];
          current.push({ x, text: item.str });
          rows.set(y, current);
        });

        Array.from(rows.entries())
          .sort(([a], [b]) => b - a)
          .forEach(([, rowItems]) => {
            const line = rowItems
              .sort((a, b) => a.x - b.x)
              .map((rowItem) => rowItem.text)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            if (line) lines.push(line);
          });
      }

      const parsed = parseMobisReceiptLines(lines);
      if (!parsed.items.length) {
        setMobisReceipt({
          ...emptyMobisReceipt,
          fileName: file.name,
          error: "Não foi possível identificar itens de recebimento neste PDF.",
        });
        return;
      }

      classifyMobisReceiptByQuantity(file.name, parsed.invoiceNumber, parsed.items);
    } catch (currentError) {
      setMobisReceipt({
        ...emptyMobisReceipt,
        fileName: file.name,
        error: currentError instanceof Error ? currentError.message : "Não foi possível ler o PDF da Mobis.",
      });
    } finally {
      event.target.value = "";
    }
  }

  function orderFormValues(order: PartOrder): PartOrderFormFields {
    return {
      customerId: order.customerId ?? "",
      orderKind: order.orderKind ?? "",
      parts: orderParts(order),
      orderStatus: effectiveOrderStatus(order) === "necessidade_identificada" || effectiveOrderStatus(order) === "aguardando_pecas"
        ? "solicitado_oficina"
        : effectiveOrderStatus(order),
      orderSource: order.orderSource ?? "",
      orderNumber: order.orderNumber ?? "",
      orderVor: order.orderVor ?? false,
      orderDate: order.orderDate ?? "",
      invoiceNumber: order.invoiceNumber ?? "",
      expectedArrivalDate: order.expectedArrivalDate ?? "",
      cancellationReason: order.cancellationReason ?? "",
      ...orderForms[order.id],
    };
  }

  function updateOrderForm(orderId: string, patch: Partial<PartOrderFormFields>) {
    setOrderForms((current) => ({
      ...current,
      [orderId]: {
        ...current[orderId],
        ...patch,
      },
    }));

    setOrderValidationErrors((current) => {
      if (!current[orderId]) return current;
      const nextOrderErrors = { ...current[orderId] };
      const fieldsToClear = patch.orderStatus ? Object.keys(nextOrderErrors) : Object.keys(patch);
      fieldsToClear.forEach((field) => delete nextOrderErrors[field as PartOrderValidationField]);

      const next = { ...current };
      if (Object.keys(nextOrderErrors).length) next[orderId] = nextOrderErrors;
      else delete next[orderId];
      return next;
    });
  }

  async function saveOrder(order: PartOrder) {
    const form = orderFormValues(order);
    const validParts = form.parts.filter((part) => part.partReference?.trim() || part.partDescription?.trim());
    const nextOrderStatus: PartOrderStatus = form.cancellationReason.trim() ? "cancelado" : form.orderStatus;

    const validationErrors: PartOrderValidationErrors = {};

    if (!form.orderKind) validationErrors.orderKind = "Obrigatório para identificar se o atendimento é Garantia, Campanha ou Externo.";
    if (nextOrderStatus === "pedido_realizado" || nextOrderStatus === "back_order") {
      if (!form.orderSource) validationErrors.orderSource = "Informe de onde a peça foi solicitada para usar este status.";
      if (!form.orderNumber.trim()) validationErrors.orderNumber = "Informe o número do pedido para usar Pedido Realizado ou B.O.";
    }
    if (nextOrderStatus === "em_transito") {
      if (!form.invoiceNumber.trim()) validationErrors.invoiceNumber = "Informe a nota fiscal que acompanha a peça em trânsito.";
      if (!form.expectedArrivalDate) validationErrors.expectedArrivalDate = "Informe a previsão de chegada da peça em trânsito.";
    }
    if (nextOrderStatus === "cancelado" && !form.cancellationReason.trim()) {
      validationErrors.cancellationReason = "Explique o motivo do cancelamento para manter a rastreabilidade.";
    }

    const firstInvalidField = Object.keys(validationErrors)[0] as PartOrderValidationField | undefined;
    if (firstInvalidField) {
      const section: PartEditSection = firstInvalidField === "orderKind"
        ? "dados"
        : firstInvalidField === "cancellationReason" ? "cancelamento" : "pedido";
      setOrderValidationErrors((current) => ({ ...current, [order.id]: validationErrors }));
      setOpenSections((current) => ({ ...current, [order.id]: section }));
      setError("Não foi possível salvar. Revise os campos destacados no pedido.");
      window.requestAnimationFrame(() => {
        const field = document.getElementById(`part-order-${firstInvalidField}-${order.id}`);
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
        field?.focus();
      });
      return;
    }

    setOrderValidationErrors((current) => {
      if (!current[order.id]) return current;
      const next = { ...current };
      delete next[order.id];
      return next;
    });

    setSavingId(order.id);
    setError("");

    try {
      await updatePartOrder({
        orderId: order.id,
        vehicleFlowId: order.vehicleFlowId,
        plate: order.plate,
        chassi: order.chassi,
        phone: order.phone,
        customerId: form.customerId,
        clientName: order.clientName,
        consultantName: order.consultantName,
        technicianName: order.technicianName,
        orderKind: form.orderKind || undefined,
        parts: validParts,
        orderStatus: nextOrderStatus,
        orderSource: form.orderSource || undefined,
        orderNumber: form.orderNumber,
        orderVor: form.orderVor,
        orderDate: form.orderDate,
        invoiceNumber: form.invoiceNumber,
        expectedArrivalDate: form.expectedArrivalDate,
        cancellationReason: form.cancellationReason,
        updatedBy: profile?.name ?? user?.email ?? user?.uid,
      });

      const updatedBy = profile?.name ?? user?.email ?? user?.uid;
      const updatedOrder: PartOrder = {
        ...order,
        parts: validParts.map((part, index) => ({
          id: part.id || `peca-${index + 1}`,
          partReference: part.partReference?.trim().toUpperCase(),
          partDescription: part.partDescription?.trim(),
        })),
        partReference: validParts[0]?.partReference?.trim().toUpperCase(),
        partDescription: validParts[0]?.partDescription?.trim(),
        customerId: form.customerId,
        orderKind: form.orderKind || undefined,
        orderStatus: nextOrderStatus,
        orderStatusUpdatedAt: effectiveOrderStatus(order) !== nextOrderStatus ? new Date().toISOString() : order.orderStatusUpdatedAt,
        orderSource: form.orderSource || undefined,
        orderNumber: form.orderNumber,
        orderVor: form.orderVor,
        orderDate: form.orderDate,
        invoiceNumber: form.invoiceNumber,
        expectedArrivalDate: form.expectedArrivalDate,
        cancellationReason: form.cancellationReason,
        updatedBy,
        updatedAt: new Date().toISOString(),
      };

      setOrders((current) => current.some((item) => item.id === order.id)
        ? current.map((item) => item.id === order.id ? updatedOrder : item)
        : [...current, updatedOrder]);

      if (nextOrderStatus === "cancelado" && focusedOrderId && (focusedOrderId === order.id || focusedOrderId === order.vehicleFlowId)) {
        window.history.replaceState(null, "", "/pecas");
        setFocusedOrderId("");
        setStatusFilter("pendentes");
      }
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o pedido.");
    } finally {
      setSavingId("");
    }
  }

  async function saveStandaloneOrder() {
    const validParts = standaloneForm.parts.filter((part) => part.partReference?.trim() || part.partDescription?.trim());

    if (!standaloneForm.clientName.trim()) {
      setError("Informe o nome do cliente para criar o pedido avulso.");
      return;
    }
    if (!standaloneForm.orderKind) {
      setError("Selecione o tipo do pedido: Garantia, Campanha ou Externo.");
      return;
    }
    if (!validParts.length) {
      setError("Informe ao menos uma referência ou descrição de peça.");
      return;
    }
    if ((standaloneForm.orderStatus === "pedido_realizado" || standaloneForm.orderStatus === "back_order") && (!standaloneForm.orderSource || !standaloneForm.orderNumber.trim())) {
      setError("Para marcar Pedido Realizado ou B.O, informe a origem e o número do pedido.");
      return;
    }
    if (standaloneForm.orderStatus === "em_transito" && (!standaloneForm.invoiceNumber.trim() || !standaloneForm.expectedArrivalDate)) {
      setError("Para marcar Em trânsito, informe a nota fiscal e confirme a previsão de chegada.");
      return;
    }
    if (standaloneForm.orderStatus === "cancelado" && !standaloneForm.cancellationReason.trim()) {
      setError("Para cancelar um pedido, informe o motivo do cancelamento.");
      return;
    }

    setSavingStandalone(true);
    setError("");
    try {
      await createStandalonePartOrder({
        plate: standaloneForm.plate,
        customerId: standaloneForm.customerId,
        clientName: standaloneForm.clientName,
        orderKind: standaloneForm.orderKind || undefined,
        parts: validParts,
        orderStatus: standaloneForm.orderStatus,
        orderSource: standaloneForm.orderSource || undefined,
        orderNumber: standaloneForm.orderNumber,
        orderVor: standaloneForm.orderVor,
        orderDate: standaloneForm.orderDate,
        invoiceNumber: standaloneForm.invoiceNumber,
        expectedArrivalDate: standaloneForm.expectedArrivalDate,
        cancellationReason: standaloneForm.cancellationReason,
        updatedBy: profile?.name ?? user?.email ?? user?.uid,
      });
      setStandaloneForm({ ...emptyStandalonePartOrder, parts: [{ id: "peca-1", partReference: "", partDescription: "" }] });
      setStandaloneOpen(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível criar o pedido avulso.");
    } finally {
      setSavingStandalone(false);
    }
  }

  async function applyMobisReceiptMatch(match: MobisReceiptMatch, order = match.recommended) {
    if (!order) return;

    const form = orderFormValues(order);
    const validParts = form.parts.filter((part) => part.partReference?.trim() || part.partDescription?.trim());
    const receiptKey = `${order.id}-${match.item.id}`;
    setApplyingReceiptId(receiptKey);
    setError("");
    setMobisActionFeedback(null);

    try {
      await updatePartOrder({
        orderId: order.id,
        vehicleFlowId: order.vehicleFlowId,
        plate: order.plate,
        customerId: form.customerId,
        clientName: order.clientName,
        consultantName: order.consultantName,
        technicianName: order.technicianName,
        orderKind: form.orderKind || undefined,
        parts: validParts,
        orderStatus: "disponivel",
        orderSource: form.orderSource || "mobis",
        orderNumber: form.orderNumber || match.item.mobisOrder,
        orderVor: form.orderVor,
        orderDate: form.orderDate,
        invoiceNumber: mobisReceipt.invoiceNumber || form.invoiceNumber,
        expectedArrivalDate: form.expectedArrivalDate,
        cancellationReason: form.cancellationReason,
        updatedBy: profile?.name ?? user?.email ?? user?.uid,
      });

      setOrders((current) => current.map((item) => (
        item.id === order.id
          ? {
              ...item,
              orderStatus: "disponivel",
              orderStatusUpdatedAt: effectiveOrderStatus(item) !== "disponivel" ? new Date().toISOString() : item.orderStatusUpdatedAt,
              orderSource: form.orderSource || "mobis",
              orderNumber: form.orderNumber || match.item.mobisOrder,
              invoiceNumber: mobisReceipt.invoiceNumber || form.invoiceNumber,
              updatedBy: profile?.name ?? user?.email ?? user?.uid,
              updatedAt: new Date().toISOString(),
            }
          : item
      )));
      setMobisReceipt((current) => ({
        ...current,
        safe: current.safe.filter((currentMatch) => currentMatch.item.id !== match.item.id),
        doubtful: current.doubtful.filter((currentMatch) => currentMatch.item.id !== match.item.id),
      }));
      setMobisActionFeedback({
        type: "success",
        message: `${match.item.partReference} foi marcada como disponível para ${order.clientName || order.plate || "o pedido selecionado"}.`,
      });
    } catch (currentError) {
      const message = currentError instanceof Error ? currentError.message : "Não foi possível aplicar o recebimento Mobis.";
      setError(message);
      setMobisActionFeedback({ type: "error", message });
    } finally {
      setApplyingReceiptId("");
    }
  }

  async function applySafeMobisMatches() {
    for (const match of mobisReceipt.safe) {
      await applyMobisReceiptMatch(match);
    }
  }

  async function syncPublicPartsPortal() {
    const syncableOrders = mergedOrders.filter((order) => order.plate && order.customerId);
    setSyncingPortal(true);
    setError("");

    try {
      for (const order of syncableOrders) {
        const form = orderFormValues(order);
        await updatePartOrder({
          orderId: order.id,
          vehicleFlowId: order.vehicleFlowId,
          plate: order.plate,
          customerId: form.customerId || order.customerId,
          clientName: order.clientName,
          consultantName: order.consultantName,
          technicianName: order.technicianName,
          orderKind: form.orderKind || undefined,
          parts: form.parts.filter((part) => part.partReference?.trim() || part.partDescription?.trim()),
          orderStatus: form.orderStatus,
          orderSource: form.orderSource || undefined,
          orderNumber: form.orderNumber,
          orderVor: form.orderVor,
          orderDate: form.orderDate,
          invoiceNumber: form.invoiceNumber,
          expectedArrivalDate: form.expectedArrivalDate,
          cancellationReason: form.cancellationReason,
          updatedBy: profile?.name ?? user?.email ?? user?.uid,
        });
      }
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível sincronizar o Portal Minha Peça.");
    } finally {
      setSyncingPortal(false);
    }
  }

  function updatePartItem(order: PartOrder, partId: string, patch: Partial<PartOrderItem>) {
    const form = orderFormValues(order);
    updateOrderForm(order.id, {
      parts: form.parts.map((part) => (
        part.id === partId ? { ...part, ...patch } : part
      )),
    });
  }

  function addPartItem(order: PartOrder) {
    const form = orderFormValues(order);
    updateOrderForm(order.id, {
      parts: [...form.parts, { id: `peca-${Date.now()}`, partReference: "", partDescription: "" }],
    });
  }

  function removePartItem(order: PartOrder, partId: string) {
    const form = orderFormValues(order);
    if (form.parts.length <= 1) return;
    updateOrderForm(order.id, {
      parts: form.parts.filter((part) => part.id !== partId),
    });
  }

  function toggleSection(orderId: string, section: PartEditSection) {
    setOpenSections((current) => ({
      ...current,
      [orderId]: current[orderId] === section ? undefined : section,
    }));
  }

  return (
    <ProtectedPage title="Pedidos de Peças" subtitle="Acompanhamento dos pedidos originados nos chips do fluxo.">
      <main className="page-wrap parts-page">
        <section className="flow-metrics">
          {metrics.map((metric) => (
            <button
              key={metric.label}
              className={`flow-metric ${metric.state} ${statusFilter === metric.filter ? "selected" : ""}`}
              type="button"
              onClick={() => applyStatusFilter(metric.filter)}
            >
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </button>
          ))}

          <label className="flow-filter">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => applyStatusFilter(event.target.value as PartsFilter)}>
              <option value="pendentes">Pendências</option>
              <option value="todos">Todos</option>
              <option value="vor">VOR</option>
              <option value="concluidos">Concluídos</option>
              {statusOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="flow-filter">
            <span>Consultar chip</span>
            <input
              type="search"
              value={searchQuery}
              placeholder="Placa ou cliente"
              autoComplete="off"
              onChange={(event) => applySearchQuery(event.target.value)}
            />
          </label>
        </section>

        <div className="parts-portal-sync">
          <div>
            <strong>Portal Minha Peça</strong>
            <span>Sincroniza pedidos com placa e ID Cliente para consulta pública.</span>
          </div>
          <a className="ghost-btn" href="/minha-peca" target="_blank" rel="noreferrer">Abrir portal</a>
          <button className="ghost-btn" type="button" onClick={() => { setError(""); setStandaloneOpen(true); }}>
            + Pedido avulso
          </button>
          <button className="primary-btn" type="button" disabled={syncingPortal} onClick={syncPublicPartsPortal}>
            {syncingPortal ? "Sincronizando..." : "Sincronizar portal"}
          </button>
          {profile?.role === "admin" && (
            <label className={`ghost-btn catalog-import-button ${catalogImporting ? "disabled" : ""}`}>
              <input type="file" accept=".xls,.xlsx" disabled={catalogImporting} onChange={importPartsCatalog} />
              {catalogImporting ? "Importando catálogo..." : "Importar catálogo Hyundai"}
            </label>
          )}
        </div>

        <section className="parts-tracking-tools" aria-label="Rastreamento de transportadoras">
          <div className="parts-tracking-copy">
            <strong>Rastreamento de pedidos</strong>
            <span>Consulte a transportadora, os contatos e acompanhe a entrega.</span>
          </div>
          <button className="ghost-btn" type="button" onClick={() => setTransportInfoModal("tip")}>Dica</button>
          <button className="ghost-btn" type="button" onClick={() => setTransportInfoModal("contacts")}>Contatos</button>
          <a className="primary-btn" href={trackingLinks.glovis} target="_blank" rel="noreferrer">Rastreio GLOVIS</a>
          <a className="primary-btn" href={trackingLinks.ceva} target="_blank" rel="noreferrer">Rastreio CEVA</a>
        </section>

        {catalogMessage && <p className="catalog-import-success">{catalogMessage}</p>}

        {transportInfoModal && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTransportInfoModal(null); }}>
            <section className={`flow-modal transport-info-modal ${transportInfoModal === "contacts" ? "contacts" : ""}`} role="dialog" aria-modal="true" aria-labelledby="transport-info-title">
              <div className="modal-head">
                <div>
                  <strong id="transport-info-title">{transportInfoModal === "tip" ? "Como identificar a transportadora" : "Contatos das transportadoras"}</strong>
                  <span>Informações do boletim Mobis MBR2026/066.</span>
                </div>
                <button className="icon-btn" type="button" onClick={() => setTransportInfoModal(null)} aria-label="Fechar">×</button>
              </div>

              {transportInfoModal === "tip" ? (
                <div className="transport-tip-content">
                  <ol>
                    <li>Acesse o <strong>DPOS</strong>.</li>
                    <li>Entre na transação <strong>DP26</strong>.</li>
                    <li>Consulte o código da transportadora, a nota fiscal e as informações do pedido.</li>
                  </ol>
                  <div className="transport-code-grid">
                    <div><span>Código AQ2K</span><strong>GLOVIS</strong></div>
                    <div><span>Código C16K</span><strong>CEVA</strong></div>
                  </div>
                </div>
              ) : (
                <div className="transport-contact-list">
                  {(["GLOVIS", "CEVA"] as const).map((carrier) => (
                    <section key={carrier} className="transport-contact-group">
                      <h3>{carrier}</h3>
                      <div className="transport-contact-table">
                        {carrierContacts.filter((contact) => contact.carrier === carrier).map((contact) => (
                          <div className="transport-contact-row" key={`${contact.carrier}-${contact.email}`}>
                            <div><span>Área</span><strong>{contact.area}</strong></div>
                            <div><span>Contato</span><strong>{contact.name}</strong></div>
                            <div><span>E-mail</span><a href={`mailto:${contact.email}`}>{contact.email}</a></div>
                            <div><span>Telefone</span><strong>{contact.phone}</strong></div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                  <small className="transport-hours">Horário administrativo de atendimento: 08:00 às 18:00.</small>
                </div>
              )}
            </section>
          </div>
        )}

        {standaloneOpen && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStandaloneOpen(false); }}>
            <section className="flow-modal standalone-parts-modal" role="dialog" aria-modal="true" aria-labelledby="standalone-parts-title">
              <div className="modal-head">
                <div>
                  <strong id="standalone-parts-title">Adicionar pedido avulso</strong>
                  <span>Registre uma solicitação que não veio de um chip do fluxo.</span>
                </div>
                <button className="icon-btn" type="button" onClick={() => setStandaloneOpen(false)} aria-label="Fechar">×</button>
              </div>

              <div className="parts-edit-grid">
                <label className="field">
                  <span>Cliente</span>
                  <input autoFocus value={standaloneForm.clientName} placeholder="Nome do cliente" onChange={(event) => setStandaloneForm((current) => ({ ...current, clientName: event.target.value }))} />
                </label>
                <label className="field">
                  <span>Placa</span>
                  <input value={standaloneForm.plate} placeholder="ABC1D23" onChange={(event) => setStandaloneForm((current) => ({ ...current, plate: event.target.value.toUpperCase() }))} />
                </label>
                <label className="field">
                  <span>ID Cliente</span>
                  <input value={standaloneForm.customerId} placeholder="ID para consulta" onChange={(event) => setStandaloneForm((current) => ({ ...current, customerId: event.target.value.toUpperCase() }))} />
                </label>
                <label className="field">
                  <span>Tipo</span>
                  <select required value={standaloneForm.orderKind} onChange={(event) => setStandaloneForm((current) => ({ ...current, orderKind: event.target.value as PartOrderKind | "" }))}>
                    <option value="">Selecionar</option>
                    {kindOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>

              <div className="parts-items">
                {standaloneForm.parts.map((part, index) => (
                  <div key={part.id} className="part-item-row">
                    <PartCatalogFields
                      index={index}
                      reference={part.partReference ?? ""}
                      description={part.partDescription ?? ""}
                      onChange={(value) => setStandaloneForm((current) => ({
                        ...current,
                        parts: current.parts.map((item) => item.id === part.id ? { ...item, ...value } : item),
                      }))}
                    />
                    <button className="ghost-btn" type="button" disabled={standaloneForm.parts.length <= 1} onClick={() => setStandaloneForm((current) => ({ ...current, parts: current.parts.filter((item) => item.id !== part.id) }))}>Remover</button>
                  </div>
                ))}
              </div>
              <button className="ghost-btn" type="button" onClick={() => setStandaloneForm((current) => ({ ...current, parts: [...current.parts, { id: `peca-${Date.now()}`, partReference: "", partDescription: "" }] }))}>+ Adicionar peça</button>

              <div className="parts-edit-grid">
                <label className="field">
                  <span>Status do Pedido</span>
                  <select value={standaloneForm.orderStatus} onChange={(event) => setStandaloneForm((current) => ({ ...current, orderStatus: event.target.value as PartOrderStatus }))}>
                    {statusOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Origem</span>
                  <select value={standaloneForm.orderSource} onChange={(event) => setStandaloneForm((current) => ({ ...current, orderSource: event.target.value as PartOrderSource | "" }))}>
                    <option value="">Selecionar origem</option>
                    {sourceOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="field"><span>Número do Pedido</span><input value={standaloneForm.orderNumber} onChange={(event) => setStandaloneForm((current) => ({ ...current, orderNumber: event.target.value.toUpperCase() }))} /></label>
                <label className="field"><span>Data do Pedido</span><input type="date" value={standaloneForm.orderDate} onChange={(event) => setStandaloneForm((current) => ({ ...current, orderDate: event.target.value }))} /></label>
                <label className="field"><span>Nota Fiscal</span><input value={standaloneForm.invoiceNumber} onChange={(event) => setStandaloneForm((current) => ({ ...current, invoiceNumber: event.target.value.toUpperCase() }))} /></label>
                <label className="field"><span>Previsão de chegada</span><input type="date" value={standaloneForm.expectedArrivalDate} onChange={(event) => setStandaloneForm((current) => ({ ...current, expectedArrivalDate: event.target.value }))} /></label>
              </div>

              <label className="inline-check parts-vor-check"><input type="checkbox" checked={standaloneForm.orderVor} onChange={(event) => setStandaloneForm((current) => ({ ...current, orderVor: event.target.checked }))} /><span>Pedido VOR</span></label>
              {standaloneForm.orderStatus === "cancelado" && <label className="field"><span>Motivo do cancelamento</span><textarea value={standaloneForm.cancellationReason} onChange={(event) => setStandaloneForm((current) => ({ ...current, cancellationReason: event.target.value }))} /></label>}

              <div className="modal-actions">
                <button className="ghost-btn" type="button" onClick={() => setStandaloneOpen(false)}>Cancelar</button>
                <button className="primary-btn" type="button" disabled={savingStandalone} onClick={saveStandaloneOrder}>{savingStandalone ? "Salvando..." : "Criar pedido avulso"}</button>
              </div>
            </section>
          </div>
        )}

        <section className="panel mobis-receipt-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Recebimento Mobis</h2>
              <span className="panel-subtitle">Importe o packing list em PDF para cruzar pedido, referência e nota fiscal.</span>
            </div>
            <label className="ghost-btn file-action">
              <input accept=".pdf" type="file" onChange={handleMobisReceiptFile} />
              Importar PDF Mobis
            </label>
          </div>

          {mobisReceipt.error && (
            <div className="duplicate-alert">
              <strong>Recebimento Mobis</strong>
              <span>{mobisReceipt.error}</span>
            </div>
          )}

          {mobisReceipt.fileName && !mobisReceipt.error && (
            <div className="mobis-review">
              <div className="mobis-review-head">
                <div>
                  <strong>{mobisReceipt.fileName}</strong>
                  <span>NF-e {mobisReceipt.invoiceNumber || "não identificada"}</span>
                </div>
                <button
                  className="primary-btn"
                  type="button"
                  disabled={!mobisReceipt.safe.length || Boolean(applyingReceiptId)}
                  onClick={applySafeMobisMatches}
                >
                  {applyingReceiptId ? "Aplicando..." : "Aplicar encontrados com segurança"}
                </button>
              </div>

              {mobisActionFeedback?.type === "success" && (
                <p className="catalog-import-success" role="status">✓ {mobisActionFeedback.message}</p>
              )}
              {mobisActionFeedback?.type === "error" && (
                <div className="duplicate-alert" role="alert">
                  <strong>Não foi possível marcar como disponível</strong>
                  <span>{mobisActionFeedback.message}</span>
                </div>
              )}

              <div className="mobis-review-grid">
                <div className="mobis-review-column good">
                  <h3>Encontrados com segurança <span>{mobisReceipt.safe.length}</span></h3>
                  {mobisReceipt.safe.length ? mobisReceipt.safe.map((match) => (
                    <div key={`safe-${match.item.id}`} className="mobis-match-card">
                      <strong>{match.item.partReference}</strong>
                      <span>{match.item.partDescription}</span>
                      <small>{match.reason} · {match.recommended?.clientName || "Cliente não identificado"} · {match.recommended?.plate || "-"}</small>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={applyingReceiptId === `${match.recommended?.id}-${match.item.id}`}
                        onClick={() => applyMobisReceiptMatch(match)}
                      >
                        {applyingReceiptId === `${match.recommended?.id}-${match.item.id}` ? "Marcando..." : "Marcar disponível"}
                      </button>
                    </div>
                  )) : <p>Nenhum item neste grupo.</p>}
                </div>

                <div className="mobis-review-column warn">
                  <h3>Encontrados com dúvida <span>{mobisReceipt.doubtful.length}</span></h3>
                  {mobisReceipt.doubtful.length ? mobisReceipt.doubtful.map((match) => (
                    <div key={`doubtful-${match.item.id}`} className="mobis-match-card">
                      <strong>{match.item.partReference}</strong>
                      <span>{match.item.partDescription}</span>
                      <small>{match.reason}</small>
                      {match.recommended && (
                        <div className="oldest-request">
                          <span>Solicitação mais antiga</span>
                          <strong>{match.recommended.clientName || "Cliente não identificado"} · {match.recommended.plate || "-"}</strong>
                          <small>{formatOperationalDateTime(match.recommended.createdAt)}</small>
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={applyingReceiptId === `${match.recommended.id}-${match.item.id}`}
                            onClick={() => applyMobisReceiptMatch(match, match.recommended)}
                          >
                            {applyingReceiptId === `${match.recommended.id}-${match.item.id}` ? "Aplicando..." : "Aplicar neste cliente"}
                          </button>
                        </div>
                      )}
                      <details>
                        <summary>Ver possíveis clientes</summary>
                        {match.candidates.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            className="mobis-candidate"
                            onClick={() => applyMobisReceiptMatch(match, candidate)}
                          >
                            <strong>{candidate.clientName || "Cliente não identificado"}</strong>
                            <span>{candidate.plate || "-"} · {formatOperationalDateTime(candidate.createdAt)}</span>
                          </button>
                        ))}
                      </details>
                    </div>
                  )) : <p>Nenhum item neste grupo.</p>}
                </div>

                <div className="mobis-review-column bad">
                  <h3>Não encontrados <span>{mobisReceipt.notFound.length}</span></h3>
                  {mobisReceipt.notFound.length ? mobisReceipt.notFound.map((item) => (
                    <div key={`not-found-${item.id}`} className="mobis-match-card">
                      <strong>{item.partReference}</strong>
                      <span>{item.partDescription}</span>
                      <small>Pedido Mobis {item.mobisOrder} · qtd. {item.quantity}</small>
                    </div>
                  )) : <p>Nenhum item neste grupo.</p>}
                </div>
              </div>
            </div>
          )}
        </section>

        {error && <div className="duplicate-alert"><strong>Erro em peças</strong><span>{error}</span></div>}

        {focusedOrderId && (
          <div className="duplicate-alert parts-focus-alert">
            <strong>Pedido de peças selecionado</strong>
            <span>Mostrando apenas o pedido selecionado na fila de urgências.</span>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                window.history.replaceState(null, "", "/pecas");
                setFocusedOrderId("");
                setStatusFilter("pendentes");
              }}
            >
              Ver pendências
            </button>
          </div>
        )}

        <section className="panel parts-urgency-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Urgências do setor de Peças</h2>
              <span className="panel-subtitle">Filas ordenadas pelo maior tempo sem movimentação de status.</span>
            </div>
          </div>

          <div className="parts-urgency-pockets">
            <section className="parts-urgency-pocket office">
              <div className="parts-urgency-pocket-head">
                <div>
                  <h3>Solicitações Oficina Aguardando Ação</h3>
                  <p>Pedidos solicitados pela oficina que ainda não tiveram movimentação.</p>
                </div>
                <strong>{workshopActionOrders.length}</strong>
              </div>

              <div className="parts-urgency-chip-list">
                {workshopActionOrders.length ? workshopActionOrders.map((order) => (
                  <button
                    key={order.id}
                    className="parts-urgency-chip office"
                    type="button"
                    onClick={() => { setFocusedOrderId(order.id); setStatusFilter("todos"); }}
                  >
                    <span className="parts-urgency-chip-head">
                      <strong>{order.plate ?? "Sem placa"}</strong>
                      <b>{daysLabel(order)}</b>
                    </span>
                    <span>{order.clientName ?? "Cliente sem nome"}</span>
                    <small>{orderParts(order).map((part) => part.partReference || part.partDescription).filter(Boolean).join(" · ") || "Peça não informada"}</small>
                  </button>
                )) : <p className="empty">Nenhuma solicitação aguardando ação.</p>}
              </div>
            </section>

            <section className="parts-urgency-pocket update">
              <div className="parts-urgency-pocket-head">
                <div>
                  <h3>Chips que precisam de atualização de Status</h3>
                  <p>Pedido realizado há mais de 3 dias ou em trânsito há mais de 9 dias.</p>
                </div>
                <strong>{statusUpdateOrders.length}</strong>
              </div>

              <div className="parts-urgency-chip-list">
                {statusUpdateOrders.length ? statusUpdateOrders.map((order) => (
                  <button
                    key={order.id}
                    className={`parts-urgency-chip update ${effectiveOrderStatus(order) === "em_transito" ? "critical" : ""}`}
                    type="button"
                    onClick={() => { setFocusedOrderId(order.id); setStatusFilter("todos"); }}
                  >
                    <span className="parts-urgency-chip-head">
                      <strong>{order.plate ?? "Sem placa"}</strong>
                      <b>{daysLabel(order)}</b>
                    </span>
                    <span>{order.clientName ?? "Cliente sem nome"}</span>
                    <small>{statusLabels[effectiveOrderStatus(order)]} · Pedido {order.orderNumber || "sem número"}</small>
                  </button>
                )) : <p className="empty">Nenhum chip com atualização atrasada.</p>}
              </div>
            </section>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Acompanhamento dos pedidos</h2>
            <span className="panel-subtitle">{filteredOrders.length} pedido(s) no filtro atual.</span>
          </div>

          <div className="parts-list">
            {filteredOrders.length ? filteredOrders.map((order) => {
              const form = orderFormValues(order);
              const openSection = openSections[order.id];
              const fieldErrors = orderValidationErrors[order.id] ?? {};

              return (
              <article key={order.id} className={`parts-card ${focusedOrderId && (order.vehicleFlowId === focusedOrderId || order.id === focusedOrderId) ? "focused" : ""}`}>
                <div className="parts-table-row">
                  <div className="parts-cell parts-client-cell">
                    <span>Cliente</span>
                    {customerNameContent(order)}
                    <small>{order.plate ?? "Sem placa"} · ID {order.customerId || "-"}</small>
                  </div>
                  <div className="parts-cell parts-line-cell">
                    <span>Pe&ccedil;as</span>
                    <div className="parts-line-list">
                      {orderParts(order).map((part, index) => (
                        <div key={part.id || `${order.id}-part-${index}`} className="parts-line-item">
                          <strong>{part.partReference || "-"}</strong>
                          <small>{part.partDescription || "Sem descricao"}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Tipo</span><strong>{kindLabel(order.orderKind)}</strong></div>
                    <div>
                      <span>Status</span>
                      <strong className={`tag ${statusTone(effectiveOrderStatus(order))}`}>{statusLabels[effectiveOrderStatus(order)]}</strong>
                      {completedOrderIds.has(order.id) && (
                        <small className="tag good">
                          {isInternalCommissionOrder(order)
                            ? "Concluído: registro interno"
                            : isAutomaticallyCompletedWorkshopOrder(order)
                              ? "Concluído: sem peça informada"
                              : "Concluído após passagem"}
                        </small>
                      )}
                    </div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Origem</span><strong>{sourceLabel(order.orderSource)}</strong></div>
                    <div>
                      <span>Pedido</span>
                      <strong>{order.orderNumber || "-"}</strong>
                      {order.orderVor && <small className="parts-vor-flag">Pedido VOR</small>}
                    </div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Data pedido</span><strong>{formatDate(order.orderDate)}</strong></div>
                    <div><span>NF</span><strong>{order.invoiceNumber || "-"}</strong></div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Previsão</span><strong>{formatDate(order.expectedArrivalDate)}</strong></div>
                    <div><span>Imobilizado</span><strong>{isOrderVehicleImmobilized(order) ? "Sim" : "Não"}</strong></div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Consultor</span><strong>{order.consultantName || "-"}</strong></div>
                    <div><span>Técnico</span><strong>{order.technicianName || "-"}</strong></div>
                  </div>
                  <div className="parts-cell"><span>Atualizado</span><strong>{formatActionSignature(order.updatedBy || order.requestedBy, order.updatedAt, "-")}</strong></div>
                </div>

                {isOrderVehicleImmobilized(order) && <span className="tag bad">Veículo imobilizado</span>}
                {order.cancellationReason && <p className="parts-note"><strong>Cancelamento:</strong> {order.cancellationReason}</p>}

                <div className="parts-actions-row">
                  <button type="button" className="ghost-btn" onClick={() => toggleSection(order.id, "dados")}>+ Dados</button>
                  <button type="button" className="ghost-btn" onClick={() => toggleSection(order.id, "pecas")}>+ Peças</button>
                  <button type="button" className="ghost-btn" onClick={() => toggleSection(order.id, "pedido")}>+ Pedido</button>
                  <button type="button" className="ghost-btn" onClick={() => toggleSection(order.id, "cancelamento")}>+ Cancelamento</button>
                  <button type="button" className="ghost-btn info-btn" onClick={() => toggleSection(order.id, "info")}>i Info</button>
                </div>

                {openSection === "info" && (
                  <div className="parts-audit-box">
                    <div><span>Solicitado por</span><strong>{formatActionSignature(order.requestedBy, order.createdAt, "-")}</strong></div>
                    <div><span>Atualizado por</span><strong>{formatActionSignature(order.updatedBy || order.requestedBy, order.updatedAt, "-")}</strong></div>
                    <div><span>Status atual</span><strong>{statusLabels[effectiveOrderStatus(order)]}</strong></div>
                    <div><span>Pedido</span><strong>{order.orderNumber || "-"}</strong><small>{sourceLabel(order.orderSource)}</small></div>
                    <div><span>Nota / previsao</span><strong>{order.invoiceNumber || "-"}</strong><small>{formatDate(order.expectedArrivalDate)}</small></div>
                    <div><span>Cancelamento</span><strong>{order.cancellationReason || "-"}</strong></div>
                  </div>
                )}

                {openSection === "dados" && (
                  <div className="parts-edit-grid compact">
                    <label className="field">
                      <span>ID Cliente</span>
                      <input
                        value={form.customerId}
                        placeholder="Informar ID"
                        onChange={(event) => updateOrderForm(order.id, { customerId: event.target.value.toUpperCase() })}
                      />
                    </label>
                    <label className={`field ${fieldErrors.orderKind ? "parts-field-invalid" : ""}`}>
                      <span>Tipo</span>
                      <select
                        id={`part-order-orderKind-${order.id}`}
                        required
                        aria-invalid={Boolean(fieldErrors.orderKind)}
                        aria-describedby={fieldErrors.orderKind ? `part-order-orderKind-error-${order.id}` : undefined}
                        value={form.orderKind}
                        onChange={(event) => updateOrderForm(order.id, { orderKind: event.target.value as PartOrderKind | "" })}
                      >
                        <option value="">Selecionar</option>
                        {kindOptions.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      {fieldErrors.orderKind && <small id={`part-order-orderKind-error-${order.id}`} className="parts-field-error-message" role="alert">{fieldErrors.orderKind}</small>}
                    </label>
                  </div>
                )}

                {openSection === "pedido" && (
                  <div className="parts-edit-grid">
                    <label className="field">
                      <span>Status do Pedido</span>
                      <select
                        value={form.orderStatus}
                        onChange={(event) => updateOrderForm(order.id, { orderStatus: event.target.value as PartOrderStatus })}
                      >
                        {statusOptions.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label className={`field ${fieldErrors.orderSource ? "parts-field-invalid" : ""}`}>
                      <span>Origem</span>
                      <select
                        id={`part-order-orderSource-${order.id}`}
                        aria-invalid={Boolean(fieldErrors.orderSource)}
                        aria-describedby={fieldErrors.orderSource ? `part-order-orderSource-error-${order.id}` : undefined}
                        value={form.orderSource}
                        onChange={(event) => updateOrderForm(order.id, { orderSource: event.target.value as PartOrderSource | "" })}
                      >
                        <option value="">Selecionar origem</option>
                        {sourceOptions.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      {fieldErrors.orderSource && <small id={`part-order-orderSource-error-${order.id}`} className="parts-field-error-message" role="alert">{fieldErrors.orderSource}</small>}
                    </label>
                    <div className={`field ${fieldErrors.orderNumber ? "parts-field-invalid" : ""}`}>
                      <span>Número do Pedido</span>
                      <input
                        id={`part-order-orderNumber-${order.id}`}
                        aria-invalid={Boolean(fieldErrors.orderNumber)}
                        aria-describedby={fieldErrors.orderNumber ? `part-order-orderNumber-error-${order.id}` : undefined}
                        value={form.orderNumber}
                        placeholder="Mobis ou externo"
                        onChange={(event) => updateOrderForm(order.id, { orderNumber: event.target.value.toUpperCase() })}
                      />
                      {fieldErrors.orderNumber && <small id={`part-order-orderNumber-error-${order.id}`} className="parts-field-error-message" role="alert">{fieldErrors.orderNumber}</small>}
                      <label className="inline-check parts-vor-check">
                        <input
                          type="checkbox"
                          checked={form.orderVor}
                          onChange={(event) => updateOrderForm(order.id, { orderVor: event.target.checked })}
                        />
                        <span>Pedido VOR</span>
                      </label>
                    </div>
                    <label className="field">
                      <span>Data do Pedido</span>
                      <input
                        type="date"
                        value={form.orderDate}
                        onChange={(event) => updateOrderForm(order.id, { orderDate: event.target.value })}
                      />
                    </label>
                    <label className={`field ${fieldErrors.invoiceNumber ? "parts-field-invalid" : ""}`}>
                      <span>Nota Fiscal</span>
                      <input
                        id={`part-order-invoiceNumber-${order.id}`}
                        aria-invalid={Boolean(fieldErrors.invoiceNumber)}
                        aria-describedby={fieldErrors.invoiceNumber ? `part-order-invoiceNumber-error-${order.id}` : undefined}
                        value={form.invoiceNumber}
                        onChange={(event) => updateOrderForm(order.id, { invoiceNumber: event.target.value.toUpperCase() })}
                      />
                      {fieldErrors.invoiceNumber && <small id={`part-order-invoiceNumber-error-${order.id}`} className="parts-field-error-message" role="alert">{fieldErrors.invoiceNumber}</small>}
                    </label>
                    <label className={`field ${fieldErrors.expectedArrivalDate ? "parts-field-invalid" : ""}`}>
                      <span>Previsão de chegada</span>
                      <input
                        id={`part-order-expectedArrivalDate-${order.id}`}
                        aria-invalid={Boolean(fieldErrors.expectedArrivalDate)}
                        aria-describedby={fieldErrors.expectedArrivalDate ? `part-order-expectedArrivalDate-error-${order.id}` : undefined}
                        type="date"
                        value={form.expectedArrivalDate}
                        onChange={(event) => updateOrderForm(order.id, { expectedArrivalDate: event.target.value })}
                      />
                      {fieldErrors.expectedArrivalDate && <small id={`part-order-expectedArrivalDate-error-${order.id}`} className="parts-field-error-message" role="alert">{fieldErrors.expectedArrivalDate}</small>}
                    </label>
                  </div>
                )}

                {(openSection === "cancelamento" || form.orderStatus === "cancelado") && (
                  <label className={`field ${fieldErrors.cancellationReason ? "parts-field-invalid" : ""}`}>
                    <span>Motivo do cancelamento</span>
                    <textarea
                      id={`part-order-cancellationReason-${order.id}`}
                      aria-invalid={Boolean(fieldErrors.cancellationReason)}
                      aria-describedby={fieldErrors.cancellationReason ? `part-order-cancellationReason-error-${order.id}` : undefined}
                      required={form.orderStatus === "cancelado"}
                      value={form.cancellationReason}
                      placeholder="Informe por que este pedido foi cancelado"
                      onChange={(event) => updateOrderForm(order.id, { cancellationReason: event.target.value })}
                    />
                    {fieldErrors.cancellationReason && <small id={`part-order-cancellationReason-error-${order.id}`} className="parts-field-error-message" role="alert">{fieldErrors.cancellationReason}</small>}
                  </label>
                )}

                {openSection === "pecas" && (
                  <>
                    <div className="parts-items">
                      {form.parts.map((part, index) => (
                        <div key={part.id} className="part-item-row">
                          <PartCatalogFields
                            index={index}
                            reference={part.partReference ?? ""}
                            description={part.partDescription ?? ""}
                            onChange={(value) => updatePartItem(order, part.id, value)}
                          />
                          <button
                            className="ghost-btn"
                            type="button"
                            disabled={form.parts.length <= 1}
                            onClick={() => removePartItem(order, part.id)}
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                    </div>

                    <button className="ghost-btn" type="button" onClick={() => addPartItem(order)}>
                      + Adicionar peça
                    </button>
                  </>
                )}

                <button
                  className="ghost-btn"
                  type="button"
                  disabled={savingId === order.id}
                  onClick={() => saveOrder(order)}
                >
                  {savingId === order.id ? "Salvando..." : "Salvar andamento"}
                </button>
              </article>
            );
            }) : (
              <p className="empty">Nenhum pedido de peças encontrado.</p>
            )}
          </div>
        </section>
      </main>
    </ProtectedPage>
  );
}
