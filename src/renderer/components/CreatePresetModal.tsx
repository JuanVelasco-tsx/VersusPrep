import { useState } from "react";
import type { FormEvent } from "react";

import styles from "./CreatePresetModal.module.css";

/**
 * Modal de "Nuevo preset" / "Renombrar preset" (bug/feature reportado tras
 * P-30 Paso 5; extendido en el rediseño Paso 5/8 con el modo "rename").
 * Reusa el MISMO patrón visual de `OperationOverlay` (backdrop de pantalla
 * completa + caja centrada), no inventa uno nuevo — a diferencia de ese
 * overlay, este SÍ se puede cerrar libremente (click en el backdrop, botón
 * "Cancelar") porque acá no hay ninguna operación en curso todavía: recién
 * se dispara al confirmar.
 *
 * REDISEÑO Paso 5/8 — modo "rename" (README "Files": "Sacar `window.prompt`
 * de 'Renombrar' (usar el mismo patrón de modal)"): se adaptó este
 * componente en vez de crear uno nuevo/un shell compartido aparte, porque
 * el modal de "Nuevo preset" YA ES el shell correcto (mismo backdrop, misma
 * caja, mismo layout de campos) — la ÚNICA diferencia real entre crear y
 * renombrar es (a) el título y (b) que renombrar no tiene campo
 * Descripción, porque `renamePreset(id, newName)` (ver `ipc-contract.ts`)
 * NO admite actualizar la descripción, a diferencia de `createPreset`.
 * Duplicar el componente entero para esa única diferencia hubiera
 * significado mantener dos copias casi idénticas del backdrop/caja/label/
 * input/botones; un prop `mode` con un `initialName` opcional es la
 * variación mínima. `onSubmit` mantiene la MISMA firma
 * `(name, description)` en ambos modos — no se cambia el contrato pedido
 * para el modo "create" — pero en modo "rename" el segundo argumento
 * siempre llega como cadena vacía (no hay campo que lo produzca) y el
 * llamador (`PresetsPanel.tsx`) lo ignora.
 *
 * Sin estado de red propio: `onSubmit` recibe `name`/`description` ya
 * recortados y es responsabilidad del llamador invocar la IPC, publicar el
 * progreso al `OperationOverlay` (solo aplica al modo "create", que
 * encadena `switchActivePreset`) y cerrar el modal.
 */
export interface CreatePresetModalProps {
  /** `true` mientras `onSubmit` está en curso: deshabilita los campos/botones. */
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, description: string) => void;
  /**
   * `"create"` (default) — título "Nuevo preset", campos Nombre +
   * Descripción, nota de "arranca vacío y queda activo". `"rename"` —
   * título "Renombrar preset", SOLO campo Nombre (precargado con
   * `initialName`), sin nota ni campo de descripción.
   */
  mode?: "create" | "rename";
  /** Nombre inicial del campo. Solo se usa en modo `"rename"` (el nombre actual del preset). */
  initialName?: string;
}

export function CreatePresetModal({
  busy,
  onCancel,
  onSubmit,
  mode = "create",
  initialName = "",
}: CreatePresetModalProps) {
  const [name, setName] = useState(initialName);
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
        <h2 className={styles.heading}>
          {mode === "rename" ? "Renombrar preset" : "Nuevo preset"}
        </h2>

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

        {mode === "create" && (
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
        )}

        {mode === "create" && (
          <p className={styles.note}>
            El preset arranca vacío y queda activo. Al activarlo se fusiona e instala su
            contenido — Windows puede pedir permisos.
          </p>
        )}

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
            {mode === "rename"
              ? busy
                ? "Renombrando..."
                : "Renombrar"
              : busy
                ? "Creando..."
                : "Crear"}
          </button>
        </div>
      </form>
    </div>
  );
}
