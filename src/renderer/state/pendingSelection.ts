/**
 * Lógica PURA de reconciliación entre el Active_Set instalado y el candidato
 * pendiente de un relanzo elevado (BUG-007/BUG-013, QA V3 jornada 2).
 *
 * Extraída de `ActiveSetPanel.tsx`/`AddonList.tsx` a un módulo aparte para
 * poder testearla sin renderizar componentes (no hay infraestructura jsdom en
 * este proyecto todavía - ver `Context/02-pendientes.md`, P-28). Ambas
 * funciones son deterministas y no tocan IPC ni estado de React: el
 * componente solo les pasa `pendingEntries`, ya resuelto de
 * `getResumeState().pendingEntries` (ver `ipc-contract.ts`, mitad main de
 * Kiro) en `App.tsx`.
 */
import type { AddonManifestEntry } from "../../main/domain/index.js";

/**
 * Resuelve qué `AddonManifestEntry[]` debe alimentar el panel "Activos"
 * (BUG-007). `pendingEntries` (`ResumeState.pendingEntries`, ver
 * ipc-contract.ts) es el Active_Set CANDIDATO que esta instancia estaba
 * restaurando desde el arranque - capturado ANTES de que el resume limpiara
 * el pending, y disponible tanto mientras el resume esta en curso como
 * después de terminar (éxito o fallo) -, así que cuando existe (no es
 * `null`) tiene PRECEDENCIA TOTAL sobre `activeSet` (`getActiveSet()`, el
 * manifest ya instalado): esta instancia arrancó específicamente para
 * restaurar esa selección, y el usuario espera verla reflejada de inmediato
 * sin importar si la escritura de fondo todavía no terminó o ya falló (el
 * resultado de la operación se comunica aparte, por `OperationOverlay`).
 * `[]` es un candidato pendiente válido (sesión activa con selección vacía)
 * y también gana, por eso el chequeo es `!== null`, no una verdad truthy
 * sobre el array.
 */
export function resolveActiveSetEntries(
  activeSet: AddonManifestEntry[],
  pendingEntries: AddonManifestEntry[] | null,
): AddonManifestEntry[] {
  return pendingEntries !== null ? pendingEntries : activeSet;
}

/**
 * Combina el Active_Set instalado con el candidato pendiente para derivar qué
 * addons deben verse "marcados" en los checkboxes de "Biblioteca" (BUG-013):
 * unión por `addonId`, con el candidato pendiente ganando en caso de overlap
 * (mismo criterio de precedencia que `resolveActiveSetEntries` - es la
 * selección que esta instancia esta restaurando). Sin candidato pendiente
 * (`null`, instancia que no arrancó por un resume), devuelve `activeSet` tal
 * cual: el camino normal no cambia de comportamiento.
 */
export function mergePendingIntoActive(
  activeSet: AddonManifestEntry[],
  pendingEntries: AddonManifestEntry[] | null,
): AddonManifestEntry[] {
  if (pendingEntries === null) return activeSet;
  const byId = new Map(activeSet.map((entry) => [entry.addonId, entry]));
  for (const entry of pendingEntries) {
    byId.set(entry.addonId, entry);
  }
  return [...byId.values()];
}
