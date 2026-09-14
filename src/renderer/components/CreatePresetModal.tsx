import { useState } from "react";
import type { FormEvent } from "react";

import styles from "./CreatePresetModal.module.css";

/**
 * Modal de "Nuevo preset" (bug/feature reportado tras P-30 Paso 5): antes de
 * este cambio, `PresetSwitcher.tsx` pedía el nombre con un `window.prompt()`
 * de texto simple — sin forma de anotar una descripción, y sin el aspecto
 * consistente del resto de la app. Reusa el MISMO patrón visual de
 * `OperationOverlay` (el único modal ya construido en la app: backdrop de
 * pantalla completa + caja centrada con `--color-surface`/`--radius-lg`), no
 * inventa uno nuevo — a diferencia de ese overlay, este SÍ se puede cerrar
 * libremente (click en el backdrop, botón "Cancelar") porque acá no hay
 * ninguna operación en curso todavía: recién se dispara al confirmar.
 *
 * Sin estado de red propio: `onSubmit` recibe `name`/`description` ya
 * recortados y es responsabilidad de `PresetSwitcher` (el llamador) invocar
 * la IPC, publicar el progreso al `OperationOverlay` y cerrar el modal.
 */
export interface CreatePresetModalProps {
  /** `true` mientras `onSubmit` está en curso: deshabilita los campos/botones. */
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, description: string) => void;
}

export function CreatePresetModal({ busy, onCancel, onSubmit }: CreatePresetModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !busy;

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmedName, description.trim());
  };

  const handleBackdropClick = (): void => {
    if (!busy) onCancel();
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <form
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className={styles.heading}>Nuevo preset</h2>

        <label className={styles.field}>
          <span className={styles.label}>Nombre</span>
          <input
            type="text"
            className={styles.input}
            value={name}
            disabled={busy}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Descripción (opcional)</span>
          <textarea
            className={styles.textarea}
            rows={2}
            value={description}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            disabled={busy}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button type="submit" className={styles.createButton} disabled={!canSubmit}>
            {busy ? "Creando..." : "Crear"}
          </button>
        </div>
      </form>
    </div>
  );
}
