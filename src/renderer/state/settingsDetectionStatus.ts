/**
 * Lógica pura del panel derecho "Estado de detección" (README `2d`, rediseño
 * Paso 6/8), extraída para poder testearla sin renderizar componentes (mismo
 * motivo que `presetSwitcher.ts`/`activeSetEntries.ts` — no hay jsdom en este
 * proyecto).
 *
 * DECISIÓN DE ARQUITECTURA (confirmada con el usuario, no asumida): el mock
 * (`screenshots/2d-configuracion.png`) muestra un checklist de 4 ítems y una
 * cifra `N/7`, pero NINGÚN canal IPC existente expone una verificación real
 * en disco reutilizable sin diálogos (`paths:detect` SÍ la tiene, pero puede
 * disparar selección manual interactiva si algo falta — inaceptable solo para
 * pintar esta pantalla). `paths:get` (`LocalStore.getPaths()`) es la única
 * lectura pura disponible, y solo expone STRINGS de `GamePaths` — no hay
 * verificación de existencia en disco NI de escribibilidad real
 * (`ElevationOsProvider.probeWrite` es interno del proceso main, no está
 * expuesto por IPC, y el README prohíbe explícitamente agregar canales
 * nuevos para esta pantalla).
 *
 * Por eso el checklist y el contador usan PRESENCIA DE STRING (`!== ""`)
 * como proxy de "resuelto", igual que ya hace `PathRow` de `SettingsPanel`
 * para "No detectado". Es una aproximación deliberada: una ruta persistida
 * que dejó de existir en disco (p. ej. el usuario movió su biblioteca de
 * Steam) sigue contando como "resuelta" hasta que el usuario pida "Volver a
 * detectar" — mismo comportamiento que ya tenía la pantalla antes de este
 * paso, solo que ahora también alimenta el panel derecho.
 *
 * El tercer ítem del checklist dice "gameinfo.txt encontrado" (no
 * "escribible" como en el mock original): corrección explícita del usuario al
 * confirmar este enfoque, porque solo se verifica existencia, no capacidad
 * real de escritura.
 */
import type { GamePaths, RequiredPathKey } from "../../main/domain/index.js";

/** Cantidad total de campos de `GamePaths` (cifra `N/7` del panel derecho). */
export const TOTAL_PATH_FIELDS = 7;

const ALL_PATH_KEYS: readonly (keyof GamePaths)[] = [
  "steamPath",
  "gameRoot",
  "left4dead2Dir",
  "workshopFolder",
  "vpkToolPath",
  "gameInfoFile",
  "modsvsFolder",
];

/**
 * Orden de prioridad de las rutas REQUERIDAS para el banner de "ruta
 * faltante" — espeja `REQUIRED_PATH_KEYS` de `path-detector.ts` (no
 * exportado desde ahí), sin duplicar la verificación en disco real: acá solo
 * decide CUÁL mostrar primero si más de una está vacía, usando el mismo
 * proxy de presencia de string que el resto de este módulo.
 */
const REQUIRED_FIELD_ORDER: readonly RequiredPathKey[] = [
  "gameRoot",
  "workshopFolder",
  "vpkToolPath",
  "gameInfoFile",
];

export interface ChecklistItem {
  label: string;
  ok: boolean;
}

export interface DetectionStatus {
  resolvedCount: number;
  totalCount: number;
  checklist: ChecklistItem[];
  /**
   * Primera ruta requerida faltante en `REQUIRED_FIELD_ORDER`, o `null` si
   * las 4 tienen valor. Alimenta el banner superior de `SettingsPanel` y el
   * estilo "Falta" de la fila HERRAMIENTAS.
   */
  missingRequiredField: RequiredPathKey | null;
}

function isPresent(paths: GamePaths | null, key: keyof GamePaths): boolean {
  return paths !== null && paths[key] !== "";
}

export function computeDetectionStatus(paths: GamePaths | null): DetectionStatus {
  const resolvedCount = ALL_PATH_KEYS.reduce(
    (count, key) => (isPresent(paths, key) ? count + 1 : count),
    0,
  );

  // Fix de bug reportado por el usuario: el 4º ítem tenía la etiqueta FIJA
  // "vpk.exe sin ubicar" sin importar `ok` — mostraba un ✓ de éxito junto a
  // un texto que literalmente dice "no encontrado" cuando vpk.exe SÍ estaba
  // presente. Mismo criterio que los otros 3 ítems: la etiqueta es un
  // enunciado que coincide con lo que el ✓/✕ representa, no un texto fijo.
  const vpkFound = isPresent(paths, "vpkToolPath");
  const checklist: ChecklistItem[] = [
    { label: "Registro de Steam leído", ok: isPresent(paths, "steamPath") },
    { label: "Left 4 Dead 2 en la biblioteca 550", ok: isPresent(paths, "gameRoot") },
    { label: "gameinfo.txt encontrado", ok: isPresent(paths, "gameInfoFile") },
    { label: vpkFound ? "vpk.exe encontrado" : "vpk.exe sin ubicar", ok: vpkFound },
  ];

  const missingRequiredField =
    REQUIRED_FIELD_ORDER.find((key) => !isPresent(paths, key)) ?? null;

  return { resolvedCount, totalCount: TOTAL_PATH_FIELDS, checklist, missingRequiredField };
}
