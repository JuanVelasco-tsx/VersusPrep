import { useEffect } from "react";

import { TrustNotices } from "./TrustNotices.js";
import styles from "./TrustNoticesModal.module.css";

/**
 * Modal reusable de "Avisos de confianza" — corrección sobre el popover
 * angosto anclado al riel (Paso 2/8): eso no es descartable, el Paso 8
 * (README `2e`, primer arranque) va a necesitar mostrar avisos de confianza
 * también ahí, así que este componente se extrae SEPARADO de la píldora del
 * riel (`App.tsx`) para poder dispararse desde cualquier lado con solo
 * montarlo — no depende de `noticesOpen` ni de ningún otro estado del riel.
 *
 * Mismo patrón visual que `CreatePresetModal` (backdrop de pantalla completa
 * + caja centrada, cerrable con click en el backdrop), sin reescribirlo como
 * un shell compartido: ninguna otra pantalla del proyecto extrae ese shell a
 * un componente común todavía (`OperationOverlay`/`CreatePresetModal` cada
 * uno con su propio `.backdrop`), así que este sigue ese mismo criterio en
 * vez de introducir una abstracción nueva sin otro consumidor real hoy.
 *
 * A diferencia de `CreatePresetModal` (que solo cierra con backdrop/botón),
 * este SÍ cierra con Escape: es un modal puramente informativo (sin
 * formulario ni operación en curso que proteger), incluir el atajo estándar
 * no tiene downside.
 *
 * El contenido interno (`TrustNotices`) NO se toca: sigue en sus tokens
 * viejos (`--font-size-sm`, `--color-warning`, etc., aliaseados en
 * `global.css`) a propósito — esa migración de tokens es del Paso 8, cuando
 * el README dice que el contenido de estos 4 avisos se condensa a 3 para el
 * primer arranque.
 */
export function TrustNoticesModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <TrustNotices />
        <div className={styles.actions}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
