# Implementation Plan: BUG-006 (el escaneo inicial SERIAL bloquea/congela la UI)

## Overview

Este plan sigue la metodología de bugfix por *bug condition*: primero se surface el
contraejemplo que demuestra el bug sobre el código SIN arreglar (Property 1 — el escaneo
corre con **concurrencia efectiva 1**), luego se capturan las garantías a preservar
(Property 2 — lista, orden y metadata idénticos al serial), después se aplica el fix
mínimo (reescribir `AddonScanner.scan` en dos fases: recolección secuencial de
candidatos + pool INLINE acotado que escribe por índice, con `DEFAULT_VPK_CONCURRENCY`)
y finalmente se valida que el bug queda resuelto (concurrencia > 1 y ≤ pool) y que no hay
regresiones (resultado deep-equal y en el mismo orden que el serial de referencia).

Este es un bug de **RENDIMIENTO / latencia**, no de corrección de datos. El fix NO cambia
QUÉ produce el escaneo, solo CÓMO recorre los addons. La firma pública de `scan`, los
helpers privados `#resolveCover` / `#readAddonInfoSafely` y el manejo de errores
best-effort por-addon **no cambian**. Alcance decidido: **NO** tocar el renderer, **NO**
agregar progreso IPC, **NO** usar `worker_threads`.

Referencias del fix (del `design.md` validado): archivo `src/main/domain/addon-scanner.ts`,
método público `AddonScanner.scan`; constante de pool `DEFAULT_VPK_CONCURRENCY` importada
de `src/main/domain/vpk-tool.ts` (única fuente del tamaño de pool, sin literal nuevo);
patrón de referencia `classifyWithBoundedConcurrency` (cursor compartido + escritura en
`results[index]`).

---

## Tasks

- [ ] 1. Escribir el test de exploración de la Bug Condition (ANTES del fix)
  - **Property 1: Bug Condition** - El escaneo corre con concurrencia efectiva 1 (serial)
  - **CRÍTICO**: este test DEBE FALLAR sobre el código sin arreglar — su fallo confirma
    que el bug existe (concurrencia efectiva 1).
  - **NO intentar arreglar el test ni el código cuando falle** en esta tarea.
  - **NOTA**: este test codifica el comportamiento esperado; cuando pase tras el fix
    (tarea 3.2) validará que el bug quedó resuelto.
  - **OBJETIVO**: surfacear el contraejemplo que demuestra que las invocaciones `vpk.exe`
    nunca se solapan sobre el código serial.
  - **Enfoque PBT acotado (bug determinista)**: acotar la propiedad al caso concreto
    reproducible — una Workshop con **≥ 5 addons** `.vpk` de nivel superior, suficiente
    para que, de existir paralelismo, dos invocaciones pudieran estar en vuelo a la vez.
  - Construir un `VpkTool` (o `CommandRunner`) **fake instrumentado** que mida el
    solapamiento de invocaciones concurrentes:
    - Un contador `inFlight` que se **incrementa** al entrar a `list`/`extract` y se
      **decrementa** al resolver; registrar el **máximo** observado (`maxInFlight`).
    - Cada invocación **no resuelve de inmediato**: cede al event loop (p. ej. resuelve en
      un `setTimeout(0)` / microtask / tick) para permitir el solapamiento si lo hubiera.
  - Combinarlo con un `AddonFileSystem` fake en memoria (estilo `addon-scanner.test.ts`)
    que liste los `.vpk` y controle covers/addoninfo de forma determinista.
  - Aserción esperada (comportamiento correcto tras el fix): `maxInFlight > 1`.
  - Ejecutar sobre el código SIN arreglar (bucle `for...await`): `maxInFlight === 1`
    (nunca hay 2 invocaciones `vpk.exe` en vuelo a la vez).
  - **RESULTADO ESPERADO**: el test FALLA (correcto — prueba que `isBugCondition` retorna
    `true`: concurrencia efectiva 1).
  - Documentar los contraejemplos hallados (p. ej. "con 8 addons, `maxInFlight = 1`: las
    invocaciones `vpk.exe` jamás se solapan sobre el código serial").
  - Marcar la tarea como completada cuando el test esté escrito, ejecutado y su fallo
    documentado.
  - Ubicación sugerida: `test/bug-006-exploratory.test.ts`.
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Escribir los property tests de Preservación (ANTES del fix)
  - **Property 2: Preservation** - El contrato de correctitud de `scan` no cambia
  - **IMPORTANTE**: seguir la metodología *observación primero*.
  - Como el código actual ES serial, el resultado del escaneo actual ES la **referencia
    serial**: estas properties describen el contrato a preservar y **PASAN** sobre el
    código sin arreglar.
  - Reutilizar los fakes en memoria del estilo de `addon-scanner.property.test.ts`: un
    `AddonFileSystem` en memoria (mapa directorio → entradas y conjunto de rutas
    existentes para el cover) y un `VpkTool` / `CommandRunner` **determinista** (controla
    qué `addoninfo` aparece y cuáles fallan).
  - Para Workshops arbitrarias (mezcla de subdirectorios, no-`.vpk`, `.vpk` con/sin cover,
    `addoninfo` que existe/falla en posiciones aleatorias), computar el valor esperado
    desde un **modelo independiente** (o desde la referencia serial determinista
    construida a partir de los mismos fakes), NO desde el código bajo prueba, y capturar
    los patrones observados (de las Preservation Requirements):
    - Solo `.vpk` de nivel superior; subdirectorios y otras extensiones ignorados (3.1).
    - `id` derivado del nombre del archivo sin `.vpk` (3.2).
    - `coverPath = <id>.jpg` si existe, `null` si no (3.3).
    - `addoninfo` best-effort: cualquier fallo degrada a `info: null` SIN abortar ni
      omitir el addon (3.4).
    - ORDEN idéntico al del listado del directorio (3.5).
    - Sin pérdida/duplicación/reordenamiento: cada `.vpk` aparece exactamente una vez
      (3.6).
  - **RESULTADO ESPERADO**: los tests PASAN sobre el código SIN arreglar (confirman el
    comportamiento base a preservar).
  - Marcar la tarea como completada cuando los tests estén escritos, ejecutados y pasando
    sobre el código sin arreglar.
  - Ubicación sugerida: `test/bug-006-preservation.property.test.ts`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 3. Fix para el escaneo serial (paralelizar con pool INLINE acotado, preservando orden)

  - [ ] 3.1 Reescribir `AddonScanner.scan` en dos fases (candidatos secuenciales + pool inline por índice)
    - En `src/main/domain/addon-scanner.ts`, reemplazar el bucle serial `for...await` del
      método público `AddonScanner.scan` por un recorrido en **dos fases**. La **firma
      pública NO cambia** (`scan(workshopFolder: string): Promise<ScannedAddon[]>`).
    - **Fase 1 — recolección secuencial de candidatos (barata, SIN `vpk.exe`)**: recorrer
      `entries` en orden y quedarse con los que pasan el filtro actual, derivando lo
      barato y determinista `{ id, vpkPath }`:
      `entries.filter((e) => !e.isDirectory).map((e) => ({ e, id: addonIdFromVpkName(e.name) })).filter((c) => c.id !== null).map((c) => ({ id: c.id, vpkPath: joinWindowsPath(workshopFolder, c.e.name) }))`.
      El **índice de cada candidato ES su posición final** en el resultado (los ignorados
      no ocupan lugar), preservando el orden del serial.
    - **Fase 2 — pool INLINE con concurrencia ACOTADA (opción (b), aprobada)**: replicar el
      patrón `classifyWithBoundedConcurrency`: `results: ScannedAddon[]` de longitud
      `candidates.length`, **cursor compartido** `let cursor = 0`, y
      `poolSize = Math.min(DEFAULT_VPK_CONCURRENCY, candidates.length)` workers. Cada
      worker toma `index = cursor++`, corta si el candidato es `undefined`, procesa
      `#resolveCover` + `#readAddonInfoSafely` (que **NO cambian**) y escribe en
      `results[index]`. `await Promise.all(...)` de los workers; `return results`.
    - Importar `DEFAULT_VPK_CONCURRENCY` de `src/main/domain/vpk-tool.ts` como tamaño de
      pool (sin introducir un número nuevo, AC 3.7).
    - La escritura en `results[index]` (posición original) garantiza el **orden idéntico
      al serial**, independientemente del orden de finalización de los workers.
    - **Manejo de errores por-addon INALTERADO**: `#readAddonInfoSafely` ya tiene su
      try/catch → `null`; `#resolveCover` usa `fs.exists` no-lanzante. Ningún worker
      propaga excepción que rompa el `Promise.all` durante el escaneo normal (AC 3.4).
    - **Deuda técnica anotada (NO implementar aquí)**: NO extraer un helper genérico
      `mapWithBoundedConcurrency`, NO tocar `classifyWithBoundedConcurrency` ni
      `MergeEngine.preview`. La unificación de los tres pools queda fuera de alcance.
    - **Sin cambios**: firma de `scan`, `#resolveCover`, `#readAddonInfoSafely`,
      `AddonFileSystem`, `DirEntry`, `ScannedAddon`, `addonIdFromVpkName`,
      `joinWindowsPath`. **No** se toca el renderer ni el handler IPC.
    - _Bug_Condition: isBugCondition(X) — concurrenciaEfectiva(F, X) = 1 (escaneo serial, tiempo lineal en N)_
    - _Expected_Behavior: F'(X) con pool inline: 1 < maxInFlight ≤ DEFAULT_VPK_CONCURRENCY, resultado deep-equal y en el mismo orden que el serial_
    - _Preservation: solo .vpk de nivel superior, id del nombre, coverPath best-effort, addoninfo best-effort → null sin abortar/omitir, orden por índice sin pérdida/dup/reorden, DEFAULT_VPK_CONCURRENCY como tamaño de pool_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.2 Verificar que el test de exploración de la Bug Condition ahora pasa
    - **Property 1: Expected Behavior** - El escaneo corre con concurrencia acotada > 1
    - **IMPORTANTE**: reejecutar el MISMO test de la tarea 1 — NO escribir un test nuevo;
      ajustar únicamente la aserción al comportamiento esperado.
    - El test de la tarea 1 codifica el comportamiento esperado; cuando pasa, confirma que
      se satisface el Expected Behavior.
    - Ejecutar el test de exploración de la tarea 1 sobre el código YA arreglado y aseverar
      `1 < maxInFlight <= DEFAULT_VPK_CONCURRENCY` (importando la constante, sin duplicar
      el literal).
    - **RESULTADO ESPERADO**: el test PASA (confirma que el bug quedó resuelto: las
      invocaciones `vpk.exe` ahora se solapan, con concurrencia acotada por el pool).
    - _Requirements: 2.1_

  - [ ] 3.3 Verificar que los property tests de Preservación siguen pasando
    - **Property 2: Preservation** - El contrato de correctitud de `scan` no cambia
    - **IMPORTANTE**: reejecutar los MISMOS tests de la tarea 2 — NO escribir tests nuevos.
    - Ejecutar los property tests de preservación de la tarea 2 sobre el código arreglado.
    - **RESULTADO ESPERADO**: los tests PASAN (resultado deep-equal + mismo orden que el
      serial de referencia; sin regresiones).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 4. Tests unitarios concretos del escaneo paralelizado
  - **Orden preservado con fallo intercalado**: lista de addons donde el `addoninfo` de un
    addon del **MEDIO** falla (→ `info: null`); el resto queda intacto y el **orden** es el
    del listado (verifica escritura por índice, no por finalización).
  - **Addon sin cover**: `<id>.jpg` ausente ⇒ `coverPath === null`, addon igualmente listado.
  - **Filtrado**: subdirectorios y archivos no-`.vpk` se ignoran; solo `.vpk` de nivel
    superior en el resultado.
  - **Lista vacía**: Workshop sin entradas (o sin `.vpk`) ⇒ `scan` devuelve `[]` y el pool
    no lanza workers (`poolSize = Math.min(DEFAULT_VPK_CONCURRENCY, 0) = 0`).
  - **Cota de concurrencia**: con más addons que el pool, `maxInFlight <= DEFAULT_VPK_CONCURRENCY`.
  - **`id` y `vpkPath` idénticos al serial**: `id` derivado del nombre y
    `vpkPath = joinWindowsPath(...)`.
  - Ubicación sugerida: `test/bug-006-exploratory.test.ts` (o el archivo de unit tests del
    scanner).
  - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 5. Property tests con fast-check (≥ 100 iteraciones) — equivalencia + cota
  - Usar el helper `test/helpers/property.ts` ya existente (≥ `MIN_NUM_RUNS` ≈ 100 iter).
  - Importar `DEFAULT_VPK_CONCURRENCY` desde `vpk-tool.ts` — **no** duplicar el literal.
  - **Equivalencia total (deep-equal + orden)**: para Workshops arbitrarias, `scan`
    paralelo es **deep-equal y en el mismo orden** que el escaneo serial de referencia
    (misma lista, mismo orden, misma metadata).
  - **Cota de concurrencia**: `maxInFlight <= DEFAULT_VPK_CONCURRENCY` en toda corrida.
  - **Sin pérdida/duplicación/reordenamiento**: la secuencia de `id` del resultado coincide
    exactamente con la de los `.vpk` de nivel superior en el orden del listado.
  - Ubicación sugerida: `test/bug-006-preservation.property.test.ts`.
  - _Requirements: 2.3, 3.5, 3.6, 3.7_

- [ ] 6. Checkpoint — Regresión, verificación final y registro de la decisión
  - Confirmar que los tests EXISTENTES `addon-scanner.test.ts` y
    `addon-scanner.property.test.ts` **siguen pasando SIN modificación** (red de seguridad
    de que el resultado no cambió).
  - Ejecutar `npm run typecheck` y `npm run test` (vitest run) — ambos en verde.
  - Asegurar que todos los tests pasan; ante dudas o fallos, consultar al usuario.
  - Registrar la decisión en `Context/04-historial-decisiones.md` siguiendo el formato de
    las entradas BUG-009/010/011:
    - **Causa raíz confirmada**: escaneo estrictamente serial (`for...await`) en
      `AddonScanner.scan`, concurrencia efectiva 1, tiempo lineal en N (~45 s con ~200
      addons).
    - **Fix**: pool INLINE acotado con `DEFAULT_VPK_CONCURRENCY` que preserva el orden por
      índice (escritura en `results[index]`); dos fases (candidatos secuenciales + llenado
      paralelo). Firma y helpers privados sin cambios; resultado idéntico al serial.
    - **Aclaración QA**: el texto "Detectando rutas del juego..." reportado por QA vs la
      fase real "Escaneando addons..." es un ERROR DE TRANSCRIPCIÓN/PERCEPCIÓN, NO un bug de
      label desactualizado.
    - **Opción (b) inline** elegida con **deuda técnica** registrada: unificar los tres
      pools (`scanner`, `classifyWithBoundedConcurrency`, `MergeEngine.preview`) en un
      helper genérico `mapWithBoundedConcurrency` en un cambio separado.
    - **Fuera de alcance**: renderer, progreso IPC y `worker_threads` (no tocados).
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

---

## Task Dependency Graph

(Grafo de dependencias de tareas)

```
1 (exploración Bug Condition — FALLA sin fix)
2 (preservación — PASA sin fix)
        │
        ▼
3.1 (reescribir scan: dos fases + pool inline por índice)  ← núcleo del fix
        │
        ├──► 3.2 (reejecutar test tarea 1 → ahora PASA)
        └──► 3.3 (reejecutar tests tarea 2 → siguen PASANDO)
        │
        ▼
4 (unit tests concretos) ──┐
5 (property tests fast-check: equivalencia + cota) ──┤
        │                                            │
        ▼                                            ▼
6 (checkpoint: regresión + typecheck + test + registro de decisión)
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
      "description": "Núcleo del fix — reescribir scan en dos fases con pool inline",
      "tasks": ["3.1"],
      "dependsOn": ["1", "2"]
    },
    {
      "wave": 3,
      "description": "Verificaciones derivadas del fix núcleo",
      "tasks": ["3.2", "3.3"],
      "dependsOn": ["3.1"]
    },
    {
      "wave": 4,
      "description": "Dependen del fix — paralelizables entre sí",
      "tasks": ["4", "5"],
      "dependsOn": ["3.1"]
    },
    {
      "wave": 5,
      "description": "Cierre — depende de todas las olas anteriores",
      "tasks": ["6"],
      "dependsOn": ["3.2", "3.3", "4", "5"]
    }
  ]
}
```

## Notes

- Las tareas **1** y **2** deben completarse ANTES del fix (tarea 3), sobre el código sin
  arreglar: la **1** DEBE FALLAR (demuestra la concurrencia efectiva 1) y la **2** DEBE
  PASAR (fija el contrato serial a preservar).
- La tarea **3.1** es el núcleo del fix; **3.2** y **3.3** solo reejecutan los MISMOS tests
  de las tareas 1 y 2 (no se escriben tests nuevos).
- Las tareas **4** y **5** dependen del fix (3.1) y pueden desarrollarse en paralelo.
- La tarea **6** es el cierre: requiere todas las anteriores en verde e incluye la
  verificación de regresión de los tests existentes del scanner y el registro de la
  decisión.
- Este es un bug de **rendimiento**: el fix NO cambia QUÉ produce el escaneo, solo CÓMO
  recorre los addons. La equivalencia del resultado con el serial de referencia es la
  garantía central.
