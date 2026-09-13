import { useCallback, useEffect, useRef, useState } from "react";

import type { SettablePathField } from "../../main/app/ipc-contract.js";
import type { GamePaths, PathDetectionResult } from "../../main/domain/index.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import styles from "./SettingsPanel.module.css";

/**
 * Pantalla de Configuración (P-37): ver/corregir las rutas del sistema
 * (`GamePaths`) DESPUÉS de la detección inicial de arranque (`PathDetector` +
 * `paths:detect`, ya existentes), para usuarios técnicos que quieran
 * corregir una ruta puntual sin borrar datos locales ni reinstalar. Panel
 * APARTE de acceso manual (nav de `App.tsx`): no se dispara solo, y NO toca
 * la cache de sesión `pathsReady` que ya usa `AddonList` para el flujo de
 * arranque (ver DECISIÓN en `App.tsx`).
 *
 * Cada fila define su `settable` (el `SettablePathField` que abre el diálogo
 * nativo correspondiente vía `paths:setManual`) o `undefined` si el campo NO
 * tiene un diálogo de selección manual asociado en el sistema existente:
 * `left4dead2Dir` es puramente DERIVADO (`<gameRoot>\left4dead2`,
 * `path-detector.ts#derivePaths`) y ningún `ManualPathRequest.kind` lo cubre
 * — no se inventa uno nuevo para esta tarea (ver `SettablePathField`,
 * `ipc-contract.ts`), se muestra de solo lectura.
 */
interface FieldDef {
  key: keyof GamePaths;
  label: string;
  settable: SettablePathField | undefined;
}

const FIELDS: readonly FieldDef[] = [
  { key: "steamPath", label: "Carpeta de Steam", settable: "steamPath" },
  { key: "gameRoot", label: "Carpeta del juego (Game_Root)", settable: "gameRoot" },
  {
    key: "left4dead2Dir",
    label: "Carpeta left4dead2 (derivada de Game_Root)",
    settable: undefined,
  },
  { key: "workshopFolder", label: "Carpeta de Workshop", settable: "workshopFolder" },
  { key: "vpkToolPath", label: "Ejecutable vpk.exe", settable: "vpkToolPath" },
  { key: "gameInfoFile", label: "Archivo gameinfo.txt", settable: "gameInfoFile" },
  { key: "modsvsFolder", label: "Carpeta modsvs", settable: "modsvsFolder" },
];

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; paths: GamePaths | null }
  | { phase: "error"; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido.";
}

/** Una fila de ruta: label + valor actual (o "No detectado") + "Cambiar" si el campo lo admite. */
function PathRow({
  field,
  value,
  busy,
  disabled,
  onChange,
}: {
  field: FieldDef;
  value: string;
  busy: boolean;
  disabled: boolean;
  onChange: (settable: SettablePathField) => void;
}) {
  const { settable } = field;
  return (
    <li className={styles.row}>
      <div className={styles.info}>
        <span className={styles.label}>{field.label}</span>
        <span className={styles.value}>{value === "" ? "No detectado" : value}</span>
      </div>
      {settable !== undefined && (
        <button
          type="button"
          className={styles.changeButton}
          disabled={disabled}
          onClick={() => onChange(settable)}
        >
          {busy ? "Eligiendo..." : "Cambiar"}
        </button>
      )}
    </li>
  );
}

export function SettingsPanel() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [busyField, setBusyField] = useState<SettablePathField | null>(null);
  const [redetecting, setRedetecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Guard contra setState tras desmontaje (mismo patron que ActiveSetPanel/
  // AddonList): el usuario puede cambiar de pestaña mientras un dialogo
  // nativo de seleccion manual sigue abierto, y esa promesa resuelve recien
  // despues de que este panel ya se desmonto.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    window.l4d2Api
      .getPaths()
      .then((paths) => {
        if (isMounted.current) setState({ phase: "ready", paths });
      })
      .catch((error: unknown) => {
        if (isMounted.current) setState({ phase: "error", message: errorMessage(error) });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const anyBusy = busyField !== null || redetecting;

  const handleChange = (field: SettablePathField): void => {
    setNotice(null);
    setBusyField(field);
    window.l4d2Api
      .setManualPath(field)
      .then((result) => {
        if (!isMounted.current) return;
        if (result.kind === "selected") {
          setState({ phase: "ready", paths: result.paths });
        }
      })
      .catch((error: unknown) => {
        if (isMounted.current) setNotice(errorMessage(error));
      })
      .finally(() => {
        if (isMounted.current) setBusyField(null);
      });
  };

  const handleRedetect = (): void => {
    setNotice(null);
    setRedetecting(true);
    window.l4d2Api
      .detectPaths()
      .then((result: PathDetectionResult) => {
        if (!isMounted.current) return;
        if (result.kind === "ready") {
          setState({ phase: "ready", paths: result.paths });
        } else {
          setNotice(`No se pudo completar la detección automática (${result.reason}).`);
        }
      })
      .catch((error: unknown) => {
        if (isMounted.current) setNotice(errorMessage(error));
      })
      .finally(() => {
        if (isMounted.current) setRedetecting(false);
      });
  };

  if (state.phase === "loading") {
    return <LoadingIndicator message="Cargando rutas..." />;
  }
  if (state.phase === "error") {
    return <p className={styles.message}>Error: {state.message}</p>;
  }

  const { paths } = state;

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Configuración</h2>
      <p className={styles.description}>
        Rutas del sistema detectadas para Left 4 Dead 2. Podés corregir cualquiera
        manualmente, sin borrar tus addons ni tu configuración.
      </p>

      {notice !== null && <p className={styles.notice}>{notice}</p>}

      {paths === null && (
        <p className={styles.message}>
          Todavía no hay rutas completas detectadas. Probá "Volver a detectar
          automáticamente".
        </p>
      )}

      {paths !== null && (
        <ul className={styles.list}>
          {FIELDS.map((field) => (
            <PathRow
              key={field.key}
              field={field}
              value={paths[field.key]}
              busy={busyField === field.settable}
              disabled={anyBusy}
              onChange={handleChange}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        className={styles.redetectButton}
        disabled={anyBusy}
        onClick={handleRedetect}
      >
        {redetecting ? "Detectando..." : "Volver a detectar automáticamente"}
      </button>
    </div>
  );
}
