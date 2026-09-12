# BUG-009 — La fusión no crea `modsvs` — Diseño del Bugfix

## Overview

Al materializar una fusión, el Manager deja el `pak01_dir.vpk` fusionado y su `.backup` sueltos en la raíz del Game_Root (`<gameRoot>\`) en lugar de dentro de `<gameRoot>\modsvs\`, y no crea la carpeta `modsvs`. Como el engine carga el Merged_Package desde `modsvs/`, el bug rompe la instalación por completo (bloqueante).

Tras reproducir el flujo estáticamente (`PathDetector.detect` con `modsvs` inexistente → selección manual → `MergeOrchestrator.#materialize`), se confirma que el problema tiene **una causa raíz principal** y **una concausa**, ambas alineadas con las hipótesis del `bugfix.md`:

- **Causa raíz (Hipótesis A, confirmada):** `modsvsFolder` figura en `REQUIRED_PATH_KEYS` de `path-detector.ts` y se verifica en disco con `verifyPathsOnDisk`. En una instalación fresca, `<gameRoot>\modsvs` todavía no existe, así que `PathDetector` lo marca como faltante (`missing`), entra al bucle de `#verifyThenManual` y pide al usuario que seleccione esa ruta con `ManualPathProvider`. Como `modsvs` no existe, el usuario termina eligiendo la raíz `Left 4 Dead 2` (que sí existe y por eso pasa la re-verificación de `#requestExisting`), con lo que `modsvsFolder = <gameRoot>`. Entonces `joinWindowsPath(<gameRoot>, "pak01_dir.vpk")` escribe en la raíz, y `LocalStore.savePaths` persiste la ruta incorrecta (bug pegajoso entre sesiones).
- **Concausa (Hipótesis B, confirmada):** `MergeOrchestrator.#materialize` crea el `workDir` temporal con `ensureDir(workDir)` pero **nunca** hace `ensureDir(this.#paths.modsvsFolder)` antes de backup/instalar. `BackupManager` documenta explícitamente (DECISIÓN 4) que NO crea `modsvs/`, y `copyFile` (sobre `fs.copyFile`) no crea el directorio padre. Por eso, incluso con `modsvsFolder` bien derivado, una instalación fresca sin `modsvs` fallaría por `ENOENT` en lugar de crear la carpeta.
- **Dato duro (confirmado):** el JSDoc de `GamePaths.modsvsFolder` en `types.ts` dice `<left4dead2Dir>\modsvs`, pero `derivePaths` y `#detectFromGameRoot` calculan `<gameRoot>\modsvs`. El comportamiento correcto (confirmado end-to-end por el usuario, P-01) es `<gameRoot>\modsvs`, así que el JSDoc está desactualizado.

La estrategia de fix es de tres frentes coordinados: (1) crear `modsvs` automáticamente en `#materialize` antes de respaldar/instalar; (2) sacar `modsvsFolder` de `REQUIRED_PATH_KEYS` para que una instalación fresca no lo trate como ruta preexistente ni desvíe a la raíz; y (3) reconciliar el JSDoc del tipo. El fix es mínimo, targeted y se limita a la capa main/dominio.

## Glossary

- **Bug_Condition (C)**: El estado observable en el que el Merged_Package (`installTarget`) y/o su backup (`backupPath`) NO quedan bajo `<gameRoot>\modsvs\`, y/o el `modsvsFolder` resuelto es distinto de `<gameRoot>\modsvs`.
- **Property (P)**: El comportamiento correcto — para cualquier `gameRoot` válido, `installTarget` y `backupPath` quedan SIEMPRE bajo `<gameRoot>\modsvs\`, y la carpeta `modsvs` se crea si no existe.
- **Preservation**: El comportamiento existente que el fix NO debe alterar — backup de un solo nivel, no-op de primera instalación, manejo reactivo de permisos, resolución del Active_Set, verificación-antes-de-persistir de las otras 4 rutas requeridas, y el caso ya funcional con `modsvs` preexistente.
- **`derivePaths` / `#detectFromGameRoot`**: Funciones de `path-detector.ts` que calculan `GamePaths`, incluyendo `modsvsFolder = joinWindows(gameRoot, "modsvs")`.
- **`REQUIRED_PATH_KEYS`**: Lista canónica de rutas que `verifyPathsOnDisk` comprueba como preexistentes en disco. Hoy incluye `modsvsFolder`; el fix la remueve.
- **`RequiredPathKey`**: Tipo de `types.ts` que enumera las claves de `GamePaths` verificables. Se decide si `modsvsFolder` sigue o no en la unión (ver Fix Implementation).
- **`MergeOrchestrator.#materialize`**: Paso de aplicación que ejecuta backup → merge → instalar → gameinfo → saveManifest, y crea/limpia el `workDir`. Es donde se agrega `ensureDir(modsvsFolder)`.
- **`modsvsFolder`**: Ruta `<gameRoot>\modsvs` donde la app gestiona e instala su Merged_Package. Es una carpeta que la **propia app crea**, no una ruta preexistente del juego.

## Bug Details

### Bug Condition

El bug se manifiesta cuando se materializa una fusión (aplicar/agregar/quitar addons) y la carpeta `<gameRoot>\modsvs` no preexiste en disco. En ese escenario el `PathDetector` trata `modsvs` como una ruta requerida faltante y desvía su resolución a la raíz del juego (`modsvsFolder = <gameRoot>`), y/o `#materialize` intenta instalar sin haber creado `modsvs`. El resultado observable es que el `installTarget` y el `backupPath` quedan fuera de `<gameRoot>\modsvs\`.

**Formal Specification:**
```
FUNCTION isBugCondition(state)
  INPUT: state con { gameRoot, modsvsFolder, installTarget, backupPath }
  OUTPUT: boolean

  LET expectedModsvs = joinWindows(state.gameRoot, "modsvs")

  RETURN state.modsvsFolder != expectedModsvs
         OR parentDir(state.installTarget) != expectedModsvs
         OR (state.backupPath != null AND parentDir(state.backupPath) != expectedModsvs)
END FUNCTION
```

Donde `parentDir(p)` es la carpeta contenedora de `p` y `installTarget = joinWindows(modsvsFolder, "pak01_dir.vpk")`, `backupPath = joinWindows(modsvsFolder, "pak01_dir.vpk.backup")`.

### Examples

- **Instalación fresca, `modsvs` inexistente (síntoma reportado):** el usuario, al no encontrar `modsvs` en el diálogo de selección manual, elige `...\Left 4 Dead 2\`. Resultado: `modsvsFolder = <gameRoot>`, `installTarget = <gameRoot>\pak01_dir.vpk` (suelto en la raíz), `backupPath = <gameRoot>\pak01_dir.vpk.backup`. Esperado: ambos bajo `<gameRoot>\modsvs\`.
- **`modsvs` bien derivado pero inexistente en disco:** si `modsvsFolder = <gameRoot>\modsvs` pero la carpeta no existe, `#materialize` llama a `copyFile(mergedVpk, <gameRoot>\modsvs\pak01_dir.vpk)` y falla con `ENOENT` (no hay `ensureDir`). Esperado: la app crea `modsvs` y la copia tiene éxito.
- **Ruta incorrecta persistida de una sesión previa:** `LocalStore` guardó `modsvsFolder = <gameRoot>` de una corrida anterior con el bug. En sesiones posteriores el destino sigue desviado. Esperado: la próxima detección re-deriva `modsvsFolder = <gameRoot>\modsvs` sin pedir selección manual de `modsvs`.
- **`modsvs` ya existente y correcto (caso ya funcional):** `modsvsFolder = <gameRoot>\modsvs` y la carpeta existe. Esperado: se instala dentro de `modsvs` exactamente como hasta ahora (el `ensureDir` es idempotente y no cambia nada).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- El backup sigue siendo de un solo nivel que sobrescribe el backup previo (`pak01_dir.vpk.backup`), sin acumular niveles (bugfix 3.1).
- La primera instalación sin `pak01_dir.vpk` que respaldar sigue siendo un no-op exitoso (`{ created: false }`) que no aborta la fusión (bugfix 3.2).
- Los fallos de escritura por permisos (`EACCES`/`EPERM`) siguen manejándose de forma reactiva vía `ElevationService.handleWriteFailure` (bugfix 3.3).
- La resolución del Active_Set y su Priority_Order ("el último gana", fusión completa desde cero) no cambia (bugfix 3.4).
- Las OTRAS 4 rutas requeridas (`gameRoot`, `workshopFolder`, `vpkToolPath`, `gameInfoFile`) se siguen verificando como preexistentes y pidiendo selección manual re-verificada si faltan (bugfix 3.5).
- La verificación-antes-de-persistir (`pathsReady`) se mantiene para las rutas que sí deben preexistir (bugfix 3.6).
- Con `modsvs` ya existente y correcto, la instalación funciona exactamente como hasta ahora; crear la carpeta es idempotente (bugfix 3.7).

**Scope:**
Todo estado en el que la carpeta `modsvs` ya está correctamente resuelta y presente (`¬C(X)`) debe quedar completamente inalterado por este fix. Esto incluye:
- El flujo de detección de las 4 rutas que sí deben preexistir.
- El comportamiento de backup (un nivel, no-op de primera instalación, propagación de fallos).
- El manejo reactivo de elevación y la resolución del Active_Set.

**Nota:** El comportamiento correcto para los inputs buggy está definido en la sección Correctness Properties (Property 1). Esta sección enumera lo que NO debe cambiar.

## Hypothesized Root Cause

Confirmado por lectura estática del código (no meras hipótesis):

1. **`modsvsFolder` en `REQUIRED_PATH_KEYS` (causa raíz principal):** en `path-detector.ts`, `REQUIRED_PATH_KEYS` incluye `"modsvsFolder"`. `verifyPathsOnDisk` recorre esa lista y lo marca como `missing` en instalación fresca. `#verifyThenManual` entra al bucle y pide la ruta con `#requestExisting`, que solo acepta rutas EXISTENTES; al no existir `modsvs`, el usuario elige la raíz (que existe) y `modsvsFolder` queda mal. `LocalStore.savePaths` persiste el error.

2. **Falta de `ensureDir(modsvsFolder)` en `#materialize` (concausa):** `#materialize` hace `ensureDir(workDir)` pero nunca `ensureDir(this.#paths.modsvsFolder)`. `BackupManager` (DECISIÓN 4) documenta que NO crea `modsvs/`, y `MergeOrchestratorFileSystem.copyFile` no crea el directorio padre. Sin la carpeta, la instalación fresca fallaría por `ENOENT`.

3. **JSDoc desactualizado en `types.ts`:** `GamePaths.modsvsFolder` documenta `<left4dead2Dir>\modsvs`, contradiciendo `derivePaths` (`<gameRoot>\modsvs`) y el comportamiento correcto confirmado por el usuario.

## Correctness Properties

Property 1: Bug Condition - El Merged_Package y su backup quedan bajo `<gameRoot>\modsvs\`

_For any_ estado donde la bug condition se cumple (`isBugCondition` devuelve true), el sistema fijado SHALL resolver `modsvsFolder = <gameRoot>\modsvs`, crear esa carpeta automáticamente si no existe, y colocar tanto el `installTarget` (`pak01_dir.vpk`) como el `backupPath` (`pak01_dir.vpk.backup`) dentro de `<gameRoot>\modsvs\`, nunca en la raíz.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Comportamiento con `modsvs` ya resuelto e inputs no-buggy

_For any_ estado donde la bug condition NO se cumple (`isBugCondition` devuelve false) — `modsvs` ya está correctamente resuelto y presente, o el input no involucra la resolución/creación de `modsvs` — el sistema fijado SHALL producir el mismo resultado que el sistema original, preservando el backup de un solo nivel, el no-op de primera instalación, el manejo reactivo de permisos, la resolución del Active_Set y la verificación-antes-de-persistir de las 4 rutas que sí deben preexistir.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Asumiendo que el análisis de causa raíz es correcto (confirmado en Testing Strategy con la fase exploratoria):

#### Cambio 1 — Crear `modsvs` automáticamente antes de backup/instalar

**Archivo:** `src/main/domain/merge-orchestrator.ts`

**Función:** `#materialize`

En `#materialize`, tras crear el `workDir` y ANTES del Paso 4 (backup), agregar:

```
await this.#fs.ensureDir(this.#paths.modsvsFolder);
```

**Por qué aquí y no en `BackupManager`:** `MergeOrchestrator` es el único componente que ya coordina las tres escrituras en el Game_Root y que ya posee `MergeOrchestratorFileSystem.ensureDir` (lo usa para el `workDir`). Colocar el `ensureDir(modsvsFolder)` aquí, una sola vez antes del backup, garantiza que la carpeta exista para los tres pasos posteriores (backup, instalar, y el `.backup`). `BackupManager` documenta explícitamente (DECISIÓN 4) que NO crea directorios y su `BackupFileSystem` solo expone `exists` + `copyFile`; agregarle `ensureDir` violaría su contrato mínimo y duplicaría la responsabilidad. `ensureDir` es recursivo e idempotente, así que con `modsvs` ya existente es un no-op (preserva 3.7).

**Consideración de elevación:** este `ensureDir` es una escritura en el Game_Root. Debe ir envuelto en el manejo reactivo `#writeStep` (igual que backup/instalar/gameinfo) para que un `EACCES`/`EPERM` al crear `modsvs` en un directorio protegido dispare la elevación en vez de abortar (coherente con 3.3). Se ejecuta como un paso reactivo previo al backup.

#### Cambio 2 — Sacar `modsvsFolder` de `REQUIRED_PATH_KEYS`

**Archivo:** `src/main/domain/path-detector.ts`

**Constante:** `REQUIRED_PATH_KEYS`

Remover `"modsvsFolder"` de la lista, dejando las 4 rutas que sí deben preexistir:

```
const REQUIRED_PATH_KEYS: readonly RequiredPathKey[] = [
  "gameRoot",
  "workshopFolder",
  "vpkToolPath",
  "gameInfoFile",
];
```

**Impacto analizado:**
- `modsvsFolder` se SIGUE derivando en `derivePaths` y `#detectFromGameRoot` (`joinWindows(gameRoot, "modsvs")`) y se sigue persistiendo como parte de `GamePaths`. Solo deja de verificarse como preexistente.
- `verifyPathsOnDisk` ya no consultará `modsvs`, por lo que `#verifyThenManual` no lo incluirá en `missing` ni lo pedirá vía `ManualPathProvider`/`ManualPathRequest`. Se elimina así el camino que desviaba a la raíz.
- Las otras 4 rutas requeridas mantienen su verificación y selección manual re-verificada intactas (preserva 3.5, 3.6).

**Sobre el tipo `RequiredPathKey`:** se decide MANTENER `"modsvsFolder"` en la unión `RequiredPathKey` de `types.ts`. Razón: `PathVerification.present` usa `Record<RequiredPathKey, boolean>`, y sacar la clave del tipo obligaría a que `verifyPathsOnDisk` produzca un `Record` incompleto. Dado que `REQUIRED_PATH_KEYS` (el recorrido efectivo) ya no incluye `modsvsFolder`, `present` simplemente no tendrá esa entrada aunque el tipo la admita; esto es consistente porque `present`/`missing` se construyen recorriendo `REQUIRED_PATH_KEYS`. Se ajustará el JSDoc de `RequiredPathKey` y `PathVerification` para aclarar que `modsvsFolder` ya NO se verifica en disco (la app la crea), evitando la contradicción documental. (Alternativa descartada: sacar `modsvsFolder` del tipo y del `Record` — implicaría más cambios de tipos y tests por un beneficio marginal.)

#### Cambio 3 — Contemplar la ruta persistida incorrecta (bug pegajoso)

**Decisión:** NO se agrega lógica de migración/corrección explícita de un `modsvsFolder` mal guardado. El fix se corrige solo por dos vías combinadas:
- Al sacar `modsvsFolder` de `REQUIRED_PATH_KEYS`, la próxima ejecución de `detect()` re-deriva `modsvsFolder = <gameRoot>\modsvs` en `derivePaths`/`#detectFromGameRoot` sin pedir selección manual, y ese valor correcto se persiste, sobrescribiendo el incorrecto.
- Mientras tanto, `#materialize` crea `modsvs` con `ensureDir`, así que aun si una sesión arrancara con un valor cacheado, el destino correcto se materializa.

**Requisito de la decisión:** para que la corrección "sola" funcione, la próxima `detect()` debe re-derivar y re-persistir `GamePaths` en lugar de reutilizar ciegamente el `modsvsFolder` cacheado. Esto ya ocurre porque `detect()` deriva desde el registro/`libraryfolders.vdf` en cada corrida de detección. Se documenta explícitamente esta decisión y se añade un test de regresión que confirme que, partiendo de una ruta persistida incorrecta, tras `detect()` el `modsvsFolder` resultante es `<gameRoot>\modsvs`.

#### Cambio 4 — Reconciliar el JSDoc de `GamePaths.modsvsFolder`

**Archivo:** `src/main/domain/types.ts`

Cambiar el JSDoc de `modsvsFolder` de `<left4dead2Dir>\modsvs` a `<gameRoot>\modsvs`, consistente con `derivePaths` y con el comportamiento confirmado por el usuario. Es solo documentación (no testeable por comportamiento).

## Testing Strategy

### Validation Approach

Enfoque en dos fases: primero surfacer contraejemplos que demuestren el bug sobre el código SIN fixear, confirmando la causa raíz; luego verificar que el fix funciona y que preserva el comportamiento existente. Se usan dobles en memoria y property tests con fast-check, siguiendo el patrón existente del proyecto (`test/helpers/orchestrator-doubles.ts`, `test/helpers/property.ts`).

### Exploratory Bug Condition Checking

**Goal:** Surfacer contraejemplos que demuestren el bug ANTES del fix y confirmar (o refutar) el análisis de causa raíz. Si se refuta, re-hipotetizar.

**Test Plan:** Escribir tests que ejecuten (a) `PathDetector.detect` con un FS en memoria donde `<gameRoot>\modsvs` NO existe y un `ManualPathProvider` que devuelve la raíz del juego, y (b) `MergeOrchestrator.#materialize` (vía `applyActiveSet`) con un FS que registra `ensureDir`/`copyFile`. Correr sobre el código SIN fixear para observar los fallos.

**Test Cases:**
1. **Detección fresca desvía a la raíz**: `detect()` con `modsvs` inexistente marca `modsvsFolder` como faltante y, tras la selección manual de la raíz, resuelve `modsvsFolder = <gameRoot>` (fallará el aserto de `<gameRoot>\modsvs` sobre el código sin fix).
2. **`#materialize` no crea `modsvs`**: sobre el código sin fix, se observa que `ensureDir` se invoca solo con el `workDir`, nunca con `modsvsFolder` (fallará el aserto de que `ensureDir(modsvsFolder)` ocurre antes del backup).
3. **`installTarget`/`backupPath` fuera de `modsvs`**: con `modsvsFolder` desviado a la raíz, el destino de copia es `<gameRoot>\pak01_dir.vpk` (fallará el aserto de contenedor `<gameRoot>\modsvs`).

**Expected Counterexamples:**
- `modsvsFolder` resuelto = `<gameRoot>` en instalación fresca.
- `ensureDir` nunca llamado con `modsvsFolder`.
- Causa confirmada: `modsvsFolder` en `REQUIRED_PATH_KEYS` + ausencia de `ensureDir(modsvsFolder)` en `#materialize`.

### Fix Checking

**Goal:** Verificar que para todo input donde se cumple la bug condition, la función fijada produce el comportamiento esperado (Property 1).

**Pseudocode:**
```
FOR ALL state WHERE isBugCondition(state) DO
  result := materialize_fixed(state)
  ASSERT modsvsFolder_fixed == joinWindows(gameRoot, "modsvs")
  ASSERT parentDir(result.installTarget) == joinWindows(gameRoot, "modsvs")
  ASSERT parentDir(result.backupPath) == joinWindows(gameRoot, "modsvs")
  ASSERT ensureDir(modsvsFolder) fue invocado ANTES del backup
END FOR
```

### Preservation Checking

**Goal:** Verificar que para todo input donde la bug condition NO se cumple, la función fijada produce el mismo resultado que la original (Property 2).

**Pseudocode:**
```
FOR ALL state WHERE NOT isBugCondition(state) DO
  ASSERT materialize_original(state) == materialize_fixed(state)
END FOR
```

**Testing Approach:** Se recomienda property-based testing para la preservación porque genera muchos casos automáticamente sobre el dominio de `gameRoot`, cubre edge cases que los unit tests podrían omitir, y da garantías fuertes de que el comportamiento no cambia para los inputs no-buggy.

**Test Plan:** Observar el comportamiento del código SIN fix para los casos ya funcionales (backup de un nivel, no-op de primera instalación, `modsvs` preexistente, las 4 rutas requeridas) y escribir tests que confirmen que ese comportamiento se mantiene tras el fix.

**Test Cases:**
1. **Backup de un solo nivel**: con `pak01_dir.vpk` previo en `modsvs`, el backup sigue sobrescribiendo `pak01_dir.vpk.backup` sin acumular niveles (3.1).
2. **No-op de primera instalación**: sin `pak01_dir.vpk` que respaldar, `backupExisting` sigue devolviendo `{ created: false }` sin abortar (3.2).
3. **`modsvs` preexistente**: con la carpeta ya presente, `ensureDir` es no-op idempotente y la instalación es idéntica a la actual (3.7).
4. **Las 4 rutas requeridas**: `verifyPathsOnDisk` sigue verificando y pidiendo manualmente `gameRoot`/`workshopFolder`/`vpkToolPath`/`gameInfoFile` si faltan (3.5, 3.6).

### Unit Tests

- `MergeOrchestrator` invoca `ensureDir(modsvsFolder)` ANTES del paso de backup (verificar el orden relativo a `ensureDir(workDir)` y al backup).
- Instalación fresca (`modsvs` inexistente): el `installTarget` y el `backupPath` quedan bajo `<gameRoot>\modsvs\`, nunca en la raíz.
- `PathDetector` ya no marca `modsvsFolder` como faltante ni lo pide vía `ManualPathProvider` cuando `modsvs` no existe.
- Regresión del bug pegajoso: partiendo de un `modsvsFolder` persistido = `<gameRoot>`, tras `detect()` el resultado re-derivado es `<gameRoot>\modsvs`.
- El `ensureDir(modsvsFolder)` que falla por `EACCES`/`EPERM` dispara el manejo reactivo (`#writeStep` → `handleWriteFailure`) en vez de abortar.
- El JSDoc de `GamePaths.modsvsFolder` reconciliado a `<gameRoot>\modsvs` (no testeable por comportamiento; verificación por revisión).

### Property-Based Tests

- **Property 1 (mín. 100 iteraciones, fast-check):** para cualquier `gameRoot` válido generado, tras `#materialize` con el fix, tanto `installTarget` como `backupPath` tienen como carpeta contenedora exactamente `<gameRoot>\modsvs` (`parentDir(installTarget) === joinWindows(gameRoot, "modsvs")` y lo mismo para `backupPath`). Reutilizar el patrón de arbitraries y dobles de `test/merge-orchestrator.property.test.ts` y `test/helpers/orchestrator-doubles.ts`.
- **Property 2 (preservación):** para cualquier `gameRoot` válido con `modsvs` ya presente (`¬C(X)`), la secuencia de llamadas a los dobles (backup, copyFile de instalación, gameinfo, saveManifest) es idéntica entre el código original y el fijado.

### Integration Tests

- Flujo completo de `applyActiveSet` en instalación fresca (sin `modsvs`): la carpeta se crea y el `.vpk` fusionado queda en `<gameRoot>\modsvs\pak01_dir.vpk`.
- Flujo `detect()` → `applyActiveSet` encadenado: la detección re-deriva `modsvsFolder` correcto y la materialización instala dentro de `modsvs`.
- Regresión de la suite existente: los tests de `merge-orchestrator`, `backup-manager` y `path-detector` deben seguir pasando. Se anticipa que hay que AJUSTAR los tests de `path-detector` que asumían `modsvsFolder` dentro de `REQUIRED_PATH_KEYS` (esperaban que se verificara/pidiera `modsvs`); esos asertos deben actualizarse para reflejar que `modsvs` ya no se verifica en disco.

---

## Notas de proceso

**Commit (formato CONTRIBUTING.md):**
```
fix(dominio): crear modsvs y no exigirla como ruta preexistente (bug BUG-009)
```

**Registro en `Context/04-historial-decisiones.md`:** añadir una entrada con el formato de las secciones anteriores (Qué / Decisión / Motivo / Impacto) documentando: (a) `ensureDir(modsvsFolder)` en `#materialize` y por qué ahí y no en `BackupManager`; (b) la remoción de `modsvsFolder` de `REQUIRED_PATH_KEYS` manteniendo la clave en el tipo `RequiredPathKey`; (c) la decisión de corregir el bug pegajoso por re-derivación en `detect()` sin migración explícita; (d) la reconciliación del JSDoc a `<gameRoot>\modsvs`.
