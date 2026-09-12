# Implementation Plan

> **Contexto — BUG-009: La fusión no crea `modsvs`**
>
> Este plan sigue la metodología de **bug condition** del workflow de bugfix: primero se
> reproduce el bug sobre el código SIN fix (fase exploratoria) para confirmar la causa raíz,
> luego se aplica el fix, después se validan las Properties de corrección y preservación, se
> ajustan los tests de regresión y finalmente se verifica toda la suite y se registra la decisión.

## Overview

El objetivo es corregir BUG-009, donde la fusión de addons no crea la carpeta `<gameRoot>\modsvs`
y, por lo tanto, el Merged_Package y su backup terminan fuera de esa carpeta (a veces en la raíz
del juego). La corrección se apoya en tres frentes: (1) crear `modsvs` de forma reactiva antes del
backup en `merge-orchestrator.ts`; (2) dejar de exigir `modsvs` como ruta preexistente en
`path-detector.ts` (para que se re-derive en cada corrida y se resuelva el "bug pegajoso"); y
(3) reconciliar la documentación de tipos. El plan primero reproduce el bug (fase exploratoria),
aplica los cambios, valida con property tests de corrección (Property 1) y preservación
(Property 2), ajusta los tests de regresión existentes y cierra con verificación completa,
commit y registro de la decisión.

## Task Dependency Graph

```
1  (exploración: reproducir bug sobre F)
│
├─► 2  (Cambio 2 + 3: path-detector — sacar modsvs de REQUIRED_PATH_KEYS + tipo/JSDoc)
│
├─► 3  (Cambio 1: merge-orchestrator — ensureDir(modsvsFolder) antes de backup, vía #writeStep)
│
└─► 4  (Cambio 4: types.ts — reconciliar JSDoc de GamePaths.modsvsFolder)

2, 3 ──► 5  (Fix check: Property 1 — property test con fast-check, mín. 100 iter.)
3    ──► 6  (Preservation check: Property 2 — property test secuencia idéntica F vs F')
2, 3 ──► 7  (Unit tests: orden ensureDir, instalación fresca, path-detector, EACCES, bug pegajoso)
2, 5, 6, 7 ─► 8  (Regresión: ajustar tests existentes de path-detector; verificar orchestrator/backup)
5, 6, 7, 8 ─► 9  (Verificación final: suite completa + typecheck)
9    ──► 10 (Commit + entrada en Context/04-historial-decisiones.md; NO mergear sin mostrar diff)
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3", "4"] },
    { "wave": 3, "tasks": ["5", "6", "7"] },
    { "wave": 4, "tasks": ["8"] },
    { "wave": 5, "tasks": ["9"] },
    { "wave": 6, "tasks": ["10"] }
  ]
}
```

## Tasks

- [x] 1. Reproducir el bug sobre el código SIN fix (fase exploratoria)
  - **Property 1: Bug Condition** - El Merged_Package y su backup NO quedan bajo `<gameRoot>\modsvs\`
  - **CRÍTICO**: estos tests DEBEN FALLAR sobre el código sin fix — la falla confirma que el bug existe.
  - **NO intentar arreglar el test ni el código cuando falle**: la falla es el resultado esperado en esta fase.
  - **NOTA**: estos tests codifican el comportamiento esperado; validarán el fix cuando pasen tras la implementación (tarea 5).
  - **OBJETIVO**: surfacer contraejemplos que demuestren el bug y confirmar la causa raíz (Hipótesis A + B del design).
  - Crear un test exploratorio (p. ej. `test/bug-009-exploratory.test.ts`) con FS/dobles en memoria, reutilizando `test/helpers/orchestrator-doubles.ts`.
  - Caso a) **Detección fresca desvía a la raíz**: ejecutar `PathDetector.detect` con FS donde `<gameRoot>\modsvs` NO existe y un `ManualPathProvider` que devuelve la raíz del juego; observar que `modsvsFolder` resuelve a `<gameRoot>` (aserto de `<gameRoot>\modsvs` FALLA sobre F).
  - Caso b) **`#materialize` no crea `modsvs`**: ejecutar `applyActiveSet` con FS que registra llamadas a `ensureDir`/`copyFile`; observar que `ensureDir` se invoca solo con el `workDir`, nunca con `modsvsFolder`.
  - Caso c) **`installTarget`/`backupPath` fuera de `modsvs`**: con `modsvsFolder` desviado, observar que el destino de copia es `<gameRoot>\pak01_dir.vpk` (aserto de contenedor `<gameRoot>\modsvs` FALLA).
  - **RESULTADO ESPERADO**: los tests FALLAN (confirman el bug).
  - Documentar los contraejemplos: `modsvsFolder = <gameRoot>` en instalación fresca; `ensureDir` nunca llamado con `modsvsFolder`; causa confirmada = `modsvsFolder` en `REQUIRED_PATH_KEYS` + ausencia de `ensureDir(modsvsFolder)` en `#materialize`.
  - Marcar la tarea completa cuando los tests estén escritos, ejecutados y la falla documentada.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Aplicar Cambio 2 + 3 en `path-detector.ts` y el tipo (sacar `modsvsFolder` de las rutas requeridas)
  - **Cambio 2** — En `src/main/domain/path-detector.ts`, remover `"modsvsFolder"` de `REQUIRED_PATH_KEYS`, dejando `["gameRoot", "workshopFolder", "vpkToolPath", "gameInfoFile"]`.
  - Confirmar que `modsvsFolder` se sigue derivando en `derivePaths` y `#detectFromGameRoot` (`joinWindows(gameRoot, "modsvs")`) y se sigue persistiendo como parte de `GamePaths`; solo deja de verificarse en disco y de pedirse vía `ManualPathProvider`.
  - En `src/main/domain/types.ts`, MANTENER `"modsvsFolder"` en la unión `RequiredPathKey` (decisión del diseño: `PathVerification.present` usa `Record<RequiredPathKey, boolean>`).
  - Ajustar el JSDoc de `RequiredPathKey` y `PathVerification` para aclarar que `modsvsFolder` ya NO se verifica en disco (la app la crea), evitando la contradicción documental.
  - **Cambio 3** (bug pegajoso): NO agregar lógica de migración explícita. La corrección se da por re-derivación en `detect()` (que ya deriva desde registro/`libraryfolders.vdf` en cada corrida) al no pedir `modsvs` como preexistente.
  - _Bug_Condition: isBugCondition(state) cuando `modsvsFolder != joinWindows(gameRoot, "modsvs")` por desvío a la raíz_
  - _Expected_Behavior: `detect()` re-deriva `modsvsFolder = <gameRoot>\modsvs` sin selección manual de `modsvs`_
  - _Preservation: las otras 4 rutas requeridas se siguen verificando y pidiendo (3.5, 3.6)_
  - _Requirements: 2.3, 3.5, 3.6_

- [x] 3. Aplicar Cambio 1 en `merge-orchestrator.ts` (crear `modsvs` antes de backup/instalar)
  - En `src/main/domain/merge-orchestrator.ts`, dentro de `#materialize`, tras crear el `workDir` y ANTES del Paso 4 (backup), agregar `await this.#fs.ensureDir(this.#paths.modsvsFolder)`.
  - Envolver ese `ensureDir(modsvsFolder)` en el manejo reactivo `#writeStep` (igual que backup/instalar/gameinfo), para que un `EACCES`/`EPERM` al crear `modsvs` dispare la elevación (`handleWriteFailure`) en vez de abortar (coherente con 3.3).
  - Ejecutarlo como paso reactivo previo al backup; `ensureDir` es recursivo e idempotente (no-op si `modsvs` ya existe → preserva 3.7).
  - NO agregar `ensureDir` en `BackupManager` (por diseño/DECISIÓN 4 no crea directorios; su `BackupFileSystem` solo expone `exists` + `copyFile`).
  - _Bug_Condition: isBugCondition(state) cuando `<gameRoot>\modsvs` no existe y `#materialize` instala sin crearla_
  - _Expected_Behavior: expectedBehavior(result) — `ensureDir(modsvsFolder)` invocado antes del backup; `installTarget` y `backupPath` bajo `<gameRoot>\modsvs\`_
  - _Preservation: backup de un nivel, no-op de primera instalación, manejo reactivo de permisos, caso `modsvs` preexistente (3.1, 3.2, 3.3, 3.7)_
  - _Requirements: 2.1, 2.2, 2.4_

- [x] 4. Aplicar Cambio 4 en `types.ts` (reconciliar JSDoc de `GamePaths.modsvsFolder`)
  - En `src/main/domain/types.ts`, cambiar el JSDoc de `GamePaths.modsvsFolder` de `<left4dead2Dir>\modsvs` a `<gameRoot>\modsvs`, consistente con `derivePaths` y el comportamiento confirmado por el usuario.
  - Cambio solo documental (no testeable por comportamiento; se verifica por revisión).
  - _Requirements: 2.5_

- [x] 5. Fix check — Property 1 (property test con fast-check, mín. 100 iteraciones)

  - [x] 5.1 Escribir el property test de corrección para `#materialize`
    - **Property 1: Expected Behavior** - El Merged_Package y su backup quedan bajo `<gameRoot>\modsvs\`
    - **IMPORTANTE**: los tests exploratorios de la tarea 1 ya codifican el comportamiento esperado; acá se agrega la garantía universal con fast-check reutilizando el patrón de `test/merge-orchestrator.property.test.ts` y `test/helpers/orchestrator-doubles.ts`.
    - Generar cualquier `gameRoot` válido; tras `#materialize` (vía `applyActiveSet`) con el fix, asertar `parentDir(installTarget) === joinWindows(gameRoot, "modsvs")` y `parentDir(backupPath) === joinWindows(gameRoot, "modsvs")`.
    - Asertar que `ensureDir(modsvsFolder)` fue invocado ANTES del paso de backup (usando el registro de llamadas del doble).
    - Configurar mínimo 100 iteraciones.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.2 Verificar que los tests exploratorios de la tarea 1 ahora PASAN
    - **Property 1: Expected Behavior** - Confirmación de que el bug quedó resuelto
    - **IMPORTANTE**: re-ejecutar los MISMOS tests de la tarea 1 — NO escribir tests nuevos.
    - Correr la suite exploratoria con `npm run test`.
    - **RESULTADO ESPERADO**: los tests que fallaban ahora PASAN (confirma que el bug está fijado).
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 6. Preservation check — Property 2 (property test: secuencia idéntica F vs F')
  - **Property 2: Preservation** - Comportamiento con `modsvs` ya resuelto e inputs no-buggy
  - **IMPORTANTE**: seguir la metodología observation-first — observar el comportamiento sobre F (código sin fix) para los casos `¬C(X)` y capturarlo antes de comparar.
  - Escribir un property test (fast-check) que, para cualquier `gameRoot` válido con `modsvs` ya presente (`¬C(X)`), compare la secuencia de llamadas a los dobles (backup → copyFile de instalación → gameinfo → saveManifest) entre el código original y el fijado, y asertar que es IDÉNTICA.
  - **RESULTADO ESPERADO**: la secuencia es idéntica (el `ensureDir` extra es no-op idempotente cuando `modsvs` ya existe, no altera el flujo observable posterior).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 7. Unit tests del fix (casos concretos)
  - **Orden de `ensureDir`**: `MergeOrchestrator` invoca `ensureDir(modsvsFolder)` ANTES del paso de backup (verificar el orden relativo a `ensureDir(workDir)` y al backup).
  - **Instalación fresca** (`modsvs` inexistente): `installTarget` y `backupPath` quedan bajo `<gameRoot>\modsvs\`, nunca en la raíz.
  - **PathDetector**: ya no marca `modsvsFolder` como faltante ni lo pide vía `ManualPathProvider` cuando `modsvs` no existe.
  - **EACCES/EPERM**: el `ensureDir(modsvsFolder)` que falla por permisos dispara el manejo reactivo (`#writeStep` → `handleWriteFailure`) en vez de abortar.
  - **Regresión del bug pegajoso**: partiendo de un `modsvsFolder` persistido = `<gameRoot>`, tras `detect()` el resultado re-derivado es `<gameRoot>\modsvs`.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.3, 3.7_

- [x] 8. Ajustar tests de regresión existentes
  - Ajustar `test/path-detector.test.ts` y `test/path-detector.property.test.ts`: los asertos que asumían `modsvsFolder` dentro de `REQUIRED_PATH_KEYS` (esperaban que se verificara/pidiera `modsvs`) deben actualizarse para reflejar que `modsvs` ya NO se verifica en disco.
  - Confirmar que `modsvsFolder` se sigue derivando/persistiendo en los asertos que corresponda.
  - Ejecutar `test/merge-orchestrator.test.ts` y `test/backup-manager.test.ts` sin modificarlos: deben seguir pasando (si fallan, es regresión real → investigar).
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7_

- [x] 9. Checkpoint — Verificación final (suite completa + typecheck)
  - Correr la suite completa con `npm run test` (vitest run, sin watch) y confirmar que TODO pasa: exploratorios (ahora pasan), Property 1, Property 2, unit tests y regresión.
  - Correr `npm run typecheck` y confirmar cero errores de tipos (main + renderer).
  - Si surgen dudas o fallos inesperados, consultar al usuario antes de continuar.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [-] 10. Commit y registro de la decisión
  - Añadir una entrada en `Context/04-historial-decisiones.md` con el formato existente (Qué / Decisión / Motivo / Impacto) documentando los 4 cambios: (a) `ensureDir(modsvsFolder)` en `#materialize` y por qué ahí y NO en `BackupManager`; (b) remoción de `modsvsFolder` de `REQUIRED_PATH_KEYS` manteniendo la clave en el tipo `RequiredPathKey`; (c) corrección del bug pegajoso por re-derivación en `detect()` sin migración explícita; (d) reconciliación del JSDoc a `<gameRoot>\modsvs`.
  - Crear el commit con el mensaje exacto: `fix(dominio): crear modsvs y no exigirla como ruta preexistente (bug BUG-009)`.
  - **NO mergear sin mostrar el diff primero**: el usuario pidió explícitamente revisar el diff antes de cualquier merge.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

## Notes

**Metodología (recordatorio):**
- **C(X)** — Bug Condition: `modsvsFolder != <gameRoot>\modsvs`, o `parentDir(installTarget) != <gameRoot>\modsvs`, o `parentDir(backupPath) != <gameRoot>\modsvs`.
- **P(result)** — Property 1: para todo input que cumple C(X), tras el fix `modsvsFolder`, `installTarget` y `backupPath` quedan bajo `<gameRoot>\modsvs\` y la carpeta se crea automáticamente.
- **¬C(X)** — inputs no-buggy (`modsvs` ya resuelto y presente) que deben preservarse (Property 2).
- **F** — función original (sin fix). **F'** — función fijada.

**Herramientas:** vitest + fast-check. Correr SIEMPRE con `npm run test` (equivale a `vitest run`, sin watch). NO usar watch mode.

**Alcance de archivos del fix (capa main/dominio):**
- `src/main/domain/merge-orchestrator.ts` (Cambio 1)
- `src/main/domain/path-detector.ts` (Cambio 2 y 3)
- `src/main/domain/types.ts` (Cambio 2 y 4)

**Tests a reutilizar/ajustar:**
- `test/merge-orchestrator.property.test.ts` y `test/helpers/orchestrator-doubles.ts` (patrón de arbitraries y dobles).
- `test/merge-orchestrator.test.ts`, `test/backup-manager.test.ts` (deben seguir pasando).
- `test/path-detector.test.ts`, `test/path-detector.property.test.ts` (a AJUSTAR: asumían `modsvsFolder` en `REQUIRED_PATH_KEYS`).

**Commit:** mensaje exacto `fix(dominio): crear modsvs y no exigirla como ruta preexistente (bug BUG-009)`.

**Aviso importante:** NO mergear sin mostrar el diff primero — el usuario pidió explícitamente revisar el diff antes de cualquier merge.
