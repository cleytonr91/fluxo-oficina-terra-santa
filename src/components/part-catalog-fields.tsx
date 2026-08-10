"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { loadHyundaiPartsCatalog } from "@/services/firestore";
import type { HyundaiPartCatalogItem } from "@/types/domain";

type SearchableCatalogItem = HyundaiPartCatalogItem & {
  referenceSearch: string;
  descriptionSearch: string;
};

let catalogCache: SearchableCatalogItem[] | null = null;
let catalogRequest: Promise<SearchableCatalogItem[]> | null = null;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

async function getCatalog() {
  if (catalogCache) return catalogCache;
  catalogRequest ??= loadHyundaiPartsCatalog().then((items) => items.map((item) => ({
    ...item,
    referenceSearch: normalize(item.reference),
    descriptionSearch: normalize(item.description),
  })));
  catalogCache = await catalogRequest;
  return catalogCache;
}

export function invalidatePartsCatalogCache() {
  catalogCache = null;
  catalogRequest = null;
}

export function PartCatalogFields({
  index,
  reference,
  description,
  onChange,
}: {
  index: number;
  reference: string;
  description: string;
  onChange: (value: { partReference?: string; partDescription?: string; salePrice?: number }) => void;
}) {
  const [catalog, setCatalog] = useState<SearchableCatalogItem[]>(catalogCache ?? []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const query = useDeferredValue(normalize(searchText));

  async function ensureCatalog() {
    if (catalog.length || loading) return;
    setLoading(true);
    try {
      setCatalog(await getCatalog());
    } finally {
      setLoading(false);
    }
  }

  const suggestions = useMemo(() => {
    if (query.length < 2) return [];

    const buckets: SearchableCatalogItem[][] = [[], [], [], [], []];

    for (const item of catalog) {
      if (item.referenceSearch === query) buckets[0].push(item);
      else if (item.referenceSearch.startsWith(query) && buckets[1].length < 8) buckets[1].push(item);
      else if (item.referenceSearch.includes(query) && buckets[2].length < 8) buckets[2].push(item);
      else if (item.descriptionSearch.startsWith(query) && buckets[3].length < 8) buckets[3].push(item);
      else if (item.descriptionSearch.includes(query) && buckets[4].length < 8) buckets[4].push(item);
    }

    return buckets.flat().slice(0, 8);
  }, [catalog, query]);

  function choose(item: HyundaiPartCatalogItem) {
    onChange({ partReference: item.reference, partDescription: item.description, salePrice: item.salePrice });
    setSearchText(item.reference);
    setOpen(false);
  }

  return (
    <div className="catalog-part-fields">
      <label className="field">
        <span>Referência da peça {index + 1}</span>
        <input
          value={reference}
          placeholder="Digite a referência"
          autoComplete="off"
          onFocus={() => { setSearchText(reference); setOpen(true); void ensureCatalog(); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 180)}
          onChange={(event) => { setSearchText(event.target.value); onChange({ partReference: event.target.value.toUpperCase() }); setOpen(true); void ensureCatalog(); }}
        />
      </label>
      <label className="field">
        <span>Descrição da peça {index + 1}</span>
        <input
          value={description}
          placeholder="Digite para pesquisar no catálogo Hyundai"
          autoComplete="off"
          onFocus={() => { setSearchText(description); setOpen(true); void ensureCatalog(); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 180)}
          onChange={(event) => { setSearchText(event.target.value); onChange({ partDescription: event.target.value.toUpperCase() }); setOpen(true); void ensureCatalog(); }}
        />
      </label>

      {open && query.length >= 2 && (
        <div className="catalog-suggestions" role="listbox" aria-label="Itens Hyundai encontrados">
          {loading ? (
            <span className="catalog-message">Carregando catálogo...</span>
          ) : suggestions.length ? suggestions.map((item) => (
            <button key={item.reference} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
              <strong>{item.reference}</strong>
              <span>{item.description}{typeof item.salePrice === "number" ? ` · ${item.salePrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}</span>
            </button>
          )) : (
            <span className="catalog-message">Item não encontrado. O preenchimento manual continua disponível.</span>
          )}
        </div>
      )}
    </div>
  );
}
