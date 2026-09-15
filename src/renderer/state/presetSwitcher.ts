/**
 * Lógica de orquestación/decisión del selector de presets de `App.tsx`
 * (P-30, Paso 5), extraída a un módulo aparte para poder testearla sin
 * renderizar componentes (mismo motivo que `pendingSelection.ts` — no hay
 * infraestructura jsdom en este proyecto todavía, ver Context/02-pendientes.md
 * P-28).
 */
import type { OperationResult, Preset } from "../../main/domain/index.js";

/**
 * Subconjunto de `L4d2Api` que necesita `createAndActivatePreset` — tipado
 * explícito (no `L4d2Api` completo) para poder inyectar un fake mínimo en los
 * tests sin implementar el resto de la API.
 */
export interface CreateAndActivateApi {
  createPreset(name: string, description?: string): Promise<Preset>;
  switchActivePreset(id: string): Promise<OperationResult>;
}

/**
 * DECISIÓN (P-30, Paso 5, punto 3 del pedido): crear un preset lo deja
 * automáticamente como ACTIVO, encadenando `switchActivePreset` justo
 * después de `createPreset`. Alternativa descartada: crearlo y dejarlo
 * inactivo, obligando a un paso extra manual del usuario ("Crear" + luego
 * "Cambiar a él") — un preset recién creado y vacío no tiene ningún efecto
 * visible en el juego hasta que se activa, así que dejarlo inactivo por
 * defecto no protege nada y solo agrega fricción.
 *
 * Si `createPreset` falla (p. ej. nombre vacío), `switchActivePreset` NUNCA
 * se llama — no hay nada que activar. Si `createPreset` tiene éxito pero el
 * `switchActivePreset` posterior falla o dispara elevación UAC, el preset
 * creado NO se deshace: `switchResult` se devuelve tal cual para que el
 * llamador lo reporte (mismo `OperationResult` que ya maneja
 * `OperationOverlay` para apply/add/remove), y el preset queda existente pero
 * inactivo — el usuario puede reintentar activarlo desde el desplegable.
 *
 * `description` (bug/feature post Paso 5, modal real de creación en
 * `PresetSwitcher.tsx`): OPCIONAL, se reenvía tal cual a `api.createPreset` —
 * ninguna lógica nueva acá, el backend ya normaliza vacío/ausente a `null`
 * (ver `ipc-handlers.ts`).
 */
export async function createAndActivatePreset(
  api: CreateAndActivateApi,
  name: string,
  description?: string,
): Promise<{ preset: Preset; switchResult: OperationResult }> {
  const preset = await api.createPreset(name, description);
  const switchResult = await api.switchActivePreset(preset.id);
  return { preset, switchResult };
}

/**
 * `true` si el preset `presetId` se puede borrar — es decir, si NO es el
 * preset activo. Espeja la validación que ya hace `ipc-handlers.ts`
 * (`deletePreset` lanza si `id === getActivePresetId()`, ver DECISIÓN ahí),
 * para que la UI directamente no OFREZCA la opción de borrar el activo en vez
 * de dejar que el usuario choque con ese error (P-30, Paso 5, punto 5 del
 * pedido). `activePresetId === null` (ningún preset activo, estado de borde)
 * no bloquea nada: sin preset activo, cualquier preset existente es seguro de
 * borrar.
 */
export function canDeletePreset(presetId: string, activePresetId: string | null): boolean {
  return presetId !== activePresetId;
}

/**
 * `true` si el formulario de `CreatePresetModal` puede enviarse: nombre no
 * vacío tras recortar espacios, y ninguna mutación en curso (`busy`).
 *
 * Extraída en el rediseño Paso 5/8: esta regla ya existía inline en
 * `CreatePresetModal.tsx` desde antes del rediseño (sin test — nunca
 * cruzó el umbral de "vale la pena aislar" mientras gateaba un solo flujo,
 * "Nuevo preset"), pero el Paso 5 sumó el modo `"rename"` COMPARTIENDO el
 * mismo componente/la misma validación para "Renombrar preset" — con DOS
 * flujos distintos dependiendo de la misma regla, un bug acá afectaría
 * ambos a la vez, así que cruza el mismo umbral que ya usó
 * `isApplyButtonDisabled` en el Paso 4 (`activeSetEntries.ts`): se extrae y
 * se testea en vez de quedar sin cobertura dentro del componente.
 */
export function canSubmitPresetForm(name: string, busy: boolean): boolean {
  return name.trim().length > 0 && !busy;
}
