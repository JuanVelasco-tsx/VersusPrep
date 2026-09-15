import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AddonManifestEntry,
  OperationResult,
  PathDetectionFailureReason,
  ScannedAddon,
  VScriptClassification,
} from "../../main/domain/index.js";
import { AddonRow } from "./AddonRow.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { publishOperation, subscribeOperation, type OperationKind } from "./OperationOverlay.js";
import { buildCollisionSummaries } from "../state/activeSetEntries.js";
import { applySelectionClick } from "../state/librarySelection.js";
import { filterAddons, type LibraryFilter } from "../state/libraryFilter.js";
import { nextSortState, sortAddons } from "../state/librarySort.js";
import type { SortState } from "../state/librarySort.js";
import { mergePendingIntoActive } from "../state/pendingSelection.js";
import { isPresetActivationEvent } from "../state/presetActivation.js";
import type { ActiveSetState } from "../state/useActiveSetState.js";
import styles from "./AddonList.module.css";

/** Chips de filtro (README `2a`, mutuamente excluyentes). "VScript · N" se arma aparte (necesita el conteo). */
const FILTER_CHIPS: { filter: LibraryFilter; label: string }[] = [
  { filter: "all", label: "Todos" },
  { filter: "active", label: "Activos" },
  { filter: "compatible", label: "Compatibles" },
];

/**
 * Estado de carga de la lista (Bloque 2, Tarea 21.1), como union discriminada
 * por `phase` (mismo estilo que `PathDetectionResult`/`OperationResult` del
 * dominio): hace estructuralmente imposible representar combinaciones
 * invalidas (p. ej. "ready" sin addons todavia resueltos).
 *
 * `classifications` solo tiene entrada para los addons cuya clasificacion YA
 * resolvio; la ausencia de entrada (ver `AddonList`, lookup con `?? "pending"`)
 * es el estado "pending" de cada fila.
 */
type LoadState =
  | { phase: "detecting-paths" }
  | { phase: "needs-manual"; reason: PathDetectionFailureReason }
  | { phase: "scanning-addons" }
  | {
      phase: "ready";
      addons: ScannedAddon[];
      classifications: Record<string, VScriptClassification>;
    }
  | { phase: "error"; message: string };

const REASON_MESSAGES: Record<PathDetectionFailureReason, string> = {
  "steam-not-installed": "No se detecto una instalacion de Steam.",
  "library-folders-unreadable":
    "No se pudo leer la configuracion de bibliotecas de Steam.",
  "l4d2-not-in-libraries":
    "Left 4 Dead 2 no esta instalado en ninguna biblioteca de Steam detectada.",
  "required-path-missing": "Faltan una o mas rutas requeridas del juego.",
};

interface AddonListProps {
  /**
   * `true` si esta instancia arranco por un relanzo elevado con una sesion
   * pendiente (BUG-004 parte 2, via `isResuming()` en `App.tsx` - HECHO
   * ESTATICO fijo para toda la vida del proceso, ver composition-root.ts).
   * Cuando es `true`, las fases de carga muestran un mensaje de continuidad
   * ("Restaurando tu selección...") en vez del texto tecnico habitual, para
   * que el reinicio post-UAC no se sienta como una Biblioteca vacia/en blanco.
   */
  resuming: boolean;
  /**
   * (BUG-008, QA V3 jornada 2) `true` si `detectPaths()` ya resolvio `ready`
   * en ESTA sesion de UI (cache en `App.tsx`, sobrevive al desmontaje de este
   * componente al cambiar de pestaña). Cuando es `true` al montar, el flujo de
   * carga se salta el paso de deteccion (que puede disparar dialogos nativos
   * de seleccion manual) y va directo a `scanAddons()`/`getActiveSet()` - la
   * causa raiz de BUG-008 era exactamente que este componente remonta en cada
   * cambio de pestaña y volvia a invocar `detectPaths()` cada vez.
   */
  pathsReady: boolean;
  /** Notifica a `App.tsx` que `detectPaths()` resolvio `ready`, para cachearlo. */
  onPathsReady: () => void;
  /**
   * (BUG-013, QA V3 jornada 2) Active_Set candidato que esta instancia esta
   * restaurando (`ResumeState.pendingEntries`, resuelto una vez en `App.tsx`;
   * mismo prop que recibe `ActiveSetPanel` para BUG-007). Se usa para que los
   * checkboxes de "Incluir" reflejen tambien lo que el usuario tenia marcado
   * ANTES del handoff, no solo lo que `getActiveSet()` reporta como ya
   * instalado (ver `mergePendingIntoActive`).
   */
  pendingEntries: AddonManifestEntry[] | null;
  /**
   * (Correccion post-revision QA) Notifica a `App.tsx` que este montaje YA
   * uso `pendingEntries` en su `runScan()` inicial. `App.tsx` lo usa para
   * pasar `null` en vez del candidato pendiente en cualquier remontaje
   * POSTERIOR de este panel (cambiar de pestaña y volver) - sin esto, la
   * fusion de `mergePendingIntoActive` se reaplicaria en cada remontaje y
   * pisaria cualquier cambio real que el usuario haga despues del resume
   * (agregar/quitar addons normalmente). Se llama SOLO cuando `pendingEntries`
   * no era `null` (nada que consumir, si ya lo es, no hace falta notificar).
   */
  onPendingConsumed: () => void;
  /**
   * (Paso 3, wiring pendiente del Paso 2) Notifica a `App.tsx` el total de
   * addons escaneados, para el contador del item "Biblioteca" del nav del
   * riel. Se llama cada vez que `state.addons.length` cambia (fase "ready").
   */
  onAddonCountChange?: (count: number) => void;
  /**
   * (Paso 3) Estado compartido del Active_Set candidato (`useActiveSetState`,
   * montado en `App.tsx`) — Biblioteca es un consumidor de SOLO LECTURA:
   * usa `entries`/`previewState` para calcular el chip "⇄ N"/"comparte N
   * archivos" de cada fila con el MISMO preview que ya alimenta el panel
   * derecho y Activos (evita una segunda llamada a `previewActiveSet`
   * independiente y potencialmente desincronizada). Nunca llama
   * `setEntries`/`handleApply`/`handleDiscard` — eso sigue siendo exclusivo
   * de Activos/el panel derecho.
   */
  activeSetState: ActiveSetState;
}

export function AddonList({
  resuming,
  pathsReady,
  onPathsReady,
  pendingEntries,
  onPendingConsumed,
  onAddonCountChange,
  activeSetState,
}: AddonListProps) {
  const [state, setState] = useState<LoadState>({ phase: "detecting-paths" });

  // Active_Set persistido completo (BUG-002 parte 2), no solo los ids: se
  // necesitan las `AddonManifestEntry` reales para que `activeIds` (abajo)
  // y el prop `included` de cada `AddonRow` reflejen membresia real, no solo
  // para chequear membership. Fuente de verdad resuelta con la MISMA llamada IPC
  // (`getActiveSet()`) que usa
  // `ActiveSetPanel`, para que Biblioteca y Activos NUNCA puedan
  // desincronizarse (causa raiz del bug de QA: el checkbox de esta lista no
  // inicializaba su `checked` desde el Active_Set persistido al montar).
  const [activeEntries, setActiveEntries] = useState<AddonManifestEntry[]>([]);
  const activeIds = useMemo(
    () => new Set(activeEntries.map((entry) => entry.addonId)),
    [activeEntries],
  );

  // Seleccion en lote (BUG-002 parte 1): addonIds marcados para agregar de
  // una sola vez, reemplazando el flujo de a-uno-por-click que tenia cada
  // checkbox. Vive aca (no en cada AddonRow) porque la accion de agregar es
  // del LISTADO completo, no de una fila individual.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Ultima fila clickeada SIN shift (P-22, Paso 2): punto de partida de un
  // rango para un shift+click posterior. Vive en `AddonList` (no en cada
  // `AddonRow`) porque un rango cruza filas distintas - ver `librarySelection.ts`.
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Ordenamiento de columnas de Biblioteca (P-31, Paso 2). `null` = orden de
  // escaneo original (default, ver `nextSortState`/`sortAddons`). REDISEÑO
  // (Paso 3): el indicador pasa de 4 encabezados clickeables a un único
  // control "Fecha ▼" en la toolbar (README "Interactions & Behavior") - solo
  // cambia la UI que lo dispara, `nextSortState`/`sortAddons` siguen intactos
  // (mismo motivo por el que `SortColumn` distinto de "mtime" sigue existiendo
  // sin usarse activamente desde acá).
  const [sort, setSort] = useState<SortState | null>(null);

  // Búsqueda + chips de filtro (README "Interactions & Behavior"): NUEVOS,
  // solo cliente, sin IPC — ver `libraryFilter.ts`. `query` sin debounce (la
  // lista ya está en memoria).
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");

  // Guard contra una operacion de OTRO origen en curso (mismo patron que cada
  // AddonRow, Seccion 21.4): los botones "Incluir seleccionados"/"Excluir
  // seleccionados" tambien deben deshabilitarse mientras hay un "Quitar"/
  // "Forzar inclusion" de alguna fila en vuelo, y viceversa.
  const [operationRunning, setOperationRunning] = useState(false);
  useEffect(() => {
    return subscribeOperation((event) => {
      setOperationRunning(event.type === "start");
    });
  }, []);

  // Guard contra el doble-montaje de StrictMode en dev: detectPaths() puede
  // disparar un dialogo nativo REAL (ManualPathProvider de produccion, ver
  // path-detector.ts #verifyThenManual) para cada ruta requerida que falte.
  // Sin este guard, StrictMode invoca el efecto dos veces al montar y el
  // usuario veria el mismo dialogo nativo duplicado. NOTA: este guard es SOLO
  // para el montaje; el boton "Reintentar deteccion" (21.3) NO pasa por aca,
  // llama a runDetection() directo (es una accion explicita del usuario).
  const hasStarted = useRef(false);

  // Guard de desmontaje REAL, en un ref APARTE (no una `let` local al mismo
  // closure que arranca `load()`). BUG YA PISADO UNA VEZ: con `cancelled`
  // como variable local de la MISMA invocacion del efecto que `hasStarted`
  // deja avanzar, el ciclo mount->cleanup->remount de StrictMode ejecuta el
  // cleanup de ESA misma invocacion (la unica que realmente llama a
  // `load()`), pisando su propio `cancelled` a `true` antes de que la
  // promesa de IPC resuelva - el resultado quedaba descartado SIEMPRE y la
  // UI se quedaba colgada en "Detectando..." para siempre (confirmado: una
  // llamada directa a detectPaths() via CDP resolvia bien; el bug era de
  // este componente, no del IPC). Al vivir en un ref propio, actualizado por
  // un efecto DISTINTO (mount/cleanup/remount de este efecto se resuelve de
  // sincrono, antes de que la promesa de red/IPC del otro efecto complete),
  // el valor final ya esta asentado en `true` para cuando `load()` continua.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Escaneo + Active_Set + clasificacion VScript, extraido de runDetection
  // (BUG-008) para poder invocarse DIRECTO cuando `pathsReady` ya esta en
  // cache (sin repetir el paso de `detectPaths()`), ademas de como
  // continuacion normal de una deteccion recien resuelta.
  const runScan = useCallback(async (): Promise<void> => {
    setState({ phase: "scanning-addons" });
    try {
      // getActiveSet() en paralelo con scanAddons() (BUG-002 parte 2): misma
      // llamada IPC que ActiveSetPanel, para que el checkbox "Incluir" arranque
      // ya sincronizado con lo que el backend tiene persistido, en vez de
      // arrancar siempre desmarcado.
      const [addons, activeSet] = await Promise.all([
        window.l4d2Api.scanAddons(),
        window.l4d2Api.getActiveSet(),
      ]);
      if (!isMounted.current) return;

      // (BUG-013) Fusiona el candidato pendiente del relanzo elevado (si lo
      // hay) para que "Incluir" arranque tildado tambien para lo que el
      // usuario tenia marcado ANTES del handoff, no solo lo ya instalado.
      setActiveEntries(mergePendingIntoActive(activeSet, pendingEntries));
      // Marca el consumo SOLO si habia algo que consumir (ver doc de la prop
      // en AddonListProps): evita un setState de mas en App.tsx en el camino
      // normal, y asegura que un remontaje posterior de este panel reciba
      // `null` en vez de reaplicar la fusion para siempre.
      if (pendingEntries !== null) onPendingConsumed();
      // Pinta la lista YA (todas las filas en "pending" de VScript);
      // classifyVScript resuelve en paralelo y actualiza despues.
      setState({ phase: "ready", addons, classifications: {} });

      const classifications = await window.l4d2Api.classifyVScript(addons);
      if (!isMounted.current) return;

      const byId: Record<string, VScriptClassification> = {};
      for (const classification of classifications) {
        byId[classification.addonId] = classification;
      }
      setState({ phase: "ready", addons, classifications: byId });
    } catch (error) {
      if (!isMounted.current) return;
      const message = error instanceof Error ? error.message : "Error desconocido.";
      setState({ phase: "error", message });
    }
  }, [pendingEntries, onPendingConsumed]);

  // Flujo de deteccion completo (detectPaths -> runScan), extraido para poder
  // REUSARLO: lo dispara el boton "Reintentar deteccion" de la rama
  // needs-manual (21.3, opcion A: reutiliza los dialogos nativos ya
  // existentes en path-detector.ts, sin construir seleccion manual nueva en
  // el renderer) y, si `pathsReady` todavia no esta en cache, tambien el
  // efecto de montaje.
  //
  // NO necesita un guard `retrying` aparte contra doble-click: al setear
  // `phase: "detecting-paths"` como PRIMER paso (antes de cualquier await), la
  // rama needs-manual -y con ella el boton- deja de renderizarse por el propio
  // chequeo `if (state.phase === "needs-manual")`, asi que el boton no esta
  // disponible mientras la deteccion esta en curso.
  const runDetection = useCallback(async (): Promise<void> => {
    setState({ phase: "detecting-paths" });
    try {
      const detection = await window.l4d2Api.detectPaths();
      if (!isMounted.current) return;

      if (detection.kind === "needs-manual") {
        setState({ phase: "needs-manual", reason: detection.reason });
        return;
      }

      // (BUG-008) Cachea en App.tsx que las rutas ya estan listas, para que un
      // remontaje futuro de este componente (cada cambio de pestaña) se salte
      // este paso en vez de volver a invocar detectPaths() - y sus posibles
      // dialogos nativos de seleccion manual - de nuevo.
      onPathsReady();
      await runScan();
    } catch (error) {
      if (!isMounted.current) return;
      const message = error instanceof Error ? error.message : "Error desconocido.";
      setState({ phase: "error", message });
    }
  }, [onPathsReady, runScan]);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    // (BUG-008) Con las rutas ya cacheadas de un mount anterior en esta misma
    // sesion de UI, se salta detectPaths() por completo.
    if (pathsReady) {
      void runScan();
    } else {
      void runDetection();
    }
  }, [pathsReady, runDetection, runScan]);

  // Re-lee el Active_Set persistido despues de cualquier escritura exitosa
  // (agregado en lote, "Quitar", "Forzar inclusion"), en vez de reconstruir
  // `activeEntries` a mano con el `priorityOrder` que CADA camino de escritura
  // usa por su cuenta. Misma llamada IPC (`getActiveSet()`) que el montaje
  // inicial y que `ActiveSetPanel` (BUG-002 parte 2) - la unica fuente de
  // verdad se re-consulta en vez de duplicarse, así ningún camino de mutación
  // puede quedar desincronizado del backend.
  const refreshActiveSet = useCallback(async (): Promise<void> => {
    const activeSet = await window.l4d2Api.getActiveSet();
    if (isMounted.current) setActiveEntries(activeSet);
  }, []);

  // Bug reportado tras P-30 Paso 5: crear/cambiar de preset (PresetSwitcher)
  // dejaba esta lista mostrando "Incluido" para addons del preset ANTERIOR,
  // porque `activeEntries` solo se cargaba una vez al montar y ningún camino
  // de escritura de PresetSwitcher pasaba por `refreshActiveSet`. `getActiveSet()`
  // YA lee del preset activo (Paso 4.5b); lo que faltaba era RE-consultarlo
  // cuando el preset activo cambia SIN que este panel se desmonte (cambiar de
  // preset no navega de pestaña). `isPresetActivationEvent` filtra el ÚNICO
  // evento relevante (switch exitoso, directo o encadenado desde "Nuevo
  // preset") del mismo pub-sub que ya se usa para `operationRunning` —
  // apply/add/remove de ESTE panel NO deben disparar este refetch (Biblioteca/
  // Activos siguen desacoplados entre sí para esas operaciones, ver
  // ActiveSetPanel.tsx). También limpia `selected`: una selección de
  // checkboxes en curso pertenecía al preset ANTERIOR, no tiene sentido
  // arrastrarla al preset recién activado (que puede ni siquiera tener esos
  // addons como candidatos válidos).
  useEffect(() => {
    return subscribeOperation((event) => {
      if (!isPresetActivationEvent(event)) return;
      setSelected(new Set());
      setSelectionAnchor(null);
      void refreshActiveSet();
    });
  }, [refreshActiveSet]);

  const handleAdded = useCallback(
    (addonId: string): void => {
      setSelected((prev) => {
        if (!prev.has(addonId)) return prev;
        const next = new Set(prev);
        next.delete(addonId);
        return next;
      });
      void refreshActiveSet();
    },
    [refreshActiveSet],
  );

  const handleRemoved = useCallback(
    (_addonId: string): void => {
      void refreshActiveSet();
    },
    [refreshActiveSet],
  );

  // Total de addons escaneados, para el contador de "Biblioteca" del nav
  // (Paso 3, wiring pendiente del Paso 2 - ver doc de `onAddonCountChange`).
  useEffect(() => {
    if (state.phase === "ready") onAddonCountChange?.(state.addons.length);
  }, [state, onAddonCountChange]);

  // Biblioteca ordenada segun `sort` (P-31, Paso 2) — copia de `state.addons`
  // en el orden de escaneo si `sort` es `null` (default).
  const sortedAddons = useMemo(() => {
    if (state.phase !== "ready") return [] as ScannedAddon[];
    return sortAddons(state.addons, state.classifications, sort);
  }, [state, sort]);

  // Cantidad de addons VScript (clasificación ya resuelta), para el label
  // "VScript · N" del chip de filtro (README).
  const vscriptCount = useMemo(() => {
    if (state.phase !== "ready") return 0;
    return sortedAddons.filter((addon) => {
      const classification = state.classifications[addon.id] ?? "pending";
      return classification !== "pending" && classification.isVScriptAddon;
    }).length;
  }, [state, sortedAddons]);

  // Biblioteca ordenada + filtrada (chip de filtro + búsqueda de texto,
  // README "Interactions & Behavior") — determina el ORDEN y el CONJUNTO de
  // filas realmente visibles: de acá en más, "selectableIds"/"Seleccionar
  // todos"/shift+clic y el render de la lista usan `visibleAddons`, no
  // `sortedAddons` (respeta el filtro aplicado, tal como ya documentaba este
  // comentario desde el Paso 2, antes de que hubiera un filtro real).
  const visibleAddons = useMemo(() => {
    if (state.phase !== "ready") return [] as ScannedAddon[];
    return filterAddons(sortedAddons, state.classifications, activeIds, filter, query);
  }, [state, sortedAddons, activeIds, filter, query]);

  // Preview compartido (`useActiveSetState`, ver doc de `activeSetState` en
  // las props) → colisiones por addonId, mismo dato que el panel derecho y
  // Activos (ver `buildCollisionSummaries`).
  const collisionSummaries = useMemo(() => {
    const preview =
      activeSetState.previewState.phase === "ready" ? activeSetState.previewState.preview : null;
    return buildCollisionSummaries(preview, activeSetState.entries);
  }, [activeSetState.previewState, activeSetState.entries]);

  /**
   * Ids seleccionables en el orden VISIBLE actual (`visibleAddons`, ya con
   * ordenamiento y filtro/búsqueda aplicados): clasificacion ya resuelta, y
   * si es VScript, solo si YA esta incluido (confirmado con el usuario,
   * P-31+P-22 Paso 2 — ver `AddonRow.tsx`, mismo criterio que su `blocked`):
   * un VScript sin forzar nunca se puede seleccionar para lote, porque
   * `addAddons`/`removeAddons` no pasan por el dialogo de confirmacion
   * individual (AC 3.7/3.8). A diferencia del viejo `eligibleIds` (BUG-002),
   * SI incluye addons ya incluidos — la seleccion ahora sirve tanto para
   * "Incluir seleccionados" como para "Excluir seleccionados".
   *
   * Se usa para "Seleccionar todos" Y como `visibleIds` de
   * `applySelectionClick` (shift+click): los ids no seleccionables ni
   * siquiera participan de un rango, ya que su checkbox esta deshabilitado y
   * nunca puede ser el `anchor` ni el clickeado.
   */
  const selectableIds = useMemo(() => {
    if (state.phase !== "ready") return [] as string[];
    return visibleAddons
      .filter((addon) => {
        const classification = state.classifications[addon.id] ?? "pending";
        if (classification === "pending") return false;
        return !classification.isVScriptAddon || activeIds.has(addon.id);
      })
      .map((addon) => addon.id);
  }, [state, visibleAddons, activeIds]);

  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleSelectAll = (): void => {
    setSelected(allSelectableSelected ? new Set() : new Set(selectableIds));
    setSelectionAnchor(null);
  };

  const handleSelectionClick = useCallback(
    (addonId: string, checked: boolean, shiftKey: boolean): void => {
      const result = applySelectionClick(
        selected,
        selectionAnchor,
        selectableIds,
        addonId,
        checked,
        shiftKey,
      );
      setSelected(result.selected);
      setSelectionAnchor(result.anchor);
    },
    [selected, selectionAnchor, selectableIds],
  );

  /**
   * Accion en lote compartida por "Incluir seleccionados"/"Excluir
   * seleccionados" (P-31+P-22, Paso 2): UNA sola llamada a
   * `activeSet:addMany`/`removeMany` (Paso 1, `MergeOrchestrator.addAddons`/
   * `removeAddons`) sobre TODOS los ids seleccionados, mismo espiritu que el
   * viejo `handleBulkAdd` (una sola fusion, nunca N) pero ahora delegando la
   * fusion+`priorityOrder` al orquestador en vez de armarla a mano aca.
   *
   * Exito: limpia la seleccion (y el anchor) y re-lee el Active_Set. Fallo:
   * NO limpia nada — el usuario puede reintentar sin volver a seleccionar
   * todo (el error ya se muestra via `OperationOverlay`, mismo criterio que
   * el resto de la app para add/remove/apply/switch).
   */
  const runBulkAction = async (
    kind: OperationKind,
    invoke: (ids: string[]) => Promise<OperationResult>,
    label: string,
  ): Promise<void> => {
    const ids = [...selected];
    if (ids.length === 0 || bulkBusy || operationRunning) return;

    setBulkBusy(true);
    publishOperation({ type: "start", kind, label });
    const result = await invoke(ids);
    publishOperation({ type: "result", kind, result });

    if (result.status === "success") {
      setSelected(new Set());
      setSelectionAnchor(null);
      await refreshActiveSet();
    }
    setBulkBusy(false);
  };

  const handleBulkInclude = (): void => {
    void runBulkAction(
      "add",
      (ids) => window.l4d2Api.addAddons(ids),
      `Incluyendo ${selected.size} addon${selected.size === 1 ? "" : "s"}...`,
    );
  };

  const handleBulkExclude = (): void => {
    void runBulkAction(
      "remove",
      (ids) => window.l4d2Api.removeAddons(ids),
      `Excluyendo ${selected.size} addon${selected.size === 1 ? "" : "s"}...`,
    );
  };

  const handleClearSelection = (): void => {
    setSelected(new Set());
    setSelectionAnchor(null);
  };

  if (state.phase === "detecting-paths") {
    return (
      <LoadingIndicator
        message={resuming ? "Restaurando tu selección..." : "Detectando rutas del juego..."}
      />
    );
  }

  if (state.phase === "needs-manual") {
    return (
      <div className={styles.message}>
        <p>
          No se pudieron detectar las rutas del juego automáticamente:{" "}
          {REASON_MESSAGES[state.reason]}
        </p>
        <button
          type="button"
          className={styles.retryButton}
          onClick={() => void runDetection()}
        >
          Reintentar detección
        </button>
      </div>
    );
  }

  if (state.phase === "scanning-addons") {
    return (
      <LoadingIndicator
        message={resuming ? "Restaurando tu selección..." : "Escaneando addons..."}
      />
    );
  }

  if (state.phase === "error") {
    return <p className={styles.message}>Error: {state.message}</p>;
  }

  if (state.addons.length === 0) {
    return <p className={styles.message}>No se encontraron addons en la Workshop_Folder.</p>;
  }

  return (
    <>
      <div className={styles.toolbar}>
        {/* "Seleccionar todos" no aparece dibujado en screenshots/2a-biblioteca.png
            ni está descrito en el README para la toolbar - se mantiene igual
            (P-22) porque el pedido de este paso no dijo que se quitara, y
            sacarlo sería remover una función existente sin que nadie lo pida. */}
        <label className={styles.selectAllLabel}>
          <input
            type="checkbox"
            aria-label="Seleccionar todos"
            checked={allSelectableSelected}
            disabled={selectableIds.length === 0 || bulkBusy || operationRunning}
            onChange={toggleSelectAll}
          />
        </label>
        <div className={styles.search}>
          <span className={styles.searchIcon} aria-hidden="true">
            ⌕
          </span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={`Buscar en ${state.addons.length} addons...`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className={styles.chips}>
          {FILTER_CHIPS.map(({ filter: chipFilter, label }) => (
            <button
              key={chipFilter}
              type="button"
              className={filter === chipFilter ? styles.chipActive : styles.chip}
              onClick={() => setFilter(chipFilter)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className={filter === "vscript" ? styles.chipVScriptActive : styles.chipVScript}
            onClick={() => setFilter("vscript")}
          >
            VScript · {vscriptCount}
          </button>
        </div>
        <button
          type="button"
          className={styles.sortControl}
          onClick={() => setSort(nextSortState(sort, "mtime"))}
        >
          Fecha{sort?.column === "mtime" ? (sort.direction === "asc" ? " ▲" : " ▼") : " ▼"}
        </button>
      </div>
      {visibleAddons.length === 0 && (
        <p className={styles.message}>Ningún addon coincide con la búsqueda/filtro actual.</p>
      )}
      <ul className={styles.list}>
        {visibleAddons.map((addon) => (
          <AddonRow
            key={addon.id}
            addon={addon}
            classification={state.classifications[addon.id] ?? "pending"}
            included={activeIds.has(addon.id)}
            collisionSummary={collisionSummaries[addon.id] ?? null}
            selected={selected.has(addon.id)}
            onSelectionClick={handleSelectionClick}
            onAdded={handleAdded}
            onRemoved={handleRemoved}
          />
        ))}
      </ul>
      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>
            {selected.size} addon{selected.size === 1 ? "" : "s"} seleccionado
            {selected.size === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className={styles.bulkClearButton}
            disabled={bulkBusy}
            onClick={handleClearSelection}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={styles.bulkExcludeButton}
            disabled={bulkBusy || operationRunning}
            onClick={handleBulkExclude}
          >
            Excluir seleccionados
          </button>
          <button
            type="button"
            className={styles.bulkAddButton}
            disabled={bulkBusy || operationRunning}
            onClick={handleBulkInclude}
          >
            Incluir seleccionados
          </button>
        </div>
      )}
    </>
  );
}
