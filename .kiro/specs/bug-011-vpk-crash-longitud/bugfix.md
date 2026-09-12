# Documento de Requisitos del Bugfix

## Introduction

BUG-011 (Alta), reportado en QA V3 (jornada 2). Al aplicar mods, `vpk.exe` **crashea** durante la extracción con el error real capturado:

```
vpk extract falló para el addon "627562239" (exit 3221226505)
```

donde `3221226505 = 0xC0000409 = STATUS_STACK_BUFFER_OVERRUN`: es el propio binario `vpk.exe` el que se desborda y aborta, no un fallo del Manager.

**La premisa del reporte de QA es ENGAÑOSA.** QA describió el síntoma como "aplicar un único mod lanza error; con 2+ mods funciona", sugiriendo una supuesta rama especial de "1 addon vs 2+ addons". La investigación demostró que esa premisa **NO es la causa**:

- El test de integración exploratorio (`test/bug-011-exploratory.integration.test.ts`), ejecutado contra el `vpk.exe` **real**, confirmó que extraer **1 solo archivo NO crashea**, y que el `argv` construido para 1 path y para N paths es **estructuralmente idéntico** salvo por la cantidad de paths (mismo prefijo `["x", <vpk>, ...paths]`, sin argumentos vacíos ni malformados).
- No existe ninguna rama especial de "1 addon" en el código: en el motor de merge cada addon se extrae **por separado**, con su propia invocación `vpk x`. El "1 vs 2+" observado por QA es **circunstancial al CONTENIDO del addon 627562239** (sus paths internos largos cruzan el umbral real de crash dentro de su propio lote); los otros addons de la prueba de QA no tenían paths lo bastante largos, por eso "parecía" que la cantidad de mods importaba.

**Causa raíz confirmada (hechos medidos contra `vpk.exe` real, no hipótesis).** `vpk x` crashea con `STATUS_STACK_BUFFER_OVERRUN` (`0xC0000409`) cuando la línea de comando de la invocación supera un límite interno del binario. Hay **dos vectores independientes** que lo disparan:

1. **Por CANTIDAD de argumentos.** Se observó el primer crash alrededor de ~80 paths (incluso paths cortos). Este vector **SÍ está cubierto** por el límite de cantidad `DEFAULT_MAX_BATCH_SIZE = 50` en `src/main/domain/vpk-batch.ts`: lotes de 50 paths cortos → `exit 0`.
2. **Por LONGITUD total de la línea de comando (el vector NO cubierto).** Con solo ~20 paths **largos** (~152 caracteres cada uno, ~3130 caracteres totales) `vpk.exe` **ya crashea**, aun cuando la **cantidad** (20) queda muy por debajo de `maxBatchSize = 50` **y** la **longitud** (~3130) queda muy por debajo de `DEFAULT_MAX_COMMAND_LENGTH = 6000`.

El bug concreto: **`DEFAULT_MAX_COMMAND_LENGTH = 6000` está MAL CALIBRADO.** Ese valor se eligió con margen respecto del máximo de la línea de comando de `cmd` de Windows (~8191), pero `vpk.exe` se desborda **mucho antes** que ese máximo del sistema operativo. En la máquina de prueba: ~1600 caracteres → OK; ~3130 caracteres → ya crashea. Un addon con paths internos largos (subcarpetas profundas, común en addons reales como el 627562239) produce un lote que respeta **ambos** límites configurados (≤50 paths **y** ≤6000 caracteres) pero **igual excede el buffer real de `vpk.exe`** → crash `0xC0000409`.

**Alcance (SOLO capa main/dominio).** Este spec es autocontenido y no toca el renderer ("Code"):

- Archivo principal: `src/main/domain/vpk-batch.ts` — la constante `DEFAULT_MAX_COMMAND_LENGTH` y, si el diseño lo decide, el modelo de costo `commandLengthForBatch`.
- Posiblemente ajustes menores en comentarios de `vpk-tool.ts`.
- **No** se toca renderer.

**Dirección del fix (a precisar en diseño; aquí solo se encuadra).** Recalibrar `DEFAULT_MAX_COMMAND_LENGTH` a un valor **empírico seguro**, bien por debajo del umbral de crash observado (~1600 seguro / ~3130 crashea en esta máquina), con margen generoso hacia abajo (criterio conservador, el mismo ya aplicado a `DEFAULT_MAX_BATCH_SIZE`). Un valor de referencia de ~1024 deja amplio margen bajo el ~1600 seguro; el diseño fija el número exacto y lo justifica. Se **mantiene** el doble límite simultáneo (cantidad + longitud): el fix **solo** recalibra el de longitud; el de cantidad (50) queda igual. El modelo de costo (`commandLengthForBatch`) sigue siendo una aproximación conservadora válida; solo baja el techo. Se documentará que el límite de longitud, como el de cantidad, es un margen empírico conservador (no un número documentado por Valve) y por qué se elige por debajo del crash observado con margen.

La formalización de la bug condition C(X) y la elección del número exacto se detallan en la fase de diseño. Este documento solo describe el comportamiento observado, el esperado y el que debe preservarse.

### Formalización de la Bug Condition (metodología bug condition)

Sea `F` el particionado actual (`batchInternalPaths` con `DEFAULT_MAX_COMMAND_LENGTH = 6000`) y `F'` el particionado tras recalibrar el límite de longitud.

**Bug Condition C(X)** — identifica los conjuntos de paths que disparan el crash:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X = (vpkPath, internalPaths)  // un addon y sus paths internos a extraer
  OUTPUT: boolean

  // Existe al menos un lote producido por el particionado ACTUAL cuya línea de
  // comando queda por debajo de AMBOS límites configurados (≤ maxBatchSize=50 y
  // ≤ DEFAULT_MAX_COMMAND_LENGTH=6000) pero AUN ASÍ excede el límite REAL de
  // vpk.exe (umbral de crash observado, entre ~1600 seguro y ~3130 crashea).
  batches ← batchInternalPaths(X.internalPaths, X.vpkPath)  // límites actuales
  RETURN EXISTS lote ∈ batches TAL QUE
           lote.length ≤ 50
           AND commandLengthForBatch(lote, X.vpkPath) ≤ 6000
           AND commandLengthForBatch(lote, X.vpkPath) > LIMITE_REAL_SEGURO_VPK
END FUNCTION
```

**Contraejemplo concreto medido:** ~20 paths de ~152 caracteres cada uno (~3130 caracteres totales) → `vpk.exe` crashea con `0xC0000409`, pese a ser 20 paths (< 50) y ~3130 caracteres (< 6000).

**Property (Fix Checking)** — comportamiento correcto para las entradas de C(X):

```pascal
// Ningún lote producido por el particionado corregido dispara el crash por longitud.
FOR ALL X WHERE isBugCondition(X) DO
  batches ← F'(X.internalPaths, X.vpkPath)   // con DEFAULT_MAX_COMMAND_LENGTH recalibrado
  FOR ALL lote ∈ batches DO
    ASSERT commandLengthForBatch(lote, X.vpkPath) ≤ DEFAULT_MAX_COMMAND_LENGTH (recalibrado)
           // salvo la garantía (c): un path que por sí solo excede el límite va aislado.
  END FOR
  ASSERT extract(F') NO produce exit 0xC0000409 por longitud
END FOR
```

**Preservation (Preservation Checking)** — para todo lo que NO dispara el bug, el comportamiento se mantiene:

```pascal
// El fix SOLO baja el techo de longitud; el resto del contrato de batching no cambia.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT estructura y garantías de F'(X) equivalentes a F(X):
         doble límite vigente, maxBatchSize=50 sin cambios, sin pérdida/duplicación/reordenamiento,
         path sobredimensionado aislado, entrada vacía → [], greedy y determinista.
END FOR
```

## Bug Analysis

### Current Behavior (Defect)

Comportamiento actual del particionado y la extracción con `DEFAULT_MAX_COMMAND_LENGTH = 6000`.

1.1 WHEN un addon tiene un conjunto de paths internos cuya invocación `vpk x <vpk> <paths...>` produce una línea de comando que supera el límite REAL de `vpk.exe` (umbral observado: ~1600 caracteres seguro, ~3130 caracteres ya crashea) pero que respeta AMBOS límites configurados (≤50 paths Y ≤6000 caracteres) THEN el sistema `batchInternalPaths` NO parte ese lote y entrega a `vpk x` una línea de comando sobredimensionada.

1.2 WHEN `vpk.exe` recibe esa línea de comando sobredimensionada por LONGITUD THEN el sistema (el binario `vpk.exe`) crashea con `STATUS_STACK_BUFFER_OVERRUN` (`exit 3221226505` = `0xC0000409`) y la extracción falla.

1.3 WHEN un addon con paths internos largos (subcarpetas profundas, como el 627562239) se extrae por separado THEN el sistema dispara el crash aunque otros addons de la misma operación se extraigan sin problema, produciendo el síntoma engañoso de "1 vs 2+ mods" que en realidad depende del CONTENIDO del addon y no de la cantidad de mods.

### Expected Behavior (Correct)

Comportamiento correcto para las mismas condiciones que disparan el bug.

2.1 WHEN un addon tiene un conjunto de paths internos (incluidos paths largos) THEN el sistema `batchInternalPaths` SHALL partir esos paths en lotes cuya línea de comando quede por debajo del límite REAL seguro de `vpk.exe`, recalibrando `DEFAULT_MAX_COMMAND_LENGTH` a un valor empírico seguro con margen generoso por debajo del umbral de crash observado (valor exacto a fijar en diseño; referencia ~1024).

2.2 WHEN se extrae cualquier addon tras el fix THEN el sistema SHALL completar la extracción sin que `vpk.exe` dispare NUNCA el crash `0xC0000409` por longitud de línea de comando.

2.3 WHEN el addon 627562239 (u otro con paths internos largos) se extrae tras el fix THEN el sistema SHALL completar con `exit 0`, con independencia de cuántos mods se apliquen en la operación.

### Unchanged Behavior (Regression Prevention)

Comportamiento existente que el fix NO debe romper. El fix SOLO recalibra el límite de longitud.

3.1 WHEN se particionan paths THEN el sistema SHALL CONTINUAR aplicando el DOBLE límite simultáneo (cantidad + longitud): un lote es válido solo si respeta AMBOS, y el que primero se alcance corta el lote.

3.2 WHEN se aplica el límite por cantidad THEN el sistema SHALL CONTINUAR usando `DEFAULT_MAX_BATCH_SIZE = 50` sin cambios (el fix no toca el límite de cantidad).

3.3 WHEN se particiona cualquier lista de paths THEN el sistema SHALL CONTINUAR sin perder, duplicar ni reordenar paths: concatenar los lotes en orden reproduce exactamente `internalPaths` (garantía (b)).

3.4 WHEN un path por sí solo excede el límite de longitud THEN el sistema SHALL CONTINUAR colocándolo en su propio lote individual sin descartarlo ni truncarlo (garantía (c)).

3.5 WHEN `internalPaths` está vacío THEN el sistema SHALL CONTINUAR devolviendo `[]` (cero lotes), sin generar lotes vacíos.

3.6 WHEN se particiona THEN el sistema SHALL CONTINUAR siendo greedy (recorre en orden, acumula mientras quepa) y determinista (misma entrada → misma partición).

3.7 WHEN se calcula el costo de un lote THEN el sistema SHALL CONTINUAR usando el modelo de costo `commandLengthForBatch` como aproximación conservadora válida; el fix solo baja el techo (`DEFAULT_MAX_COMMAND_LENGTH`), no cambia la fórmula del modelo.
