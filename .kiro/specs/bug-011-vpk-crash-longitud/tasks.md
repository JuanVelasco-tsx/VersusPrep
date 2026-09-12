# Implementation Plan: BUG-011 (crash de `vpk.exe` por LONGITUD de la línea de comando)

## Overview

Este plan sigue la metodología de bugfix por *bug condition*: primero se surface el
contraejemplo que demuestra el bug sobre el código SIN arreglar (Property 1), luego se
capturan las garantías a preservar (Property 2), después se aplica el fix mínimo
(recalibrar `DEFAULT_MAX_COMMAND_LENGTH` a **1024**) y finalmente se valida que el bug
queda resuelto y que no hay regresiones.

Referencias vigentes de umbral (medidas contra `vpk.exe` real con overhead de
producción): **último valor sano 1719 chars / primer crash 2031 chars** (`0xC0000409`).
El techo 1024 queda ~40 % por debajo de 1719.

---

## Tasks

- [ ] 1. Escribir el test de exploración de la Bug Condition (ANTES del fix)
  - **Property 1: Bug Condition** - Los lotes superan el límite real de `vpk.exe`
  - **CRÍTICO**: este test DEBE FALLAR sobre el código sin arreglar (con
    `DEFAULT_MAX_COMMAND_LENGTH = 6000`) — su fallo confirma que el bug existe.
  - **NO intentar arreglar el test ni el código cuando falle** en esta tarea.
  - **NOTA**: este test codifica el comportamiento esperado; cuando pase tras el fix
    (tarea 3.2) validará que el bug quedó resuelto.
  - **OBJETIVO**: surfacear el contraejemplo que demuestra el bug.
  - **Enfoque PBT acotado (bug determinista)**: acotar la propiedad al caso concreto
    reproducible — un conjunto de paths internos largos cuya línea de comando total
    (con overhead de producción) quede en el orden del umbral real (~2031 chars),
    respetando AMBOS límites actuales (≤ 50 paths **y** ≤ 6000 chars).
  - Construir la entrada usando un `vpkPath` de longitud representativa de producción
    (~85 chars) para que el overhead reflejado sea realista.
  - Aserción esperada (comportamiento correcto): con el particionado, todo lote debe
    tener `commandLengthForBatch(lote, vpkPath) ≤ LIMITE_REAL_SEGURO_VPK` (1719).
  - Ejecutar sobre el código SIN arreglar (techo 6000): `batchInternalPaths` deja el
    conjunto en **un solo lote** con `commandLengthForBatch > 1719` (≤ 6000, ≤ 50).
  - **RESULTADO ESPERADO**: el test FALLA (correcto — prueba que la bug condition se
    cumple: `isBugCondition` retorna `true`).
  - Documentar los contraejemplos hallados (p. ej. "lote de N paths largos con línea de
    comando ~2031 chars quedó sin partir, por encima de 1719").
  - Marcar la tarea como completada cuando el test esté escrito, ejecutado y su fallo
    documentado.
  - Ubicación sugerida: `test/vpk-batch.test.ts` (test unitario/property puro, sin
    `vpk.exe`).
  - _Requirements: 1.1, 1.2, 2.1_

- [ ] 2. Escribir los property tests de Preservación (ANTES del fix)
  - **Property 2: Preservation** - El resto del contrato de batching no cambia
  - **IMPORTANTE**: seguir la metodología *observación primero*.
  - Observar sobre el código SIN arreglar el comportamiento para entradas donde
    `isBugCondition` retorna `false` (conjuntos cuya línea de comando ya quedaba por
    debajo del nuevo techo):
    - Concatenar los lotes en orden reproduce exactamente `internalPaths` (garantía (b)).
    - Ningún lote supera `DEFAULT_MAX_BATCH_SIZE = 50` paths.
    - Un path que por sí solo excede el techo queda aislado en su propio lote (garantía (c)).
    - `internalPaths = []` → `[]`.
    - Determinismo: misma entrada → misma partición en corridas repetidas.
  - Escribir property tests con fast-check que capturen esos patrones observados.
  - **RESULTADO ESPERADO**: los tests PASAN sobre el código SIN arreglar (confirman el
    comportamiento base a preservar).
  - Marcar la tarea como completada cuando los tests estén escritos, ejecutados y
    pasando sobre el código sin arreglar.
  - Ubicación sugerida: `test/vpk-batch.test.ts`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 3. Fix para el crash de `vpk.exe` por longitud (recalibrar el techo de longitud)

  - [ ] 3.1 Recalibrar `DEFAULT_MAX_COMMAND_LENGTH` a 1024 y reescribir su JSDoc + el
        encabezado del archivo
    - En `src/main/domain/vpk-batch.ts`, cambiar
      `export const DEFAULT_MAX_COMMAND_LENGTH = 6000;` a
      `export const DEFAULT_MAX_COMMAND_LENGTH = 1024;`.
    - Reescribir el JSDoc de `DEFAULT_MAX_COMMAND_LENGTH`: el límite NO es el máximo de
      `cmd` de Windows (~8191) sino el **buffer interno real de `vpk.exe`**, que se
      desborda con `STATUS_STACK_BUFFER_OVERRUN` (`0xC0000409`) mucho antes del máximo
      del SO. Es un **margen empírico conservador** (no documentado por Valve), medido
      contra el binario real con overhead de producción: **1719 chars seguro / 2031
      chars crashea**; se elige **1024** por debajo del seguro con ~40 % de holgura.
      Referenciar **BUG-011** como origen de la recalibración.
    - Reescribir el párrafo del encabezado del archivo que menciona "~6000 vs ~8191" y
      "máximo real de Windows (~8191 caracteres para `cmd`)": el límite por longitud se
      describe como el **buffer real de `vpk.exe`**, no el de `cmd`. Mantener la
      naturaleza aproximada/conservadora del modelo de costo. Si se citan números, usar
      los remedidos con overhead de producción (**1719 sano / 2031 crash**), nunca los
      viejos ~1600/~3130.
    - **Sin cambios**: `commandLengthForBatch` (fórmula), `DEFAULT_MAX_BATCH_SIZE = 50`,
      la lógica de `batchInternalPaths`, la firma pública y `BatchInternalPathsOptions`.
    - **No** se toca el renderer.
    - _Bug_Condition: isBugCondition(X) — existe lote ≤ 50 paths y ≤ 6000 chars pero con commandLengthForBatch > LIMITE_REAL_SEGURO_VPK (1719)_
    - _Expected_Behavior: para todo lote de F', commandLengthForBatch(lote, vpkPath) ≤ DEFAULT_MAX_COMMAND_LENGTH (1024), salvo garantía (c)_
    - _Preservation: doble límite vigente, maxBatchSize=50, garantías (b) y (c), entrada vacía → [], greedy/determinista, fórmula de costo intacta_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.2 (Opcional) Aclarar el comentario de `extract` en `vpk-tool.ts`
    - **Tarea OPCIONAL / menor**: sin cambio de comportamiento.
    - En `src/main/domain/vpk-tool.ts`, aclarar el comentario de `extract` sobre
      particionar para no exceder el "límite seguro": precisar que ese límite es el
      **buffer real de `vpk.exe`** (BUG-011), no el máximo de `cmd` de Windows.
    - _Requirements: 2.1_

  - [ ] 3.3 Verificar que el test de exploración de la Bug Condition ahora pasa
    - **Property 1: Expected Behavior** - Los lotes respetan el límite real de `vpk.exe`
    - **IMPORTANTE**: reejecutar el MISMO test de la tarea 1 — NO escribir un test nuevo.
    - El test de la tarea 1 codifica el comportamiento esperado; cuando pasa, confirma
      que se satisface el Expected Behavior.
    - Ejecutar el test de exploración de la tarea 1 sobre el código YA arreglado (techo
      1024).
    - **RESULTADO ESPERADO**: el test PASA (confirma que el bug quedó resuelto: el lote
      del contraejemplo ahora se parte en varios lotes, cada uno ≤ 1024).
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.4 Verificar que los property tests de Preservación siguen pasando
    - **Property 2: Preservation** - El resto del contrato de batching no cambia
    - **IMPORTANTE**: reejecutar los MISMOS tests de la tarea 2 — NO escribir tests nuevos.
    - Ejecutar los property tests de preservación de la tarea 2 sobre el código
      arreglado.
    - **RESULTADO ESPERADO**: los tests PASAN (confirma que no hay regresiones).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 4. Tests unitarios del particionado con el nuevo techo
  - Verificar que `DEFAULT_MAX_COMMAND_LENGTH === 1024` y que
    `DEFAULT_MAX_BATCH_SIZE === 50` (sin cambios).
  - Partición del contraejemplo: paths largos que producirían una línea de comando total
    ~2031 chars con el techo anterior → con el nuevo techo se parte en **varios lotes**,
    cada uno con `commandLengthForBatch ≤ 1024`.
  - Edge cases:
    - `internalPaths = []` → `[]` (cero lotes).
    - Un solo path corto → 1 lote.
    - Un path único sobredimensionado (por sí solo excede 1024) → 1 lote aislado, sin
      descartarlo ni truncarlo (garantía (c)).
  - `commandLengthForBatch` sin cambios: misma salida para las mismas entradas (fórmula
    `len("<exe> x <vpk>") + Σ (1 + len(path))`).
  - Ubicación sugerida: `test/vpk-batch.test.ts`.
  - _Requirements: 2.1, 2.2, 3.2, 3.3, 3.4, 3.5, 3.7_

- [ ] 5. Property tests con fast-check (≥ 100 iteraciones)
  - Importar `DEFAULT_MAX_COMMAND_LENGTH` (y `DEFAULT_MAX_BATCH_SIZE`) desde el módulo —
    **no** duplicar el literal 1024.
  - **Techo de longitud**: para listas arbitrarias de paths, ningún lote producido por
    `batchInternalPaths` con el nuevo techo excede `DEFAULT_MAX_COMMAND_LENGTH` (salvo la
    garantía (c): un path que por sí solo excede el techo va aislado).
  - **Preservación sin pérdida (b)**: concatenar los lotes en orden reproduce
    exactamente `internalPaths` (misma cantidad, mismo orden, sin duplicados).
  - **Determinismo**: dos particionados de la misma entrada son iguales.
  - **Entrada vacía**: `internalPaths = []` → `[]`.
  - Ubicación sugerida: `test/vpk-batch.test.ts`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 6. Test de integración SKIPPEABLE contra `vpk.exe` real
  - Seguir el patrón de `test/vpk-tool.integration.test.ts` y
    `test/bug-011-exploratory.integration.test.ts`: solo corre si existe `VPK_EXE_PATH`
    (`C:\Program Files (x86)\Steam\steamapps\common\left 4 dead 2\bin\vpk.exe`); en su
    ausencia, `describe.skip` en vez de fallar.
  - Empaquetar un fixture con paths internos largos que reproduzca el contraejemplo
    (línea de comando total en el orden del umbral real, ~2031 chars).
  - Copiar/ubicar el VPK en un `vpkPath` de **longitud representativa de producción
    (~85 chars)** para que la validación end-to-end refleje el overhead real (con ruta
    corta el overhead se subestima y el test deja de ser representativo del crash de
    producción).
  - Extraer con `VpkTool.extract` (que aplica `batchInternalPaths` con el nuevo techo) y
    verificar:
    - Se particiona en **varios lotes** (más de uno), cada uno con
      `commandLengthForBatch ≤ 1024`.
    - **Ninguna** invocación `vpk x` crashea: todos con `exit 0`.
    - La extracción completa sin error y escribe todos los archivos en disco.
  - Confirmar que fixtures ya cubiertos (muchos archivos cortos, archivos con espacios)
    siguen extrayéndose con `exit 0` (preservación de punta a punta).
  - _Requirements: 2.2, 2.3_

- [ ] 7. Checkpoint — Verificación final y registro de la decisión
  - Ejecutar `npm run typecheck` y `npm run test` (vitest run) — ambos en verde.
  - Asegurar que todos los tests pasan; ante dudas o fallos, consultar al usuario.
  - Registrar la decisión en `Context/04-historial-decisiones.md`:
    - Recalibración de `DEFAULT_MAX_COMMAND_LENGTH` de 6000 → 1024.
    - Premisa de QA "1 mod falla / 2+ funciona" engañosa (circunstancial al contenido del
      addon 627562239, no a la cantidad de mods).
    - Umbral remedido con overhead de producción: **1719 sano / 2031 crash**
      (`0xC0000409`), reemplaza la medición previa ~1600/~3130.
    - Riesgo conocido NO corregido en BUG-011: el batching subestima el overhead del
      ejecutable ~64 chars porque `VpkTool.extract` no pasa `this.#vpkExe` a
      `batchInternalPaths` (usa `DEFAULT_EXECUTABLE_NAME`); cubierto por el margen de 1024.
  - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

---

## Task Dependency Graph

(Grafo de dependencias de tareas)

```
1 (exploración Bug Condition — FALLA sin fix)
2 (preservación — PASA sin fix)
        │
        ▼
3.1 (recalibrar constante + JSDoc + encabezado)  ← núcleo del fix
        │
        ├──► 3.2 (opcional: comentario en vpk-tool.ts)
        ├──► 3.3 (reejecutar test tarea 1 → ahora PASA)
        └──► 3.4 (reejecutar tests tarea 2 → siguen PASANDO)
        │
        ▼
4 (unit tests) ──┐
5 (property tests fast-check) ──┤
6 (integración skippeable) ─────┤
        │                       │
        ▼                       ▼
7 (checkpoint: typecheck + test + registro de decisión)
```

### Olas de ejecución (waves)

Definición estructurada de las olas de ejecución derivadas del grafo anterior. Cada ola
agrupa las tareas que pueden ejecutarse una vez satisfechas sus dependencias:

```json
{
  "waves": [
    {
      "wave": 1,
      "description": "Sin dependencias — se ejecutan sobre el código SIN arreglar",
      "tasks": ["1", "2"],
      "dependsOn": []
    },
    {
      "wave": 2,
      "description": "Núcleo del fix — recalibrar la constante",
      "tasks": ["3.1"],
      "dependsOn": ["1", "2"]
    },
    {
      "wave": 3,
      "description": "Derivadas del fix núcleo (verificaciones y aclaración opcional)",
      "tasks": ["3.2", "3.3", "3.4"],
      "dependsOn": ["3.1"]
    },
    {
      "wave": 4,
      "description": "Dependen del fix — paralelizables entre sí",
      "tasks": ["4", "5", "6"],
      "dependsOn": ["3.1"]
    },
    {
      "wave": 5,
      "description": "Cierre — depende de todas las olas anteriores",
      "tasks": ["7"],
      "dependsOn": ["3.2", "3.3", "3.4", "4", "5", "6"]
    }
  ]
}
```

## Notes

- Las tareas **1** y **2** deben completarse ANTES del fix (tarea 3), sobre el código sin
  arreglar.
- La tarea **3.2** es **opcional** (aclaración de comentario, sin cambio de comportamiento).
- Las tareas **4, 5 y 6** dependen del fix (3.1) y pueden desarrollarse en paralelo.
- La tarea **7** es el cierre: requiere todas las anteriores en verde.
