/**
 * Checklist de pasos del `OperationOverlay` en estado "en curso" (README
 * "Interactions & Behavior", fila "Overlay de operación"; rediseño Paso 7/8).
 * Extraído a un módulo aparte para poder testearlo sin renderizar
 * componentes (mismo motivo que `presetSwitcher.ts`/`activeSetEntries.ts`).
 *
 * DECISIÓN DE GRANULARIDAD (confirmada contra el código, no asumida): el
 * mock (`screenshots/1f-overlays-progreso-uac-fallo.png`) muestra 5 líneas,
 * separando "Desempaquetando VPK (4 de 4)" de "Empaquetando pak01_dir.vpk"
 * con un contador en vivo. Verificado contra `merge-orchestrator.ts`: AMBAS
 * frases corresponden al MISMO step real (`"merge"`, `#emit("merge")` antes
 * de la única llamada a `MergeEngine.merge()`, que hace extracción +
 * detección de colisiones + empaquetado como una operación atómica) —
 * `MergeProgressEvent` no tiene granularidad por addon ni contador de
 * archivos. Agregar esa granularidad requeriría instrumentar eventos nuevos
 * dentro de `MergeEngine`/`VpkTool` (una 4ª excepción a "ningún IPC/estado
 * nuevo" sin aprobar), así que ESTE módulo colapsa esas dos líneas del mock
 * en UNA sola ("merge"), sin contador — la opción que el usuario pidió
 * preferir en vez de ampliar el scope.
 *
 * También se corrigió el copy del paso "backup" respecto del mock: el mock
 * dice "Copia de seguridad de gameinfo.txt", pero `BackupManager.backupExisting`
 * (Sección 12) respalda el `pak01_dir.vpk` EXISTENTE en `modsvs/` antes de
 * sobrescribirlo — nunca gameinfo.txt (que no tiene backup real en el
 * código, ver también la nota equivalente en `settingsDetectionStatus.ts`).
 *
 * `guard`/`scan`/`elevation` (precondiciones casi instantáneas) y
 * `saveManifest`/`done` (cierre tras `gameinfo`) no tienen fila propia,
 * mismo criterio que el propio mock (que tampoco las muestra): antes de
 * `backup` todo el checklist está "pending"; en o después de `saveManifest`/
 * `done`, todo está "done".
 */
import type { MergeProgressEvent } from "../../main/domain/index.js";

type MergeStep = MergeProgressEvent["step"];
type ChecklistStep = "backup" | "merge" | "install" | "gameinfo";

export type ChecklistRowState = "done" | "current" | "pending";

export interface ChecklistRow {
  step: ChecklistStep;
  label: string;
  state: ChecklistRowState;
}

/** Orden real de la secuencia normal (sin resume), tal como la emite MergeOrchestrator. */
const ALL_STEPS_ORDER: readonly MergeStep[] = [
  "guard",
  "scan",
  "elevation",
  "backup",
  "merge",
  "install",
  "gameinfo",
  "saveManifest",
  "done",
];

/** Los únicos 4 steps con fila visible en el checklist (ver docblock del módulo). */
const CHECKLIST_STEPS: readonly ChecklistStep[] = ["backup", "merge", "install", "gameinfo"];

const CHECKLIST_LABELS: Record<ChecklistStep, string> = {
  backup: "Copia de seguridad del VPK anterior",
  merge: "Fusionando addons (extrayendo y empaquetando el VPK)",
  install: "Instalando en modsvs\\",
  gameinfo: "Registrando en gameinfo.txt",
};

/**
 * `currentStep`: el último `step` recibido por `onProgress` para la operación
 * en curso, o `null` si todavía no llegó ninguno. `"restarting"`/`"failed"`
 * no aparecen en `ALL_STEPS_ORDER` a propósito: cuando cualquiera de los dos
 * llega, `OperationOverlay` deja de mostrar este checklist (pasa a sus
 * propias vistas de reinicio/fallo), así que su posición acá es irrelevante
 * — `indexOf` devuelve `-1` para ambos, tratados igual que `null`.
 */
export function computeChecklist(currentStep: MergeStep | null): ChecklistRow[] {
  const currentPosition = currentStep === null ? -1 : ALL_STEPS_ORDER.indexOf(currentStep);

  return CHECKLIST_STEPS.map((step) => {
    const stepPosition = ALL_STEPS_ORDER.indexOf(step);
    const state: ChecklistRowState =
      currentPosition > stepPosition ? "done" : currentPosition === stepPosition ? "current" : "pending";
    return { step, label: CHECKLIST_LABELS[step], state };
  });
}

/** Fracción [0, 1] de la barra de progreso — cantidad de filas "done" sobre el total. */
export function computeProgressFraction(currentStep: MergeStep | null): number {
  const rows = computeChecklist(currentStep);
  return rows.filter((row) => row.state === "done").length / rows.length;
}
