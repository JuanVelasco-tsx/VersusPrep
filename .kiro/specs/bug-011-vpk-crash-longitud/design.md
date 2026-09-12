# BUG-011 (crash de `vpk.exe` por LONGITUD de la línea de comando) — Diseño del Bugfix

## Overview

`vpk.exe` crashea con `STATUS_STACK_BUFFER_OVERRUN` (`exit 3221226505` = `0xC0000409`)
durante la extracción (`vpk x <vpk> <paths...>`) cuando la línea de comando de la
invocación supera un límite interno del propio binario. Hay **dos vectores
independientes** que lo disparan, ambos medidos contra el `vpk.exe` real:

1. **Por CANTIDAD de argumentos** (~80 paths, incluso cortos). Este vector **ya está
   cubierto** por el límite de cantidad `DEFAULT_MAX_BATCH_SIZE = 50` en
   `src/main/domain/vpk-batch.ts`.
2. **Por LONGITUD total de la línea de comando** (el vector NO cubierto). Con paths
   largos la línea de comando total supera el buffer real de `vpk.exe` y el binario
   crashea, aunque el lote respete **ambos** límites configurados (≤50 paths **y**
   ≤6000 caracteres).

El bug concreto: **`DEFAULT_MAX_COMMAND_LENGTH = 6000` está MAL CALIBRADO.** Ese valor
se eligió con margen respecto del máximo de línea de comando de `cmd` de Windows
(~8191 caracteres), pero `vpk.exe` se desborda **mucho antes** que ese máximo del
sistema operativo. Medición contra el `vpk.exe` real con **overhead de producción
realista** (~159 chars fijos: ejecutable ~71 chars + ruta del VPK ~85 chars):
último valor sano medido **1719 caracteres → OK**; primer crash **2031 caracteres →
`0xC0000409`**. El umbral real está en la ventana **(1719, 2031]**.

> **Nota sobre mediciones previas.** Una medición anterior (con rutas cortas de
> `tmpdir`) ubicaba el umbral en ~1600/~3130 chars, pero **subestimaba el overhead
> fijo** de producción (rutas de ejecutable y de VPK reales, mucho más largas). Los
> números vigentes de este diseño son los remedidos con overhead de producción:
> **1719 sano / 2031 crash**.

El fix es una **recalibración de una única constante**: bajar
`DEFAULT_MAX_COMMAND_LENGTH` a un valor empírico seguro, con margen generoso por
debajo del umbral de crash observado, y reescribir el JSDoc de la constante para que
la justificación refleje que el límite ahora es sobre el **buffer real de `vpk.exe`**,
no sobre el máximo de `cmd` de Windows. No cambia la fórmula del modelo de costo ni el
límite de cantidad; el fix **solo baja el techo de longitud**.

## Glossary

- **Bug_Condition (C)**: La condición que dispara el bug — existe al menos un lote
  producido por el particionado actual cuya línea de comando queda por debajo de
  **ambos** límites configurados (≤ `maxBatchSize = 50` y ≤ `DEFAULT_MAX_COMMAND_LENGTH = 6000`)
  pero **aun así** excede el límite real de `vpk.exe`.
- **Property (P)**: El comportamiento deseado — ningún lote producido por el
  particionado corregido dispara el crash por longitud; la extracción completa con
  `exit 0`.
- **Preservation**: Todo el contrato de batching que NO debe cambiar (doble límite
  vigente, `maxBatchSize = 50` intacto, sin pérdida/duplicación/reordenamiento, path
  sobredimensionado aislado, entrada vacía → `[]`, greedy y determinista, fórmula de
  costo intacta).
- **`batchInternalPaths`**: Función pura en `src/main/domain/vpk-batch.ts` que
  particiona los paths internos de un VPK en lotes que respetan simultáneamente los
  dos límites (longitud y cantidad).
- **`commandLengthForBatch`**: Función pura en `src/main/domain/vpk-batch.ts` que
  calcula el costo (longitud estimada de la línea de comando) de un lote:
  `len("<exe> x <vpk>") + Σ (1 + len(path))`. Única fuente de verdad del modelo de
  costo. **No cambia** con este fix.
- **`DEFAULT_MAX_COMMAND_LENGTH`**: Techo de longitud (en caracteres) por lote. Es la
  **única constante que este fix recalibra**.
- **`DEFAULT_MAX_BATCH_SIZE`**: Techo de cantidad de paths por lote (= 50). **No
  cambia** con este fix.
- **`LIMITE_REAL_SEGURO_VPK`**: Referencia empírica del máximo de caracteres de línea
  de comando que `vpk.exe` tolera sin crashear, medido contra el binario real con
  **overhead de producción** (~159 chars fijos: ejecutable ~71 chars + ruta del VPK
  ~85 chars). Valores observados: **último sano medido 1719 caracteres** / **primer
  crash 2031 caracteres** (`0xC0000409`, estable). El umbral real está en la ventana
  **(1719, 2031]**; como referencia segura conservadora se toma **1719**. Es un margen
  empírico, no un número documentado por Valve.
- **`F`**: Particionado original (`batchInternalPaths` con `DEFAULT_MAX_COMMAND_LENGTH = 6000`).
- **`F'`**: Particionado corregido (con `DEFAULT_MAX_COMMAND_LENGTH` recalibrado).

## Bug Details

### Bug Condition

El bug se manifiesta cuando un addon tiene un conjunto de paths internos cuya
invocación `vpk x <vpk> <paths...>` produce una línea de comando que supera el límite
real de `vpk.exe` (`LIMITE_REAL_SEGURO_VPK`, umbral observado en la ventana
(1719, 2031]: último sano 1719 caracteres / primer crash 2031 caracteres) **pero** que
respeta ambos límites configurados (≤ 50 paths **y** ≤ 6000 caracteres). El
particionado `batchInternalPaths` **no parte**
ese lote y entrega a `vpk x` una línea de comando sobredimensionada que el binario no
tolera. El binario es quien se desborda y aborta, no el Manager.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X = (vpkPath, internalPaths)   // un addon y sus paths internos a extraer
  OUTPUT: boolean

  // LIMITE_REAL_SEGURO_VPK: referencia empírica del máximo tolerado por vpk.exe,
  // medido con overhead de producción (~159 chars fijos: exe ~71 + vpkPath ~85).
  // Umbral en la ventana (1719, 2031]: último sano 1719 chars, primer crash 2031 chars.
  // Referencia segura conservadora = 1719.
  batches ← batchInternalPaths(X.internalPaths, X.vpkPath)   // límites ACTUALES (6000, 50)
  RETURN EXISTS lote ∈ batches TAL QUE
           lote.length ≤ 50
           AND commandLengthForBatch(lote, X.vpkPath) ≤ 6000
           AND commandLengthForBatch(lote, X.vpkPath) > LIMITE_REAL_SEGURO_VPK
END FUNCTION
```

### Examples

- **Contraejemplo concreto medido:** una línea de comando total de ~2031 caracteres
  (con overhead de producción) → esperado `exit 0` (extracción completa); actual:
  `vpk.exe` crashea con `0xC0000409`, pese a respetar ≤ 50 paths y ≤ 6000 caracteres.
- **Addon 627562239 (reportado por QA):** paths internos largos (subcarpetas
  profundas) → esperado extracción completa con `exit 0`; actual: crash `0xC0000409`
  al extraerlo por separado, con el síntoma engañoso de "1 mod falla / 2+ funciona".
- **Tabla de longitud total de línea de comando (medida contra `vpk.exe` real,
  overhead de producción):** 679, 991, 1199, 1407, 1719 caracteres → `exit 0` (OK);
  2031, 2239, 2759, 3279 caracteres → crash `0xC0000409` (`STATUS_STACK_BUFFER_OVERRUN`,
  estable). Último sano medido: **1719**. Primer crash: **2031**.
- **Lote de ~1719 caracteres o menos:** esperado y actual coinciden → `exit 0`
  (por debajo del umbral real; no dispara la bug condition).
- **Edge case — un solo path muy largo (> techo de longitud):** esperado y tras el
  fix idéntico → se coloca en su propio lote individual (garantía (c)), sin
  descartarlo ni truncarlo; el fix no cambia este comportamiento.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors (lo que NO debe cambiar):**

- El **doble límite simultáneo** (cantidad + longitud) sigue vigente: un lote es
  válido solo si respeta AMBOS; el que primero se alcance corta el lote.
- El límite por cantidad `DEFAULT_MAX_BATCH_SIZE = 50` queda **exactamente igual**
  (el fix no lo toca).
- El particionado sigue **sin perder, duplicar ni reordenar** paths: concatenar los
  lotes en orden reproduce exactamente `internalPaths` (garantía (b)).
- Un path que por sí solo excede el límite de longitud se sigue colocando en su
  **propio lote individual**, sin descartarlo ni truncarlo (garantía (c)).
- `internalPaths` vacío sigue devolviendo `[]` (cero lotes), sin lotes vacíos.
- El particionado sigue siendo **greedy** (recorre en orden, acumula mientras quepa)
  y **determinista** (misma entrada → misma partición).
- El **modelo de costo** `commandLengthForBatch` no cambia: misma fórmula
  `len("<exe> x <vpk>") + Σ (1 + len(path))`. El fix solo baja el techo, no la fórmula.

**Scope:**

Todos los conjuntos de paths cuya línea de comando ya quedaba por debajo del nuevo
techo recalibrado (`¬C(X)`) deben producir **exactamente la misma partición** con `F'`
que con `F`. En particular, no se ven afectados:

- Lotes cortos (pocos paths o paths cortos) cuya línea de comando ya era ≤ nuevo techo.
- El comportamiento del límite por cantidad (50).
- El empaquetado (`pack`), el listado (`list`) y cualquier otra operación de `VpkTool`.
- El renderer ("Code"): no se toca.

_Nota:_ el comportamiento correcto para las entradas de la bug condition se define en
la sección **Correctness Properties** (Property 1). Esta sección se centra en lo que
**no** debe cambiar.

## Hypothesized Root Cause

A diferencia de un bugfix con causa por confirmar, aquí la causa raíz está
**confirmada empíricamente** (hechos medidos contra `vpk.exe` real). Se lista igual la
estructura de análisis, marcando el hallazgo:

1. **Constante de longitud mal calibrada (causa raíz confirmada)**: `DEFAULT_MAX_COMMAND_LENGTH = 6000`
   se calibró contra el máximo de `cmd` de Windows (~8191), no contra el buffer real
   de `vpk.exe`. El binario se desborda mucho antes: con overhead de producción,
   1719 chars OK, 2031 chars crashea. El techo de 6000 permite armar lotes que
   crashean el binario.

2. **Premisa de QA engañosa (descartada como causa)**: "1 mod falla / 2+ funciona" es
   circunstancial al **contenido** del addon 627562239 (paths internos largos), no a
   la cantidad de mods. Cada addon se extrae por separado con su propia invocación
   `vpk x`; no existe una rama especial de "1 addon". El test exploratorio confirmó
   que el `argv` de 1 path y de N paths es estructuralmente idéntico salvo por la
   cantidad de paths.

3. **Vector por cantidad (ya cubierto, no es esta causa)**: `vpk.exe` también crashea
   por demasiados argumentos (~80), pero eso ya lo cubre `DEFAULT_MAX_BATCH_SIZE = 50`.
   El crash de BUG-011 ocurre con pocos paths (bastante por debajo de 50) cuando estos
   son largos, así que el límite por cantidad no lo previene: el disparador es la
   LONGITUD total de la línea de comando, no el conteo de argumentos.

4. **Modelo de costo (correcto, no es la causa)**: la fórmula `commandLengthForBatch`
   es una aproximación conservadora válida; el problema no es cómo se mide la longitud,
   sino que el **techo** contra el que se compara es demasiado alto.

## Correctness Properties

Property 1: Bug Condition - Los lotes producidos respetan el límite real de `vpk.exe`

_For any_ entrada donde la bug condition se cumple (`isBugCondition` retorna `true`),
el particionado corregido `F'` (con `DEFAULT_MAX_COMMAND_LENGTH` recalibrado) SHALL
producir lotes cuya línea de comando estimada (`commandLengthForBatch`) sea
≤ `DEFAULT_MAX_COMMAND_LENGTH` recalibrado —y por tanto cómodamente por debajo del
umbral de crash real de `vpk.exe`—, de modo que la extracción complete sin disparar
`0xC0000409` por longitud. Único caso exento: un path que por sí solo excede el techo,
que se aísla en su propio lote (garantía (c)).

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - El resto del contrato de batching no cambia

_For any_ entrada donde la bug condition NO se cumple (`isBugCondition` retorna
`false`), el particionado corregido `F'` SHALL producir un resultado equivalente al
original `F` en todo lo que no sea el techo de longitud: mismo doble límite vigente,
`maxBatchSize = 50` sin cambios, sin pérdida/duplicación/reordenamiento (garantía (b)),
path sobredimensionado aislado (garantía (c)), entrada vacía → `[]`, greedy y
determinista, y misma fórmula de costo.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Causa raíz confirmada; el fix es una recalibración de constante + reescritura de su
JSDoc.

**File**: `src/main/domain/vpk-batch.ts`

**Símbolo**: constante `DEFAULT_MAX_COMMAND_LENGTH` (y su JSDoc). El encabezado del
archivo también menciona "~8191" y "quoting/escaping" en la explicación del modelo de
costo: hay que reescribir esa justificación para que ya no diga que el margen es
respecto del máximo de `cmd` de Windows.

**Specific Changes**:

1. **Recalibrar el valor de la constante**: cambiar
   `export const DEFAULT_MAX_COMMAND_LENGTH = 6000;` a
   `export const DEFAULT_MAX_COMMAND_LENGTH = 1024;`.

   **Justificación del número exacto (1024):** el valor final SE MANTIENE en **1024**
   (ya aceptado y sigue siendo seguro). La justificación se reescribe con los números
   correctos remedidos con overhead de producción:
   - Umbral real observado (overhead de producción): **1719 caracteres → OK**;
     **2031 caracteres → crashea** (`0xC0000409`).
   - 1024 queda **por debajo del último valor sano medido (1719)** con ~40 % de holgura,
     y es **menos de la mitad del primer crash observado (2031)**. Esto deja colchón
     ante variaciones del binario o del entorno (rutas de VPK más largas, distinto
     build de `vpk.exe`).
   - Sigue siendo un valor "redondo" (potencia de 2) coherente con el criterio
     conservador ya aplicado a `DEFAULT_MAX_BATCH_SIZE = 50` (margen empírico, no un
     número documentado por Valve).
   - Un lote que rozara el techo 1024, con techo aplicado se parte en varios lotes,
     cada uno holgadamente por debajo del umbral de crash real (2031).

2. **Reescribir el JSDoc de `DEFAULT_MAX_COMMAND_LENGTH`**: la justificación actual
   dice que el valor se fija "cómodamente por debajo del máximo real de Windows para
   `cmd` (~8191), dejando margen para el quoting/escaping". Esa premisa es falsa para
   `vpk.exe`. El nuevo JSDoc debe explicar que:
   - El límite real no es el de `cmd` de Windows sino el **buffer interno de `vpk.exe`**,
     que se desborda con `STATUS_STACK_BUFFER_OVERRUN` (`0xC0000409`) mucho antes del
     máximo del SO.
   - Es un **margen empírico conservador** (no documentado por Valve), medido contra el
     binario real con overhead de producción: 1719 chars seguro / 2031 chars crashea;
     se elige 1024 por debajo del seguro con holgura (~40 %).
   - Referenciar BUG-011 como origen de la recalibración.

3. **Actualizar el encabezado del archivo (modelo de costo)**: reescribir el párrafo
   que menciona "~6000 vs ~8191" y "máximo real de Windows (~8191 caracteres para
   `cmd`)" para que el límite por longitud se describa como el buffer real de
   `vpk.exe`, no el de `cmd`. La naturaleza aproximada/conservadora del modelo de costo
   se mantiene tal cual; solo cambia contra qué máximo se compara. Si se citan números,
   usar los remedidos con overhead de producción (1719 sano / 2031 crash), nunca los
   viejos ~1600/~3130.

**Sin cambios**:
- `commandLengthForBatch` (fórmula del modelo de costo): **no se toca**.
- `DEFAULT_MAX_BATCH_SIZE = 50`: **no se toca**.
- La lógica de `batchInternalPaths`: **no se toca** (solo consume la constante).
- La firma pública y las opciones (`BatchInternalPathsOptions`): **no cambian**;
  `maxCommandLength` sigue siendo sobreescribible por invocación.

**File (ajuste menor opcional)**: `src/main/domain/vpk-tool.ts`

- El comentario de `extract` menciona particionar "para que ninguna línea de comando
  exceda el límite seguro". Es genérico y no menciona ~8191, así que el ajuste es
  opcional: si se toca, solo para aclarar que el "límite seguro" es el buffer real de
  `vpk.exe` (BUG-011). No hay cambio de comportamiento en este archivo.

**No** se toca renderer.

### Riesgo conocido / nota de precisión del modelo de costo

Durante la remedición se detectó una **subestimación sistemática del overhead del
ejecutable** en el modelo de costo del batching. Se documenta como hallazgo importante
y riesgo conocido; **no** se corrige en BUG-011 (fix mínimo = solo recalibrar la
constante).

**El hallazgo:**

- `VpkTool.extract` invoca al `CommandRunner` con `this.#vpkExe`, que es la **ruta real
  de `vpk.exe`** (~71 chars en producción, p. ej.
  `C:\Program Files (x86)\Steam\steamapps\common\left 4 dead 2\bin\vpk.exe`).
- **Pero** `commandLengthForBatch` usa por defecto `DEFAULT_EXECUTABLE_NAME = "vpk.exe"`
  (7 chars) para estimar el overhead del ejecutable, porque `VpkTool.extract` **NO le
  pasa el ejecutable real** al llamar a `batchInternalPaths` (usa las opciones por
  defecto, sin `options.executableName`).
- **Consecuencia:** el modelo de costo del batching **SUBESTIMA el overhead del
  ejecutable en ~64 chars** (~71 reales − 7 por defecto) en producción, **siempre**. Es
  decir, la longitud real de la línea de comando en producción es **~64 chars MAYOR**
  que la estimada por `commandLengthForBatch`.

**Por qué NO es necesario corregirlo para BUG-011:**

- Con el techo 1024, la subestimación queda holgadamente absorbida por el margen: un
  lote estimado en 1024 tendría en producción ~1024 + 64 = **~1088 chars reales**, muy
  por debajo del último valor sano medido (**1719**) y aún más lejos del primer crash
  (**2031**).
- Por eso **no** hace falta cambiar la firma ni pasar el ejecutable real para cerrar
  BUG-011: el margen conservador de 1024 ya cubre la subestimación.

**Nota para el futuro (decisión explícita de NO hacerlo ahora):**

- Si en el futuro se quisiera **subir el techo cerca del umbral real**, habría que
  corregir esta subestimación pasando el ejecutable real (`this.#vpkExe`) a
  `batchInternalPaths` vía `options.executableName`, para que `commandLengthForBatch`
  estime el overhead correcto.
- Para BUG-011 se **decide NO hacerlo**: se mantiene el fix mínimo (solo recalibrar la
  constante), y el margen conservador de 1024 cubre la subestimación de ~64 chars.

## Testing Strategy

### Validation Approach

Enfoque en dos fases: primero surfacear el contraejemplo que demuestra el bug sobre el
código sin arreglar, luego verificar que el fix parte correctamente los lotes y que
preserva el resto del contrato de batching. El grueso de la validación es **unit +
property test** (puros, rápidos, sin `vpk.exe`); el test de integración contra el
binario real es **skippeable** y confirma el fix de punta a punta.

### Exploratory Bug Condition Checking

**Goal**: Surfacear contraejemplos que demuestran el bug ANTES del fix y confirmar la
causa raíz. Ya existe evidencia recogida por `test/bug-011-exploratory.integration.test.ts`
(que mide el umbral por longitud contra `vpk.exe` real).

**Test Plan**: Sobre el particionado ACTUAL (`DEFAULT_MAX_COMMAND_LENGTH = 6000`),
construir un conjunto de paths cuya línea de comando total (con overhead de
producción) quede por encima del umbral real (≥ 2031 chars) y observar que
`batchInternalPaths` lo deja en **un solo lote** cuya `commandLengthForBatch` es
> `LIMITE_REAL_SEGURO_VPK` (1719) pero ≤ 6000 y ≤ 50 paths — es decir, que la bug
condition se cumple con los límites actuales. En integración (real), observar que ese
lote hace crashear a `vpk.exe` con `0xC0000409`.

**Test Cases**:
1. **Contraejemplo por longitud (puro)**: paths que produzcan una línea de comando de
   ~2031 chars → con techo 6000 queda en 1 lote > 1719 chars (demuestra
   `isBugCondition = true`).
2. **Umbral por longitud (integración real, skippeable)**: invocar `vpk x` directo con
   longitud total creciente y ubicar el punto de crash (ya presente en el test
   exploratorio; ventana medida (1719, 2031]).

**Expected Counterexamples**:
- Un lote cuya línea de comando total sea ≥ 2031 caracteres (≤ 6000, ≤ 50 paths) que
  `vpk.exe` rechaza con `exit 3221226505` (`0xC0000409`).
- Confirma que la causa es la LONGITUD, no la cantidad ni una rama especial de
  "1 vs N".

### Fix Checking

**Goal**: Verificar que para todas las entradas donde la bug condition se cumple, el
particionado corregido produce lotes por debajo del nuevo techo (y del umbral real).

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  batches ← batchInternalPaths(X.internalPaths, X.vpkPath)   // con techo recalibrado (1024)
  FOR ALL lote ∈ batches DO
    ASSERT commandLengthForBatch(lote, X.vpkPath) ≤ DEFAULT_MAX_COMMAND_LENGTH   // = 1024
           // salvo garantía (c): un path que por sí solo excede el techo va aislado.
  END FOR
END FOR
```

### Preservation Checking

**Goal**: Verificar que para todas las entradas donde la bug condition NO se cumple, el
particionado corregido produce el mismo resultado estructural que el original en todo
lo que no sea el techo de longitud.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT garantías de F'(X) equivalentes a F(X):
         doble límite vigente, maxBatchSize=50 sin cambios,
         concatenación de lotes reproduce internalPaths (b),
         path sobredimensionado aislado (c), entrada vacía → [],
         greedy y determinista, fórmula de costo intacta.
END FOR
```

**Testing Approach**: El property-based testing (fast-check, ≥ 100 iteraciones) es
adecuado para la preservación porque genera muchos casos automáticamente a través del
dominio de entrada, cubre edge cases que los unit tests puntuales podrían omitir y da
garantías fuertes de que el contrato de batching no cambia. El modelo del test compara
directamente contra `DEFAULT_MAX_COMMAND_LENGTH` importado (sin duplicar el literal).

**Test Cases**:
1. **Preservación de longitud**: con el nuevo techo, ningún lote producido por
   `batchInternalPaths` excede `DEFAULT_MAX_COMMAND_LENGTH` (salvo garantía (c)).
2. **Preservación sin pérdida (b)**: concatenar los lotes en orden reproduce
   exactamente `internalPaths` (misma cantidad, mismo orden, sin duplicados).
3. **Preservación de cantidad**: ningún lote supera `maxBatchSize = 50`.
4. **Determinismo**: misma entrada → misma partición en corridas repetidas.
5. **Entrada vacía**: `internalPaths = []` → `[]`.
6. **Path sobredimensionado (c)**: un path que por sí solo excede el techo queda
   aislado en su propio lote, sin descartarlo ni truncarlo.

### Unit Tests

- Verificar que `DEFAULT_MAX_COMMAND_LENGTH` es el nuevo valor recalibrado (1024) y que
  `DEFAULT_MAX_BATCH_SIZE` sigue siendo 50.
- Partición del contraejemplo (paths que rocen/superen el umbral real, ~2031 chars de
  línea de comando total) con el nuevo techo → varios lotes, cada uno ≤ 1024.
- Edge cases: entrada vacía → `[]`; un solo path corto → 1 lote; path único
  sobredimensionado → 1 lote aislado.
- `commandLengthForBatch` sin cambios (misma salida para las mismas entradas).

### Property-Based Tests

- (fast-check, ≥ 100 iteraciones) Generar listas arbitrarias de paths y verificar que
  **ningún** lote producido con el nuevo techo excede `DEFAULT_MAX_COMMAND_LENGTH`
  (salvo garantía (c)).
- Property de preservación: concatenar lotes reproduce la entrada (sin
  pérdida/duplicación/reordenamiento).
- Property de determinismo: dos particionados de la misma entrada son iguales.
- Property de entrada vacía → `[]`.

### Integration Tests

- **Skippeable** (patrón de `test/vpk-tool.integration.test.ts` y
  `test/bug-011-exploratory.integration.test.ts`): solo corre si existe `VPK_EXE_PATH`
  (`C:\Program Files (x86)\Steam\steamapps\common\left 4 dead 2\bin\vpk.exe`); en su
  ausencia se salta con `describe.skip` en vez de fallar.
- Empaquetar un fixture con paths internos largos que reproduzca el contraejemplo
  (línea de comando total en el orden del umbral real, ~2031 chars) y extraerlo con
  `VpkTool.extract` (que aplica `batchInternalPaths` con el nuevo techo). Verificar:
  - Se particiona en **varios lotes** (más de uno), cada uno con
    `commandLengthForBatch ≤ 1024`.
  - **Ninguna** invocación `vpk x` crashea: todos los `exit 0`.
  - La extracción completa sin error y escribe todos los archivos en disco.
- **Usar un `vpkPath` de longitud representativa de producción (~85 chars)** para que la
  validación end-to-end refleje el overhead real. Con ruta de VPK corta (p. ej. de
  `tmpdir`) el overhead se subestima y el test dejaría de ser representativo del crash
  observado en producción (ver "Riesgo conocido / nota de precisión del modelo de
  costo"). Recordar además que `commandLengthForBatch` subestima el overhead del
  ejecutable en ~64 chars, por lo que la longitud real en producción es mayor que la
  estimada.
- Confirmar que fixtures ya cubiertos (muchos archivos cortos, archivos con espacios)
  siguen extrayéndose con `exit 0` (preservación de punta a punta).
