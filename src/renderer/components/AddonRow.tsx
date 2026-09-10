import { useState } from "react";

import type { ScannedAddon, VScriptClassification } from "../../main/domain/index.js";
import { AddonCover } from "./AddonCover.js";
import styles from "./AddonRow.module.css";

/**
 * Una fila de la lista de addons (Bloque 2, Tarea 21.1). `classification` es
 * `"pending"` mientras `classifyVScript` todavia no resolvio para este addon -
 * un tercer estado, distinto de "bloqueado" y de "permitido" (AC 3.6-3.8: no
 * se puede advertir ni permitir sobre una clasificacion que no se conoce).
 *
 * El checkbox "Incluir" y el gate de "Forzar inclusion" son estado EFIMERO de
 * React (useState local a esta fila): no tocan `AddonManifestEntry` ni
 * `LocalStore` - la persistencia real del Active_Set es tarea de 21.2, fuera
 * de alcance de este bloque.
 */
interface AddonRowProps {
  addon: ScannedAddon;
  classification: VScriptClassification | "pending";
}

export function AddonRow({ addon, classification }: AddonRowProps) {
  const [forced, setForced] = useState(false);
  const [included, setIncluded] = useState(false);

  const isPending = classification === "pending";
  const isVScript = classification !== "pending" && classification.isVScriptAddon;
  const blocked = isVScript && !forced;

  const info = addon.info;
  const title = info?.title ?? addon.id;

  const handleForce = (): void => {
    const confirmed = window.confirm(
      "Este addon usa VScript y es incompatible con Versus_Mode. " +
        "¿Forzar su inclusión de todos modos?",
    );
    if (confirmed) {
      setForced(true);
      setIncluded(true);
    }
  };

  return (
    <li className={styles.row}>
      <AddonCover addonId={addon.id} hasCover={addon.coverPath !== null} title={info?.title} />
      <div className={styles.info}>
        <span className={styles.title}>{title}</span>
        {info !== null && info.author !== undefined && (
          <span className={styles.author}>por {info.author}</span>
        )}
        <span className={isVScript ? `${styles.status} ${styles.statusBlocked}` : styles.status}>
          {isPending && "Clasificando..."}
          {!isPending && isVScript && "⚠ VScript: incompatible con Versus"}
          {!isPending && !isVScript && "Compatible con Versus"}
        </span>
      </div>
      <div className={styles.actions}>
        <label className={styles.includeLabel}>
          <input
            type="checkbox"
            checked={included}
            disabled={isPending || blocked}
            onChange={(event) => setIncluded(event.target.checked)}
          />
          Incluir
        </label>
        {!isPending && isVScript && !forced && (
          <button type="button" className={styles.forceButton} onClick={handleForce}>
            Forzar inclusión
          </button>
        )}
      </div>
    </li>
  );
}
