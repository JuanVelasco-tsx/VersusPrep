# BUG-006 (el escaneo inicial SERIAL bloquea/congela la UI) — Diseño del Bugfix

## Overview

El escaneo inicial de la Workshop bloquea la UI ~45 s en una Workshop grande.
`AddonScanner.scan` (en `src/main/domain/addon-scanner.ts`) recorre TODOS los `.vpk`
de nivel superior en un bucle `for...await` estrictamente **serial**: por cada addon
lanza 1–2 procesos `vpk.exe` (`vpkTool.list` siempre; `vpkTool.extract` del
`addoninfo.txt` si existe) y cada addon **espera** al anterior. La concurrencia
efectiva es 1 y el tiempo total crece linealmente con N (12–17 s con 73 addons →
~45 s con ~200 addons, medido en `Context/02-pendientes.md`).

Este es un bug de **RENDIMIENTO / latencia**, no de corrección de datos. El fix
**no cambia QUÉ produce** el escaneo, solo **CÓMO recorre** los addons: pasa de serial
a un **pool de concurrencia ACOTADA**, reutilizando el patrón que ya existe en el
código (`classifyWithBoundedConcurrency` en `ipc-handlers.ts` y el pool de
`MergeEngine.preview`), con tamaño de pool `DEFAULT_VPK_CONCURRENCY = 4` (definido en
`src/main/domain/vpk-tool.ts`). El resultado debe ser **IDÉNTICO** al serial: misma
lista, **mismo orden**, misma metadata (`info`, `coverPath`) y mismo manejo
best-effort del `addoninfo` (fallo → `info: null`, sin abortar ni omitir addons).

Fuera de alcance (decisión explícita del usuario en `bugfix.md`): **NO** se toca el
renderer (zona del equipo "Code"), **NO** se agrega canal de progreso IPC, y **NO** se
usan `worker_threads` (el cuello de botella es la espera de procesos hijo `vpk.exe`,
no CPU del hilo main; la concurrencia acotada de promesas es suficiente y coherente
con el código existente).

## Glossary

- **Bug_Condition (C)**: La condición que dispara el defecto de rendimiento — el
  escaneo se ejecuta con concurrencia efectiva 1 (serial) sobre N addons, de modo que
  el tiempo total crece linealmente con N y produce latencia perceptible (Workshop
  grande ⇒ ~45 s). Ver `isBugCondition` más abajo.
- **Property (P)**: El comportamiento deseado para las entradas de C — el escaneo se
  ejecuta con concurrencia **acotada** (> 1, ≤ `DEFAULT_VPK_CONCURRENCY`), baja el
  tiempo total ~por el factor de concurrencia, y produce un resultado **exactamente
  igual** al serial (misma lista, mismo orden, misma metadata).
- **Preservation**: Todo el contrato de correctitud de `AddonScanner.scan` que NO debe
  cambiar (solo `.vpk` de nivel superior, `id` derivado del nombre, `coverPath`
  best-effort, `addoninfo` best-effort → `null` sin abortar/omitir, **orden idéntico**,
  sin pérdida/duplicación/reordenamiento).
- **`AddonScanner.scan`**: Método público `scan(workshopFolder: string): Promise<ScannedAddon[]>`
  en `src/main/domain/addon-scanner.ts`. Es el único símbolo cuyo cuerpo cambia. Su
  **firma pública (input/output) NO cambia**.
- **`ScannedAddon`**: Registro `{ id, vpkPath, coverPath, info }` que produce el
  escaneo por cada addon (en `src/main/domain/types.ts`). El fix no altera su forma ni
  cómo se construye cada campo.
- **`DEFAULT_VPK_CONCURRENCY`**: Constante compartida `= 4` (en
  `src/main/domain/vpk-tool.ts`) que fija cuántos procesos `vpk.exe` concurrentes se
  toleran. Es la **única** fuente del tamaño de pool; el fix la **reutiliza**, no
  introduce un número nuevo.
- **`classifyWithBoundedConcurrency`**: Patrón de referencia (función privada en
  `ipc-handlers.ts`) que paraleliza `vscriptDetector.classify` sobre una lista de
  addons con un **cursor compartido** (`let cursor = 0`), workers que toman
  `index = cursor++`, escriben en `results[index]` (preservando la posición, no el
  orden de finalización) y un pool `poolSize = Math.min(DEFAULT_VPK_CONCURRENCY, items.length)`.
  `MergeEngine.preview` replica el mismo patrón inline.
- **Concurrencia efectiva**: Cantidad máxima de invocaciones `vpk.exe` que pueden estar
  "en vuelo" simultáneamente durante el escaneo. Serial ⇒ 1; con el fix ⇒ acotada por
  el pool.
- **Preservación de orden por índice**: Técnica del patrón de referencia — cada addon
  se escribe en `results[index]`, donde `index` es su posición en el orden de entrada;
  así el orden del resultado es independiente del orden en que terminan los workers.
- **`F`**: Escaneo original (serial, `for...await`, concurrencia efectiva 1).
- **`F'`**: Escaneo corregido (pool acotado de tamaño `DEFAULT_VPK_CONCURRENCY`).

## Bug Details

### Bug Condition

El bug se manifiesta cuando la Workshop contiene N addons `.vpk` de nivel superior y el
escaneo los procesa en un bucle `for...await` estrictamente serial: cada addon espera a
que terminen las invocaciones `vpk.exe` (`list` y, si aplica, `extract`) del anterior.
La **concurrencia efectiva es 1**, nunca se solapan las esperas de procesos hijo, y el
tiempo total crece linealmente con N. Con N grande (~200) la latencia (~45 s) es
perceptible y la UI —que espera un único `await` sin resultados parciales— se percibe
congelada.

**Importante: este NO es un bug de datos.** El resultado del escaneo serial es
**correcto**. Lo que falla es el **tiempo** para producirlo. Por eso la formalización se
hace sobre el comportamiento observable de concurrencia/tiempo y sobre la **equivalencia
del resultado** entre serial y paralelo.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X = conjunto de N addons (.vpk de nivel superior) en la Workshop_Folder
  OUTPUT: boolean

  // F = AddonScanner.scan serial. Las invocaciones vpk.exe (list + extract) se
  // ejecutan una detras de otra: cada addon espera al anterior.
  RETURN concurrenciaEfectiva(F, X) = 1
         AND tiempoTotal(F, X) ≈ N * tiempoPromedioPorAddon
         AND N es suficientemente grande como para producir latencia perceptible
             (Workshop grande: ~200 addons ⇒ ~45 s medidos)
END FUNCTION
```

### Examples

- **Contraejemplo concreto medido:** Workshop con ~200 addons ⇒ el escaneo serial tarda
  ~45 s (extrapolado linealmente desde 12–17 s con 73 addons, `Context/02-pendientes.md`);
  esperado con el fix: ~11 s (~4×). Durante ese tiempo la UI no muestra avance.
- **73 addons (medido):** 12–17 s serial ⇒ esperado ~3–4 s con pool de 4.
- **Solapamiento de invocaciones (observable):** con el código actual, en cualquier
  instante hay **a lo sumo 1** `vpk.exe` en vuelo (concurrencia efectiva 1); esperado
  con el fix: hasta `DEFAULT_VPK_CONCURRENCY` (4) en vuelo, nunca más.
- **Edge case — Workshop vacía o sin `.vpk`:** esperado y actual coinciden → `[]` (no
  hay trabajo que paralelizar; la bug condition no se dispara porque N ≈ 0).
- **Equivalencia de resultado (invariante):** para la misma Workshop, la lista que
  produce el escaneo paralelo es **deep-equal y en el mismo orden** que la del serial.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors (lo que NO debe cambiar — clausulas 3.1–3.7 del `bugfix.md`):**

- **(3.1) Solo `.vpk` de nivel superior:** se incluyen ÚNICAMENTE los archivos `.vpk`
  ubicados directamente en la Workshop_Folder; subdirectorios y otras extensiones se
  siguen ignorando.
- **(3.2) `id` derivado del nombre:** para `<id>.vpk`, el `id` sigue siendo el nombre
  sin la extensión `.vpk`.
- **(3.3) Cover best-effort:** `coverPath = <id>.jpg` de la misma carpeta si existe,
  `null` si no. Sin cambios.
- **(3.4) Addoninfo best-effort por-addon:** cualquier fallo de la fase de metadata
  (`addoninfo` ausente del listado, `vpk l`/`vpk x` con exit ≠ 0, error de FS, texto
  malformado) sigue degradando a `info: null` **SIN abortar el escaneo completo ni
  omitir el addon**.
- **(3.5) ORDEN idéntico — FOCO CENTRAL DE LA PRESERVACIÓN:** el resultado debe preservar
  **exactamente** el orden de las entradas del listado del directorio. Al paralelizar,
  cada addon debe escribirse en su **posición original** (preservar índice, igual que
  `classifyWithBoundedConcurrency` con `results[index]`), de modo que el orden sea
  idéntico al del escaneo serial e independiente del orden en que terminen los workers.
- **(3.6) Sin pérdida/duplicación/reordenamiento:** cada `.vpk` de nivel superior aparece
  **exactamente una vez** en el resultado.
- **(3.7) Constante compartida:** el tamaño del pool es `DEFAULT_VPK_CONCURRENCY`
  (`vpk-tool.ts`), sin introducir un límite nuevo ni desincronizado respecto de los
  pools ya existentes (`classifyWithBoundedConcurrency`, `MergeEngine.preview`).

**Scope:**

Como el fix solo cambia el **mecanismo de recorrido** (serial → pool), la equivalencia
de resultado vale para **toda** entrada X (no solo para las de la bug condition): la
lista, el orden y la metadata de `F'(X)` son idénticos a los de `F(X)`. En particular,
NO se ven afectados:

- La forma de `ScannedAddon` ni cómo se construye cada campo (`id`, `vpkPath`,
  `coverPath`, `info`).
- La lógica interna de los helpers privados `#resolveCover` y `#readAddonInfoSafely`
  (incluido su try/catch best-effort): **no cambian**.
- El renderer ("Code"), el handler IPC y el resto del pipeline: **no se tocan**.
- La firma pública de `scan` (mismo input `workshopFolder`, mismo output
  `Promise<ScannedAddon[]>`).

_Nota:_ el comportamiento correcto para las entradas de la bug condition (concurrencia
> 1 acotada + resultado idéntico) se define en **Correctness Properties** (Property 1).
Esta sección se centra en lo que **no** debe cambiar.

## Hypothesized Root Cause

A diferencia de un bugfix con causa por confirmar, aquí la causa raíz está
**CONFIRMADA** (leída en el código y medida end-to-end, ver `bugfix.md` y
`Context/02-pendientes.md`). Se lista la estructura de análisis marcando el hallazgo:

1. **Bucle de escaneo estrictamente serial (causa raíz confirmada)**: `AddonScanner.scan`
   usa `for (const entry of entries) { ... await this.#resolveCover(...); await this.#readAddonInfoSafely(...); ... }`.
   Los `await` dentro del bucle serializan las invocaciones `vpk.exe`: cada addon espera
   al anterior ⇒ concurrencia efectiva 1 ⇒ tiempo lineal en N.

2. **Asimetría con la fase posterior (evidencia clave)**: la clasificación VScript
   POSTERIOR ya está paralelizada con `classifyWithBoundedConcurrency`
   (`ipc-handlers.ts`), y `MergeEngine.preview` también usa un pool. El escaneo inicial
   es el único que quedó serial. Esa asimetría confirma que el patrón de solución ya
   existe y es reutilizable.

3. **"Freeze" percibido = latencia + ausencia de feedback (contribuye, pero fuera de
   alcance)**: el handler IPC es un único `await` y el renderer un único `Promise.all`,
   sin progreso parcial. Reducir la latencia ~4× ataca la causa dominante; el feedback
   de progreso queda explícitamente fuera de alcance de este fix.

4. **I/O síncrono bloqueante (descartado como causa)**: todo el camino usa
   `node:fs/promises` y `execFile` async; no hay `readFileSync`/`execSync`/`spawnSync`.
   El event loop NO está técnicamente bloqueado; el problema es la latencia total del
   escaneo serial, no un bloqueo del hilo.

## Correctness Properties

Property 1: Bug Condition - Escaneo paralelizado idéntico al serial, con concurrencia acotada

_For any_ Workshop_Folder donde la bug condition se cumple (`isBugCondition` retorna
`true`: N addons procesados en serie), el escaneo corregido `F'` (`AddonScanner.scan`
con pool de tamaño `DEFAULT_VPK_CONCURRENCY`) SHALL producir una lista de `ScannedAddon`
**exactamente igual** a la del escaneo serial `F` —misma cantidad, **mismo orden**
(el del listado del directorio) y misma metadata (`info`, `coverPath`) por addon—, y
SHALL ejecutar las invocaciones `vpk.exe` con concurrencia efectiva **> 1 y acotada por
el pool** (nunca más de `DEFAULT_VPK_CONCURRENCY` en vuelo), reduciendo el tiempo total
aproximadamente por el factor de concurrencia.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - El contrato de correctitud de scan no cambia

_For any_ Workshop_Folder (independientemente de si la bug condition se cumple), el
escaneo corregido `F'` SHALL producir un resultado idéntico al original `F` en todas las
garantías de correctitud: solo `.vpk` de nivel superior (subdirectorios y otras
extensiones ignorados), `id` derivado del nombre, `coverPath` best-effort (`<id>.jpg` o
`null`), `addoninfo` best-effort que degrada a `info: null` sin abortar ni omitir el
addon, **orden idéntico al serial** (escritura por índice, sin
pérdida/duplicación/reordenamiento), y uso de la constante compartida
`DEFAULT_VPK_CONCURRENCY` como tamaño de pool.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Causa raíz confirmada. El fix reemplaza el bucle serial de `AddonScanner.scan` por un
recorrido en **dos fases**: (1) construcción secuencial y barata del orden de resultado,
y (2) llenado paralelo acotado que preserva ese orden por índice. Los helpers privados
**no cambian**.

**File**: `src/main/domain/addon-scanner.ts`

**Símbolo**: método público `AddonScanner.scan`. Su **firma NO cambia**
(`scan(workshopFolder: string): Promise<ScannedAddon[]>`).

#### Fase 1 — Recolección secuencial de candidatos (barata, SIN `vpk.exe`)

Recorrer `entries` **en orden** y quedarse con los que pasan el filtro actual
(`!entry.isDirectory` **y** `addonIdFromVpkName(entry.name) !== null`). Por cada
candidato se computa lo barato y determinista: `{ id, vpkPath }` (con
`joinWindowsPath(workshopFolder, entry.name)`). Esta fase **define el orden final del
resultado ANTES de paralelizar**, porque las entradas ignoradas (subdirectorios,
no-`.vpk`) **no ocupan lugar** en el resultado.

Como los ignorados no ocupan posición, la forma más simple y correcta es:

```
const candidates = entries
  .filter((e) => !e.isDirectory)                         // AC 2.1/2.2
  .map((e) => ({ e, id: addonIdFromVpkName(e.name) }))
  .filter((c) => c.id !== null)                          // AC 2.1 (no-.vpk)
  .map((c) => ({ id: c.id, vpkPath: joinWindowsPath(workshopFolder, c.e.name) }));
```

El **índice de cada candidato en `candidates` ES su posición final** en el array
`ScannedAddon[]` de resultado. Este `filter/map` preserva el orden de `entries`, así que
el orden final es idéntico al del recorrido serial actual (que emitía en ese mismo
orden).

> Nota: no se requiere `vpk.exe` en esta fase; es puro filtrado/derivación de nombres.
> Se mantiene barata y secuencial a propósito.

#### Fase 2 — Llenado paralelo con concurrencia ACOTADA (preservando índice)

Un pool tipo `classifyWithBoundedConcurrency`: un array `results: ScannedAddon[]` de
longitud `candidates.length`, un **cursor compartido** `let cursor = 0`, y
`poolSize = Math.min(DEFAULT_VPK_CONCURRENCY, candidates.length)` workers. Cada worker
hace:

```
async function worker() {
  for (;;) {
    const index = cursor++;
    const candidate = candidates[index];
    if (candidate === undefined) return;                 // fuera de rango → fin
    const coverPath = await this.#resolveCover(workshopFolder, candidate.id);
    const info = await this.#readAddonInfoSafely(candidate.vpkPath, candidate.id);
    results[index] = { id: candidate.id, vpkPath: candidate.vpkPath, coverPath, info };
  }
}
await Promise.all(Array.from({ length: poolSize }, () => worker()));
return results;
```

La escritura en `results[index]` (posición original del candidato) garantiza el **orden
idéntico al serial**, independientemente del orden en que terminen los workers.

**CLAVE de correctitud — manejo de errores por-addon inalterado:** `#readAddonInfoSafely`
**ya** está envuelto en un `try/catch` que degrada a `null`. La paralelización **no
cambia** ese manejo: un fallo de metadata de un addon devuelve `info: null` para ese
addon y **no afecta a los demás ni aborta el pool**. `#resolveCover` es igualmente
best-effort (usa `fs.exists`, que devuelve `false` en vez de lanzar). Por eso ningún
worker propaga una excepción que pueda romper el `Promise.all` durante el escaneo normal;
el contrato best-effort por-addon se preserva tal cual (AC 3.4).

> Precisión sobre `Promise.all`: como cada iteración del worker está protegida por el
> try/catch interno de `#readAddonInfoSafely` y por la semántica no-lanzante de
> `#resolveCover`, no se espera rechazo. (El único rechazo posible del escaneo sigue
> siendo el de `listEntries` en Fase 1 —fuera del pool—, que ya hoy propaga porque sin
> listado no hay escaneo; ese comportamiento se preserva.)

#### Decisión: dónde vive el helper del pool

`classifyWithBoundedConcurrency` está en `ipc-handlers.ts` (capa `app`) y está acoplada
a `VScriptDetector`/`VScriptClassification`; no es reutilizable directamente desde el
dominio. Hay dos opciones:

- **(a)** Extraer un helper genérico y puro `mapWithBoundedConcurrency<T, R>(items, limit, fn)`
  a un módulo compartido del dominio, y refactorizar `classifyWithBoundedConcurrency`
  **y** `MergeEngine.preview` para usarlo, además de `AddonScanner.scan`.
- **(b)** Implementar el pool **inline** en `AddonScanner.scan`, replicando el patrón
  (como ya hacen `classifyWithBoundedConcurrency` y `MergeEngine.preview`), y dejar una
  nota de deuda técnica para unificar los tres pools más adelante.

**Recomendación: opción (b) — pool inline en `AddonScanner`.** Justificación:

- El objetivo de BUG-006 es un fix **mínimo y de bajo riesgo** de rendimiento. La opción
  (a) toca **tres** sitios (scanner + classify + merge-engine) y su superficie de
  refactor y de regresión excede el alcance del bug.
- Ya existe **precedente deliberado** de replicar el patrón inline: `MergeEngine.preview`
  lo replica en vez de compartir con `classifyWithBoundedConcurrency`. Añadir un tercer
  uso inline es coherente con el estado actual del código y no empeora la consistencia.
- El patrón es corto (~10 líneas) y está bien entendido; el riesgo de duplicarlo una vez
  más es menor que el de refactorizar dos consumidores estables que hoy pasan sus tests.
- Se documenta la **deuda técnica**: cuando exista una tercera repetición estable
  (esta), es el momento natural para, en un cambio separado, extraer
  `mapWithBoundedConcurrency<T, R>` genérico y migrar los tres pools bajo la cobertura de
  sus tests existentes. Esa unificación queda **fuera de alcance** de BUG-006.

> Si en revisión se prefiriera la opción (a), sería aceptable **solo** si se extrae una
> función pura genérica `mapWithBoundedConcurrency<T, R>(items, limit, fn)` y se
> refactoriza `classifyWithBoundedConcurrency` para delegar en ella, apoyándose en sus
> tests existentes para cubrir la regresión. El diseño juzga que ese scope adicional no
> se justifica para este bug y recomienda (b).

**Sin cambios**:
- `#resolveCover` y `#readAddonInfoSafely`: **no cambia su lógica interna** (siguen siendo
  best-effort; `#readAddonInfoSafely` conserva su try/catch → `null`).
- La firma pública de `scan`, la interfaz `AddonFileSystem`, `DirEntry`, `ScannedAddon`
  y los helpers `addonIdFromVpkName`/`joinWindowsPath`: **no cambian**.
- `DEFAULT_VPK_CONCURRENCY` es la constante usada como tamaño de pool (importada de
  `vpk-tool.ts`); **no** se introduce un número nuevo (AC 3.7).
- El renderer, el handler IPC y el resto del pipeline: **no se tocan**.

## Testing Strategy

### Validation Approach

Dos fases: primero surfacear un contraejemplo que demuestre que el escaneo actual es
serial (concurrencia efectiva 1) sobre el código sin arreglar, y luego verificar que el
fix (1) alcanza concurrencia acotada > 1 y (2) preserva **exactamente** el resultado
(lista, orden y metadata) del escaneo serial. El grueso de la validación es **unit +
property test** con fakes deterministas en memoria (rápidos, sin `vpk.exe` real). El test
de rendimiento contra tiempos reales es **opcional/skippeable**. El renderer queda
**fuera de alcance** (no se testea).

### Exploratory Bug Condition Checking

**Goal**: Surfacear un contraejemplo que demuestre el bug ANTES del fix — que el escaneo
actual ejecuta las invocaciones `vpk.exe` con **concurrencia efectiva 1** (nunca se
solapan) — y confirmar la causa raíz (bucle serial).

**Test Plan**: Inyectar un `VpkTool` (o `CommandRunner`) **fake instrumentado** que mida
el solapamiento de invocaciones concurrentes:

- Un contador `inFlight` que se **incrementa** al entrar a `list`/`extract` y se
  **decrementa** al resolver; se registra el **máximo** observado (`maxInFlight`).
- Cada invocación **no resuelve de inmediato**: cede al event loop (p. ej. resuelve en un
  `setTimeout(0)`/microtask/tick) para que, si hubiera paralelismo, dos invocaciones
  puedan estar en vuelo a la vez.
- Se ejecuta `scan` con varios addons (p. ej. 8) y se asevera el paralelismo.

Sobre el **código sin arreglar** (serial), `maxInFlight` es **1**: una aserción de
`maxInFlight > 1` **FALLA** (demuestra el bug). Tras el fix, `maxInFlight` es **> 1 y
≤ `DEFAULT_VPK_CONCURRENCY`**: la misma aserción **PASA**.

**Test Cases**:
1. **Serialidad actual (fallará al aseverar paralelismo)**: con ≥ 5 addons, `maxInFlight === 1`
   en el código sin arreglar (aseverar `> 1` falla).
2. **Cota superior del fix**: tras el fix, `maxInFlight <= DEFAULT_VPK_CONCURRENCY`
   siempre (el pool nunca lanza de más).

**Expected Counterexamples**:
- En el código sin arreglar, jamás hay 2 invocaciones `vpk.exe` en vuelo al mismo tiempo
  (`maxInFlight = 1`), confirmando concurrencia efectiva 1.

### Fix Checking

**Goal**: Verificar que para toda entrada de la bug condition, el escaneo corregido
produce el mismo resultado que el serial y con concurrencia acotada.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  resultado := scan_fixed(X)                     // pool DEFAULT_VPK_CONCURRENCY
  ASSERT resultado == scan_serial_referencia(X)  // deep-equal Y mismo orden
  ASSERT 1 < maxInFlight(scan_fixed, X) <= DEFAULT_VPK_CONCURRENCY
END FOR
```

### Preservation Checking

**Goal**: Verificar que para toda entrada (dispare o no la bug condition), el escaneo
corregido produce un resultado idéntico al serial de referencia en lista, orden y
metadata.

**Pseudocode:**
```
FOR ALL X DO
  ASSERT scan_fixed(X) == scan_serial_referencia(X)   // deep-equal Y mismo orden
  ASSERT maxInFlight(scan_fixed, X) <= DEFAULT_VPK_CONCURRENCY
END FOR
```

**Testing Approach**: El property-based testing (fast-check, ≥ `MIN_NUM_RUNS` ≈ 100
iteraciones, vía el helper `test/helpers/property.ts` ya existente) es adecuado para la
preservación porque genera muchas Workshops arbitrarias (mezcla de subdirectorios,
no-`.vpk`, `.vpk` con/sin cover, `addoninfo` que existe/falla) y cubre edge cases de
orden y de fallos intercalados que los unit tests puntuales podrían omitir. El **valor
esperado** se computa desde un **modelo independiente** (o desde una referencia serial
determinista construida a partir de los mismos fakes), NO desde el código bajo prueba —
mismo enfoque que el `addon-scanner.property.test.ts` actual.

**Test Plan**: Reutilizar los fakes en memoria del estilo de `addon-scanner.property.test.ts`
/ `addon-scanner.test.ts`: un `AddonFileSystem` en memoria (mapa directorio → entradas y
conjunto de rutas existentes para el cover) y un `VpkTool`/`CommandRunner` **determinista**
(controla qué `addoninfo` aparece y cuáles fallan). Para cada Workshop generada, comparar
`scan` (fix) contra el resultado serial de referencia.

**Test Cases**:
1. **Equivalencia total (deep-equal + orden)**: para Workshops arbitrarias, `scan`
   paralelo == referencia serial (misma lista, mismo orden, misma metadata).
2. **Cota de concurrencia**: `maxInFlight <= DEFAULT_VPK_CONCURRENCY` en toda corrida.

### Unit Tests

- **Orden preservado con fallo intercalado**: lista de addons donde el `addoninfo` de un
  addon del **medio** falla (→ `info: null`); el resto queda intacto y el **orden** es el
  del listado (verifica escritura por índice, no por finalización).
- **Addon sin cover**: `<id>.jpg` ausente ⇒ `coverPath === null`, addon igualmente listado.
- **Filtrado**: subdirectorios y archivos no-`.vpk` se ignoran; solo `.vpk` de nivel
  superior en el resultado.
- **Lista vacía**: Workshop sin entradas (o sin `.vpk`) ⇒ `scan` devuelve `[]` (y el pool
  no lanza workers: `poolSize = Math.min(DEFAULT_VPK_CONCURRENCY, 0) = 0`).
- **Concurrencia acotada**: con más addons que el pool, `maxInFlight <= DEFAULT_VPK_CONCURRENCY`;
  con menos addons que el pool, `maxInFlight <= candidates.length`.
- **`id` y `vpkPath`**: `id` derivado del nombre y `vpkPath = joinWindowsPath(...)`
  idénticos al serial.
- **Regresión**: los tests existentes `addon-scanner.test.ts` y
  `addon-scanner.property.test.ts` deben **seguir pasando sin modificación** (son la red
  de seguridad de que el resultado no cambió).

### Property-Based Tests

- (fast-check, ≥ `MIN_NUM_RUNS`) Para Workshops arbitrarias (subdirs + no-`.vpk` + `.vpk`
  con/sin cover + `addoninfo` ok/fallando en posiciones aleatorias): `scan` paralelo es
  **deep-equal y en el mismo orden** que el escaneo serial de referencia.
- Property de **cota de concurrencia**: la concurrencia máxima observada nunca supera
  `DEFAULT_VPK_CONCURRENCY` (importando la constante, sin duplicar el literal).
- Property de **sin pérdida/duplicación/reordenamiento**: la secuencia de `id` del
  resultado coincide exactamente con la de los `.vpk` de nivel superior en el orden del
  listado.

### Integration Tests (rendimiento — OPCIONAL / skippeable)

- **Opcional y skippeable**: el fix **no** depende de `vpk.exe` real. Si se incluye una
  validación de tiempo, usar un `VpkTool` **fake con delay artificial** por invocación
  (p. ej. `await delay(D)`), ejecutar `scan` con N addons y verificar que el tiempo total
  con pool es ~`(N / DEFAULT_VPK_CONCURRENCY) * D`, es decir cerca de ~4× más rápido que
  el serial de referencia (con tolerancia amplia para evitar flakiness).
- No es necesario `vpk.exe` real ni la ruta `VPK_EXE_PATH`; si un test de integración
  contra el binario real se agregara, seguiría el patrón skippeable de
  `test/vpk-tool.integration.test.ts` (se salta con `describe.skip` si el binario no está).

**Fuera de alcance de testing**: el renderer (`AddonList.tsx`), el handler IPC y el canal
de progreso. No se testean en este fix (coherente con el alcance decidido).
