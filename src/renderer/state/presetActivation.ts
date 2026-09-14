/**
 * Predicado PURO para detectar, dentro del pub-sub de `OperationOverlay.ts`,
 * el evento exacto que significa "el preset ACTIVO cambió con éxito" — ya sea
 * un `switchActivePreset` directo desde el desplegable de `PresetSwitcher`, o
 * el switch encadenado que dispara "Nuevo preset" (`createAndActivatePreset`,
 * `presetSwitcher.ts`). Ambos publican el MISMO `kind: "switch"`, así que un
 * único chequeo cubre las dos entradas.
 *
 * Bug reportado tras P-30 Paso 5: `getActiveSet()` ya lee del preset activo
 * (convergencia del Paso 4.5b), pero `AddonList`/`ActiveSetPanel` solo lo
 * consultaban UNA VEZ al montar — remontar (cambiar de pestaña) forzaba un
 * refetch por accidente, pero quedarse en la misma pestaña mientras se
 * cambiaba/creaba un preset dejaba ambos paneles mostrando el Active_Set del
 * preset ANTERIOR. Este predicado es lo que dispara el refetch explícito
 * (ver `AddonList.tsx`/`ActiveSetPanel.tsx`) sin necesitar un remontaje.
 *
 * Extraído a un módulo aparte (mismo motivo que `pendingSelection.ts`/
 * `presetSwitcher.ts` — no hay infraestructura jsdom en este proyecto
 * todavía, P-28) porque acertar el filtro es la parte no trivial del fix: un
 * chequeo de menos (p. ej. olvidar `status === "success"`) dispara un
 * refetch prematuro durante un switch en curso o tras uno fallido/elevando;
 * uno de más (p. ej. incluir "apply"/"add"/"remove") reintroduciría el
 * refetch en cada operación de Biblioteca, revirtiendo el desacople
 * deliberado entre Biblioteca y Activos (ver `ActiveSetPanel.tsx`).
 */
import type { OperationEvent } from "../components/OperationOverlay.js";

export function isPresetActivationEvent(event: OperationEvent): boolean {
  return event.type === "result" && event.kind === "switch" && event.result.status === "success";
}
