# BUG-007 — Elevación pierde el batch: Diseño del Bugfix

## Overview

Tras aceptar el prompt de UAC, la instancia elevada arranca correctamente y el resume
materializa la operación (el `.vpk` se instala, el manifest se guarda), pero el renderer
de la instancia elevada **no puede repintar la selección** (batch: addons + Priority_Order)
que el usuario tenía preparada antes del reinicio. El usuario percibe el batch como
"perdido" aunque el dominio sí lo persistió y sí lo aplicó.

La investigación estática (ver "Hypothesized Root Cause") descarta que el batch no se
persista: para `applyActiveSet` el batch que se guarda ES exactamente el batch visual del
renderer, y `SqliteLocalStore` persiste ambas columnas (`addonId`, `priorityOrder`) con un
flag de estado que distingue "sin sesión" de "sesión vacía intencional". El batch está en
disco. El hueco real es de **forma de datos expuesta por IPC**: el `ResumeState` que
`getResumeState()` devuelve al renderer expone `bufferedEvents` (progreso) y `result`
(resultado terminal), pero **NO expone las entries candidatas** (el Active_Set que se está
restaurando). El renderer sabe que "está resumiendo" (`isResuming()`) y ve el progreso y el
resultado, pero no tiene ningún canal que le entregue la lista `{ addonId, priorityOrder }`
para reconstruir la vista de selección: `getActiveSet()` devuelve el manifest INSTALADO,
que durante el resume todavía no refleja el candidato (el `saveManifest` ocurre al final de
`#materialize`), y `getPendingSession()` es interno del dominio, no está expuesto por IPC.

El fix, respetando la decisión ya tomada por el usuario de **no** agregar un canal IPC
nuevo (`getPendingOperation`), **extiende el `ResumeState` existente** con un campo
`pendingEntries: AddonManifestEntry[]`, capturado del `getPendingSession()` **antes** de
que el resume lo limpie con `clearPendingSession()`. Así el renderer, con el mismo
`getResumeState()` que ya consume, obtiene también las entries para repintar la selección.

Este documento cubre la mitad **main/dominio**. La mitad **renderer** (consumir
`pendingEntries` y repintar la UI) la resuelve el equipo de "Code" por separado. El límite
main/renderer se detalla explícitamente en "Fix Implementation".

## Glossary

- **Bug_Condition (C)**: el estado observable en el que, tras la elevación, el renderer de
  la instancia elevada no puede reconstruir el batch (selección + Priority_Order) porque el
  estado expuesto por IPC (`ResumeState`) no incluye el Active_Set candidato.
- **Property (P)**: el comportamiento deseado — cuando la instancia arranca para resumir y
  hay una sesión pendiente activa, el `ResumeState` expuesto por IPC contiene exactamente
  las entries candidatas persistidas (con su `priorityOrder`), disponibles desde antes de
  que el resume termine y limpie el pending.
- **Preservation**: el ciclo de vida de elevación/resume ya existente que el fix NO debe
  romper (elevación una vez por sesión, resume idempotente + `clearPendingSession` en el
  `finally`, distinción `null` vs `[]`, flujo sin elevación, cancelación UAC = `denied`,
  y que `getResumeState()`/`isResuming()` sigan sirviendo el resultado terminal sin canales
  duplicados).
- **Active_Set candidato**: la selección de addons + `priorityOrder` que el usuario tenía
  preparada en la UI y que se persiste vía `savePendingSession(entries)` antes del `runas`.
  Es un `AddonManifestEntry[]`.
- **ResumeState**: el objeto que `getResumeState()` (`activeSet:resumeState`) devuelve al
  renderer. Hoy: `{ bufferedEvents, result }`. Definido en `src/main/app/ipc-contract.ts`.
- **resumeState (variable de composición)**: la variable mutable dentro de
  `runStartupSequence` (composition-root.ts) que `readResumeState()` expone y `runResume()`
  puebla. Es el punto donde hay que capturar las entries antes del clear.
- **isResuming**: HECHO ESTÁTICO del arranque (`parseResumeArgs(argv) !== null` Y
  `getPendingSession() !== null`). Fijo para toda la vida del proceso; el renderer lo
  consulta una vez al montar sin ventana de carrera.
- **AddonManifestEntry**: `{ addonId: string; priorityOrder: number }` (types.ts).

## Bug Details

### Bug Condition

El bug se manifiesta cuando la instancia elevada arranca para RESUMIR una sesión pendiente
(el usuario preparó un batch en la UI, disparó una operación de escritura protegida —
típicamente `applyActiveSet` —, aceptó el UAC y la app se relanzó elevada). El renderer, al
montar, consulta `isResuming()` (que devuelve `true`) y `getResumeState()` para reconstruir
la vista, pero el `ResumeState` devuelto **no contiene las entries candidatas**: el renderer
no tiene de dónde sacar la lista `{ addonId, priorityOrder }` para repintar la selección
que el usuario ve como "perdida".

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type ResumeStartupContext
         { argv, pendingSession: AddonManifestEntry[] | null, resumeState: ResumeState | null }
  OUTPUT: boolean

  // La instancia arrancó para resumir (args de resume presentes)...
  isResuming := parseResumeArgs(input.argv) != null
                AND input.pendingSession != null

  // ...y hay un Active_Set candidato persistido que el usuario espera ver repintado...
  hasCandidate := input.pendingSession != null

  // ...pero el estado expuesto por IPC al renderer NO incluye ese candidato.
  resumeStateExposesCandidate := input.resumeState != null
                                 AND HAS_FIELD(input.resumeState, "pendingEntries")

  RETURN isResuming
         AND hasCandidate
         AND NOT resumeStateExposesCandidate
END FUNCTION
```

### Examples

- **Manifestación reportada (QA V3):** el usuario prepara un batch de 5 addons con un
  Priority_Order específico en la UI, presiona "Aplicar", acepta el UAC. La app se relanza
  elevada, instala el `.vpk` correctamente (el batch SÍ se persistió y aplicó), pero la
  lista de selección aparece vacía o desincronizada: el renderer no recibió las entries
  para repintarla. Resultado esperado: la selección con esos 5 addons y su orden queda
  repintada tras el resume.
- **Candidato vacío intencional (`removeAddon` del último addon):** el usuario quita el
  último addon; el candidato persistido es `[]` (sesión activa, `active = 1`). Tras el
  resume, el renderer debe poder distinguir "restauré una selección vacía" de "no hay
  resume". Hoy no puede, porque ni siquiera recibe el candidato. Resultado esperado:
  `pendingEntries = []` con la sesión activa, para que el renderer muestre selección vacía.
- **Sin resume (arranque normal):** la app arranca sin args de resume; `getResumeState()`
  devuelve `null`. No hay batch que repintar y el bug no aplica. Resultado esperado
  (inalterado): `ResumeState` sigue siendo `null`.
- **Edge case — captura vs limpieza:** el resume corre `getPendingSession()` al inicio y
  `clearPendingSession()` en el `finally`. Si el renderer leyera el candidato de
  `getPendingSession()` DESPUÉS del clear, obtendría `null`. Por eso las entries deben
  CAPTURARSE antes del clear y quedar en el `ResumeState` que `readResumeState()` expone,
  disponibles aunque el pending ya se haya limpiado. Resultado esperado: `pendingEntries`
  refleja el candidato aunque la operación de resume ya haya terminado y limpiado.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- La elevación se sigue pidiendo **una sola vez por sesión**: `ensureCanWrite`/
  `handleWriteFailure` chequean `isElevated()` primero y no relanzan `runas` si ya está
  elevada (bugfix 3.1).
- El resume sigue siendo **idempotente** y limpia el estado con `clearPendingSession()` en
  el `finally` de `resumePendingOperation`, en cualquier desenlace (bugfix 3.2).
- `getPendingSession()` sigue distinguiendo `null` (sin sesión) de `[]` (sesión activa con
  candidato vacío) vía el flag `pending_session_state.active`, no por la cantidad de filas
  (bugfix 3.3).
- El flujo **sin elevación** (instancia ya escribible o `gameRoot` no protegido) sigue
  completando sin relanzar ni persistir/restaurar sesión pendiente (bugfix 3.4).
- La **cancelación del UAC** sigue devolviendo `denied` y permitiendo limpiar el estado
  pendiente sin dejar sesión huérfana (bugfix 3.5).
- `getResumeState()` / `isResuming()` siguen exponiendo el **resultado terminal** por los
  canales IPC existentes que el renderer ya consume (P-25); NO se agrega un canal nuevo
  (bugfix 3.6).

**Scope:**
Todos los caminos que NO son un resume con sesión pendiente activa deben quedar
completamente inalterados. Esto incluye:
- El arranque normal sin resume (`ResumeState` sigue siendo `null`).
- El flujo de `applyActiveSet`/`addAddon`/`removeAddon` en la instancia sin privilegios
  (persistencia + relanzo idénticos).
- Los canales IPC `getActiveSet`, `willNeedElevation`, `isResuming`, `getTitles` y el push
  `merge:onProgress` (sin cambios).

**Note:** El comportamiento correcto concreto (que el `ResumeState` exponga las entries
candidatas) está definido en "Correctness Properties" (Property 1). Esta sección enumera lo
que NO debe cambiar.

## Hypothesized Root Cause

Se plantearon dos hipótesis y se determinó la causa raíz real con evidencia del código.

### Hipótesis B — Captura incompleta del estado visual del renderer (DESCARTADA para el camino reportado)

La idea: el batch que se persiste antes del `runas` no corresponde al batch que el usuario
ve en la UI, así que "se pierde" desde el origen.

**Evidencia que la descarta para `applyActiveSet`** (el camino del síntoma reportado):
- El handler IPC `applyActiveSet(entries)` recibe las `entries` DIRECTO del renderer (el
  batch visual). Fluyen sin transformación: handler → `MergeOrchestrator.applyActiveSet` →
  `#runPublic(entries, "applyActiveSet")` → `ElevationService.ensureCanWrite(gameRoot,
  entries, "applyActiveSet")` → `relaunchElevated(pending, entries)` →
  `savePendingSession([...entries])`.
- `savePendingSession` persiste `addonId` + `priorityOrder` de cada entry en la tabla
  `pending_session`, dentro de una transacción, marcando `active = 1`.
- Conclusión: **para `applyActiveSet` NO hay hueco de captura**. El batch persistido ES el
  batch visual del renderer. La Hipótesis B no explica el síntoma reportado ("preparé una
  selección y se perdió tras el UAC" — ese camino usa `applyActiveSet`).

Matiz honesto sobre `addAddon`/`removeAddon`: en esos dos, las entries se DERIVAN del
manifest INSTALADO (`getManifest()`) más la mutación (upsert/filter), no del estado visual.
Pero son acciones puntuales y explícitas, y el "batch" ahí es el manifest resultante, que sí
se persiste. Tampoco corresponden al síntoma reportado (una selección preparada en la UI).
Por lo tanto la Hipótesis B no es la causa raíz.

### Hipótesis A — Carrera de ciclo de vida / forma de datos del arranque (CAUSA RAÍZ, refinada)

La idea original: el renderer de la instancia elevada no obtiene el batch por un problema de
TIMING (consulta antes de que el estado esté disponible, o después de que
`clearPendingSession()` ya limpió el pending).

**Evidencia y refinamiento:**
- `main.ts` crea la ventana ANTES y luego dispara `runResume()` SIN `await` (BUG-004 A1). El
  renderer, al montar, consulta `isResuming()` (hecho estático, sin carrera) y se suscribe a
  `merge:onProgress`. El resultado terminal llega por `getResumeState().result` cuando el
  resume termina. Ese timing YA está resuelto para progreso + resultado.
- El punto que NO está resuelto: `getResumeState()` expone `{ bufferedEvents, result }`,
  pero **no** las ENTRIES del batch. El renderer sabe que está resumiendo y ve el progreso/
  resultado, pero **no tiene de dónde sacar las entries** `{ addonId, priorityOrder }` para
  repintar la selección:
  - `getActiveSet()` devuelve el manifest INSTALADO, que durante el resume todavía NO
    refleja el candidato (el `saveManifest` es el Paso 8, al final de `#materialize`).
  - `getPendingSession()` es interno del dominio, NO está expuesto por IPC (no está en
    `IPC_CHANNELS` ni en `L4d2Api`).
- Además, aunque se expusiera `getPendingSession()` tal cual, chocaría con el orden de
  limpieza: `resumePendingOperation()` hace `getPendingSession()` al inicio y
  `clearPendingSession()` en el `finally`. Tras terminar el resume, `getPendingSession()`
  devolvería `null`. El renderer podría leerlo demasiado tarde.

**Conclusión (causa raíz):** el hueco real es de **DATOS EXPUESTOS AL RENDERER**, no de
timing puro. El `ResumeState` no expone el Active_Set candidato que el renderer necesita
para reconstruir la vista de selección. La solución es capturar las entries candidatas
ANTES del `clearPendingSession()` y exponerlas dentro del `ResumeState` existente, sin
canal IPC nuevo.

## Correctness Properties

Property 1: Bug Condition — El ResumeState expone las entries candidatas del resume

_For any_ arranque en el que la instancia resume una sesión pendiente activa
(`isBugCondition` sería verdadera en el código sin arreglar, es decir `isResuming` es `true`
y hay un Active_Set candidato persistido), el `ResumeState` que `getResumeState()` expone
SHALL contener un campo `pendingEntries` con exactamente las entries candidatas persistidas
(mismos `addonId` y `priorityOrder`, en Priority_Order ascendente), capturadas antes de que
el resume limpie el estado pendiente, de modo que el renderer pueda reconstruir la selección.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Comportamiento sin resume y ciclo de vida del resume inalterados

_For any_ input donde la bug condition NO se cumple (arranque sin args de resume, o sin
sesión pendiente), el código arreglado SHALL producir el mismo resultado observable que el
original: `getResumeState()` devuelve `null` cuando no hay resume, `isResuming()` devuelve el
mismo hecho estático, el resume sigue siendo idempotente y limpia el pending en el `finally`,
la distinción `null` vs `[]` de `getPendingSession()` se preserva, y el resultado terminal
sigue viajando por `getResumeState().result` sin canales duplicados.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Asumiendo que la causa raíz (hueco de datos expuestos al renderer) es correcta.

**Forma de datos (contrato para "Code"):**

`src/main/app/ipc-contract.ts` — extender `ResumeState`:

```typescript
export interface ResumeState {
  /**
   * Eventos de progreso bufferizados durante el resume-antes-de-ventana
   * (Decisión D2a-i). Sin cambios respecto del contrato previo.
   */
  bufferedEvents: MergeProgressEvent[];
  /**
   * Resultado TERMINAL del resume, o `null` si el resume sigue en curso (el
   * progreso llega en vivo por `merge:onProgress`). Sin cambios.
   */
  result: OperationResult | null;
  /**
   * (BUG-007) Active_Set CANDIDATO que se está restaurando en este resume:
   * la selección + Priority_Order que el usuario tenía preparada antes del
   * relanzo elevado. Capturado del `getPendingSession()` del LocalStore ANTES
   * de que `resumePendingOperation()` limpie el pending, de modo que el renderer
   * pueda repintar la selección aunque el resume ya haya terminado.
   *
   * Semántica (espeja `getPendingSession()`, ver local-store.ts DECISIÓN 5):
   *  - lista con entradas: el candidato tal cual se persistió (Priority_Order
   *    ascendente). El renderer repinta esa selección.
   *  - `[]`: sesión activa con candidato intencionalmente vacío (p. ej. se quitó
   *    el último addon). El renderer muestra una selección vacía, NO "sin resume".
   *
   * INVARIANTE: si el objeto `ResumeState` existe (no es `null`), `pendingEntries`
   * SIEMPRE está presente (nunca `undefined`). El caso "no hay resume" se
   * representa con el `ResumeState` entero en `null`, igual que hoy.
   *
   * DISPONIBILIDAD EN EL CICLO DE VIDA: `pendingEntries` está poblado desde el
   * PRIMER `getResumeState()` que el renderer haga tras montar (se captura al
   * construir el `resumeState` inicial en `runStartupSequence`, antes de que
   * `runResume()` limpie el pending). Está disponible tanto mientras `result` es
   * `null` (resume en curso) como después (resume terminado).
   */
  pendingEntries: AddonManifestEntry[];
}
```

`AddonManifestEntry` ya se importa en `ipc-contract.ts` (no hace falta import nuevo).

**File**: `src/main/app/composition-root.ts`

**Función**: `runStartupSequence` (y el closure `runResume` / la variable `resumeState`).

**Cambios específicos**:
1. **Capturar el candidato al inicio, antes del clear**: al calcular `isResuming`, leer
   `const pendingEntries = base.localStore.getPendingSession() ?? []`. Como `isResuming`
   ya implica `getPendingSession() !== null`, `pendingEntries` refleja el candidato real
   (que puede ser `[]` legítimamente). Capturarlo ACÁ garantiza que se lee ANTES de que
   `runResume()` dispare `resumePendingOperation()` → `clearPendingSession()`.
2. **Incluir `pendingEntries` en el `resumeState` inicial**: cambiar
   `resumeState = isResuming ? { bufferedEvents: [], result: null } : null` por
   `resumeState = isResuming ? { bufferedEvents: [], result: null, pendingEntries } : null`.
3. **Preservar `pendingEntries` al poblar el resultado terminal**: en las dos ramas de
   `runResume` (éxito y catch) que reasignan `resumeState`, incluir el mismo `pendingEntries`
   ya capturado (`{ bufferedEvents, result, pendingEntries }`). Así el renderer sigue
   viendo el candidato después de que el resume termina, aunque el pending ya se limpió.
4. **Sin tocar `resumePendingOperation`**: el orden `getPendingSession()` al inicio +
   `clearPendingSession()` en el `finally` NO cambia (preserva 3.2, 3.3). La captura para el
   `ResumeState` vive en la capa de composición, no en el dominio.

**File**: `src/main/app/ipc-handlers.ts`

**Cambios específicos**:
5. **Ninguno funcional**: `getResumeState` ya delega en `deps.getResumeState()`
   (`readResumeState`). Al enriquecerse el `ResumeState`, el handler `activeSet:resumeState`
   pasa el objeto extendido tal cual. NO se agrega un canal nuevo (preserva 3.6).

**File**: `src/main/main.ts`

**Cambios específicos**:
6. **Ninguno funcional**: `getResumeState = () => outcome.readResumeState()` sigue igual; el
   orden ventana-antes-de-resume (BUG-004 A1) se mantiene.

### Límite main / renderer (coordinación con "Code")

- **main (este spec)**: expone las entries candidatas dentro del `ResumeState`
  (`pendingEntries: AddonManifestEntry[]`), capturadas antes del `clearPendingSession`, y
  las mantiene disponibles durante todo el resume (en curso y terminado). No repinta nada.
- **Code (renderer, spec aparte)**: al montar, tras ver `isResuming() === true`, llama a
  `getResumeState()` y usa `pendingEntries` para reconstruir la vista de selección (lista +
  Priority_Order). Consume el resultado terminal por `result` y el progreso por
  `merge:onProgress` como ya hace (P-25). Este spec **no cierra** la mitad de Code: solo le
  entrega la forma de datos definida arriba.

## Testing Strategy

### Validation Approach

Primero se expone el hueco con un test que falla sobre el código sin arreglar (el
`ResumeState` no trae las entries), luego se verifica que el fix las expone y que el ciclo
de vida del resume y los caminos sin resume quedan inalterados.

### Exploratory Bug Condition Checking

**Goal**: Surfar un contraejemplo que demuestre el bug ANTES de implementar el fix, y
confirmar la causa raíz (el `ResumeState` no expone el candidato). Si se refutara, habría
que re-hipotetizar.

**Test Plan**: Con un `SqliteLocalStore` en memoria (`:memory:`), guardar una sesión
pendiente (`savePendingSession([...])`), construir el `StartupOutcome` con args de resume, y
aseverar que `readResumeState()` contiene las entries candidatas. Correr sobre el código sin
arreglar para observar el fallo (el campo no existe).

**Test Cases**:
1. **Resume con candidato no vacío**: `savePendingSession` con 3 entries y Priority_Order
   dispares; aseverar que `readResumeState().pendingEntries` es esas 3 entries ordenadas
   (falla sin el fix: el campo no existe).
2. **Resume con candidato vacío intencional**: `savePendingSession([])` (sesión activa,
   candidato `[]`); aseverar que `readResumeState().pendingEntries` es `[]` y el
   `ResumeState` no es `null` (falla sin el fix).
3. **Captura antes del clear**: disparar `runResume()` (que limpia el pending) y aseverar
   que `readResumeState().pendingEntries` sigue reflejando el candidato después (falla sin el
   fix: no hay captura).

**Expected Counterexamples**:
- `readResumeState()` no tiene `pendingEntries`; el renderer no tiene de dónde repintar.
- Causa confirmada: hueco de datos en el `ResumeState`, no timing puro.

### Fix Checking

**Goal**: Verificar que para todo arranque donde la bug condition se cumple (resume con
sesión pendiente activa), el `ResumeState` expuesto contiene el candidato correcto.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  outcome := runStartupSequence_fixed(input)
  state := outcome.readResumeState()
  ASSERT state != null
  ASSERT state.pendingEntries EQUALS input.pendingSession   // mismas entries, mismo orden
END FOR
```

### Preservation Checking

**Goal**: Verificar que para todo input donde la bug condition NO se cumple, el código
arreglado produce el mismo resultado observable que el original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT runStartupSequence_original(input).readResumeState()
       = runStartupSequence_fixed(input).readResumeState()
  // Además, para todo camino de resume:
  //  - resumePendingOperation sigue idempotente y limpia en el finally
  //  - getPendingSession() sigue distinguiendo null vs []
  //  - getResumeState().result sigue sirviendo el resultado terminal
END FOR
```

**Testing Approach**: El property-based testing es adecuado para la preservación: genera
muchos casos automáticamente (candidatos de cualquier tamaño y Priority_Order), cubre edge
cases y da garantías fuertes de que el comportamiento no cambió para los caminos no-buggy.

**Test Plan**: Observar el comportamiento del código sin arreglar para el arranque sin
resume y para el ciclo de vida del resume, y escribir tests que verifiquen que se mantiene.

**Test Cases**:
1. **Arranque sin resume**: sin args de resume, `readResumeState()` sigue devolviendo `null`
   (inalterado).
2. **Idempotencia + limpieza del resume**: tras `runResume()`, `getPendingSession()` del
   store devuelve `null` (se limpió en el `finally`); el `result` es terminal.
3. **Distinción null vs []**: `getPendingSession()` sigue devolviendo `null` sin sesión y
   `[]` con sesión activa vacía (test de `SqliteLocalStore` existente, verificar que no
   cambia).
4. **Resultado terminal sin duplicar canales**: `getResumeState().result` expone el
   `OperationResult` terminal; no se agregó ningún canal a `IPC_CHANNELS`/`L4d2Api`.

### Unit Tests

- **composition-root**: el `ResumeState` inicial incluye `pendingEntries` capturado del
  `getPendingSession()` antes del clear; con candidato no vacío y con `[]`.
- **composition-root**: tras `runResume()` (éxito y catch de excepción inesperada),
  `readResumeState().pendingEntries` sigue reflejando el candidato capturado, y `result` es
  el terminal correspondiente.
- **composition-root**: sin resume, `readResumeState()` es `null` (preservación).
- **ipc-handlers**: `activeSet:resumeState` retorna el `ResumeState` extendido tal cual lo
  entrega `getResumeState()`; no hay canal nuevo en `IPC_CHANNELS`.
- **merge-orchestrator** (regresión): `resumePendingOperation` sigue idempotente y limpia
  con `clearPendingSession()` en el `finally` (sin cambios).

### Property-Based Tests

- Con `fast-check` (mínimo 100 iteraciones): para cualquier Active_Set candidato persistido
  (lista arbitraria de `{ addonId, priorityOrder }`, incluida la lista vacía), tras construir
  el `StartupOutcome` con args de resume, `readResumeState().pendingEntries` contiene
  exactamente esas entries con su `priorityOrder`, en Priority_Order ascendente, para todo
  camino de resume (antes y después de `runResume()`).
- Generar candidatos con `priorityOrder` repetidos/desordenados y verificar que el orden
  expuesto coincide con el que `getPendingSession()` ya garantiza (ascendente por
  `priorityOrder`, luego `addonId`).

### Integration Tests

- Flujo completo de resume: persistir un candidato, construir el outcome con args de resume,
  correr `runResume()` y verificar que el `ResumeState` expuesto por el handler IPC contiene
  `pendingEntries` (el batch) + `result` terminal, todo por el mismo `activeSet:resumeState`.
- Cambio de forma de datos: ajustar cualquier test existente de composition-root/ipc que
  construya o asevere sobre `ResumeState` para incluir `pendingEntries` (el campo pasa a ser
  obligatorio cuando el objeto no es `null`).

---

## Nota de commit y trazabilidad

- **Commit** (formato CONTRIBUTING.md): `fix(main): exponer batch candidato en ResumeState para restaurar la selección tras UAC (bug BUG-007)`.
- **Registro en `Context/04-historial-decisiones.md`** referenciando P-25: "P-25 cerró
  progreso + `isResuming` end-to-end, pero el `ResumeState` no exponía el batch candidato
  para repintar la selección tras el relanzo elevado (BUG-007). Se extiende `ResumeState`
  con `pendingEntries: AddonManifestEntry[]`, capturado del `getPendingSession()` antes del
  `clearPendingSession()` del resume, sin agregar canal IPC nuevo (decisión del usuario). La
  mitad renderer (consumir `pendingEntries` para repintar) queda como follow-up de Code."
