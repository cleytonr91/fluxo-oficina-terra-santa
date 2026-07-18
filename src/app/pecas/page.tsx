"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import type { ManualContent } from "@/components/operation-manual";
import { useAuth } from "@/context/auth-context";
import { subscribeActiveVehicleFlows, subscribePartOrders, updatePartOrder } from "@/services/firestore";
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
  { value: "externo", label: "Externo" },
];

const manual: ManualContent = {
  title: "Manual de Pedidos de Peças",
  audience: "Uso principal: estoque, chefe de oficina e consultores",
  objective: "Controlar os pedidos de peças originados no fluxo, registrar andamento e deixar claro quando a peça está disponível para execução ou agendamento.",
  steps: [
    "Abra a página Peças para visualizar todos os pedidos originados nos chips.",
    "Use os filtros superiores para localizar pendências, B.O, VOR, em trânsito, disponíveis ou cancelados.",
    "Em Dados, complemente ID do cliente e tipo do pedido.",
    "Em Peças, revise ou adicione referência e descrição de cada item.",
    "Em Pedido, atualize status, origem, número do pedido, data, nota fiscal e previsão.",
    "Ao marcar Disponível, o pedido fica apto para ação: oficina se imobilizado, agendamento se cliente está rodando.",
    "Ao cancelar, informe obrigatoriamente o motivo.",
  ],
  rules: [
    "Pedido realizado exige origem e número do pedido.",
    "Em trânsito exige nota fiscal e previsão de chegada.",
    "B.O deve ser usado quando a peça está em back order.",
    "Pedido VOR deve ser marcado para acompanhamento prioritário.",
    "Veículo imobilizado deve ficar visível para o chefe de oficina.",
  ],
  flow: [
    { title: "Solicitado oficina", text: "Necessidade registrada pelo fluxo." },
    { title: "Pedido realizado", text: "Estoque informa origem e número do pedido." },
    { title: "Em trânsito", text: "Nota fiscal e previsão de chegada são confirmadas." },
    { title: "Recebido", text: "Peça chegou à loja." },
    { title: "Disponível", text: "Peça pode gerar execução ou agendamento de retorno." },
  ],
};

type PartsFilter = "pendentes" | "todos" | "vor" | PartOrderStatus;
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

function statusTone(status: PartOrderStatus) {
  if (status === "disponivel" || status === "recebido") return "good";
  if (status === "cancelado") return "bad";
  if (status === "em_transito" || status === "pedido_realizado" || status === "back_order") return "warn";
  return "";
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

function orderTimeValue(order: PartOrder) {
  const date = toDate(order.createdAt) ?? toDate(order.updatedAt);
  return date?.getTime() ?? 0;
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
  const [vehicles, setVehicles] = useState<VehicleFlow[]>([]);
  const [orderForms, setOrderForms] = useState<Record<string, Partial<PartOrderFormFields>>>({});
  const [openSections, setOpenSections] = useState<Record<string, PartEditSection | undefined>>({});
  const [savingId, setSavingId] = useState("");
  const [statusFilter, setStatusFilter] = useState<PartsFilter>(initialFocusedOrderId ? "todos" : "pendentes");
  const [focusedOrderId, setFocusedOrderId] = useState(initialFocusedOrderId);
  const [error, setError] = useState("");
  const [mobisReceipt, setMobisReceipt] = useState<MobisReceiptState>(emptyMobisReceipt);
  const [applyingReceiptId, setApplyingReceiptId] = useState("");

  useEffect(() => {
    const unsubscribe = subscribePartOrders((items) => {
      setOrders(items);
      setError("");
    }, (currentError) => {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar pedidos de peças.");
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeActiveVehicleFlows((items) => {
      setVehicles(items);
    }, () => undefined, { includeDelivered: true });

    return unsubscribe;
  }, []);

  const mergedOrders = useMemo(() => {
    const orderByVehicle = new Map(orders.map((order) => [order.vehicleFlowId, order]));
    const syntheticOrders = vehicles
      .filter((vehicle) => vehicle.partsOrdered && !orderByVehicle.has(vehicle.id))
      .map((vehicle): PartOrder => ({
        id: vehicle.id,
        vehicleFlowId: vehicle.id,
        plate: vehicle.plate,
        customerId: "",
        clientName: vehicle.clientName,
        consultantName: vehicle.consultantName,
        technicianName: vehicle.technicianName,
        parts: [{ id: "peca-1", partReference: "", partDescription: vehicle.partsNote ?? "" }],
        orderStatus: "solicitado_oficina",
        vehicleImmobilized: false,
        createdAt: vehicle.createdAt,
        updatedAt: vehicle.updatedAt,
      }));

    return [...orders, ...syntheticOrders];
  }, [orders, vehicles]);

  const vehiclesById = useMemo(() => {
    const mapped = new Map<string, VehicleFlow>();
    vehicles.forEach((vehicle) => mapped.set(vehicle.id, vehicle));
    return mapped;
  }, [vehicles]);

  function customerNameContent(order: PartOrder) {
    const name = order.clientName ?? "Cliente sem nome";
    const url = whatsappUrl(vehiclesById.get(order.vehicleFlowId)?.phone);

    if (!url) return <strong>{name}</strong>;

    return (
      <a className="client-link" href={url} target="_blank" rel="noreferrer">
        <strong>{name}</strong>
      </a>
    );
  }

  const availableOrders = useMemo(() => (
    mergedOrders.filter((order) => order.orderStatus === "disponivel")
  ), [mergedOrders]);

  const canceledOrders = useMemo(() => (
    mergedOrders.filter((order) => order.orderStatus === "cancelado")
  ), [mergedOrders]);

  const pendingOrders = useMemo(() => (
    mergedOrders.filter((order) => order.orderStatus !== "disponivel" && order.orderStatus !== "cancelado")
  ), [mergedOrders]);

  const filteredOrders = useMemo(() => {
    if (focusedOrderId) return mergedOrders.filter((order) => order.vehicleFlowId === focusedOrderId || order.id === focusedOrderId);
    if (statusFilter === "todos") return mergedOrders;
    if (statusFilter === "pendentes") return pendingOrders;
    if (statusFilter === "vor") return mergedOrders.filter((order) => order.orderVor);
    if (statusFilter === "solicitado_oficina") {
      return mergedOrders.filter((order) => order.orderStatus === "solicitado_oficina" || order.orderStatus === "necessidade_identificada" || order.orderStatus === "aguardando_pecas");
    }
    return mergedOrders.filter((order) => order.orderStatus === statusFilter);
  }, [focusedOrderId, mergedOrders, pendingOrders, statusFilter]);

  const availableImmobilized = availableOrders.filter((order) => order.vehicleImmobilized);
  const availableScheduling = availableOrders.filter((order) => !order.vehicleImmobilized);

  const metrics = [
    { label: "pendências", value: pendingOrders.length, filter: "pendentes" as PartsFilter, state: "active" },
    { label: "solicitado oficina", value: mergedOrders.filter((order) => order.orderStatus === "solicitado_oficina" || order.orderStatus === "necessidade_identificada" || order.orderStatus === "aguardando_pecas").length, filter: "solicitado_oficina" as PartsFilter, state: "" },
    { label: "pedido realizado", value: mergedOrders.filter((order) => order.orderStatus === "pedido_realizado").length, filter: "pedido_realizado" as PartsFilter, state: "" },
    { label: "B.O", value: mergedOrders.filter((order) => order.orderStatus === "back_order").length, filter: "back_order" as PartsFilter, state: "danger" },
    { label: "VOR", value: mergedOrders.filter((order) => order.orderVor).length, filter: "vor" as PartsFilter, state: "danger" },
    { label: "em trânsito", value: mergedOrders.filter((order) => order.orderStatus === "em_transito").length, filter: "em_transito" as PartsFilter, state: "" },
    { label: "disponíveis", value: availableOrders.length, filter: "disponivel" as PartsFilter, state: "" },
    { label: "cancelados", value: canceledOrders.length, filter: "cancelado" as PartsFilter, state: "danger" },
  ];

  function classifyMobisReceiptByQuantity(fileName: string, invoiceNumber: string, items: MobisReceiptItem[]) {
    const openOrders = mergedOrders.filter((order) => order.orderStatus !== "disponivel" && order.orderStatus !== "cancelado");
    const safe: MobisReceiptMatch[] = [];
    const doubtful: MobisReceiptMatch[] = [];
    const notFound: MobisReceiptItem[] = [];
    const groupedItems = new Map<string, MobisReceiptItem>();

    items.forEach((item) => {
      const key = normalizeCode(item.partReference);
      const current = groupedItems.get(key);

      if (!current) {
        groupedItems.set(key, item);
        return;
      }

      const mobisOrders = Array.from(new Set([
        ...current.mobisOrder.split(",").map((value) => value.trim()).filter(Boolean),
        item.mobisOrder,
      ]));

      groupedItems.set(key, {
        ...current,
        id: `${current.id}-${item.line}`,
        mobisOrder: mobisOrders.join(", "),
        quantity: current.quantity + item.quantity,
      });
    });

    groupedItems.forEach((item) => {
      const partCandidates = openOrders
        .filter((order) => orderHasPart(order, item.partReference))
        .sort((a, b) => orderTimeValue(a) - orderTimeValue(b));

      if (!partCandidates.length) {
        notFound.push(item);
        return;
      }

      const allocated = partCandidates.slice(0, item.quantity);

      allocated.forEach((order, index) => {
        safe.push({
          item: {
            ...item,
            id: `${item.id}-${order.id}`,
            quantity: 1,
          },
          candidates: [order],
          recommended: order,
          reason: `Fila mais antiga por referência (${index + 1}/${Math.min(item.quantity, partCandidates.length)} de ${item.quantity} recebida(s))`,
        });
      });

      if (item.quantity > partCandidates.length) {
        notFound.push({
          ...item,
          id: `${item.id}-saldo`,
          quantity: item.quantity - partCandidates.length,
          partDescription: `${item.partDescription} - SALDO SEM PEDIDO ABERTO`,
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
      orderStatus: order.orderStatus === "necessidade_identificada" || order.orderStatus === "aguardando_pecas"
        ? "solicitado_oficina"
        : order.orderStatus,
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
  }

  async function saveOrder(order: PartOrder) {
    const form = orderFormValues(order);
    const validParts = form.parts.filter((part) => part.partReference?.trim() || part.partDescription?.trim());

    if ((form.orderStatus === "pedido_realizado" || form.orderStatus === "back_order") && (!form.orderSource || !form.orderNumber.trim())) {
      setError("Para marcar Pedido Realizado ou B.O, informe a origem e o número do pedido.");
      return;
    }

    if (form.orderStatus === "em_transito" && (!form.invoiceNumber.trim() || !form.expectedArrivalDate)) {
      setError("Para marcar Em trânsito, informe a nota fiscal e confirme a previsão de chegada.");
      return;
    }

    if (form.orderStatus === "cancelado" && !form.cancellationReason.trim()) {
      setError("Para cancelar um pedido, informe o motivo do cancelamento.");
      return;
    }

    setSavingId(order.id);
    setError("");

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

      setOrders((current) => current.map((item) => (
        item.id === order.id
          ? {
              ...item,
              parts: validParts.map((part, index) => ({
                id: part.id || `peca-${index + 1}`,
                partReference: part.partReference?.trim().toUpperCase(),
                partDescription: part.partDescription?.trim(),
              })),
              partReference: validParts[0]?.partReference?.trim().toUpperCase(),
              partDescription: validParts[0]?.partDescription?.trim(),
              customerId: form.customerId,
              orderKind: form.orderKind || undefined,
              orderStatus: form.orderStatus,
              orderSource: form.orderSource || undefined,
              orderNumber: form.orderNumber,
              orderVor: form.orderVor,
              orderDate: form.orderDate,
              invoiceNumber: form.invoiceNumber,
              expectedArrivalDate: form.expectedArrivalDate,
              cancellationReason: form.cancellationReason,
              updatedBy: profile?.name ?? user?.email ?? user?.uid,
              updatedAt: new Date().toISOString(),
            }
          : item
      )));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível salvar o pedido.");
    } finally {
      setSavingId("");
    }
  }

  async function applyMobisReceiptMatch(match: MobisReceiptMatch, order = match.recommended) {
    if (!order) return;

    const form = orderFormValues(order);
    const validParts = form.parts.filter((part) => part.partReference?.trim() || part.partDescription?.trim());
    const receiptKey = `${order.id}-${match.item.id}`;
    setApplyingReceiptId(receiptKey);
    setError("");

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
              orderSource: form.orderSource || "mobis",
              orderNumber: form.orderNumber || match.item.mobisOrder,
              invoiceNumber: mobisReceipt.invoiceNumber || form.invoiceNumber,
              updatedBy: profile?.name ?? user?.email ?? user?.uid,
              updatedAt: new Date().toISOString(),
            }
          : item
      )));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível aplicar o recebimento Mobis.");
    } finally {
      setApplyingReceiptId("");
    }
  }

  async function applySafeMobisMatches() {
    for (const match of mobisReceipt.safe) {
      await applyMobisReceiptMatch(match);
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
    <ProtectedPage title="Pedidos de Peças" subtitle="Acompanhamento dos pedidos originados nos chips do fluxo." manual={manual}>
      <main className="page-wrap parts-page">
        <section className="flow-metrics">
          {metrics.map((metric) => (
            <button
              key={metric.label}
              className={`flow-metric ${metric.state} ${statusFilter === metric.filter ? "selected" : ""}`}
              type="button"
              onClick={() => setStatusFilter(metric.filter)}
            >
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </button>
          ))}

          <label className="flow-filter">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="pendentes">Pendências</option>
              <option value="todos">Todos</option>
              <option value="vor">VOR</option>
              {statusOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </section>

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
                  Aplicar encontrados com segurança
                </button>
              </div>

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
                        Marcar disponível
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
                          <small>{formatDateTime(match.recommended.createdAt)}</small>
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={applyingReceiptId === `${match.recommended.id}-${match.item.id}`}
                            onClick={() => applyMobisReceiptMatch(match, match.recommended)}
                          >
                            Aplicar neste cliente
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
                            <span>{candidate.plate || "-"} · {formatDateTime(candidate.createdAt)}</span>
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
            <span>Mostrando apenas o pedido vinculado ao chip imobilizado.</span>
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

        {availableOrders.length > 0 && (
          <section className="panel parts-available-panel">
            <div className="panel-head">
              <h2 className="panel-title">Peças disponíveis para ação</h2>
              <span className="panel-subtitle">{availableOrders.length} pedido(s) disponível(is).</span>
            </div>

            <div className="available-split">
              <div className="available-box urgent">
                <h3>Veículos imobilizados</h3>
                {availableImmobilized.length ? availableImmobilized.map((order) => (
                  <div key={order.id} className="available-row">
                    <strong>{order.plate ?? "Sem placa"}</strong>
                    {customerNameContent(order)}
                    <small>Chefe de oficina deve programar execução.</small>
                  </div>
                )) : <p className="empty">Nenhum imobilizado disponível.</p>}
              </div>

              <div className="available-box">
                <h3>Agendamento / retorno</h3>
                {availableScheduling.length ? availableScheduling.map((order) => (
                  <div key={order.id} className="available-row">
                    <strong>{order.plate ?? "Sem placa"}</strong>
                    {customerNameContent(order)}
                    <small>Agendamento deve dar sequência ao atendimento.</small>
                  </div>
                )) : <p className="empty">Nenhum retorno pendente.</p>}
              </div>
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Acompanhamento dos pedidos</h2>
            <span className="panel-subtitle">{filteredOrders.length} pedido(s) no filtro atual.</span>
          </div>

          <div className="parts-list">
            {filteredOrders.length ? filteredOrders.map((order) => {
              const form = orderFormValues(order);
              const openSection = openSections[order.id];

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
                    <div><span>Status</span><strong className={`tag ${statusTone(order.orderStatus)}`}>{statusLabels[order.orderStatus]}</strong></div>
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
                    <div><span>Imobilizado</span><strong>{order.vehicleImmobilized ? "Sim" : "Não"}</strong></div>
                  </div>
                  <div className="parts-cell parts-duo-cell">
                    <div><span>Consultor</span><strong>{order.consultantName || "-"}</strong></div>
                    <div><span>Técnico</span><strong>{order.technicianName || "-"}</strong></div>
                  </div>
                  <div className="parts-cell"><span>Atualizado</span><strong>{order.updatedBy || order.requestedBy || "-"}</strong><small>{formatDateTime(order.updatedAt)}</small></div>
                </div>

                {order.vehicleImmobilized && <span className="tag bad">Veículo imobilizado</span>}
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
                    <div><span>Solicitado por</span><strong>{order.requestedBy || "-"}</strong><small>{formatDateTime(order.createdAt)}</small></div>
                    <div><span>Atualizado por</span><strong>{order.updatedBy || order.requestedBy || "-"}</strong><small>{formatDateTime(order.updatedAt)}</small></div>
                    <div><span>Status atual</span><strong>{statusLabels[order.orderStatus]}</strong></div>
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
                    <label className="field">
                      <span>Tipo</span>
                      <select
                        value={form.orderKind}
                        onChange={(event) => updateOrderForm(order.id, { orderKind: event.target.value as PartOrderKind | "" })}
                      >
                        <option value="">Selecionar</option>
                        {kindOptions.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
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
                    <label className="field">
                      <span>Origem</span>
                      <select
                        value={form.orderSource}
                        onChange={(event) => updateOrderForm(order.id, { orderSource: event.target.value as PartOrderSource | "" })}
                      >
                        <option value="">Selecionar origem</option>
                        {sourceOptions.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <div className="field">
                      <span>Número do Pedido</span>
                      <input
                        value={form.orderNumber}
                        placeholder="Mobis ou externo"
                        onChange={(event) => updateOrderForm(order.id, { orderNumber: event.target.value.toUpperCase() })}
                      />
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
                    <label className="field">
                      <span>Nota Fiscal</span>
                      <input
                        value={form.invoiceNumber}
                        onChange={(event) => updateOrderForm(order.id, { invoiceNumber: event.target.value.toUpperCase() })}
                      />
                    </label>
                    <label className="field">
                      <span>Previsão de chegada</span>
                      <input
                        type="date"
                        value={form.expectedArrivalDate}
                        onChange={(event) => updateOrderForm(order.id, { expectedArrivalDate: event.target.value })}
                      />
                    </label>
                  </div>
                )}

                {(openSection === "cancelamento" || form.orderStatus === "cancelado") && (
                  <label className="field">
                    <span>Motivo do cancelamento</span>
                    <textarea
                      required={form.orderStatus === "cancelado"}
                      value={form.cancellationReason}
                      placeholder="Informe por que este pedido foi cancelado"
                      onChange={(event) => updateOrderForm(order.id, { cancellationReason: event.target.value })}
                    />
                  </label>
                )}

                {openSection === "pecas" && (
                  <>
                    <div className="parts-items">
                      {form.parts.map((part, index) => (
                        <div key={part.id} className="part-item-row">
                          <label className="field">
                            <span>Referência da Peça {index + 1}</span>
                            <input
                              value={part.partReference ?? ""}
                              onChange={(event) => updatePartItem(order, part.id, { partReference: event.target.value.toUpperCase() })}
                            />
                          </label>
                          <label className="field">
                            <span>Descrição da Peça {index + 1}</span>
                            <input
                              value={part.partDescription ?? ""}
                              onChange={(event) => updatePartItem(order, part.id, { partDescription: event.target.value.toUpperCase() })}
                            />
                          </label>
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
