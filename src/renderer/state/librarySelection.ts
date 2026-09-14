/**
 * Lógica PURA de selección múltiple de Biblioteca (P-22, Paso 2). Extraída de
 * `AddonList.tsx` por el mismo motivo que `librarySort.ts`/`pendingSelection.ts`
 * (testeable sin jsdom).
 *
 * El checkbox de SELECCIÓN de cada fila es un concepto transitorio, separado
 * del checkbox "Incluir" (que solo refleja membresía en el preset activo, ver
 * `AddonRow.tsx`): sirve para elegir addons para una acción en lote
 * (Incluir/Excluir seleccionados), y se limpia solo (éxito de la acción,
 * cambio de preset activo, o "Cancelar"). Por eso NO hay ninguna restricción
 * de elegibilidad acá (a diferencia del viejo `eligibleIds` de BUG-002, que
 * solo dejaba seleccionar addons NO incluidos y NO bloqueados): con
 * `addMany`/`removeMany` disponibles, CUALQUIER fila visible es seleccionable
 * para cualquiera de las dos acciones.
 */

export interface SelectionClickResult {
  selected: Set<string>;
  anchor: string | null;
}

/**
 * Resuelve la selección y el "anchor" (última fila clickeada SIN shift, punto
 * de partida de un rango) resultantes de un click sobre el checkbox de
 * selección de la fila `clickedId`.
 *
 * - Click simple o Ctrl/Cmd+click: alterna SOLO `clickedId` (agrega si
 *   `checked` es `true`, quita si es `false`) sin tocar el resto de
 *   `current` — es el comportamiento nativo de un checkbox independiente, así
 *   que Ctrl/Cmd+click no necesita loǵica extra más allá de esta rama; ambos
 *   casos también mueven el `anchor` a `clickedId`, para que un shift+click
 *   posterior arranque el rango desde acá.
 * - Shift+click (con un `anchor` previo válido, presente en `visibleIds`):
 *   aplica `checked` a TODO el rango entre `anchor` y `clickedId` (ambos
 *   inclusive, en el orden ACTUAL de `visibleIds` — respeta el
 *   ordenamiento/filtro aplicado), sumado a `current` (no reemplaza la
 *   selección previa fuera del rango). El `anchor` NO se mueve, para que
 *   shift+clicks repetidos sigan extendiendo/encogiendo el mismo rango.
 * - Shift+click sin `anchor` previo (primer click de la sesión de selección):
 *   degrada a click simple, ya que no hay desde dónde trazar un rango.
 */
export function applySelectionClick(
  current: ReadonlySet<string>,
  anchor: string | null,
  visibleIds: readonly string[],
  clickedId: string,
  checked: boolean,
  shiftKey: boolean,
): SelectionClickResult {
  if (shiftKey && anchor !== null) {
    const fromIndex = visibleIds.indexOf(anchor);
    const toIndex = visibleIds.indexOf(clickedId);
    if (fromIndex !== -1 && toIndex !== -1) {
      const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const next = new Set(current);
      for (const id of visibleIds.slice(start, end + 1)) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { selected: next, anchor };
    }
  }

  const next = new Set(current);
  if (checked) next.add(clickedId);
  else next.delete(clickedId);
  return { selected: next, anchor: clickedId };
}
