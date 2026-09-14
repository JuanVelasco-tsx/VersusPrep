/**
 * Lógica PURA de ordenamiento de columnas de Biblioteca (P-31, Paso 2).
 * Extraída de `AddonList.tsx` para poder testearla sin renderizar
 * componentes (mismo motivo que `pendingSelection.ts`/`presetSwitcher.ts` —
 * no hay infraestructura jsdom en este proyecto todavía, ver
 * `Context/02-pendientes.md`). El ordenamiento en sí vive ENTERAMENTE acá y
 * en el renderer: no toca IPC, opera sobre el array de `ScannedAddon[]` ya
 * cargado por `scanAddons()` (`mtimeMs`/`sizeBytes` ya vienen del backend,
 * Paso 1) y el `Record<addonId, VScriptClassification>` que `AddonList.tsx`
 * ya mantiene por separado (la clasificación VScript NO es parte de
 * `ScannedAddon`, ver ese componente y `classifyVScript`).
 */
import type { ScannedAddon, VScriptClassification } from "../../main/domain/index.js";

export type SortColumn = "name" | "mtime" | "size" | "type";
export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

export type ClassificationLookup = Record<string, VScriptClassification | "pending">;

/**
 * Estado de ordenamiento SIGUIENTE tras un click en el encabezado `column`
 * (patrón estándar de explorador de archivos: un solo criterio activo a la
 * vez, clickear la misma columna alterna asc/desc, clickear una columna
 * distinta la activa en ascendente).
 *
 * `current: null` es el estado inicial — SIN ningún encabezado clickeado
 * todavía, la lista se muestra en el orden de escaneo tal cual llega de
 * `scanAddons()` (ver `sortAddons`). Es el default elegido (no es una
 * decisión crítica, ver pedido): es el que menos sorprende porque es
 * exactamente el comportamiento que Biblioteca ya tenía antes de este Paso
 * (sin UI de ordenamiento), así que ningún usuario existente ve un reorden
 * inesperado hasta que clickea un encabezado por primera vez.
 */
export function nextSortState(current: SortState | null, column: SortColumn): SortState {
  if (current !== null && current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: "asc" };
}

function addonName(addon: ScannedAddon): string {
  return addon.info?.title ?? addon.id;
}

/**
 * Ranking de "Tipo" para ordenar: las dos categorías YA resueltas (Normal,
 * VScript) van antes que "Clasificando..." (`pending`) — un addon todavía sin
 * clasificar no es ni compatible ni incompatible, así que agruparlo con
 * cualquiera de los dos sería engañoso; se lo deja al final del ranking en
 * vez de mezclado.
 */
const TYPE_RANK = { normal: 0, vscript: 1, pending: 2 } as const;

function typeRank(addon: ScannedAddon, classifications: ClassificationLookup): number {
  const classification = classifications[addon.id] ?? "pending";
  if (classification === "pending") return TYPE_RANK.pending;
  return classification.isVScriptAddon ? TYPE_RANK.vscript : TYPE_RANK.normal;
}

type Comparator = (a: ScannedAddon, b: ScannedAddon, classifications: ClassificationLookup) => number;

const COMPARATORS: Record<SortColumn, Comparator> = {
  name: (a, b) => addonName(a).localeCompare(addonName(b), "es", { sensitivity: "base" }),
  mtime: (a, b) => a.mtimeMs - b.mtimeMs,
  size: (a, b) => a.sizeBytes - b.sizeBytes,
  type: (a, b, classifications) => typeRank(a, classifications) - typeRank(b, classifications),
};

/**
 * Devuelve `addons` ordenado según `sort` (o una COPIA en el orden de
 * escaneo original si `sort` es `null`, ver `nextSortState`). Nunca muta el
 * array recibido. `Array.prototype.sort` es estable (garantizado desde
 * ES2019), así que dos addons con la misma clave de ordenamiento conservan
 * su orden relativo original — no hace falta un criterio de desempate
 * explícito.
 */
export function sortAddons(
  addons: readonly ScannedAddon[],
  classifications: ClassificationLookup,
  sort: SortState | null,
): ScannedAddon[] {
  if (sort === null) return [...addons];
  const compare = COMPARATORS[sort.column];
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...addons].sort((a, b) => sign * compare(a, b, classifications));
}
