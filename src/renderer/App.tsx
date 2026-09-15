// Capa UI (Seccion 21, Bloque 2 de la Tarea 21.1; nav de 21.2; shell de tres
// columnas del rediseño, Paso 2/8). Punto de entrada del renderer: orquesta
// el layout de pagina (riel/centro/panel derecho) y el toggle de vista; la
// carga de datos y el estado real viven en AddonList/ActiveSetPanel/
// SettingsPanel, cada uno por su cuenta (integracion desacoplada, opcion B -
// ver Context/05-plan-seccion-21-restante.md). Este paso SOLO reestructura
// el shell que los envuelve - el contenido interno de esos tres componentes
// no se toca (llega en los Pasos 3, 4 y 6).
import { useCallback, useEffect, useState } from "react";

import type { AddonManifestEntry, Preset } from "../main/domain/index.js";
import { ActiveSetPanel } from "./components/ActiveSetPanel.js";
import { AddonList } from "./components/AddonList.js";
import { LoadingIndicator } from "./components/LoadingIndicator.js";
import { OperationOverlay, publishOperation } from "./components/OperationOverlay.js";
import { PresetSwitcher } from "./components/PresetSwitcher.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { NOTICES_COUNT, TrustNotices } from "./components/TrustNotices.js";
import styles from "./App.module.css";

type View = "library" | "active" | "presets" | "settings";

/**
 * Items del nav vertical del riel (README `2a`, "Nav vertical"). `count` es
 * `null` cuando este paso todavia no tiene de donde sacar un numero real sin
 * tocar el contenido interno de un componente que no le toca a este paso
 * (Biblioteca: total escaneado, vive en `AddonList`, Paso 3) - un item con
 * `count: null` simplemente no muestra contador, no un placeholder inventado.
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
 * del preset", `2d` con "Estado de detección"; `2c` Presets es "riel + una
 * sola columna de contenido, sin panel derecho"). El contenido REAL del
 * panel se conecta en los Pasos 3 (Biblioteca), 4 (Activos) y 6
 * (Configuración) - acá el slot queda con un placeholder.
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
  // Fix: cada panel tiene su PROPIO flag de consumo, marcado por el panel
  // mismo (via `onPendingConsumed`) la PRIMERA vez que su propio `load()`
  // efectivamente usa `pendingEntries` (no en remontajes posteriores, porque
  // el flag vive aca en App.tsx, que no remonta). Una vez marcado, ese panel
  // recibe `null` en vez de `pendingEntries` de ahi en adelante y cae al
  // camino normal (`getActiveSet()` sin override). NO alcanza con un solo
  // flag compartido: el resume fuerza `view="active"` primero, asi que si se
  // limpiara `pendingEntries` apenas lo consume `ActiveSetPanel`, `AddonList`
  // jamas lo veria no-`null` al entrar por primera vez a "Biblioteca"
  // (reabriria BUG-013). Cada panel necesita su propia ventana de "primera
  // vez", independiente del ciclo de montaje del otro.
  const [activeSetConsumedPending, setActiveSetConsumedPending] = useState(false);
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
  const handleActiveSetPendingConsumed = useCallback(() => {
    setActiveSetConsumedPending(true);
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

  // (Paso 2, shell) presets/activePresetId reportados por PresetSwitcher
  // (ver ese componente, `onPresetsChange`), para derivar los contadores de
  // "Activos" y "Presets" del nav sin duplicar la llamada IPC que
  // PresetSwitcher ya hace por su cuenta.
  const [presetsInfo, setPresetsInfo] = useState<{
    presets: Preset[];
    activePresetId: string | null;
  }>({ presets: [], activePresetId: null });
  const handlePresetsChange = useCallback(
    (presets: Preset[], activePresetId: string | null): void => {
      setPresetsInfo({ presets, activePresetId });
    },
    [],
  );
  const activePreset =
    presetsInfo.presets.find((preset) => preset.id === presetsInfo.activePresetId) ?? null;

  // (Paso 2, shell) `true` mientras el popover de avisos del pie del riel
  // esta abierto. Puramente UI - el contenido de `TrustNotices` no cambia,
  // solo DONDE se ve (popover en vez de franja fija); se muda al primer
  // arranque recien en el Paso 8.
  const [noticesOpen, setNoticesOpen] = useState(false);

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

        <PresetSwitcher onPresetsChange={handlePresetsChange} />

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const count =
              item.view === "active"
                ? (activePreset?.entries.length ?? null)
                : item.view === "presets"
                  ? presetsInfo.presets.length
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
          {noticesOpen && (
            <div className={styles.noticesPopover}>
              <TrustNotices />
            </div>
          )}
          <p className={styles.disclaimer}>Proyecto fan-made. Sin relación con Valve.</p>
        </div>
      </aside>

      <div className={styles.center}>
        {resuming === null && <LoadingIndicator message="Cargando..." />}
        {resuming !== null && view === "library" && (
          <AddonList
            resuming={resuming}
            pendingEntries={addonListConsumedPending ? null : pendingEntries}
            onPendingConsumed={handleAddonListPendingConsumed}
            pathsReady={pathsReady}
            onPathsReady={handlePathsReady}
          />
        )}
        {resuming !== null && view === "active" && (
          <ActiveSetPanel
            resuming={resuming}
            pendingEntries={activeSetConsumedPending ? null : pendingEntries}
            onPendingConsumed={handleActiveSetPendingConsumed}
          />
        )}
        {resuming !== null && view === "presets" && (
          <p className={styles.placeholder}>
            Gestión de presets — próximamente (Paso 5 del rediseño). Mientras tanto, usá
            "Cambiar preset" en el riel.
          </p>
        )}
        {resuming !== null && view === "settings" && <SettingsPanel />}
      </div>

      {VIEWS_WITH_RIGHT_PANEL.has(view) && (
        <aside className={styles.rightPanel}>
          {/* Contenido real: Paso 3 (Biblioteca), Paso 4 (Activos), Paso 6 (Configuración). */}
          <p className={styles.placeholder}>Próximamente</p>
        </aside>
      )}
    </div>
  );
}
