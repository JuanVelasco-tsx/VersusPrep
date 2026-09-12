# Implementation Plan

## Overview

Este plan implementa el fix de BUG-007 (capa **main/dominio**, sin canal IPC nuevo)
siguiendo la metodología de bug condition del diseño.

**Causa raíz (del design):** hueco de DATOS expuestos al renderer. El `ResumeState` que
`getResumeState()` entrega expone `{ bufferedEvents, result }` pero **no** las entries del
Active_Set candidato, así que el renderer de la instancia elevada no puede repintar la
selección (addons + Priority_Order) tras el UAC.

**Fix (del design):** extender el `ResumeState` existente con
`pendingEntries: AddonManifestEntry[]`, capturado del `getPendingSession()` **antes** de que
`runResume()` → `resumePendingOperation()` limpie el pending con `clearPendingSession()`, y
preservarlo en las ramas de éxito y catch de `runResume`.

**Bug Condition C(X):** `isResuming` (args de resume presentes y `getPendingSession() != null`)
Y hay candidato persistido, pero el `ResumeState` NO expone `pendingEntries`.

**Property P(result):** el `ResumeState` expuesto contiene exactamente las entries candidatas
(mismos `addonId`/`priorityOrder`, en Priority_Order ascendente), disponibles antes y después
de que el resume limpie el pending.

**Límite main/renderer (explícito):** este spec cierra la mitad **main** — expone
`pendingEntries` en el `ResumeState`. La mitad **renderer** (equipo "Code", spec aparte)
consume `pendingEntries` para repintar la selección. Este spec **coordina sin cerrar** la
mitad de Code.

**Metodología:** primero reproducción (fase exploratoria, test que FALLA sin el fix), luego
el fix, luego fix-check (property + re-ejecutar exploratorios), preservation-check, unit
tests, ajuste de regresión y checkpoint final. Testing con **vitest + fast-check**, SIN watch
(`npm run test` = `vitest run`) y `npm run typecheck`.

## Task Dependency Graph

```
                 ┌─────────────────────────────┐
   Wave 1        │ 1. Fase exploratoria (FALLA) │  (reproduce el bug — sin fix)
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
   Wave 2        │ 2. Preservation (PASA sin fix)│ (baseline observado)
                 └──────────────┬──────────────┘
                                │
        ┌───────────────────────▼───────────────────────┐
   Wave 3   3. Fix           3.1 ipc-contract → 3.2 composition-root
                                │
        ┌───────────────────────▼───────────────────────┐
   Wave 4   4. Fix-check      4.1 property (fix)   4.2 re-ejecutar exploratorios (PASAN)
                                │
                 ┌──────────────▼──────────────┐
   Wave 5        │ 5. Preservation re-check     │ (siguen pasando — sin regresión)
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
   Wave 6        │ 6. Unit tests (comp-root/ipc)│
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
   Wave 7        │ 7. Regresión (ResumeState)   │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
   Wave 8        │ 8. Checkpoint (test+typecheck)│
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
   Wave 9        │ 9. Commit + historial (P-25) │
                 └─────────────────────────────┘
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "description": "Reproducir el bug con test exploratorio que FALLA sobre el código sin fix" },
    { "wave": 2, "tasks": ["2"], "description": "Capturar el baseline de preservación (PASA sobre el código sin fix)" },
    { "wave": 3, "tasks": ["3", "3.1", "3.2"], "description": "Implementar el fix: extender ResumeState y capturar pendingEntries antes del clear" },
    { "wave": 4, "tasks": ["4", "4.1", "4.2"], "description": "Fix-check: property test con fast-check y re-ejecución de los exploratorios (ahora PASAN)" },
    { "wave": 5, "tasks": ["5"], "description": "Preservation re-check: los tests de preservación siguen pasando" },
    { "wave": 6, "tasks": ["6", "6.1", "6.2"], "description": "Unit tests de composition-root e ipc-handlers" },
    { "wave": 7, "tasks": ["7"], "description": "Ajuste de regresión de tests existentes que construyen/aseveran ResumeState" },
    { "wave": 8, "tasks": ["8"], "description": "Checkpoint: suite completa (vitest run) + typecheck" },
    { "wave": 9, "tasks": ["9"], "description": "Commit y registro en el historial de decisiones (P-25)" }
  ]
}
```

## Tasks

- [x] 1. Escribir el test exploratorio de la Bug Condition (ANTES del fix)
  - **Property 1: Bug Condition** - El ResumeState no expone las entries candidatas del resume
  - **CRÍTICO**: este test DEBE FALLAR sobre el código sin arreglar — el fallo confirma que el bug existe (el campo `pendingEntries` no existe en `ResumeState`).
  - **NO intentar arreglar el test ni el código cuando falle**: el fallo es el resultado esperado en esta fase.
  - **NOTA**: este test codifica el comportamiento esperado; validará el fix cuando pase tras la implementación (tarea 4.2).
  - **OBJETIVO**: surfar contraejemplos que demuestren el hueco de datos en el `ResumeState`.
  - **Enfoque PBT acotado**: para el bug determinista, acotar la propiedad a los casos concretos que fallan (candidato persistido y args de resume presentes).
  - Setup: `SqliteLocalStore` en memoria (`new Database(":memory:")`), `savePendingSession([...])`, construir el `StartupOutcome` con `runStartupSequence` usando `argv` de resume (`--l4d2-resume-type applyActiveSet --l4d2-resume-handle <h>`), y aseverar sobre `readResumeState()`.
  - Caso 1 — candidato no vacío: `savePendingSession` con 3 entries de `priorityOrder` dispares/desordenados; aseverar que `readResumeState().pendingEntries` contiene esas 3 entries en Priority_Order ascendente (luego `addonId`). Falla sin el fix: el campo no existe.
  - Caso 2 — candidato vacío intencional: `savePendingSession([])` (sesión activa, `active = 1`); aseverar que `readResumeState()` no es `null` y `pendingEntries` es `[]` (distinto de "sin resume"). Falla sin el fix.
  - Caso 3 — captura antes del clear: tras `await runResume()` (que limpia el pending en el `finally`), aseverar que `readResumeState().pendingEntries` sigue reflejando el candidato. Falla sin el fix: no hay captura previa al clear.
  - Ejecutar sobre el código SIN fix con `npm run test` (vitest run, sin watch).
  - **RESULTADO ESPERADO**: el test FALLA (esto es correcto: prueba que el bug existe).
  - Documentar los contraejemplos encontrados (p. ej. "`readResumeState()` no tiene `pendingEntries`; el renderer no tiene de dónde repintar la selección").
  - Marcar completa cuando el test esté escrito, ejecutado y el fallo documentado.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Escribir los tests de preservación (ANTES del fix)
  - **Property 2: Preservation** - Comportamiento sin resume y ciclo de vida del resume inalterados
  - **IMPORTANTE**: seguir la metodología observación-primero — correr el código SIN fix, observar los outputs reales y aseverarlos.
  - Observar y aseverar (sobre código sin fix): arranque sin args de resume => `readResumeState()` devuelve `null`.
  - Observar y aseverar: tras `runResume()`, `getPendingSession()` del store devuelve `null` (se limpió en el `finally`) y el resume es idempotente.
  - Observar y aseverar: `getPendingSession()` sigue distinguiendo `null` (sin sesión) de `[]` (sesión activa con candidato vacío) vía el flag `active`, no por cantidad de filas.
  - Observar y aseverar: `getResumeState().result` sigue sirviendo el `OperationResult` terminal; no hay canal nuevo en `IPC_CHANNELS`/`L4d2Api` (comparar contra el set de canales existente).
  - Property-based (fast-check, mín. 100 iter) recomendado para la preservación: para candidatos arbitrarios que NO cumplen la bug condition el resultado observable no cambia.
  - Ejecutar sobre el código SIN fix con `npm run test` (vitest run, sin watch).
  - **RESULTADO ESPERADO**: los tests PASAN (confirma el baseline a preservar).
  - Marcar completa cuando los tests estén escritos, ejecutados y pasando sobre el código sin fix.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix para BUG-007 — exponer el batch candidato en el ResumeState (sin canal IPC nuevo)

  - [x] 3.1 Extender la interface `ResumeState` en `src/main/app/ipc-contract.ts`
    - Agregar el campo `pendingEntries: AddonManifestEntry[]` a la interface `ResumeState` (`AddonManifestEntry` ya se importa ahí — no hace falta import nuevo).
    - Documentar la semántica en JSDoc: lista con entradas = candidato tal cual se persistió (Priority_Order ascendente); `[]` = sesión activa con candidato intencionalmente vacío (mostrar selección vacía, NO "sin resume").
    - Documentar la INVARIANTE: si el objeto `ResumeState` no es `null`, `pendingEntries` SIEMPRE está presente (nunca `undefined`); "sin resume" se representa con el `ResumeState` entero en `null`.
    - Documentar la disponibilidad en el ciclo de vida: poblado desde el primer `getResumeState()` tras montar (capturado al construir el `resumeState` inicial, antes del clear), disponible con `result` `null` (resume en curso) y después.
    - NO agregar ningún canal a `IPC_CHANNELS` ni método a `L4d2Api`.
    - _Bug_Condition: `isBugCondition(input)` — `NOT HAS_FIELD(resumeState, "pendingEntries")` (del design)_
    - _Expected_Behavior: `ResumeState.pendingEntries` presente cuando el objeto no es `null` (Property 1 del design)_
    - _Requirements: 2.1, 2.2, 2.3, 3.6_

  - [x] 3.2 Capturar y preservar `pendingEntries` en `src/main/app/composition-root.ts`
    - En `runStartupSequence`, al calcular `isResuming`: capturar el candidato ANTES del clear con `const pendingEntries = base.localStore.getPendingSession() ?? []` (`isResuming` ya implica `getPendingSession() !== null`, así que `[]` refleja el candidato vacío legítimo).
    - Incluir el candidato en el `resumeState` inicial: cambiar `resumeState = isResuming ? { bufferedEvents: [], result: null } : null` por `{ bufferedEvents: [], result: null, pendingEntries }`.
    - Preservar `pendingEntries` en la rama de ÉXITO de `runResume`: `resumeState = { bufferedEvents: ..., result, pendingEntries }`.
    - Preservar `pendingEntries` en la rama de CATCH (excepción inesperada) de `runResume`: incluir el mismo `pendingEntries` en el `resumeState` de fallo terminal.
    - NO tocar `resumePendingOperation`: el orden `getPendingSession()` al inicio + `clearPendingSession()` en el `finally` NO cambia (la captura vive en la capa de composición, no en el dominio).
    - `src/main/app/ipc-handlers.ts`: sin cambios funcionales — `activeSet:resumeState` ya delega en `getResumeState()` y pasa el objeto extendido tal cual. NO agregar canal nuevo.
    - `src/main/main.ts`: sin cambios funcionales — `getResumeState = () => outcome.readResumeState()` sigue igual; el orden ventana-antes-de-resume (BUG-004 A1) se mantiene.
    - _Bug_Condition: `isResuming AND hasCandidate AND NOT resumeStateExposesCandidate` (del design)_
    - _Expected_Behavior: `state.pendingEntries EQUALS input.pendingSession` para todo camino de resume (Fix Checking del design)_
    - _Preservation: elevación una vez por sesión, resume idempotente + clear en el finally, null vs [], sin resume => null, sin canal nuevo (Preservation Requirements del design)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Fix-check — verificar que el fix expone el candidato correcto

  - [x] 4.1 Escribir el property test del fix con fast-check
    - **Property 1: Expected Behavior** - El ResumeState expone exactamente las entries candidatas
    - Con `fast-check` (mínimo 100 iteraciones): generar un Active_Set candidato arbitrario (lista de `{ addonId, priorityOrder }`, incluida la lista vacía `[]`), con `priorityOrder` repetidos/desordenados.
    - Para cada candidato: `savePendingSession(candidato)` en un `SqliteLocalStore` en memoria, construir el `StartupOutcome` con `argv` de resume, y aseverar que `readResumeState().pendingEntries` contiene exactamente esas entries en Priority_Order ascendente (luego `addonId`), coincidiendo con el orden que `getPendingSession()` ya garantiza.
    - Verificar para TODO camino de resume: antes de `runResume()` (estado inicial) y después de `await runResume()` (tras el clear del pending).
    - Ejecutar con `npm run test` (vitest run, sin watch).
    - **RESULTADO ESPERADO**: el property test PASA sobre el código con fix.
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.2 Re-ejecutar los tests exploratorios de la tarea 1
    - **Property 1: Expected Behavior** - Los exploratorios ahora pasan (bug resuelto)
    - **IMPORTANTE**: re-ejecutar los MISMOS tests de la tarea 1 — NO escribir tests nuevos. Esos tests codifican el comportamiento esperado.
    - Ejecutar con `npm run test` (vitest run, sin watch).
    - **RESULTADO ESPERADO**: los 3 casos (candidato no vacío, `[]`, captura antes del clear) PASAN (confirma que el bug está resuelto).
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 5. Preservation re-check — verificar que no hay regresiones
  - **Property 2: Preservation** - Comportamiento sin resume y ciclo de vida del resume inalterados
  - **IMPORTANTE**: re-ejecutar los MISMOS tests de la tarea 2 — NO escribir tests nuevos.
  - Ejecutar con `npm run test` (vitest run, sin watch).
  - **RESULTADO ESPERADO**: los tests de preservación siguen PASANDO tras el fix (sin resume => `null`; resume idempotente + clear en el finally; null vs []; `result` terminal sin canales duplicados).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 6. Unit tests de composición e IPC

  - [x] 6.1 Unit tests de `composition-root`
    - El `resumeState` inicial incluye `pendingEntries` capturado del `getPendingSession()` antes del clear, con candidato no vacío y con `[]`.
    - Tras `await runResume()` en la rama de ÉXITO: `readResumeState().pendingEntries` sigue reflejando el candidato capturado y `result` es el `OperationResult` terminal.
    - Tras `runResume()` en la rama de CATCH (mock que hace `throw` en `resumePendingOperation`): `pendingEntries` sigue reflejando el candidato y `result` es el fallo terminal (`status: "failure"`).
    - Sin resume (sin args): `readResumeState()` es `null` (preservación).
    - Ejecutar con `npm run test` (vitest run, sin watch).
    - _Requirements: 2.1, 2.2, 2.3, 3.4_

  - [x] 6.2 Unit tests de `ipc-handlers`
    - `activeSet:resumeState` retorna el `ResumeState` extendido tal cual lo entrega `getResumeState()` (incluye `pendingEntries`).
    - No hay canal nuevo en `IPC_CHANNELS`; el set de canales es idéntico al previo.
    - Ejecutar con `npm run test` (vitest run, sin watch).
    - _Requirements: 3.6_

- [x] 7. Ajuste de regresión — tests existentes que construyen/aseveran `ResumeState`
  - Localizar todos los tests existentes de `composition-root`/`ipc-handlers`/`preload` que construyan o aseveren sobre un `ResumeState`.
  - Ajustarlos para incluir `pendingEntries` (el campo pasa a ser obligatorio cuando el objeto no es `null`): agregar `pendingEntries: [...]` (o `[]`) donde se construya un `ResumeState`, y actualizar aserciones de igualdad estructural.
  - No cambiar el comportamiento aseverado, solo la forma de datos.
  - Ejecutar con `npm run test` (vitest run, sin watch).
  - _Requirements: 2.1, 3.6_

- [x] 8. Checkpoint — suite completa + typecheck
  - Correr `npm run test` (vitest run, SIN watch): todos los tests pasan (exploratorios ahora en verde, preservación intacta, unit + regresión).
  - Correr `npm run typecheck`: sin errores de tipos (el campo obligatorio `pendingEntries` no rompe ningún consumidor de `ResumeState`).
  - Si surgen dudas o fallos inesperados, preguntar al usuario antes de continuar.
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [~] 9. Commit y registro en el historial de decisiones
  - Crear el commit con formato CONTRIBUTING.md: `fix(main): exponer batch candidato en ResumeState para restaurar la selección tras UAC (bug BUG-007)`. Si se sigue la convención `(task X.Y, req Z.W)` de CONTRIBUTING, anexar las tareas/requisitos cubiertos manteniendo intacto el mensaje base pedido.
  - Preferir stage de archivos específicos (los tocados: `ipc-contract.ts`, `composition-root.ts`, tests nuevos/ajustados, `Context/04-historial-decisiones.md`), no `git add .`.
  - Agregar entrada en `Context/04-historial-decisiones.md` referenciando P-25: "P-25 cerró progreso + `isResuming` end-to-end, pero el `ResumeState` no exponía el batch candidato para repintar la selección tras el relanzo elevado (BUG-007). Se extiende `ResumeState` con `pendingEntries: AddonManifestEntry[]`, capturado del `getPendingSession()` antes del `clearPendingSession()` del resume, sin agregar canal IPC nuevo (decisión del usuario). La mitad renderer (consumir `pendingEntries` para repintar) queda como follow-up de Code."
  - **NO mergear sin mostrar el diff primero** (el usuario lo pide siempre): mostrar `git diff`/`git show` antes de cualquier merge y esperar confirmación.
  - _Requirements: 2.1, 2.2, 2.3, 3.6_

## Notes

- **Metodología bug condition**: la tarea 1 (exploratoria) DEBE fallar sobre el código sin fix — ese fallo confirma la causa raíz (hueco de datos en el `ResumeState`). La tarea 2 (preservación) DEBE pasar sobre el código sin fix — captura el baseline observado. No se implementa el fix hasta que ambas fases estén ejecutadas y documentadas.
- **Sin canal IPC nuevo**: por decisión del usuario, el fix extiende el `ResumeState` existente; NO se agrega nada a `IPC_CHANNELS` ni a `L4d2Api`. Las tareas 3.1, 3.2, 6.2 y 5 lo verifican explícitamente (preserva bugfix 3.6 / P-25).
- **Captura antes del clear**: el candidato se lee en la capa de composición (`runStartupSequence`) al calcular `isResuming`, antes de que `runResume()` dispare `clearPendingSession()`. `resumePendingOperation` NO se toca (preserva bugfix 3.2, 3.3).
- **Semántica `[]` vs `null`**: `pendingEntries = []` (sesión activa, candidato vacío) es distinto de `ResumeState = null` (sin resume). Cubierto en las tareas 1 (caso 2), 3.1 (JSDoc) y 6.1.
- **Orden Priority_Order**: las entries se exponen en orden ascendente por `priorityOrder`, luego `addonId`, coincidiendo con lo que `getPendingSession()` ya garantiza (verificado en la tarea 4.1 con `priorityOrder` repetidos/desordenados).
- **Límite main/renderer**: este spec cierra la mitad main (exponer `pendingEntries`). La mitad renderer (repintar la selección) es follow-up del equipo Code; este spec coordina sin cerrarla.
- **Herramientas de test**: vitest + fast-check. SIEMPRE `npm run test` (= `vitest run`, sin watch) y `npm run typecheck`. NUNCA watch mode.
