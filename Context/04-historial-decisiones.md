# Historial de Decisiones

Log de cambios de rumbo, correcciones de terminología y decisiones importantes con fecha y motivo. Orden cronológico ascendente (más antiguo primero).

---

## 2026-09

### [2026-09] Creación del proyecto y documentación inicial (v1)
**Qué:** Se define el concepto base del proyecto: app de escritorio para gestionar addons de Workshop en L4D2 Versus sin empaquetar VPKs manualmente.
**Decisiones tomadas:** funcionalidades core, filtro anti-VScript, resolución de dependencias, proceso de habilitación en background.
**Estado:** sin stack definido, sin análisis de competencia.

---

### [2026-09] Análisis de competencia y refinamiento del scope (v2)
**Qué:** Se investiga *funky* (pukmajster) y *L4D2ModManager* (xavier-cai), los gestores existentes.
**Decisión:** no competir en todo, sino enfocarse en los tres diferenciadores que funky no cubre explícitamente: filtro anti-VScript, resolución de dependencias, y fusión de VPKs resuelta de forma clara para Versus.
**Motivo:** evitar construir un clon peor de un proyecto ya maduro y bien mantenido.

---

### [2026-09] Stack definido: Electron + React/Angular + TypeScript
**Qué:** Se decide usar Electron como framework de escritorio.
**Motivo:** el desarrollador tiene experiencia previa en Angular/React + TypeScript, lo que reduce la fricción. Tauri fue evaluado pero descartado por la curva de aprendizaje adicional en Rust para un side project.
**Nota:** la elección entre React y Angular dentro del stack sigue pendiente (ver `02-pendientes.md` P-12).

---

### [2026-09] Cambio de terminología: "inyección" -> "fusión"
**Qué:** El término usado en v1 para describir el proceso central era "inyección de archivos". En v2 se adoptó "fusión de VPKs".
**Motivo:** "inyección" tiene connotaciones de modificación en memoria o en tiempo de ejecución, lo que es impreciso. "Fusión" describe mejor la operación real: combinar el contenido de múltiples VPKs en uno que el engine pueda cargar.
**Impacto:** el término "fusión" es el canónico en toda la documentación de este proyecto a partir de la v2.

---

### [2026-09] Se agregan consideraciones de seguridad/confianza al scope
**Qué:** Se añaden como requisitos: backups automáticos antes de modificar archivos, aviso sobre `sv_pure`, advertencia de verificación de Steam, y aviso de SmartScreen documentado.
**Motivo:** una app que modifica archivos del juego debe ganar la confianza del usuario desde el primer uso. Funky tiene el mismo problema con SmartScreen y lo advierte en su README - se adopta el mismo enfoque.

---

### [2026-09] Reorganización de la documentación de contexto
**Qué:** Los documentos originales `v1.md` y `v2.md` se archivan en `Context/archive/` y se reemplazaron por una estructura de 5 archivos indexados (`00` al `04`).
**Motivo:** hacer el contexto portátil entre LLMs. Cualquier modelo nuevo debe poder leer solo la carpeta `Context/` y quedar al mismo nivel de conocimiento sin reexplicación.

---

### [2026-09] Validación end-to-end del mecanismo de fusión de VPKs (Opción B)
**Qué:** Se ejecutó una prueba real completa del mecanismo central de la app: extraer 3 VPKs de la Workshop del usuario, fusionar su contenido en una carpeta pak01_dir, reempaquetar con vpk.exe, instalar en modsvs/ y **cargar en Versus dentro del juego**. Los 3 addons cargaron sin texturas ni modelos rotos.
**Motivo:** validar el núcleo técnico con datos reales antes de formalizar el spec, en vez de construir sobre suposiciones.
**Alternativas descartadas:** renombrado de VPKs (Opción A) y VPK multi-archivo (Opción C) - se optó por B (desempaquetar+reempaquetar) por ser el método ya probado manualmente por el usuario y el que da control total y reversibilidad.
**Hallazgos que impactan el diseño:**
  - `vpk.exe x` debe ejecutarse POR LOTES (~20 archivos); pasar cientos de argumentos de una vez falla (probado: addon de 232 archivos extrajo 0 en una sola llamada).
  - `vpk.exe x` no crea subdirectorios; la app debe crearlos antes.
  - La detección de VScript NO puede confiar en addonContent_Script del addoninfo.txt (visto un addon con el flag en 0 pero con 3 .nut reales); hay que inspeccionar el listado real del VPK.
  - La precondición "juego cerrado" verifica el proceso `left4dead2.exe`, no `hl2.exe`.
  - La resolución de colisiones quedó SIN validar en esa prueba (los 3 addons no colisionaban) -> se resolvió en la entrada siguiente.
**Impacto:** cierra P-01 (mecanismo) y confirma P-02, P-03, P-04. Actualiza 01-decisiones-tecnicas.md y 02-pendientes.md.

---

### [2026-09] Validación de la resolución de colisiones (P-13)
**Qué:** Se probó la política de resolución de colisiones con 2 addons reales que reemplazan los mismos modelos de brazos en primera persona (`models/weapons/arms/v_arms_*`): los addons 3776576407 y 3776602410, que comparten 24 archivos.
**Método:** se fusionaron en orden [3776576407, 3776602410] aplicando "el último de la lista gana". Se verificó por hash SHA256 del archivo compartido `v_arms_bill.mdl` que el contenido final correspondía al addon 3776602410 (el último), confirmando la política objetivamente antes incluso de abrir el juego.
**Resultado:** política "último gana" confirmada por hash y validada visualmente en Versus.
**Impacto:** cierra P-13. El núcleo técnico (fusión + colisiones) queda completamente validado. Habilita el paso a la formalización del spec.

---

### [2026-09-05] Decisiones de forma inferidas para tipos de dominio no explícitos en design.md (Tarea 1)
**Qué:** Al implementar el andamiaje (Tarea 1), dos de los tipos de dominio compartidos exigidos por el checklist se nombran en las firmas de `design.md` pero **no** tienen una forma explícita definida ahí. Se decidió su forma concreta:
  - `LibraryEntry = { path: string; apps: string[] }`. El bloque `apps` real de `libraryfolders.vdf` es un mapa `appid -> tamaño en bytes`; se **simplifica a solo la lista de AppIDs** (las claves), porque el AC 1.5 únicamente necesita saber si la clave `"550"` está presente y en qué **orden** de aparición para elegir la primera biblioteca con L4D2. El orden del array preserva el orden del archivo.
  - `OperationResult` = unión discriminada `{ ok: true; report?; installedManifest? } | { ok: false; error: string; addonId? }`. El `addonId` opcional en el caso de fallo está pensado para que el orquestador pueda **identificar el addon que falló** (p. ej. una extracción con exit != éxito), cubriendo el AC 6.12.
**Motivo:** `design.md` deja estas formas implícitas; fijarlas ahora evita ambigüedad en las tareas que las consumen y deja registro de por qué se eligió la representación mínima.
**A revisar:** si la **Tarea 5 (PathDetector)** necesita más datos por biblioteca (p. ej. label/nombre de la biblioteca o el tamaño por app), habrá que ampliar `LibraryEntry`. Para el AC 1.5 la forma mínima alcanza. Nota: `PathVerification` y `PathDetectionResult` (retornos de `PathDetector` en `design.md`) **no** se definieron en la Tarea 1; se crearán en la Tarea 5 junto con la implementación.
**Impacto:** `src/main/domain/types.ts` (Tarea 1). Condiciona la Tarea 5 (PathDetector) y la Tarea 18 (MergeOrchestrator, consumidor de `OperationResult`).

---

### [2026-09-05] Decisiones de comportamiento inferidas para filterVpkNoise (Tarea 2.1)
**Qué:** El AC 6.2 y la Property 8 solo especifican: descartar las líneas que
**comienzan con** `CDynamicFunction:`, `FS:` o `Using`, y conservar el resto
**sin alterarlas**. Al implementar `filterVpkNoise` (tarea 2.1) hubo que decidir
cuatro detalles de comportamiento que el spec NO especifica:
  - **Sensible a mayúsculas.** Los prefijos se comparan tal cual (`FS:` sí, `fs:` no).
    El spec los enumera literales sin decir case-insensitive. Nota: para VScript
    (Property 5) el spec Sí pide case-insensitive explícito, así que aquí el
    silencio se interpreta como sensible a mayúsculas.
  - **Sin `trim`.** "Comienza con" = prefijo literal al inicio EXACTO de la línea;
    una línea "  FS: ..." con espacios iniciales se CONSERVA (no comienza con el
    prefijo de forma literal).
  - **Fin de línea.** Se soporta `\n` y `\r\n`; se normaliza un `\r` colgante al
    final de cada línea antes de evaluar el prefijo y se elimina de las líneas
    devueltas.
  - **Línea final vacía.** Un salto de línea terminal produce una última cadena
    vacía que se DESCARTA; las líneas vacías intermedias se CONSERVAN; stdout vacío
    devuelve arreglo vacío.
**Motivo:** el requisito es a nivel de "línea" pero no define tokenización de
líneas ni casing; fijar estos criterios ahora los hace deterministas y permite
escribir el property test de la tarea 2.2 sin ambigüedad.
**A revisar:** si al integrar con `vpk.exe` real (tarea 3) se observa que el binario
emite los prefijos con otro casing o con indentación, habrá que revisitar las
decisiones de casing y `trim`.
**Impacto:** `src/main/domain/vpk-noise-filter.ts` (tarea 2.1) y el property test de
la tarea 2.2. Consumido luego por `VpkTool.list()` (tarea 2.7).

---

### [2026-09-05] Modelo de costo de la línea de comando en batchInternalPaths (Tarea 2.3)
**Qué:** El AC 6.4 exige que "la longitud total de la línea de comando de cada
invocación (ejecutable, VPK y todos los paths) no exceda un límite seguro", pero
NO define QUÉ caracteres se cuentan ni cómo. Al implementar `batchInternalPaths`
(tarea 2.3) se fijó un modelo de costo CONSERVADOR y explícito:

    costo(lote) = len("<executableName> x <vpkPath>") + Σ (1 + len(path))

  - `overheadBase` = longitud del prefijo fijo `"<executableName> x <vpkPath>"`:
    nombre del ejecutable (por defecto `vpk.exe`, NO la ruta absoluta) + espacio +
    subcomando `x` + espacio + ruta del VPK.
  - Por cada path se suma `1 + len(path)`: el `1` es el espacio separador que
    precede al argumento; `len(path)` es el path tal cual (no se traducen
    separadores; eso es la tarea 2.5).
  - Límite por defecto `DEFAULT_MAX_COMMAND_LENGTH = 6000`, sobreescribible por opción.
**Limitación conocida (IMPORTANTE):** el modelo NO modela el QUOTING/escaping que
el SO aplicaría a paths con espacios o caracteres especiales (añadiría comillas y,
por tanto, más caracteres por argumento). Se ASUME que el margen entre el límite
usado (6000) y el máximo real de Windows (~8191 para `cmd`) es suficiente para
absorber ese overhead, y que la invocación sin shell (argumentos como array, ver
diseño VpkTool) reduce el problema. Esa suposición NO está verificada empíricamente.
**Verificado (Tarea 3) — caveat de quoting/espacios: CONFIRMADO que NO es problema.**
El test de integración `test/vpk-tool.integration.test.ts` incluye un fixture con
paths internos CON ESPACIOS (p. ej. `materials/some model file.vmt`) y se ejecutó
contra el `vpk.exe` real. Resultado: la extracción de esos paths funciona sin error
y el archivo con espacios queda en disco en la ubicación esperada. Motivo: el
`CommandRunner` real (`ChildProcessCommandRunner`, tarea 3) usa `execFile` SIN shell,
por lo que cada path se pasa como argumento LITERAL a `vpk.exe` sin quoting de shell.
El overhead de comillas que el modelo de costo no cuenta NO aparece (no hay shell que
las añada), así que el caveat de quoting queda cerrado: no empuja por encima del
límite y no reproduce el fallo. NO fue necesario bajar el margen ni modelar el quoting.

**HALLAZGO INESPERADO Y MÁS GRAVE (Tarea 3) — el límite real de `vpk.exe` es por
CANTIDAD de argumentos, NO por longitud de la línea de comando.** Al extraer el
fixture grande (260 archivos, paths cortos con línea total ~6.6k chars) se observó
que `vpk.exe` CRASHEA cuando recibe demasiados argumentos de path de una sola vez,
INDEPENDIENTEMENTE de la longitud total: el umbral está entre 70 (OK) y 80 (crash);
72-79 argumentos ya crashean. El crash NO es el `exit -1` supuesto, sino
`exit 0xC0000409` (`STATUS_STACK_BUFFER_OVERRUN`; `-1073740791` con signo o
`3221226505` sin signo) y extrae 0 archivos. Como `batchInternalPaths` (2.3) SOLO
limita por CARACTERES (~6000) y `VpkTool.extract` (2.7) lo invoca con los defaults
(sin opción de cantidad), produce lotes de >70 paths que igual crashean. El test de
integración DOCUMENTA este bug (la extracción de los 260 paths de golpe falla con
`VpkToolError`) y DEMUESTRA la corrección (partiendo manualmente en lotes de 64
paths, la extracción de los mismos 260 completa y todos los archivos quedan en disco).
**Corrección APLICADA (opción B):** se agregó a `batchInternalPaths` (2.3) un SEGUNDO
límite por CANTIDAD de paths por lote (`DEFAULT_MAX_BATCH_SIZE = 50`, configurable vía
`options.maxBatchSize`), que se aplica SIMULTÁNEAMENTE con el de longitud: en cada lote
se respetan AMBAS restricciones y el que primero se alcance corta el lote. Un path
individual que excede por sí solo cualquiera de los dos límites sigue yendo en su
propio lote. El property test 2.4 (Property 9) se extendió con la aserción de cantidad
(`batch.length <= maxBatchSize`). `VpkTool.extract` (2.7) usa los defaults, así que quedó
corregido automáticamente. NOTA sobre el umbral: se observó empíricamente que 64
argumentos funcionan (exit 0, extrae todo) y ~72-79 crashean, en ESTA versión del
`vpk.exe`. 50 es un MARGEN CONSERVADOR elegido por nosotros, NO un límite documentado
por Valve; si en el futuro se usa una versión distinta de `vpk.exe` conviene RE-VERIFICAR
el umbral (el test de integración de la tarea 3 sirve para eso).
**Impacto:** `src/main/domain/vpk-batch.ts` (tarea 2.3) y su property test 2.4 (modelo de
costo vía `commandLengthForBatch`), `VpkTool.extract()` (tarea 2.7), el test de integración
`test/vpk-tool.integration.test.ts` (tarea 3, que ya deja el hallazgo verificado) y el
futuro `MergeEngine` (tarea 11).

---

### [2026-09-05] Traducción de separadores: literal "\\" en vez de path.sep (Tarea 2.5)
**Qué:** En `internalPathToDiskPath` (tarea 2.5) la traducción de separadores usa
el literal `DISK_SEPARATOR = "\\"` (backslash de Windows), NO `path.sep` del módulo
`path` de Node. Es una decisión deliberada, no un descuido.
**Motivo:** `path.sep` depende de la PLATAFORMA DE EJECUCIÓN: vale `\\` en
Windows pero `/` en Linux/macOS. La Property 10 (AC 6.6), en cambio, exige la
traducción `/` -> `\\` como REGLA FIJA del formato de destino (paths de disco de
Windows, que es la plataforma primaria del proyecto), independiente de en qué SO
corra el proceso o el CI. Usar `path.sep` haría que la traducción "no hiciera nada"
en Linux/macOS (donde `path.sep === "/"`), produciendo un path de salida idéntico al
de entrada.
**Advertencia explícita:** si alguien "simplifica" esto a `path.sep` en el futuro,
ROMPE la Property 10 en cualquier corrida de CI que NO sea Windows (el test
fallaría porque la salida no tendría `\\`). El literal `"\\"` es intencional y no
debe reemplazarse por `path.sep`.
**Impacto:** `src/main/domain/vpk-path.ts` (tarea 2.5) y su property test (tarea 2.6).

---

### [2026-09-05] Forma de CommandRunner y VpkToolError (Tarea 2.7)
**Qué:** La tarea 2.7 introdujo dos tipos nuevos que el spec no fija (no están en
los 12 tipos de la tarea 1): la interfaz inyectable `CommandRunner` (+ `CommandResult`)
y el error tipado `VpkToolError`. Decisiones de forma tomadas:

  - **`CommandRunner.run()` RESUELVE (no rechaza) para CUALQUIER exit code**, y solo
    rechaza la promesa si el proceso NO pudo siquiera lanzarse (p. ej. ejecutable
    inexistente). Motivo: la responsabilidad de decidir QUÉ exit code es "éxito"
    queda en `VpkTool` (método privado `#assertSuccess`, criterio `exitCode === 0`),
    NO en el runner. Así el runner es un transporte neutro (devuelve exit + stdout +
    stderr) y el dominio concentra la política de éxito/fallo en un solo lugar.
    ADVERTENCIA: una implementación real del runner (tarea 3) que "auto-rechace"
    ante exit ≠ 0 (p. ej. usar `execFile` con su rechazo por código ≠ 0 sin
    capturarlo) ROMPERÍA este contrato: `VpkTool` nunca vería el `CommandResult`
    y no podría envolver el fallo como `VpkToolError` tipado con el addon. El runner
    real DEBE capturar el exit ≠ 0 y resolver con el `CommandResult` correspondiente.

  - **`addonId` es parámetro de CADA método** (`list/extract/pack`), NO del
    constructor. Motivo: una sola instancia de `VpkTool` (mismo `vpk.exe` +
    runner) opera sobre MÚLTIPLES addons en el flujo de MergeEngine (tarea 11);
    pasar el addonId por método permite reutilizar la instancia a través de todos
    los addons en vez de construir una por addon. El `vpkExe` y el runner, en
    cambio, sí van en el constructor (dependencias estables de la instancia).

  - **`list/extract/pack` NO usan `internalPathToDiskPath` (2.5).** Los argumentos
    que recibe `vpk.exe` van SIEMPRE con `/` (formato interno del VPK); la
    traducción a `\\` es responsabilidad de QUIEN ESCRIBE EN DISCO (MergeEngine,
    tarea 11, al crear subdirectorios de destino), no de `VpkTool`. Por eso
    `vpk-tool.ts` ni siquiera importa `internalPathToDiskPath`.

**Impacto:** `src/main/domain/vpk-tool.ts` (tarea 2.7), sus unit tests (2.8), la
implementación real del runner + integración (tarea 3), y el consumo desde
MergeEngine (tarea 11).

---

### [2026-09-05] Parseo de `libraryfolders.vdf` y `findGameLibrary` (Tarea 5.1)
**Qué:** Se implementó la Tarea 5.1 (PathDetector, AC 1.3 / 1.5 / 1.6): un parser
KeyValues de Valve (`src/main/domain/vdf-parser.ts`) y la selección de la
Game_Library con `findGameLibrary` (`src/main/domain/path-detector.ts`). Ambos
se re-exportan desde el barrel `src/main/domain/index.ts`.

**CONFIRMACIÓN — `LibraryEntry = { path; apps: string[] }` de la Tarea 1 ALCANZA
para la Tarea 5 (cierra el "A revisar" de la entrada [2026-09-05] de tipos de
dominio):** `findGameLibrary` (5.1) solo necesita, por biblioteca, el conjunto
ORDENADO de AppIDs (para saber si `"550"` está presente y respetar el orden de
aparición) y el `path` (para devolverlo cuando gana). `derivePaths` (5.3) usará
ese mismo `path`. NO hacen falta label/nombre de biblioteca ni el tamaño por app
(el bloque `apps` real es `appid -> bytes`; el tamaño se descarta). Por tanto NO
se amplió `LibraryEntry`: la forma mínima de la Tarea 1 es suficiente. Este punto
queda CERRADO.

**Decisión de firma del parser (opera sobre CONTENIDO, no sobre ruta):** aunque
`design.md` muestra `parseLibraryFolders(steamPath: string)`, la subtarea 5.1 es
parseo PURO y testeable, así que `parseLibraryFolders(content: string)` opera
sobre el TEXTO del archivo. La lectura desde disco a partir de `steamPath`
(`readSteamPath` → leer `<steamPath>\steamapps\libraryfolders.vdf` → parsear)
queda para la Tarea 5.3, que compondrá el I/O con este parser puro. Motivo:
aislar el I/O del parseo hace el parser trivialmente testeable (unit + property).

**Decisiones de comportamiento del parser KeyValues no fijadas por el spec:**
  - **Comentarios `//`.** Se soportan: `//` FUERA de comillas descarta el resto
    de la línea; `//` DENTRO de comillas es parte del valor (p. ej. `http://...`).
  - **Tokens sin comillas.** El tokenizador los acepta por robustez (delimitados
    por espacios/llaves), aunque `libraryfolders.vdf` en la práctica va todo
    entrecomillado.
  - **Casing de claves ESTRUCTURALES (`libraryfolders`, `path`, `apps`).** Se
    comparan INSENSIBLE a mayúsculas (el nombre de campo del formato de Valve no
    es sensible al casing). Los VALORES (rutas, AppIDs) se conservan tal cual.
  - **Casing de la clave `"550"`.** Comparación EXACTA contra el literal `"550"`
    (`L4D2_APP_ID`); al ser numérica, el casing no altera el dígito.
  - **Claves duplicadas.** Los AppIDs del bloque `apps` se PRESERVAN en orden de
    aparición, incluyendo duplicados (no se deduplican). Ante `path` duplicado en
    una biblioteca, gana la ÚLTIMA ocurrencia ("última asignación gana").
  - **Biblioteca sin `path`/sin `apps`.** `path` ausente → `""` (la verificación
    en disco de 5.3 la descartará); `apps` ausente → `[]`.
  - **Raíz.** Se busca el bloque `libraryfolders` (insensible a mayúsculas); si
    falta el envoltorio, se toleran las entradas de nivel superior directamente.
  - **Representación del árbol.** El nodo KeyValues es una lista ORDENADA de pares
    (`VdfEntry[]`), no un `Record`, para preservar orden y admitir duplicados.

**Verificación:** `npm run typecheck` (tsc estricto) pasa sin errores y `npm test`
(Vitest) pasa las 54 pruebas, incluidas las 13 nuevas de `test/path-detector.test.ts`
(parser: estructura real, indentación/tabs, `\r\n`, comentarios `//`, vacío, sin
`apps`; selección: 0 con 550→null, varias→gana la primera, L4D2 en otro disco,
única con 550, lista vacía). El property test de selección (Property 1) es la
Tarea 5.2 y NO se implementó aquí.

**Impacto:** `src/main/domain/vdf-parser.ts` y `src/main/domain/path-detector.ts`
(nuevos), `src/main/domain/index.ts` (barrel) y `test/path-detector.test.ts`
(nuevo). Condiciona la Tarea 5.2 (Property 1) y la Tarea 5.3 (`readSteamPath`,
`derivePaths`, `verifyPathsOnDisk`, `detect`), que compondrán el I/O sobre este
parser puro.

---

## Plantilla para entradas futuras

```
### [YYYY-MM-DD HH:MM] Título corto de la decisión
**Qué:** descripción de lo que cambió o se decidió.
**Motivo:** por qué se tomó esta decisión.
**Alternativas descartadas:** (opcional) qué otras opciones se evaluaron.
**Impacto:** qué archivos, módulos o decisiones futuras afecta.
```
