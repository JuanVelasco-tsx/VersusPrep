// Capa UI (Seccion 21, Bloque 2 de la Tarea 21.1; nav de 21.2; shell de tres
// columnas del rediseño, Paso 2/8). Punto de entrada del renderer: orquesta
// el layout de pagina (riel/centro/panel derecho) y el toggle de vista; la
// carga de datos y el estado real viven en AddonList/ActiveSetPanel/
// SettingsPanel, cada uno por su cuenta (integracion desacoplada, opcion B -
// ver Context/05-plan-seccion-21-restante.md). Este paso SOLO reestructura
// el shell que los envuelve - el contenido interno de esos tres componentes
// no se toca (llega en los Pasos 3, 4 y 6).
import { useCallback, useEffect, useState } from "react";

import type { AddonManifestEntry } from "../main/domain/index.js";
import { ActiveSetPanel } from "./components/ActiveSetPanel.js";
import { AddonList } from "./components/AddonList.js";
import { DetectionStatusPanel } from "./components/DetectionStatusPanel.js";
import { FirstLaunchScreen } from "./components/FirstLaunchScreen.js";
import { LoadingIndicator } from "./components/LoadingIndicator.js";
import { MergeSummaryPanel } from "./components/MergeSummaryPanel.js";
import { OperationOverlay, publishOperation } from "./components/OperationOverlay.js";
import { PresetsPanel } from "./components/PresetsPanel.js";
import { PresetSwitcher } from "./components/PresetSwitcher.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { NOTICES_COUNT } from "./components/TrustNotices.js";
import { TrustNoticesModal } from "./components/TrustNoticesModal.js";
import { useActiveSetState } from "./state/useActiveSetState.js";
import { usePresetsState } from "./state/usePresetsState.js";
import { useSettingsState } from "./state/useSettingsState.js";
import styles from "./App.module.css";

type View = "library" | "active" | "presets" | "settings";

/**
 * Items del nav vertical del riel (README `2a`, "Nav vertical"). `count` es
 * `null` para "Configuración" (esa pantalla no tiene noción de "cantidad").
 * El contador de "Biblioteca" (total escaneado) se conecta en el Paso 3 via
 * `AddonList.onAddonCountChange` - antes de ese paso quedaba `null` a
 * propósito (sin tocar el contenido interno de `AddonList`).
 */
interface NavItemDef {
  view: View;
  label: string;
}

const NAV_ITEMS: readonly NavItemDef[] = [
  { view: "library", label: "Biblioteca" },
  { view: "active", label: "Activos" },
  { view: "presets", label: "Presets" },
  { view: "settings", label: "Configuración" },
];

/**
 * Vistas que llevan el slot de panel derecho (README: `2a`/`2b` con "Estado
 * del preset" vía `MergeSummaryPanel`, `2d` con "Estado de detección" vía
 * `DetectionStatusPanel`; `2c` Presets es "riel + una sola columna de
 * contenido, sin panel derecho").
 */
const VIEWS_WITH_RIGHT_PANEL: ReadonlySet<View> = new Set(["library", "active", "settings"]);

/**
 * `null` mientras no se determino si esta instancia arranco por un relanzo
 * elevado con sesion pendiente (BUG-004 parte 2, QA); una vez resuelto, fijo
 * para el resto de la sesion.
 */
export function App() {
  const [view, setView] = useState<View>("library");
  const [resuming, setResuming] = useState<boolean | null>(null);

  // (BUG-008, QA V3 jornada 2) Cache de sesion de UI: una vez que `detectPaths()`
  // resuelve `ready` (auto o manual) una vez, se recuerda ACA - que sobrevive
  // a que `AddonList` se desmonte/remonte en cada cambio de pestaña (Biblioteca
  // <-> Activos son ramas mutuamente excluyentes del JSX de abajo) - para que
  // `AddonList` no vuelva a invocar `detectPaths()` (con sus dialogos nativos
  // de seleccion manual si alguna ruta requerida no se puede auto-detectar) en
  // cada remontaje. Se resetea solo si el usuario pide explicitamente
  // "Reintentar deteccion" (ver AddonList.tsx, no pasa por este cache).
  const [pathsReady, setPathsReady] = useState(false);

  // ESTABILIZACION PREVENTIVA (no es un fix de un bug observado): mismo
  // patron que `handleAddonListPendingConsumed`/`handleActiveSetPendingConsumed`
  // mas abajo, aplicado aca por la misma clase de fragilidad - `onPathsReady`
  // se pasaba como arrow function inline en el JSX, con identidad nueva en
  // cada re-render de `App`. `runDetection` (`AddonList.tsx`) la incluye en
  // sus deps, asi que esa inestabilidad se propagaba hasta el `useEffect` de
  // montaje que dispara `detectPaths()`/`scanAddons()` - sin sintoma
  // observado hoy (el guard `hasStarted.current` de `AddonList` ya absorbe
  // cualquier re-invocacion espuria), pero por la misma razon que se
  // estabilizo `onPendingConsumed`.
  const handlePathsReady = useCallback(() => {
    setPathsReady(true);
  }, []);

  // (BUG-007/BUG-013, QA V3 jornada 2) Active_Set CANDIDATO que esta
  // instancia esta restaurando (`ResumeState.pendingEntries`, mitad main
  // cerrada por Kiro - ver ipc-contract.ts). `null` mientras no se resolvio
  // (o si esta sesion no es un resume); una vez resuelto, se mantiene en
  // estado (nunca se vuelve `null` aca) para que el panel que TODAVIA no lo
  // consumio (ver mas abajo) pueda seguir viendolo si monta mas tarde.
  const [pendingEntries, setPendingEntries] = useState<AddonManifestEntry[] | null>(null);

  // CORRECCION (hallazgo post-revision, QA): un resume ocurre como mucho una
  // vez por vida del proceso, pero ESO NO significa que la PRECEDENCIA de
  // `pendingEntries` sobre el estado real (`resolveActiveSetEntries`/
  // `mergePendingIntoActive`) deba aplicarse en cada remontaje de
  // AddonList/ActiveSetPanel (cambiar de pestaña y volver remonta cada uno
  // por completo, ver App.module - integracion desacoplada). Si se aplicara
  // siempre, cualquier cambio REAL que el usuario haga despues del resume
  // (agregar/quitar addons normalmente) se veria "revertido" la proxima vez
  // que cualquiera de los dos paneles remonte, porque `pendingEntries` seguiria
  // ganando para siempre.
  //
  // Fix: `AddonList` tiene su PROPIO flag de consumo, marcado por el panel
  // mismo (via `onPendingConsumed`) la PRIMERA vez que su propio `load()`
  // efectivamente usa `pendingEntries` (no en remontajes posteriores, porque
  // el flag vive aca en App.tsx, que no remonta). Una vez marcado, recibe
  // `null` en vez de `pendingEntries` de ahi en adelante y cae al camino
  // normal (`getActiveSet()` sin override).
  //
  // (Paso 3) `ActiveSetPanel` YA NO necesita su propio flag equivalente: su
  // consumo de `pendingEntries` (BUG-013) se movio a `useActiveSetState`
  // (mas abajo), que se monta UNA sola vez para toda la vida del proceso -
  // ver el docblock de ese hook para el porque el guard interno de ESE hook
  // (mismo patron `hasStarted` que ya usa `AddonList`) alcanza sin necesitar
  // un flag threadeado desde aca.
  const [addonListConsumedPending, setAddonListConsumedPending] = useState(false);

  // CORRECCION (hallazgo de revision QA): `onPendingConsumed` pasado como
  // arrow function inline en el JSX (mas abajo) tendria una identidad NUEVA
  // en CADA re-render de `App`, no solo cuando cambia lo que le importa a
  // cada panel. Como `AddonList.tsx` incluye `onPendingConsumed` en las deps
  // de su `useCallback` de `runScan` (que a su vez esta en las deps del
  // `useEffect` de montaje que dispara `detectPaths()`/`scanAddons()`), esa
  // inestabilidad de identidad se propagaria hasta ese efecto - inofensivo
  // HOY solo porque el guard `hasStarted.current` de `AddonList` absorbe
  // cualquier re-invocacion espuria, pero fragil (un cambio futuro a ese
  // guard reabriria BUG-008 por esta via, sin tocar el propio BUG-008).
  // `useCallback(..., [])` alcanza porque los setters de `useState` son
  // referencialmente estables entre renders (garantia de React) - la funcion
  // que retorna es la MISMA en toda la vida de este componente.
  const handleAddonListPendingConsumed = useCallback(() => {
    setAddonListConsumedPending(true);
  }, []);

  // BUG-004 parte 2 (backend de Kiro cerrado en 8a7e009, reordenamiento A1):
  // reemplaza la version anterior basada en `getResumeState()` al montar.
  // Ahora `isResuming()` es el HECHO ESTATICO correcto para esto (derivado de
  // los args de arranque, fijo para toda la vida del proceso) - a diferencia
  // de `getResumeState()`, no depende de que el resume ya haya terminado, asi
  // que no hay carrera: con A1 la ventana se crea ANTES de que el resume
  // corra, entonces al montar `App` el resume bien puede seguir en curso.
  //
  // Si `isResuming` es `true`: arranca en "Activos" (refleja lo que se estaba
  // aplicando) y pasa el flag a AddonList/ActiveSetPanel para su mensaje de
  // continuidad ("Restaurando tu selección..."), IGUAL que antes. La
  // diferencia real es lo que pasa despues: en vez de asumir que el resume ya
  // termino, se suscribe a `onProgress` (mismo canal `merge:onProgress`) y,
  // en cada evento que llega, relee `getResumeState()` - `result` sigue en
  // `null` mientras el resume esta en curso; en cuanto aparece no-null se
  // publica al `OperationOverlay` como el resultado de la operacion que
  // disparo la elevacion, y se deja de escuchar/pollear. NO se usa el replay
  // de `bufferedEvents` (D2a-i): con `isResuming` ya se esta escuchando en
  // vivo, reproducir el buffer ademas duplicaria eventos.
  //
  // POLLING DE RESPALDO (no solo eventos) - CORRECCION post-QA: reaccionar
  // SOLO a `onProgress` deja colgado al usuario en "Restaurando tu
  // selección..." para siempre ante CUALQUIER fallo real durante el resume
  // (no solo la excepcion inesperada que ya cubre el catch de `runResume` en
  // composition-root.ts). Confirmado contra `MergeOrchestrator#materialize`:
  // cuando falla un paso (`backup`/`install`/`gameinfo` via `#writeStep`, o
  // `merge` via su propio catch -> `#failureFromError`), la funcion hace
  // `return` DIRECTO con `status: "failure"` SIN emitir ningun evento
  // posterior - el ULTIMO evento que llega es el del paso que estaba por
  // EMPEZAR (p. ej. "merge"), no uno que anuncie que ese paso fallo. El
  // chequeo que dispara ESE evento corre ANTES de que el trabajo real
  // termine/falle (encuentra `result: null`), y como no llega ningun evento
  // despues, `onProgress` solo nunca vuelve a disparar un re-chequeo. Un
  // intervalo de respaldo (1s) garantiza que el resultado terminal se detecte
  // en un tiempo acotado pase lo que pase con la emision de steps; los
  // eventos de `onProgress` siguen dando respuesta casi inmediata en el
  // camino feliz ("done" se emite justo antes del success).
  useEffect(() => {
    let cancelled = false;
    let unsubscribeProgress: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const stopWatching = (): void => {
      unsubscribeProgress?.();
      unsubscribeProgress = null;
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
    };

    const checkTerminalResult = async (): Promise<void> => {
      const state = await window.l4d2Api.getResumeState();
      if (cancelled || state === null || state.result === null) return;
      publishOperation({ type: "result", kind: "apply", result: state.result });
      stopWatching();
    };

    window.l4d2Api
      .isResuming()
      .then(async (isResuming) => {
        if (cancelled) return;
        if (!isResuming) {
          setResuming(false);
          return;
        }
        // (BUG-007/BUG-013) Resuelve `pendingEntries` ANTES de publicar
        // `resuming`/`view`: AddonList/ActiveSetPanel montan recien cuando
        // `resuming !== null` (ver el JSX de mas abajo) y cada uno carga su
        // estado UNA sola vez al montar (guard `hasStarted`) - si se
        // publicara `resuming` primero, podrian montar con `pendingEntries`
        // todavia en `null` y nunca reaccionar al valor que llega despues.
        // Invariante de `ipc-contract.ts`: si `isResuming()` es `true`,
        // `getResumeState()` YA NO es `null` y `pendingEntries` SIEMPRE esta
        // presente (capturado en el arranque, antes de este await).
        const state = await window.l4d2Api.getResumeState();
        if (cancelled) return;
        setPendingEntries(state?.pendingEntries ?? null);
        setResuming(true);
        setView("active");
        unsubscribeProgress = window.l4d2Api.onProgress(() => void checkTerminalResult());
        pollTimer = setInterval(() => void checkTerminalResult(), 1000);
        void checkTerminalResult();
      })
      .catch(() => {
        if (!cancelled) setResuming(false);
      });

    return () => {
      cancelled = true;
      stopWatching();
    };
  }, []);

  // (Paso 5, arquitectura) Estado compartido de presets (lista + activo +
  // mutaciones) — montado de forma INCONDICIONAL acá, mismo criterio que
  // `activeSetState` (Paso 3): nunca remonta al cambiar de vista, así que
  // el bloque del riel (`PresetSwitcher`, persistente) y `PresetsPanel`
  // (se monta/desmonta con la vista) SIEMPRE ven los mismos datos. Ver el
  // docblock de `usePresetsState` para el porqué completo.
  const presetsState = usePresetsState();
  const activePreset =
    presetsState.presets.find((preset) => preset.id === presetsState.activePresetId) ?? null;

  // (Paso 2, shell; corregido de popover a modal - ver TrustNoticesModal.tsx)
  // `true` mientras el modal de avisos disparado por la pildora del riel
  // esta abierto. El contenido de `TrustNotices` no cambia acá; se condensa
  // recien en el Paso 8 (primer arranque, README 2e).
  const [noticesOpen, setNoticesOpen] = useState(false);

  // (Paso 3, wiring pendiente del Paso 2) Total de addons escaneados,
  // reportado por AddonList (ver ese componente, `onAddonCountChange`) para
  // el contador de "Biblioteca" del nav. `null` hasta que AddonList termina
  // su primer escaneo.
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const handleAddonCountChange = useCallback((count: number): void => {
    setLibraryCount(count);
  }, []);

  // (Paso 3) Estado compartido del Active_Set candidato (entries/preview/
  // apply) - montado de forma INCONDICIONAL aca (nunca dentro de una rama
  // `{view === ... &&}`), lo que GARANTIZA por las reglas de Hooks de React
  // que sobrevive a cualquier cambio de `view` sin remontar. Alimenta tanto
  // a `ActiveSetPanel` (lista + reordenamiento) como al panel derecho
  // "Estado del preset" (`MergeSummaryPanel`, Biblioteca Y Activos) - ver
  // `useActiveSetState` para el detalle completo de esta decision de
  // arquitectura (confirmada con el usuario, no asumida).
  const activeSetState = useActiveSetState(pendingEntries);

  // (Paso 6) Estado compartido de Configuración (paths/busyField/notice/
  // permiso de administrador) - mismo criterio de arquitectura que
  // `activeSetState` de arriba: alimenta tanto al centro (`SettingsPanel`)
  // como al panel derecho ("Estado de detección", `DetectionStatusPanel`).
  // Ver `useSettingsState` para el detalle (no necesita la garantía de "no
  // remonta nunca" de `activeSetState`, solo la de compartir un mismo estado
  // entre las dos regiones simultáneas de esta vista).
  const settingsState = useSettingsState();

  // (Paso 8/8, README 2e) `null` mientras no se sabe todavía si el usuario ya
  // pasó por "Primer arranque" alguna vez (persistido en LocalStore, ver
  // OnboardingState en ipc-contract.ts). `false` monta FirstLaunchScreen EN
  // VEZ del shell de abajo (pantalla completa, sin riel); `true` monta el
  // shell de siempre. Este hook se declara INCONDICIONALMENTE, antes del
  // `return` condicional de más abajo, por las mismas reglas de Hooks que ya
  // documentan `activeSetState`/`settingsState`.
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.l4d2Api
      .getOnboardingState()
      .then((state) => {
        if (!cancelled) setOnboardingSeen(state.seen);
      })
      .catch(() => {
        // Fail-safe: si falla la lectura, no se bloquea al usuario detrás de
        // una pantalla de bienvenida que nunca resuelve - se asume "ya visto"
        // y se va directo al shell normal (mismo camino que sigue hoy).
        if (!cancelled) setOnboardingSeen(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (onboardingSeen === null) {
    return null;
  }
  if (!onboardingSeen) {
    return <FirstLaunchScreen onComplete={() => setOnboardingSeen(true)} />;
  }

  return (
    <div className={styles.shell}>
      <OperationOverlay />

      <aside className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.brandDot} aria-hidden="true" />
          <span className={styles.brandText}>
            <span className={styles.brandName}>Versus</span>
            <span className={styles.brandSub}>Addon Manager</span>
          </span>
        </div>
        <div className={styles.hairline} />

        <PresetSwitcher presetsState={presetsState} onOpenPresets={() => setView("presets")} />

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const count =
              item.view === "library"
                ? libraryCount
                : item.view === "active"
                  ? (activePreset?.entries.length ?? null)
                  : item.view === "presets"
                    ? presetsState.presets.length
                    : null;
            return (
              <button
                key={item.view}
                type="button"
                className={view === item.view ? styles.navItemActive : styles.navItem}
                onClick={() => setView(item.view)}
              >
                <span>{item.label}</span>
                {count !== null && <span className={styles.navCount}>{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className={styles.railFooter}>
          <button
            type="button"
            className={styles.noticesPill}
            onClick={() => setNoticesOpen((prev) => !prev)}
          >
            ▲ {NOTICES_COUNT} avisos importantes
          </button>
          <p className={styles.disclaimer}>Proyecto fan-made. Sin relación con Valve.</p>
        </div>
      </aside>

      {noticesOpen && <TrustNoticesModal onClose={() => setNoticesOpen(false)} />}

      <div className={styles.center}>
        {resuming === null && <LoadingIndicator message="Cargando..." />}
        {resuming !== null && view === "library" && (
          <AddonList
            resuming={resuming}
            pendingEntries={addonListConsumedPending ? null : pendingEntries}
            onPendingConsumed={handleAddonListPendingConsumed}
            pathsReady={pathsReady}
            onPathsReady={handlePathsReady}
            onAddonCountChange={handleAddonCountChange}
            activeSetState={activeSetState}
          />
        )}
        {resuming !== null && view === "active" && (
          <ActiveSetPanel resuming={resuming} activeSetState={activeSetState} />
        )}
        {resuming !== null && view === "presets" && <PresetsPanel presetsState={presetsState} />}
        {resuming !== null && view === "settings" && (
          <SettingsPanel state={settingsState} workshopAddonCount={libraryCount} />
        )}
      </div>

      {VIEWS_WITH_RIGHT_PANEL.has(view) && (
        <aside className={styles.rightPanel}>
          {view === "settings" ? (
            <DetectionStatusPanel state={settingsState} />
          ) : (
            <MergeSummaryPanel
              entryCount={activeSetState.entries.length}
              previewState={activeSetState.previewState}
              applyState={activeSetState.applyState}
              hasUnappliedChanges={activeSetState.hasUnappliedChanges}
              titles={
                activeSetState.loadState.phase === "ready" ? activeSetState.loadState.titles : {}
              }
              onApply={activeSetState.handleApply}
              onDiscard={activeSetState.handleDiscard}
              // Ya estando en Activos no tiene sentido un link PARA ir a
              // Activos (ver el "Podés cambiar el orden en Activos" del
              // hallazgo de colisiones, README 2a/2b) - se OMITE la prop en
              // vez de pasar `undefined` (exactOptionalPropertyTypes) para
              // que MergeSummaryPanel muestre el texto plano.
              {...(view !== "active" && { onGoToActive: () => setView("active") })}
              // README 2b: en Activos, este mismo panel pasa a "Resumen de
              // fusión" con las cajas a ancho completo (Paso 4/8).
              detailed={view === "active"}
            />
          )}
        </aside>
      )}
    </div>
  );
}
