# Implementation Plan: L4D2 Versus Addon Manager

## Overview

Este plan implementa el **Núcleo Validado** (Requisitos 1-9) del L4D2 Versus Addon Manager sobre Electron + TypeScript. La estrategia es incremental y prioriza el proceso **main** (agnóstico de UI), porque ahí vive todo el mecanismo ya validado end-to-end (fusión de VPK, detección de rutas, batching, colisiones, VScript). La UI se construye al final sobre un núcleo ya probado.

Orden de construcción:
1. Andamiaje del proyecto (Electron + TS + test runner + fast-check).
2. Núcleo del proceso main, componente por componente, cada uno con sus tests de propiedad y/o unitarios.
3. El orquestador (`MergeOrchestrator`) que cablea el flujo completo.
4. La capa IPC/preload tipada.
5. La capa UI (renderer), marcada como opcional/posterior al núcleo.

El diseño usa **TypeScript** en main y renderer, por lo que todo el código y los tests se escriben en TypeScript. El property-based testing usa **fast-check** (mínimo 100 iteraciones por propiedad; una propiedad = un test; etiqueta `Feature: l4d2-versus-addon-manager, Property N: ...`).

La **Fase Posterior (Requisitos 10-19)** NO se detalla aquí: queda fuera del MVP. Solo se lista al final una sección opcional de placeholders para constancia de scope.

## Tasks

- [x] 1. Andamiaje del proyecto (Electron + TypeScript + testing + fast-check)
  - Inicializar el proyecto Electron con TypeScript (main + preload + renderer), configurar `tsconfig` estricto, `electron-builder`/empaquetado base y el manifest de aplicación con `asInvoker` (no `requireAdministrator`)
  - Definir la estructura de carpetas: `src/main/domain/`, `src/main/app/`, `src/main/data/`, `src/preload/`, `src/renderer/`, `test/`, `test/fixtures/`
  - Configurar el test runner (Vitest o Jest) e integrar **fast-check**; crear un helper de test que fije `numRuns` a un mínimo de 100 iteraciones y una convención de nombre de propiedad `Feature: l4d2-versus-addon-manager, Property N: <título>`
  - Definir los tipos de dominio compartidos en un módulo (`GamePaths`, `LibraryEntry`, `ScannedAddon`, `AddonInfo`, `VScriptClassification`, `AddonManifestEntry`, `ExtractedRoot`, `MergeReport`, `FileCollision`, `PendingOperation`, `ElevationOutcome`, `OperationResult`)
  - _Requirements: base para 1-9_

- [ ] 2. VpkTool: wrapper de `vpk.exe` (lógica con mocks)
  - [x] 2.1 Implementar el filtrado de ruido de la salida de `vpk.exe`
    - Función pura que descarta líneas de stdout que comienzan con `CDynamicFunction:`, `FS:` o `Using`, conservando el resto sin alterarlas; usada por `list()`
    - _Requirements: 6.2_

  - [x]* 2.2 Escribir property test del filtrado de ruido
    - **Feature: l4d2-versus-addon-manager, Property 8: Filtrado del ruido de la VPK_Tool**
    - **Validates: Requirements 6.2**
    - fast-check, mínimo 100 iteraciones, generando stdout con mezcla arbitraria de líneas de ruido y líneas válidas

  - [x] 2.3 Implementar el batching por longitud de línea de comando
    - Función pura de particionado de `internalPaths` en lotes tales que la longitud total (`vpk.exe` + vpk + paths) no exceda un límite seguro (~6000, margen por debajo de ~8191); un path que por sí solo excede el límite queda en lote individual
    - _Requirements: 6.4, 6.5_

  - [ ]* 2.4 Escribir property test del batching
    - **Feature: l4d2-versus-addon-manager, Property 9: Batching por longitud de línea de comando sin pérdida de archivos**
    - **Validates: Requirements 6.4, 6.5**
    - fast-check, mínimo 100 iteraciones; verifica (a) límite por lote, (b) unión = entrada sin omisiones ni duplicados, (c) path sobredimensionado en lote individual

  - [ ] 2.5 Implementar la traducción de separadores de path
    - Función pura que deriva el path de destino en disco (`\`) a partir del path interno del VPK (`/`), preservando la interpretación interna con `/`
    - _Requirements: 6.6_

  - [ ]* 2.6 Escribir property test de separadores de path
    - **Feature: l4d2-versus-addon-manager, Property 10: Coherencia de separadores de path**
    - **Validates: Requirements 6.6**
    - fast-check, mínimo 100 iteraciones

  - [ ] 2.7 Implementar `VpkTool` (`list`, `extract`, `pack`) sobre un ejecutor inyectable
    - Ejecuta `vpk l`/`vpk x`/`vpk <carpeta>` vía un `CommandRunner` inyectado (`execFile`/`spawn`, argumentos como array, sin shell); `list` aplica el filtrado (2.1), `extract` usa el batching (2.3) y crea `destDir` como working directory; cualquier exit distinto de éxito se propaga como error tipado que identifica el addon
    - _Requirements: 6.1, 6.3, 6.12_

  - [ ]* 2.8 Escribir unit tests de `VpkTool` con ejecutor mockeado
    - Verifica invocación correcta de argumentos, propagación de exit codes como error tipado y wiring de filtrado/batching; sin tocar `vpk.exe` real
    - _Requirements: 6.1, 6.3, 6.12_

- [ ]* 3. VpkTool: test de integración con `vpk.exe` real (requiere el binario)
  - [ ]* 3.1 Crear fixtures de VPK de prueba reales, incluyendo uno de >200 archivos
    - Generar/incluir VPKs de prueba en `test/fixtures/vpk/`; uno debe contener **más de 200 archivos** para confirmar que el batching evita el fallo `exit -1` de pasar cientos de argumentos de una vez
    - _Requirements: 6.4, 6.5_

  - [ ]* 3.2 Escribir test de integración de `VpkTool` contra `vpk.exe`
    - Ejecuta `list` → `extract` (por lotes) → `pack` sobre los fixtures reales; verifica que la extracción del fixture de >200 archivos completa sin `exit -1` y que todos los archivos se extraen; se ejecuta solo si el binario `vpk.exe` está disponible
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.8, 6.12_

- [ ] 4. Checkpoint - Asegurar que los tests del wrapper VPK pasan
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. PathDetector (Requirement 1)
  - [ ] 5.1 Implementar el parseo de `libraryfolders.vdf` y `findGameLibrary`
    - Parser KeyValues de Valve; `findGameLibrary` selecciona la primera entrada cuyo bloque `apps` contiene la clave `550` en orden de aparición, o `null`
    - _Requirements: 1.3, 1.5_

  - [ ]* 5.2 Escribir property test de selección de biblioteca
    - **Feature: l4d2-versus-addon-manager, Property 1: Selección de la primera biblioteca con L4D2**
    - **Validates: Requirements 1.5**
    - fast-check, mínimo 100 iteraciones, generando contenidos válidos de `libraryfolders.vdf` con 0..n bibliotecas conteniendo o no la clave `550`

  - [ ] 5.3 Implementar lectura del registro, derivación de rutas y verificación en disco
    - `readSteamPath` (HKCU\Software\Valve\Steam:SteamPath, `null` si ausente), `derivePaths` (usa el `path` de la Game_Library incluso en otro disco), `verifyPathsOnDisk` (marca faltantes), y `detect` que orquesta todo y ofrece selección manual con re-verificación ante fallos; el acceso al registro y al FS se inyecta para testeo
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12_

  - [ ]* 5.4 Escribir property test de verificación previa a persistencia
    - **Feature: l4d2-versus-addon-manager, Property 2: Ninguna ruta se persiste sin verificación en disco**
    - **Validates: Requirements 1.9, 1.11, 1.13**
    - fast-check con FS mockeado, mínimo 100 iteraciones; solo se persisten rutas verificadas, y toda ruta requerida inexistente se marca faltante

- [ ] 6. AddonScanner (Requirement 2)
  - [ ] 6.1 Implementar el escaneo de la Workshop_Folder
    - Incluye solo `.vpk` de nivel superior (ignora subdirectorios y otras extensiones); trata `<id>.vpk` como Addon `<id>`; asocia `<id>.jpg` como Addon_Cover si existe (`null` si no); lectura opcional de `addoninfo.txt` interno que no bloquea el escaneo; FS inyectado
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 6.2 Escribir property test del contenido del escaneo
    - **Feature: l4d2-versus-addon-manager, Property 3: El escaneo incluye exactamente los `.vpk` de nivel superior**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - fast-check con FS mockeado, mínimo 100 iteraciones, generando mezclas arbitrarias de `.vpk`, `.jpg`, otras extensiones y subdirectorios

  - [ ]* 6.3 Escribir property test de asociación de Addon_Cover
    - **Feature: l4d2-versus-addon-manager, Property 4: Asociación correcta de Addon_Cover**
    - **Validates: Requirements 2.4**
    - fast-check con FS mockeado, mínimo 100 iteraciones; cover = ruta de `<id>.jpg` si existe, `null` si no

- [ ] 7. VScriptDetector (Requirement 3)
  - [ ] 7.1 Implementar la clasificación VScript a partir del listado del VPK
    - Usa `VpkTool.list`; clasifica como VScript_Addon si y solo si hay un path con prefijo `scripts/vscripts/` (case-insensitive) y extensión `.nut` (case-insensitive); ignora `.nut` fuera de ese prefijo; **nunca** usa el flag `addonContent_Script`; si `vpk l` falla, clasifica como VScript_Addon por precaución
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 7.2 Escribir property test de clasificación VScript
    - **Feature: l4d2-versus-addon-manager, Property 5: Clasificación VScript a partir del listado real**
    - **Validates: Requirements 3.2, 3.3, 3.4**
    - fast-check, mínimo 100 iteraciones, generando listados con paths `.nut` dentro y fuera de `scripts/vscripts/` y variaciones de mayúsculas

- [ ] 8. Reglas de inclusión del Active_Set (Requirement 3.7, 3.8)
  - [ ] 8.1 Implementar la política de inclusión de addons en el Active_Set
    - Función pura que decide si un Addon forma parte del Active_Set: permitido si no es VScript_Addon, o si es VScript_Addon con confirmación explícita de forzado; bloqueado por defecto en caso contrario
    - _Requirements: 3.6, 3.7, 3.8_

  - [ ]* 8.2 Escribir property test de inclusión bloqueada de VScript_Addon
    - **Feature: l4d2-versus-addon-manager, Property 6: Inclusión bloqueada de VScript_Addon salvo confirmación explícita**
    - **Validates: Requirements 3.7, 3.8**
    - fast-check, mínimo 100 iteraciones, variando `isVScriptAddon` y la confirmación del usuario

- [ ] 9. Checkpoint - Asegurar que los tests de detección/escaneo/clasificación pasan
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. CollisionResolver (Requirement 7)
  - [ ] 10.1 Implementar la fusión con política "el último del Priority_Order gana"
    - `mergeInto` recorre los `extractedRoots` en orden ascendente de Priority_Order y copia a `destDir` sobrescribiendo en colisión (gana el último); registra las File_Collision en el `MergeReport` (contributors + winner); FS inyectado
    - _Requirements: 7.1, 7.2_

  - [ ] 10.2 Implementar la selección determinista del ganador por colisión (núcleo puro)
    - Extraer la lógica pura que, dado el contenido por addon y el Priority_Order, determina el archivo final de cada path (independiente del I/O) para poder testearla como propiedad
    - _Requirements: 6.7, 7.1, 7.2_

  - [ ]* 10.3 Escribir property test de fusión determinista y "el último gana"
    - **Feature: l4d2-versus-addon-manager, Property 11: Fusión determinista y "el último del Priority_Order gana"**
    - **Validates: Requirements 6.7, 7.1, 7.2**
    - fast-check, mínimo 100 iteraciones, generando conjuntos de addons con contenidos colisionantes y Priority_Orders arbitrarios; verifica determinismo y ganador correcto

- [ ] 11. MergeEngine (Requirement 6, núcleo de fusión)
  - [ ] 11.1 Implementar el flujo de fusión list → crear dirs → extraer por lotes → fusionar → empaquetar
    - `merge` recibe addons en Priority_Order ascendente; por addon: `VpkTool.list` → crear subdirectorios → `VpkTool.extract` por lotes; delega en `CollisionResolver.mergeInto` la fusión a `pak01_dir/`; `VpkTool.pack(pak01_dir)` genera `pak01_dir.vpk`; aborta e informa el addon que falló si una extracción devuelve exit distinto de éxito
    - _Requirements: 6.3, 6.7, 6.8, 6.12_

  - [ ]* 11.2 Escribir unit tests del MergeEngine con VpkTool/FS mockeados
    - Verifica el orden del flujo, la creación de subdirectorios previa a la extracción, la generación del `pak01_dir.vpk` y el aborto con identificación del addon ante fallo de extracción
    - _Requirements: 6.3, 6.8, 6.12_

- [ ] 12. BackupManager (Requirement 5)
  - [ ] 12.1 Implementar el backup de un único nivel
    - `backupExisting` copia el `pak01_dir.vpk` actual de `modsvs/` a la ubicación de backup antes de sobrescribir; si ya existe un backup previo lo sobrescribe (un solo nivel); propaga fallo para que el orquestador aborte; FS inyectado
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 12.2 Escribir property test del backup de un único nivel
    - **Feature: l4d2-versus-addon-manager, Property 7: Backup previo a toda sobrescritura, con un único nivel**
    - **Validates: Requirements 5.1, 5.3**
    - fast-check con FS mockeado, mínimo 100 iteraciones, sobre secuencias de instalaciones que sobrescriben; verifica backup previo a la sobrescritura y a lo sumo un nivel de backup

- [ ] 13. GameInfoEditor (Requirement 6.10)
  - [ ] 13.1 Implementar `ensureModsvsFirst` con los tres casos y colapso de duplicados
    - Parsea `GameInfo > FileSystem > SearchPaths`; Caso A (ausente → insertar primero), Caso B (existe no-primera o múltiple → mover/colapsar a única primera), Caso C (ya primera y única → sin cambios, idempotente); preserva el orden relativo del resto de SearchPaths; núcleo de transformación de texto puro con I/O inyectado
    - _Requirements: 6.10_

  - [ ]* 13.2 Escribir property test de `Game modsvs` primero, único e idempotente
    - **Feature: l4d2-versus-addon-manager, Property 12: `Game modsvs` como primer y único SearchPath, de forma idempotente**
    - **Validates: Requirements 6.10**
    - fast-check, mínimo 100 iteraciones, generando bloques SearchPaths con `modsvs` ausente / no-primero / múltiple; verifica primera-y-única, preservación del orden del resto e idempotencia de una segunda aplicación

- [ ] 14. ProcessGuard (Requirement 4)
  - [ ] 14.1 Implementar la detección del proceso `left4dead2.exe`
    - `isGameRunning` busca específicamente `left4dead2.exe` (no `hl2.exe`) vía un proveedor de lista de procesos inyectable
    - _Requirements: 4.1_

  - [ ]* 14.2 Escribir unit tests de ProcessGuard con proveedor de procesos mockeado
    - Casos: juego en ejecución, juego cerrado, y presencia de `hl2.exe` que no debe contar
    - _Requirements: 4.1, 4.2_

- [ ] 15. LocalStore (persistencia; motor a elección)
  - [ ] 15.1 Definir la interfaz `LocalStore` y elegir el motor de persistencia
    - Definir `LocalStore` (`getPaths`/`savePaths`/`getManifest`/`saveManifest`) desacoplada del motor concreto; implementar el motor recomendado **SQLite vía `better-sqlite3`** (con `electron-rebuild`), dejando la puerta abierta a una implementación **JSON plano** alternativa detrás de la misma interfaz; el manifest guarda solo `{ addonId, priorityOrder }`
    - Añadir a la interfaz los métodos de **estado de sesión pendiente**: `savePendingSession(entries)`, `getPendingSession()` y `clearPendingSession()`, que persisten el **Active_Set candidato** (selección + Priority_Order) como fuente de verdad para rehidratar la UI tras un relanzo elevado; el estado se escribe ANTES de relanzar con `runas` y la instancia elevada lo lee al arrancar (ver tareas 17.1 y 18.2)
    - _Requirements: 1.13, 8.1, 8.6, 9.2_

  - [ ]* 15.2 Escribir property test de round-trip del Addon_Manifest
    - **Feature: l4d2-versus-addon-manager, Property 14: Round-trip de persistencia del Addon_Manifest**
    - **Validates: Requirements 8.1, 8.6**
    - fast-check, mínimo 100 iteraciones, contra un store en memoria/temporal; guardar y leer produce el mismo conjunto de entradas

  - [ ]* 15.3 Escribir unit tests del estado de sesión pendiente
    - Verifica el ciclo `savePendingSession` → `getPendingSession` → `clearPendingSession` contra un store en memoria/temporal: tras guardar se lee el mismo Active_Set candidato (selección + Priority_Order), y tras limpiar `getPendingSession` devuelve vacío/`null`; cubre el soporte de rehidratación del relanzo elevado
    - _Requirements: 8.6, 9.2_

- [ ] 16. Checkpoint - Asegurar que los tests de fusión, backup, gameinfo y persistencia pasan
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. ElevationService (Requirement 9.2, elevación UAC bajo demanda)
  - [ ] 17.1 Implementar la heurística y los primitivos de elevación
    - `isProtectedPath` (p. ej. bajo `Program Files`), `isElevated`, `needsElevation` (protegido o probe write que falla), `relaunchElevated` (re-lanza la app con verbo `runas`); SO/relaunch inyectados
    - **Antes de relanzar**, `relaunchElevated` persiste el estado de sesión pendiente vía `LocalStore.savePendingSession(...)` (Active_Set candidato: selección + Priority_Order), de modo que la instancia elevada rehidrate leyéndolo del LocalStore y NO de la línea de comando
    - La instancia sin privilegios se **cierra** una vez lanzada la elevada (**reemplazo total**, no coexisten); la `PendingOperation` transferida por args/archivo es **mínima** (`type` + `resumeHandle`), nunca el Active_Set completo
    - _Requirements: 9.2_

  - [ ] 17.2 Implementar los caminos proactivo y reactivo de decisión de elevación
    - Tanto `ensureCanWrite` como `handleWriteFailure` chequean `isElevated()` **PRIMERO**: si la instancia actual ya está elevada, proceden a **escribir directo SIN relanzar ni pedir UAC otra vez** (elevación **una vez por sesión**, no por operación). El relanzo `runas` solo ocurre si se necesita elevar Y la instancia actual NO está elevada
    - `ensureCanWrite` (proactivo: si ya `isElevated`, devuelve `already-writable`; si no, y `needsElevation`, dispara relaunch; devuelve `already-writable` / `elevated-handoff` / `denied`) y `handleWriteFailure` (reactivo: ante `EACCES`/`EPERM`, si ya `isElevated` reintenta directo sin relanzar, y si no intenta elevar y reintentar; ante error no-permisos devuelve `already-writable` para que el orquestador propague sin elevar); lógica de decisión pura y aislable
    - _Requirements: 9.2_

  - [ ]* 17.3 Escribir property test del intento de elevación ante fallo de permisos
    - **Feature: l4d2-versus-addon-manager, Property 15: Todo fallo de escritura por permisos intenta elevar antes de fallar definitivamente**
    - **Validates: Requirements 9.2**
    - fast-check con ejecutor/FS mockeado, mínimo 100 iteraciones, variando el `code` del error (`EACCES`/`EPERM` vs `ENOENT`), el resultado del intento de elevación (aceptado/denied/falla) y el éxito de la escritura reintentada; error no-permisos no dispara elevación

- [ ] 18. MergeOrchestrator (capa de aplicación; Requisitos 4, 5, 6, 8)
  - [ ] 18.1 Implementar `applyActiveSet`, `addAddon` y `removeAddon` con el orden garantizado
    - Secuencia: `ProcessGuard.isGameRunning` (abortar si corre) → resolver Active_Set + Priority_Order (add/remove = fusión completa desde cero) → `ElevationService.ensureCanWrite` (proactivo) → `BackupManager.backupExisting` (abortar si falla) → `MergeEngine.merge` → instalar en `modsvs/` → `GameInfoEditor.ensureModsvsFirst` → `LocalStore.saveManifest` → notificar resultado; las escrituras de los pasos de backup/instalación/gameinfo van envueltas para invocar `ElevationService.handleWriteFailure` (reactivo) ante `EACCES`/`EPERM` y reintentar en la instancia elevada
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 6.9, 6.11, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.2_

  - [ ] 18.2 Implementar el arranque de la instancia elevada que ejecuta la PendingOperation
    - Al arrancar, si hay una `PendingOperation` transferida (mínima: `type` + `resumeHandle`), la instancia elevada **REHIDRATA** el estado leyendo `LocalStore.getPendingSession()` (NO de los argumentos), reconstruyendo la vista (lista, selección, Priority_Order, Activos) desde el LocalStore + re-escaneo para que la transición sea **transparente**
    - Luego **materializa** la operación (backup → merge → instalar → gameinfo → manifest) reconstruyendo add/remove desde los VPK originales; al terminar **limpia** el estado con `LocalStore.clearPendingSession()` y reporta el resultado
    - _Requirements: 8.3, 8.4, 8.5, 9.2_

  - [ ]* 18.3 Escribir property test de equivalencia add/remove ↔ fusión completa
    - **Feature: l4d2-versus-addon-manager, Property 13: Agregar o quitar equivale a una fusión completa desde cero**
    - **Validates: Requirements 8.3, 8.4, 8.5**
    - fast-check con MergeEngine/FS mockeados, mínimo 100 iteraciones; el resultado de add/remove es idéntico a la fusión completa directa del Active_Set final

  - [ ]* 18.4 Escribir unit tests del orden y precondiciones del orquestador
    - Verifica aborto si el juego corre, aborto si el backup falla, orden backup→merge→instalar→gameinfo→manifest, y disparo de `handleWriteFailure` ante `EACCES`/`EPERM` con reintento
    - _Requirements: 4.1, 4.2, 5.2, 6.9, 6.11, 8.6_

- [ ] 19. Checkpoint - Asegurar que el núcleo del proceso main y su orquestador pasan todos los tests
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Capa IPC / preload tipada
  - [ ] 20.1 Definir los canales IPC tipados y el preload con `contextBridge`
    - Preload expone una API tipada (aislamiento de contexto activado, sin `nodeIntegration`); definir canales para detectar rutas, seleccionar ruta manual, escanear, clasificar VScript, obtener/guardar Active_Set y aplicar/agregar/quitar addons, más eventos de progreso vía `webContents.send`
    - _Requirements: base de exposición para 1, 2, 3, 6, 7, 8, 9_

  - [ ] 20.2 Implementar los handlers `ipcMain.handle` que delegan en dominio/orquestador
    - Cada canal delega en `PathDetector`, `AddonScanner`, `VScriptDetector` o `MergeOrchestrator`; emite progreso y devuelve resultados/errores tipados al renderer
    - _Requirements: 1.2, 1.10, 2.6, 3.6, 6.11, 8.2_

  - [ ]* 20.3 Escribir unit tests de los handlers IPC con dominio mockeado
    - Verifica el ruteo canal→componente, la serialización de resultados/errores y la emisión de progreso
    - _Requirements: 6.11, 8.2_

- [ ] 21. Capa UI (renderer) — construida sobre el núcleo ya probado
  - [ ]* 21.1 Implementar la lista de addons con Addon_Cover, metadata y marca de VScript
    - Lista con portada y metadata; marca los VScript_Addon con advertencia y bloqueo por defecto, con opción de forzar inclusión mediante confirmación explícita; framework a elección (React recomendado)
    - _Requirements: 2.6, 3.6, 3.7, 3.8_

  - [ ]* 21.2 Implementar la sección "Activos" y el reordenamiento de Priority_Order
    - Muestra el Active_Set instalado, permite agregar/quitar en caliente y reordenar el Priority_Order antes de fusionar; invoca los canales IPC correspondientes
    - _Requirements: 7.3, 8.2_

  - [ ]* 21.3 Implementar los avisos de confianza y seguridad
    - Aviso `sv_pure`, aviso de posible prompt UAC ("editor desconocido") al escribir sobre `Program Files`, disclaimer fan-made, nota de SmartScreen y aviso de posible reversión por verificación de Steam; incluye el flujo de selección manual de rutas ante fallos de detección
    - _Requirements: 1.2, 1.10, 1.12, 9.1, 9.2, 9.3, 9.5_

  - [ ]* 21.4 Cablear la UI a la API del preload y mostrar el progreso/resultado de las operaciones
    - Conecta las vistas a los canales IPC (detección, escaneo, clasificación, aplicar/agregar/quitar) y refleja los eventos de progreso y el resultado final
    - _Requirements: 6.11, 8.2_

- [ ] 22. Checkpoint final - Asegurar que todos los tests pasan
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido. Incluyen: tests (unitarios, de propiedad e integración), el test de integración de `vpk.exe` real que requiere el binario (tarea 3), y toda la capa UI (tarea 21), de modo que primero pueda validarse el núcleo del proceso main de forma automatizada antes de invertir en la UI.
- Cada tarea referencia sus requisitos y/o la propiedad de corrección que cubre para trazabilidad.
- Los checkpoints garantizan validación incremental en cada corte razonable.
- **Property-based testing con fast-check**: las 15 Correctness Properties del diseño se cubren en tareas 2.2, 2.4, 2.6 (Props 8, 9, 10), 5.2, 5.4 (Props 1, 2), 6.2, 6.3 (Props 3, 4), 7.2 (Prop 5), 8.2 (Prop 6), 10.3 (Prop 11), 12.2 (Prop 7), 13.2 (Prop 12), 15.2 (Prop 14), 17.3 (Prop 15) y 18.3 (Prop 13). Cada propiedad es un test independiente, con mínimo 100 iteraciones y etiqueta `Feature: l4d2-versus-addon-manager, Property N: ...`.
- **Wrapper de `vpk.exe` en dos niveles**: la lógica (filtrado, batching, separadores) se prueba con propiedades y mocks (tarea 2); la integración con VPKs reales —incluyendo un fixture de >200 archivos para confirmar que el batching evita el fallo `exit -1`— se prueba aparte y es opcional por requerir el binario (tarea 3).
- **Persistencia**: la interfaz `LocalStore` está desacoplada del motor; se recomienda SQLite (`better-sqlite3`) pero la tarea 15.1 permite elegir JSON plano detrás de la misma interfaz.
- **Orden**: primero el núcleo del proceso main (agnóstico de UI), luego el orquestador, luego IPC y finalmente la UI, cuyo framework (React vs Angular) queda abierto.

### Fase Posterior (Nice to Have) — fuera del MVP

Los Requisitos 10-19 (dependencias, favoritos, presets, categorías/orden/búsqueda, hover, tweak de visión de infectado, botón "Jugar", detección de reversión, sincronía con la Workshop, cache de miniaturas) **no** se detallan en tareas de implementación aquí. Se abordarán en un plan posterior una vez que el núcleo (Req 1-9) esté completo y estable. Nota: el pendiente P-05 (fuente de datos de dependencias) debe resolverse antes de planificar el Requisito 10.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "2.3", "2.5", "5.1", "6.1", "13.1", "14.1", "15.1", "17.1"] },
    { "id": 1, "tasks": ["2.2", "2.4", "2.6", "5.2", "6.2", "6.3", "10.1", "12.1", "13.2", "14.2", "15.2", "15.3", "17.2"] },
    { "id": 2, "tasks": ["2.7", "3.1", "5.3", "7.1", "8.1", "10.2", "12.2", "17.3"] },
    { "id": 3, "tasks": ["2.8", "3.2", "5.4", "7.2", "8.2", "10.3", "11.1"] },
    { "id": 4, "tasks": ["11.2", "18.1"] },
    { "id": 5, "tasks": ["18.2", "18.4", "20.1"] },
    { "id": 6, "tasks": ["18.3", "20.2"] },
    { "id": 7, "tasks": ["20.3", "21.1", "21.2", "21.3"] },
    { "id": 8, "tasks": ["21.4"] }
  ]
}
```
