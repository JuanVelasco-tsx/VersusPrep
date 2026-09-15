/**
 * Estado de la pantalla "Primer arranque" (README `2e`, rediseño Paso 8/8).
 * Reusa EXACTAMENTE la misma secuencia IPC que ya existe (`paths:detect` →
 * `addons:scan`) — README: "Ningún estado ni canal IPC nuevo" salvo las 3
 * excepciones ya aprobadas por el usuario (progreso de escaneo, persistencia
 * de "ya visto"/avisos, y el openGameFolder del Paso 6). Este hook NO
 * reemplaza el flujo de detección de `AddonList.tsx` (que sigue existiendo
 * tal cual para arranques posteriores) — es una capa NUEVA, mostrada UNA
 * sola vez antes de que `App.tsx` monte el shell normal.
 *
 * DECISIÓN (confirmada con el usuario): "Entrar de todos modos" (Estado 2)
 * NO hace que Biblioteca muestre la lista de addons en modo degradado — eso
 * quedó anotado como P-39 (Context/02-pendientes.md) para una implementación
 * futura. Acá simplemente marca el onboarding como visto y cede el control
 * a `App.tsx`, que monta el shell normal; `AddonList` hace su PROPIA
 * detección desde cero ahí (con `pathsReady=false`, ve exactamente lo mismo
 * que hoy si la ruta sigue faltando: su pantalla `needs-manual` de siempre).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { SettablePathField } from "../../main/app/ipc-contract.js";
import type { PathDetectionFailureReason, RequiredPathKey } from "../../main/domain/index.js";

export type OnboardingScreen =
  | {
      phase: "detecting";
      /** `true` recién cuando `detectPaths()` resolvió "ready" (Steam/biblioteca/rutas verificadas). */
      pathsResolved: boolean;
      scanDone: number | null;
      scanTotal: number | null;
    }
  | {
      phase: "needs-manual";
      reason: PathDetectionFailureReason;
      /** Solo para reason === "required-path-missing": la primera ruta requerida ausente. */
      missingField: RequiredPathKey | null;
      /** `true` si Steam y la carpeta del juego YA se resolvieron (solo falta `missingField`). */
      steamAndGameRootResolved: boolean;
      busyField: SettablePathField | null;
      notice: string | null;
    };

export interface UseOnboardingStateResult {
  screen: OnboardingScreen;
  /** `false` una vez que el usuario tildó "no mostrar de nuevo" (esta vez o en un intento previo). */
  showNotices: boolean;
  onAcknowledgeNotices: (checked: boolean) => void;
  onRetryDetection: () => void;
  onPickManualPath: (field: SettablePathField) => void;
  onEnterAnyway: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido.";
}

/** `onComplete` se llama UNA vez, cuando el flujo termina (ready, o "Entrar de todos modos"). */
export function useOnboardingState(onComplete: () => void): UseOnboardingStateResult {
  const [screen, setScreen] = useState<OnboardingScreen>({
    phase: "detecting",
    pathsResolved: false,
    scanDone: null,
    scanTotal: null,
  });
  const [showNotices, setShowNotices] = useState(true);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Estado inicial de "no mostrar de nuevo" — si el usuario ya lo tildó en un
  // intento anterior (p. ej. cerró la app a mitad de una detección fallida y
  // la reabrió), la caja de avisos condensados no vuelve a aparecer.
  useEffect(() => {
    window.l4d2Api
      .getOnboardingState()
      .then((state) => {
        if (isMounted.current && state.trustNoticesAcknowledged) setShowNotices(false);
      })
      .catch(() => {
        // Best-effort: si falla, se muestra la caja igual (peor caso: se ve una vez de más).
      });
  }, []);

  const onScanProgress = useCallback((done: number, total: number) => {
    if (!isMounted.current) return;
    setScreen((prev) => (prev.phase === "detecting" ? { ...prev, scanDone: done, scanTotal: total } : prev));
  }, []);

  useEffect(() => {
    return window.l4d2Api.onScanProgress((event) => onScanProgress(event.done, event.total));
  }, [onScanProgress]);

  const finishSuccessfully = useCallback((): void => {
    window.l4d2Api
      .markOnboardingSeen()
      .catch(() => {
        // Best-effort: si falla la persistencia, igual se deja pasar al usuario
        // (peor caso: vuelve a ver esta pantalla en el próximo arranque).
      })
      .finally(() => {
        if (isMounted.current) onComplete();
      });
  }, [onComplete]);

  const hasStarted = useRef(false);
  const runDetection = useCallback((): void => {
    setScreen({ phase: "detecting", pathsResolved: false, scanDone: null, scanTotal: null });
    window.l4d2Api
      .detectPaths()
      .then((result) => {
        if (!isMounted.current) return;
        if (result.kind === "needs-manual") {
          const missingField =
            result.reason === "required-path-missing" ? (result.verification?.missing[0] ?? null) : null;
          setScreen({
            phase: "needs-manual",
            reason: result.reason,
            missingField,
            steamAndGameRootResolved: result.paths?.gameRoot !== undefined && result.paths.gameRoot !== "",
            busyField: null,
            notice: null,
          });
          return;
        }
        // Steam/biblioteca/rutas requeridas ya verificadas — el checklist
        // puede marcar esos 3 ítems como "hecho" mientras arranca el escaneo.
        setScreen((prev) => (prev.phase === "detecting" ? { ...prev, pathsResolved: true } : prev));
        return window.l4d2Api.scanAddons().then(() => {
          if (!isMounted.current) return;
          finishSuccessfully();
        });
      })
      .catch((error: unknown) => {
        if (!isMounted.current) return;
        setScreen({
          phase: "needs-manual",
          reason: "required-path-missing",
          missingField: null,
          steamAndGameRootResolved: false,
          busyField: null,
          notice: errorMessage(error),
        });
      });
  }, [finishSuccessfully]);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    runDetection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickManualPath = useCallback((field: SettablePathField): void => {
    setScreen((prev) => (prev.phase === "needs-manual" ? { ...prev, busyField: field, notice: null } : prev));
    window.l4d2Api
      .setManualPath(field)
      .then((result) => {
        if (!isMounted.current) return;
        if (result.kind === "selected" && result.paths !== null) {
          // Las 7 rutas ya están completas (LocalStore.getPaths() solo
          // devuelve no-null cuando lo están, ver DECISIÓN 4 en
          // local-store.ts) — equivalente a un detectPaths() ready.
          setScreen({ phase: "detecting", pathsResolved: true, scanDone: null, scanTotal: null });
          window.l4d2Api.scanAddons().then(() => {
            if (isMounted.current) finishSuccessfully();
          });
          return;
        }
        setScreen((prev) => (prev.phase === "needs-manual" ? { ...prev, busyField: null } : prev));
      })
      .catch((error: unknown) => {
        if (!isMounted.current) return;
        setScreen((prev) =>
          prev.phase === "needs-manual" ? { ...prev, busyField: null, notice: errorMessage(error) } : prev,
        );
      });
  }, [finishSuccessfully]);

  const onEnterAnyway = useCallback((): void => {
    finishSuccessfully();
  }, [finishSuccessfully]);

  const onAcknowledgeNotices = useCallback((checked: boolean): void => {
    window.l4d2Api.setTrustNoticesAcknowledged(checked).catch(() => {
      // Best-effort: la persistencia puede fallar sin bloquear la pantalla.
    });
  }, []);

  return {
    screen,
    showNotices,
    onAcknowledgeNotices,
    onRetryDetection: runDetection,
    onPickManualPath,
    onEnterAnyway,
  };
}
