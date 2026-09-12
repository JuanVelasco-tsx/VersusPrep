# Documento de Requisitos del Bugfix

## Introduction

BUG-009 (Bloqueante), reportado en QA V3 (jornada 2). Al materializar una fusión, el Manager **no crea el subdirectorio `modsvs`**: el `pak01_dir.vpk` fusionado y su `.backup` terminan sueltos en la **raíz del Game_Root** (`...\Left 4 Dead 2\`) en lugar de dentro de `...\Left 4 Dead 2\modsvs\`. Como el engine carga el Merged_Package desde `modsvs/`, dejar el `.vpk` en la raíz rompe la instalación por completo: es un bug bloqueante.

El usuario confirmó, reproduciéndolo en la validación end-to-end P-01, que la ubicación **correcta** de la carpeta es `<gameRoot>\modsvs` (cuelga de la raíz del juego, **no** de `left4dead2\`). Ahí el `pak01_dir.vpk` cargó bien. Es decir, el cálculo de `PathDetector.derivePaths` (`joinWindows(gameRoot, "modsvs")`) coincide con lo correcto; lo que está mal es que ese destino no se crea y la instalación termina desviándose a la raíz.

Este spec cubre **únicamente la capa main/dominio** del bug; es autocontenido y no depende del renderer ("Code"). Alcance de archivos: `src/main/domain/path-detector.ts`, `src/main/domain/types.ts`, `src/main/domain/merge-orchestrator.ts`, `src/main/domain/backup-manager.ts`, `src/main/data/node-fs-helpers.ts` (y adaptadores `*FileSystem` si el diseño lo requiere). No se toca código de renderer.

La formalización de la bug condition C(X) y la determinación de **cuál** de las hipótesis es la causa raíz exacta se harán en la fase de diseño reproduciendo el flujo (`PathDetector.detect` con `modsvs` inexistente + selección manual + `#materialize`). Este documento solo describe el comportamiento observado, el esperado y el que debe preservarse. Dos sospechosos identificados en la investigación estática, a confirmar en diseño:

- **Hipótesis A (fuerte, consistente con el síntoma "archivo suelto en la raíz, sin carpeta modsvs"):** `modsvsFolder` es una `RequiredPathKey` verificada en disco por `verifyPathsOnDisk`. En una instalación FRESCA la carpeta `<gameRoot>\modsvs` todavía no existe, así que `PathDetector` la marca como faltante y pide al usuario que la seleccione manualmente. Al no existir `modsvs`, el usuario termina seleccionando la raíz `Left 4 Dead 2`, con lo que `modsvsFolder = <gameRoot>`; entonces `joinWindowsPath(<gameRoot>, "pak01_dir.vpk")` = `<gameRoot>\pak01_dir.vpk` (suelto en la raíz). Además `LocalStore.savePaths` persiste esa ruta incorrecta, así que el bug se vuelve pegajoso entre sesiones.
- **Hipótesis B:** falta de `ensureDir(modsvsFolder)` antes de backup/instalar. `fs.copyFile` no crea el directorio padre por sí mismo (lanzaría `ENOENT`, no escribe en la raíz), pero `modsvs`, al ser una carpeta que la propia app gestiona, debería crearse automáticamente en vez de exigir que preexista o forzar selección manual.

Dato duro adicional confirmado en el código: en `src/main/domain/types.ts` el JSDoc de `GamePaths.modsvsFolder` documenta `<left4dead2Dir>\modsvs`, pero `PathDetector.derivePaths` (y `#detectFromGameRoot`) lo calculan como `<gameRoot>\modsvs`. El JSDoc contradice la implementación; como lo correcto (confirmado por el usuario) es `<gameRoot>\modsvs`, el JSDoc del tipo está desactualizado y debe reconciliarse.

## Bug Analysis

### Current Behavior (Defect)

Comportamiento actual cuando se materializa una fusión y la carpeta `<gameRoot>\modsvs` no preexiste en disco.

1.1 WHEN se materializa una fusión (aplicar/agregar/quitar addons) y la carpeta `<gameRoot>\modsvs` no existe THEN el sistema instala el `pak01_dir.vpk` fusionado en la raíz del Game_Root (`<gameRoot>\pak01_dir.vpk`) en vez de dentro de `<gameRoot>\modsvs\`.

1.2 WHEN se materializa una fusión y la carpeta `<gameRoot>\modsvs` no existe THEN el sistema escribe el backup (`pak01_dir.vpk.backup`) fuera de `<gameRoot>\modsvs\` (junto al `.vpk` desviado), en vez de dentro de `<gameRoot>\modsvs\`.

1.3 WHEN el flujo de detección de rutas se ejecuta en una instalación fresca donde `<gameRoot>\modsvs` todavía no existe THEN el sistema trata `modsvs` como una ruta requerida que debe preexistir y la reporta como faltante, forzando una selección manual que puede resolver `modsvsFolder` a la raíz del juego (`<gameRoot>`) en lugar de a `<gameRoot>\modsvs`.

1.4 WHEN el flujo de detección resuelve `modsvsFolder` a una ruta que no es `<gameRoot>\modsvs` (p. ej. la raíz del juego) THEN el sistema persiste esa ruta incorrecta, de modo que el defecto se mantiene entre sesiones (instalaciones posteriores también quedan desviadas).

1.5 WHEN se inspecciona el tipo `GamePaths.modsvsFolder` en `types.ts` THEN el JSDoc documenta `<left4dead2Dir>\modsvs`, contradiciendo la implementación real de `derivePaths` (`<gameRoot>\modsvs`) y el comportamiento confirmado como correcto por el usuario.

### Expected Behavior (Correct)

Comportamiento correcto para las mismas condiciones que disparan el bug. `modsvs` es una carpeta que la **propia app gestiona** (ahí instala su Merged_Package), no una ruta preexistente del juego como workshop/gameinfo/vpk.exe.

2.1 WHEN se materializa una fusión y la carpeta `<gameRoot>\modsvs` no existe THEN el sistema SHALL crear automáticamente `<gameRoot>\modsvs` antes de respaldar e instalar, y colocar el `pak01_dir.vpk` fusionado dentro de `<gameRoot>\modsvs\pak01_dir.vpk`, nunca en la raíz.

2.2 WHEN se materializa una fusión y la carpeta `<gameRoot>\modsvs` no existe THEN el sistema SHALL escribir el backup (`pak01_dir.vpk.backup`) dentro de `<gameRoot>\modsvs\`, nunca en la raíz.

2.3 WHEN el flujo de detección de rutas se ejecuta en una instalación fresca donde `<gameRoot>\modsvs` todavía no existe THEN el sistema SHALL NO tratar `modsvs` como una ruta requerida que deba preexistir ni desviar la instalación a la raíz: la ausencia de `modsvs` en una instalación fresca no debe romper ni desviar la instalación (la app crea la carpeta).

2.4 WHEN el sistema determina el destino de instalación del Merged_Package y su backup THEN el sistema SHALL garantizar que, para cualquier `gameRoot` válido, tanto el `installTarget` como el `backupPath` queden SIEMPRE bajo `<gameRoot>\modsvs\`.

2.5 WHEN se inspecciona el tipo `GamePaths.modsvsFolder` en `types.ts` THEN el JSDoc SHALL describir `<gameRoot>\modsvs`, consistente con `derivePaths` y con el comportamiento confirmado como correcto por el usuario.

### Unchanged Behavior (Regression Prevention)

Comportamiento existente que el fix NO debe romper.

3.1 WHEN existe un `pak01_dir.vpk` previo en `<gameRoot>\modsvs\` antes de una nueva fusión THEN el sistema SHALL CONTINUAR creando un backup de un solo nivel que sobrescribe el backup previo (`pak01_dir.vpk.backup`), sin acumular niveles.

3.2 WHEN es la primera instalación y no existe ningún `pak01_dir.vpk` que respaldar THEN el sistema SHALL CONTINUAR tratando el backup como un no-op exitoso (`{ created: false }`) sin abortar la fusión.

3.3 WHEN una escritura en el Game_Root falla por permisos (`EACCES`/`EPERM`) THEN el sistema SHALL CONTINUAR manejándola de forma reactiva vía `ElevationService.handleWriteFailure` (elevar y reintentar) en vez de abortar.

3.4 WHEN se resuelve el Active_Set y su Priority_Order en add/remove/apply THEN el sistema SHALL CONTINUAR aplicando la resolución "el último gana" y materializando una fusión completa desde cero, sin alterar el orden ni el resultado.

3.5 WHEN el flujo de detección procesa las OTRAS rutas requeridas (`gameRoot`, `workshopFolder`, `vpkToolPath`, `gameInfoFile`) THEN el sistema SHALL CONTINUAR verificándolas como preexistentes en disco y pidiendo selección manual re-verificada si faltan (esas rutas SÍ deben preexistir; solo `modsvs` cambia de tratamiento).

3.6 WHEN el flujo de detección produce un `GamePaths` listo para persistir THEN el sistema SHALL CONTINUAR garantizando la verificación-antes-de-persistir (solo se alcanza `ready` cuando la verificación aplicable es exitosa), sin regresar a persistir rutas no verificadas para las rutas que sí deben preexistir.

3.7 WHEN se materializa una fusión con un `<gameRoot>\modsvs` ya existente y correctamente configurado THEN el sistema SHALL CONTINUAR instalando el `pak01_dir.vpk` y su backup dentro de `<gameRoot>\modsvs\` exactamente como hasta ahora (crear la carpeta es idempotente y no altera el caso ya funcional).
