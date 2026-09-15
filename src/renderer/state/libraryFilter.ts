/**
 * Búsqueda y chips de filtro de Biblioteca (README "Interactions & Behavior":
 * ambos NUEVOS, solo cliente, sin IPC — filtran `sortedAddons`, ya en
 * memoria). Extraído a un módulo aparte (mismo motivo que `librarySort.ts`/
 * `librarySelection.ts` — testeable sin jsdom, ver Context/02-pendientes.md).
 */
import type { ScannedAddon, VScriptClassification } from "../../main/domain/index.js";

export type LibraryFilter = "all" | "active" | "compatible" | "vscript";

/**
 * `true` si `addon` matchea `query` (case-insensitive, sobre `info.title` —
 * o el `id` de fallback si no hay título — e `info.author`). `query` vacío o
 * solo espacios matchea todo (equivalente a no buscar).
 */
export function matchesQuery(addon: ScannedAddon, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const title = (addon.info?.title ?? addon.id).toLowerCase();
  const author = (addon.info?.author ?? "").toLowerCase();
  return title.includes(needle) || author.includes(needle);
}

/**
 * `true` si un addon con clasificación `classification` (o `"pending"` si
 * todavía no resolvió) matchea `filter`. Un addon `"pending"` nunca matchea
 * "compatible" ni "vscript" (ninguno de los dos es todavía un hecho
 * conocido) — solo puede aparecer bajo "Todos"/"Activos".
 */
export function matchesFilter(
  addonId: string,
  classification: VScriptClassification | "pending",
  activeIds: ReadonlySet<string>,
  filter: LibraryFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return activeIds.has(addonId);
    case "compatible":
      return classification !== "pending" && !classification.isVScriptAddon;
    case "vscript":
      return classification !== "pending" && classification.isVScriptAddon;
  }
}

/** Aplica `matchesFilter` + `matchesQuery` en conjunto, en ese orden. */
export function filterAddons(
  addons: readonly ScannedAddon[],
  classifications: Record<string, VScriptClassification | "pending">,
  activeIds: ReadonlySet<string>,
  filter: LibraryFilter,
  query: string,
): ScannedAddon[] {
  return addons.filter((addon) => {
    const classification = classifications[addon.id] ?? "pending";
    return (
      matchesFilter(addon.id, classification, activeIds, filter) && matchesQuery(addon, query)
    );
  });
}
