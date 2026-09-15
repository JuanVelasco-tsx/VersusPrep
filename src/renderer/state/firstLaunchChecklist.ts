/**
 * Checklist del Estado 1 ("detectando") de `FirstLaunchScreen` (README `2e`,
 * rediseño Paso 8/8). Extraído a módulo aparte para testear sin renderizar
 * componentes, mismo criterio que `operationChecklist.ts`.
 *
 * Los primeros 3 ítems (Steam, biblioteca, verificación de vpk.exe/gameinfo)
 * no tienen progreso en vivo — pasan de "pending" a "done" los tres JUNTOS,
 * en el instante en que `detectPaths()` resuelve `ready` (`pathsResolved`).
 * Ver el docblock de `useOnboardingState.ts`/`types.ts#ScanProgressEvent`
 * para por qué no se instrumentó `PathDetector` con progreso real: sus pasos
 * resuelven en milisegundos, sin nada perceptible que mostrar en vivo.
 */
export type FirstLaunchRowState = "done" | "current" | "pending";

export interface FirstLaunchRow {
  id: "steam" | "library" | "scanning" | "verifying";
  label: string;
  state: FirstLaunchRowState;
  /** Valor mono a la derecha (README: "41 de 73" mientras escanea). `null` si no aplica todavía. */
  detail: string | null;
}

export function computeFirstLaunchChecklist(
  pathsResolved: boolean,
  scanDone: number | null,
  scanTotal: number | null,
): FirstLaunchRow[] {
  const preconditionState: FirstLaunchRowState = pathsResolved ? "done" : "pending";
  const scanningState: FirstLaunchRowState = !pathsResolved
    ? "pending"
    : scanTotal === null || scanDone === null || scanDone < scanTotal
      ? "current"
      : "done";

  return [
    { id: "steam", label: "Steam encontrado", state: preconditionState, detail: null },
    { id: "library", label: "Biblioteca con el juego (id 550)", state: preconditionState, detail: null },
    {
      id: "scanning",
      label: "Leyendo tus addons suscritos",
      state: scanningState,
      detail: scanTotal === null || scanDone === null ? null : `${scanDone} de ${scanTotal}`,
    },
    { id: "verifying", label: "Verificando vpk.exe y gameinfo.txt", state: preconditionState, detail: null },
  ];
}
