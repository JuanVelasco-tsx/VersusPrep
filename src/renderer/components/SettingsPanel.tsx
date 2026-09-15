import type { SettablePathField } from "../../main/app/ipc-contract.js";
import type { GamePaths, RequiredPathKey } from "../../main/domain/index.js";
import type { SettingsState } from "../state/useSettingsState.js";
import { computeDetectionStatus } from "../state/settingsDetectionStatus.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import styles from "./SettingsPanel.module.css";

/**
 * Pantalla de Configuración (P-37, restyleada en el rediseño Paso 6/8, README
 * `2d`): ver/corregir las rutas del sistema (`GamePaths`) DESPUÉS de la
 * detección inicial de arranque, agrupadas por origen. El estado (`paths`,
 * `busyField`, `notice`, etc.) ya NO vive acá — lo levanta `useSettingsState`
 * en `App.tsx` (ver ese hook) para compartirlo con el panel derecho
 * "Estado de detección" (`DetectionStatusPanel.tsx`), que necesita el MISMO
 * `paths` para su cifra `N/7` y su checklist.
 *
 * Cada fila define su `settable` (el `SettablePathField` que abre el diálogo
 * nativo correspondiente vía `paths:setManual`) o `undefined` si el campo NO
 * tiene un diálogo de selección manual asociado en el sistema existente:
 * `left4dead2Dir` es puramente DERIVADO (`<gameRoot>\left4dead2`,
 * `path-detector.ts#derivePaths`) y ningún `ManualPathRequest.kind` lo cubre
 * — no se inventa uno nuevo para esta tarea (ver `SettablePathField`,
 * `ipc-contract.ts`), se muestra de solo lectura con el badge "Derivada".
 */
interface FieldDef {
  key: keyof GamePaths;
  label: string;
  settable: SettablePathField | undefined;
}

interface GroupDef {
  kicker: string;
  fields: readonly FieldDef[];
}

const GROUPS: readonly GroupDef[] = [
  {
    kicker: "STEAM",
    fields: [
      { key: "steamPath", label: "Carpeta de Steam", settable: "steamPath" },
      { key: "workshopFolder", label: "Carpeta de Workshop", settable: "workshopFolder" },
    ],
  },
  {
    kicker: "LEFT 4 DEAD 2",
    fields: [
      { key: "gameRoot", label: "Carpeta del juego", settable: "gameRoot" },
      { key: "left4dead2Dir", label: "Carpeta left4dead2", settable: undefined },
      { key: "gameInfoFile", label: "Archivo gameinfo.txt", settable: "gameInfoFile" },
      { key: "modsvsFolder", label: "Carpeta modsvs", settable: "modsvsFolder" },
    ],
  },
  {
    kicker: "HERRAMIENTAS",
    fields: [{ key: "vpkToolPath", label: "Ejecutable vpk.exe", settable: "vpkToolPath" }],
  },
];

/**
 * Copy del banner "ruta faltante" (README `2d`) por `RequiredPathKey`. El
 * mock solo especifica el texto para `vpkToolPath` (el caso realista: es la
 * única ruta requerida que puede faltar legítimamente DESPUÉS de una
 * detección inicial exitosa, porque las Authoring Tools se instalan aparte).
 * Las otras tres tienen una explicación genérica de respaldo — no inventan
 * contenido de marketing, solo dicen para qué sirve la ruta.
 */
// `RequiredPathKey` (tipo de dominio) admite `modsvsFolder`, pero esta pantalla
// nunca la ofrece como banner: `REQUIRED_FIELD_ORDER` (settingsDetectionStatus.ts)
// no la incluye, misma razón documentada ahí (la app la CREA, no la verifica).
// Los tres Record de abajo igual necesitan una entrada para que el tipo cierre.
const MISSING_FIELD_LABEL: Record<RequiredPathKey, string> = {
  gameRoot: "la carpeta del juego",
  workshopFolder: "la carpeta de Workshop",
  vpkToolPath: "vpk.exe",
  gameInfoFile: "gameinfo.txt",
  modsvsFolder: "la carpeta modsvs",
};

const MISSING_FIELD_BODY: Record<RequiredPathKey, string> = {
  gameRoot: "Sin esta carpeta no se puede ubicar el resto de los archivos del juego.",
  workshopFolder: "Sin esta carpeta no se pueden encontrar los addons suscritos.",
  vpkToolPath:
    "Sin esta herramienta no se puede fusionar nada. Viene con las Left 4 Dead 2 Authoring Tools, que se instalan aparte desde Steam.",
  gameInfoFile: "Sin este archivo no se puede activar ningún preset.",
  modsvsFolder: "Acá se instala el VPK fusionado.",
};

/** Carpeta (openDirectory) vs. archivo (openFile) — espeja toRequiredPathOptions (manual-path-provider.ts), sin duplicar su lógica. */
const MISSING_FIELD_ACTION: Record<RequiredPathKey, string> = {
  gameRoot: "Elegir carpeta",
  workshopFolder: "Elegir carpeta",
  vpkToolPath: "Elegir archivo",
  gameInfoFile: "Elegir archivo",
  modsvsFolder: "Elegir carpeta",
};

interface RowBadge {
  text: string;
  danger: boolean;
}

function PathRow({
  field,
  value,
  note,
  badge,
  busy,
  disabled,
  onChange,
}: {
  field: FieldDef;
  value: string;
  note: string | null;
  badge: RowBadge | null;
  busy: boolean;
  disabled: boolean;
  onChange: (settable: SettablePathField) => void;
}) {
  const { settable } = field;
  return (
    <li className={styles.row}>
      <div className={styles.info}>
        <span className={styles.labelLine}>
          <span className={styles.label}>{field.label}</span>
          {badge !== null && (
            <span className={badge.danger ? styles.badgeDanger : styles.badgeNeutral}>
              {badge.text}
            </span>
          )}
        </span>
        <span className={styles.value}>{value === "" ? "No detectado" : value}</span>
        {note !== null && <span className={styles.note}>{note}</span>}
      </div>
      {settable !== undefined ? (
        <button
          type="button"
          className={badge?.danger === true ? styles.changeButtonDanger : styles.changeButton}
          disabled={disabled}
          onClick={() => onChange(settable)}
        >
          {busy ? "Eligiendo..." : badge?.danger === true ? "Elegir" : "Cambiar"}
        </button>
      ) : (
        <span className={styles.readOnlyNote}>Sale de la anterior</span>
      )}
    </li>
  );
}

export function SettingsPanel({
  state,
  workshopAddonCount,
}: {
  state: SettingsState;
  /** Conteo real de la Biblioteca (App.tsx, `libraryCount`) para la nota de `workshopFolder` — `null` si Biblioteca todavía no escaneó en esta sesión. */
  workshopAddonCount: number | null;
}) {
  const { loadState, busyField, redetecting, notice, handleChange } = state;

  if (loadState.phase === "loading") {
    return <LoadingIndicator message="Cargando rutas..." />;
  }
  if (loadState.phase === "error") {
    return <p className={styles.message}>Error: {loadState.message}</p>;
  }

  const { paths } = loadState;
  const anyBusy = busyField !== null || redetecting;
  const { missingRequiredField } = computeDetectionStatus(paths);

  const noteFor = (key: keyof GamePaths): string | null => {
    if (key === "workshopFolder") {
      return workshopAddonCount === null ? null : `${workshopAddonCount} addons encontrados acá`;
    }
    if (key === "modsvsFolder") {
      return "Acá se instala el VPK fusionado";
    }
    return null;
  };

  const badgeFor = (field: FieldDef, value: string): RowBadge | null => {
    if (field.key === "left4dead2Dir") {
      return { text: "Derivada", danger: false };
    }
    if (field.key === "vpkToolPath" && value === "") {
      return { text: "Falta", danger: true };
    }
    return null;
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Rutas del sistema</h2>
      <p className={styles.description}>
        Detectadas al arrancar. Podés corregir cualquiera a mano sin borrar tus addons ni tus
        presets.
      </p>

      {notice !== null && <p className={styles.notice}>{notice}</p>}

      {missingRequiredField !== null && (
        <div className={styles.banner}>
          <span className={styles.bannerIcon}>✕</span>
          <div className={styles.bannerText}>
            <p className={styles.bannerTitle}>Falta {MISSING_FIELD_LABEL[missingRequiredField]}</p>
            <p className={styles.bannerBody}>{MISSING_FIELD_BODY[missingRequiredField]}</p>
          </div>
          <button
            type="button"
            className={styles.bannerButton}
            disabled={anyBusy}
            onClick={() => handleChange(missingRequiredField)}
          >
            {busyField === missingRequiredField
              ? "Eligiendo..."
              : MISSING_FIELD_ACTION[missingRequiredField]}
          </button>
        </div>
      )}

      {paths === null && (
        <p className={styles.message}>
          Todavía no hay rutas completas detectadas. Probá "Volver a detectar" en el panel de la
          derecha.
        </p>
      )}

      {paths !== null &&
        GROUPS.map((group) => {
          const groupDanger = group.fields.some(
            (field) => field.key === "vpkToolPath" && paths[field.key] === "",
          );
          return (
            <section key={group.kicker} className={styles.group}>
              <p className={styles.kicker}>{group.kicker}</p>
              <ul className={groupDanger ? styles.listDanger : styles.list}>
                {group.fields.map((field) => (
                  <PathRow
                    key={field.key}
                    field={field}
                    value={paths[field.key]}
                    note={noteFor(field.key)}
                    badge={badgeFor(field, paths[field.key])}
                    busy={busyField === field.settable}
                    disabled={anyBusy}
                    onChange={handleChange}
                  />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
