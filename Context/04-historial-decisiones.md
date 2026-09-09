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

### [2026-09-05] Property test de selección de biblioteca vía VDF real (Tarea 5.2)
**Qué:** Se implementó la Tarea 5.2 (Property 1: "Selección de la primera
biblioteca con L4D2", AC 1.5) en `test/path-detector.property.test.ts`. El
requisito explícito era ejercitar el PIPELINE COMPLETO
`parseLibraryFolders` → `findGameLibrary`, no la selección aislada sobre
`LibraryEntry[]` ya parseadas.
**Decisiones no triviales del generador:**
  - **VDF-texto, no estructuras parseadas.** El arbitrary genera un MODELO
    abstracto de bibliotecas (lista ordenada; cada una con fragmento de path,
    lista ordenada de AppIDs de ruido y un flag `hasL4D2` + posición de
    inserción del literal `"550"`), y a partir de él RENDERIZA un
    `libraryfolders.vdf` válido que pasa por el parser real. Así el test valida
    tokenizador + árbol + selección juntos, como en producción.
  - **Charset SEGURO de paths.** Los paths se generan con un charset acotado
    (letras/dígitos/espacio/`:`/`\`/`/`/`.`/`-`/`_`/`()`), SIN `"` ni saltos de
    línea/tab. El único carácter con escape es `\`, que al renderizar se emite
    como `\\` para que el parser lo colapse a `\` y el path parseado vuelva
    idéntico al generado. Se evitan a propósito `"` y saltos de línea: no aportan
    cobertura sobre la política de SELECCIÓN y solo complicarían el escaping.
  - **Unicidad por índice.** Cada path se prefija con su índice (`L{i}|...`) para
    que la aserción `.toBe(expected)` sea inequívoca aun cuando varias
    bibliotecas contengan `"550"`.
  - **Literal `"550"` exacto.** El ruido usa un conjunto fijo de AppIDs
    (`440/620/228980/570/730/240`) que NO incluye `"550"` ni variantes tipo
    `"0550"`; la presencia de L4D2 se controla solo con el flag `hasL4D2`.
  - **Esperado desde el MODELO (fuente independiente).** El resultado esperado
    (path de la primera lib con `hasL4D2`, o `null`) se computa recorriendo el
    modelo generado, NO reimplementando `findGameLibrary` sobre `LibraryEntry[]`.
  - Se cubren 0 bibliotecas, `apps` vacío, `"550"` en posición arbitraria con
    ruido alrededor y orden de aparición variado.
**Verificación:** `npm run typecheck` (tsc estricto) y `npm test` (Vitest) pasan;
la suite completa quedó en 55 tests (54 previos + el nuevo property test, con el
piso de 100 iteraciones del helper `propertyTest`).
**Impacto:** `test/path-detector.property.test.ts` (nuevo). Cierra la Tarea 5.2.

---

### [2026-09-05] PathDetector: registro, derivación, verificación y `detect` (Tarea 5.3)
**Qué:** Se implementó la Tarea 5.3 (AC 1.1, 1.2, 1.4, 1.6–1.12): lectura del
registro (`readSteamPath`), derivación de rutas (`derivePaths`), verificación en
disco (`verifyPathsOnDisk`) y la orquestación completa (`detect`), sobre
dependencias inyectables. Además se definieron los dos tipos de dominio que
quedaron pendientes de la Tarea 1.

**Forma elegida de `PathVerification` (en `types.ts`):**
`{ present: Record<RequiredPathKey, boolean>; missing: RequiredPathKey[]; allPresent: boolean }`.
Se decidió NO usar un booleano global: `detect` (AC 1.10) necesita saber QUÉ
ruta específica falta para ofrecer la selección manual de ESA ruta y no de
todas. El núcleo es el mapa `present` (una entrada por CADA ruta requerida,
usando `Record<RequiredPathKey, boolean>` para que el compilador exija verificar
todas y no "olvidar" ninguna); `missing` y `allPresent` son derivados de
conveniencia. Se introdujo `RequiredPathKey` como subconjunto tipado de las
claves de `GamePaths` (`gameRoot | workshopFolder | vpkToolPath | gameInfoFile |
modsvsFolder`) — las 5 que enumera el AC 1.9 — para que ni la verificación ni
`detect` puedan referir un rol de ruta inexistente. `steamPath` y `left4dead2Dir`
NO se verifican como requeridas (el AC 1.9 no las lista).

**Forma elegida de `PathDetectionResult` (en `types.ts`):** UNIÓN DISCRIMINADA
por `kind`, al estilo de `OperationResult`/`ElevationOutcome`. Motivo: el flujo
tiene caminos cualitativamente distintos con datos distintos, y la unión obliga
al consumidor a manejarlos explícitamente. Dos variantes:
  - `ready`: rutas verificadas y listas para persistir; lleva `paths`,
    `verification` (la que las respalda) y `source: "auto" | "manual"`.
  - `needs-manual`: la detección no se completó; lleva `reason`
    (`PathDetectionFailureReason`: `steam-not-installed` AC 1.2 /
    `library-folders-unreadable` AC 1.4 / `l4d2-not-in-libraries` AC 1.6 /
    `required-path-missing` AC 1.10) para que la UI sepa QUÉ selección manual
    ofrecer, más `paths?`/`verification?` opcionales cuando el fallo ocurrió tras
    derivar rutas.

**Interfaces inyectables (patrón `CommandRunner` de la Tarea 2.7):** el dominio
depende de interfaces, no de módulos concretos, para ser testeable sin registro,
FS ni UI reales:
  - `RegistryReader.readValue(hive, key, value) => Promise<string | null>`: `null`
    si la clave/valor no existe (AC 1.2). La implementación real (winreg / `reg
    query` vía runner) es de una tarea posterior.
  - `FileSystemProbe`: `readTextFile(path) => Promise<FileReadResult>` (unión
    `{ ok:true; content } | { ok:false }`, sin excepciones, para que `detect`
    decida el camino de fallo sin try/catch) y `exists(path) => Promise<boolean>`.
  - `ManualPathProvider.requestPath(request) => Promise<ManualPathResponse>`:
    `request` es `ManualPathRequest` (`steam-path` / `game-root` /
    `required-path` con su `pathKey`) y la respuesta es
    `{ kind:"selected"; path } | { kind:"cancelled" }` (unión, no `string|null`,
    para forzar el manejo explícito de la cancelación). Mantiene `detect`
    desacoplado de Electron/diálogos.
Las tres se pasan por CONSTRUCTOR (`PathDetectorDeps`), como `VpkTool` recibe
runner + vpkExe.

**Cómo se garantiza estructuralmente "no persistir sin verificación" (invariante
que probará la Tarea 5.4 / Property 2):** el estado `ready` de
`PathDetectionResult` es el ÚNICO que representa "rutas listas para persistir", y
se construye EXCLUSIVAMENTE a través del constructor `pathsReady(paths,
verification, source)`, que devuelve `ready` sólo si `verification.allPresent ===
true`; en caso contrario devuelve `needs-manual` con `required-path-missing`.
Ningún camino de código fabrica el literal `{ kind: "ready", ... }` a mano: tanto
la detección automática como la selección manual desembocan en `#verifyThenManual`,
que llama a `verifyPathsOnDisk` y luego a `pathsReady`. Así es imposible alcanzar
`ready` sin una verificación en disco cuyas 5 rutas requeridas estén todas
presentes. La selección manual, además, re-verifica en disco la ruta elegida
antes de aceptarla (`#requestExisting` reintenta si no existe, AC 1.11/1.12), y
tras suplir una ruta se re-verifica el conjunto completo (AC 1.11).

**Decisión de join de rutas:** se usa un join LITERAL con `\` (`joinWindows`), NO
`path.join` de Node, por la misma razón documentada para `internalPathToDiskPath`:
`path.join` depende de la plataforma de EJECUCIÓN (usaría `/` en Linux/CI) mientras
que las rutas de L4D2 son de Windows por definición. Mantiene el resultado
determinista en cualquier SO (los tests corren en CI no-Windows).

**Cierra el pendiente de la Tarea 1:** el segundo punto del "A revisar" de la
entrada [2026-09-05] "Decisiones de forma … tipos de dominio no explícitos"
(`PathVerification` y `PathDetectionResult` sin definir) queda CERRADO: ambos se
definieron aquí, junto a la implementación que los consume.

**Verificación:** `npm run typecheck` (tsc estricto) pasa sin errores y `npm test`
(Vitest) pasa las 72 pruebas (11 archivos), incluidas las nuevas de la Tarea 5.3
en `test/path-detector.test.ts` (readSteamPath null/valor/vacío; derivePaths en
otro disco; verifyPathsOnDisk faltantes/allPresent; invariante de `pathsReady`;
`detect`: camino feliz, Steam ausente cancelado/suplido, VDF ausente, ninguna lib
con 550, ruta faltante con selección + re-verificación, reintento AC 1.12 y
cancelación). El property test formal (Property 2) es la Tarea 5.4 y NO se
implementó aquí.

**Impacto:** `src/main/domain/types.ts` (tipos nuevos), `src/main/domain/path-detector.ts`
(implementación + interfaces inyectables), `src/main/domain/index.ts` (barrel) y
`test/path-detector.test.ts` (tests). Condiciona la Tarea 5.4 (Property 2), la
Tarea 15/18 (persistencia real de rutas vía `LocalStore.savePaths`, AC 1.13) y la
Tarea 20 (capa IPC que consumirá `detect`).

---

### [2026-09-05] Property 2 (Tarea 5.4): generador y oráculo de "no persistir sin verificación"

**Contexto:** la Tarea 5.4 escribe el property test de la Property 2 ("Ninguna
ruta se persiste sin verificación en disco", Validates 1.9/1.11/1.13) sobre el
`detect()` real de la Tarea 5.3. El invariante ya está garantizado
estructuralmente por `pathsReady` (ver entrada anterior); la Property 2 lo
CONFIRMA end-to-end ejerciendo el pipeline real y usando el FS mock como oráculo
independiente.

**Decisiones no triviales del generador (`test/path-detector.property.test.ts`):**

- **Oráculo = FS mock, no reimplementación.** El test NUNCA reimplementa
  `detect`/`verifyPathsOnDisk`. Deriva las 5 rutas requeridas con el
  `derivePaths(LIB, STEAM)` real y consulta `fs.existing.has(path)` como fuente de
  verdad independiente sobre el resultado de `detect()`. Así la propiedad compara
  el comportamiento del código contra un oráculo externo (existencia real en el
  FS), no contra sí mismo.

- **Anti-bucle infinito (clave).** `#requestExisting` reintenta ante una ruta
  `selected` que no existe (AC 1.12) y solo termina ante `cancelled` o una ruta
  existente. Para que el test no cuelgue, el `MockManual` consume una COLA FINITA
  de respuestas por request (0..4 elementos) y, AL AGOTARSE, devuelve `cancelled`.
  Como las colas son finitas, tras a lo sumo N iteraciones el provider cancela y
  el bucle termina. Se confirmó empíricamente: la suite del property test corre en
  ~2s sin colgarse.

- **Cobertura de los tres sub-casos de respuestas manuales (c).** Cada respuesta
  del generador es (i) cancelación, (ii) selección de una ruta FIJA fuera del Set
  del FS (`Z:\nope\*`, fuerza el reintento de AC 1.12), o (iii) selección de una
  ruta requerida que el escenario marcó como existente (candidatas tomadas del
  propio Set del FS). Las rutas "inexistentes" nunca se añaden al FS, garantizando
  que jamás sean aceptadas en un `ready`.

- **Dos caminos de derivación.** `useVdf=true` entrega un `libraryfolders.vdf` con
  550 en LIB → `detect` deriva por Game_Library y verifica (camino principal).
  `useVdf=false` deja el VDF ausente → `detect` pide Game_Root (camino manual). El
  registro SIEMPRE devuelve STEAM (no se ejercita el fallo de registro aquí; eso
  ya lo cubren los unit tests).

- **Propiedades verificadas:** (a) si `ready`, las 5 rutas finales existen en el
  FS y `verification.allPresent && missing==[]`; (b) en `needs-manual` con
  paths+verification, `missing` coincide EXACTAMENTE con las rutas finales
  inexistentes (existente⇒no en missing; ausente⇒en missing) y `allPresent` es
  false; (c) reforzado dentro de (a): ninguna ruta final de un `ready` es
  reportada inexistente por el FS.

**Orden de claves requerido:** el property test declara LOCALMENTE el orden
canónico de las 5 `RequiredPathKey` (en vez de importar el `REQUIRED_PATH_KEYS`
interno del dominio) para no acoplarse a un símbolo interno ni tocar `src`; el
tipado `readonly RequiredPathKey[]` hace que cualquier cambio en las claves
requeridas rompa la compilación del test.

**Tests de cancelación añadidos (unit, `test/path-detector.test.ts`):** se
completó la cobertura de cancelaciones terminales que faltaba: Game_Root cancelado
tras VDF ausente (→ `library-folders-unreadable`), Game_Root cancelado tras
ninguna lib con 550 (→ `l4d2-not-in-libraries`), y confirmación de que la
cancelación invoca al provider UNA sola vez (no reintenta; el bucle de
`#requestExisting` es solo para `selected` inexistente).

**Verificación:** `npm run typecheck` (tsc estricto) pasa; `npx vitest run` pasa
las 76 pruebas (11 archivos), incluidas Property 1, Property 2 (>=100 iteraciones)
y los 3 tests de cancelación nuevos.

**Impacto:** `test/path-detector.property.test.ts` (Property 2) y
`test/path-detector.test.ts` (tests de cancelación); sin cambios en `src`.
Cierra la cobertura formal del Requirement 1 (PathDetector).

---

### [2026-09-05] Hardening de la Property 2 (tarea 5.4)

**Qué:** dos refuerzos sobre `test/path-detector.property.test.ts`, sin cambiar el
alcance de la tarea 5.4 ni tocar `src`.
1. **No-vacuidad.** La Property 2 pasó de registrarse con el helper `propertyTest`
   a un `test()` propio (nombre canónico idéntico vía `propertyName(2, ...)`) para
   poder correr una aserción DESPUÉS de que la propiedad complete sus iteraciones.
   Se cuenta `readyCount` (iteraciones que terminan en `ready`) y se afirma
   `expect(readyCount).toBeGreaterThan(0)`, garantizando que la implicación "si
   ready entonces las 5 rutas existen" NO fue vacuamente verdadera. Observado:
   `readyCount ≈ 9` sobre 100 iteraciones (`MIN_NUM_RUNS`).
2. **Exhaustividad de tipos.** Junto a la constante local `REQUIRED_KEYS` se añadió
   un artefacto de solo-tipos (`... satisfies Record<RequiredPathKey, true>`, con
   `void` para descartar el runtime). Si el union `RequiredPathKey` del dominio
   crece y `REQUIRED_KEYS` queda desactualizada, faltaría una clave en el objeto y
   el `satisfies` haría fallar el typecheck del test.

**Motivo:** blindar la Property 2 contra falsos verdes: que el camino `ready`
realmente se ejerza (no-vacuidad) y que las claves requeridas del test no queden
silenciosamente desalineadas con el dominio (exhaustividad en compile-time).

**Verificación:** `npm run typecheck` (tsc estricto) pasa; `npx vitest run` sigue
verde con 76 pruebas (11 archivos) —el conteo no cambia porque la Property 2 sigue
siendo un único test.

**Impacto:** solo `test/path-detector.property.test.ts`; sin cambios en `src` ni en
el estado de la tarea 5.4 (sigue `[x]`).

---
### [2026-09-06] AddonScanner: FS propia, addoninfo vía VpkTool y extractor ad-hoc (Tarea 6.1)
**Qué:** Se implementó el escaneo de la Workshop_Folder (`AddonScanner`, Requirement 2, AC 2.1–2.6) en `src/main/domain/addon-scanner.ts`, con el extractor de metadata en `src/main/domain/addoninfo-extract.ts`. Tres decisiones de arquitectura tomadas por el usuario y aplicadas:

  - **Decisión 1 — Interfaz de FS PROPIA (`AddonFileSystem`), no reutilizar la de la sección 5.** `AddonScanner` define su propio contrato de FS inyectable (`listEntries` con `DirEntry {name, isDirectory}` para distinguir archivo de subdir, `exists`, `readTextFile`, `ensureDir`) en vez de depender del `FileSystemProbe` de PathDetector, que en esta rama (`addon-scanner`, salida de main) NO está mergeado. **Motivo:** CONTRIBUTING.md exige que cada rama parta de main actualizada y el checkpoint de la tarea 9 agrupa deliberadamente las secciones 6+7+8; mergear PathDetector antes de tiempo solo para evitar la duplicación rompería esa disciplina de ramas. La duplicación de un contrato de FS chico es un costo ACEPTADO conscientemente: aún no hay suficientes consumidores (PathDetector, AddonScanner y probablemente VScriptDetector en la sección 7) como para saber qué forma debería tener una interfaz de FS común. **A revisar:** unificar las interfaces de FS una vez existan PathDetector + AddonScanner + VScriptDetector (prioridad MENOR que la unificación de parsers, ver abajo).

  - **Decisión 2 — Lectura de `addoninfo.txt` vía `VpkTool` (extracción selectiva a dir temporal), NO lectura de disco directa.** El `addoninfo.txt` vive DENTRO del `<id>.vpk`. Flujo: (1) `vpkTool.list(vpkPath, id)` → localizar el path interno cuyo basename es `addoninfo.txt` (case-insensitive); si no aparece → `info: null` sin extraer; (2) `vpkTool.extract(vpkPath, [ese path], destDir, id)` extrae SOLO ese archivo a un `destDir` temporal por addon (se asegura el dir con `ensureDir`); (3) leer con el FS inyectado y parsear con el extractor ad-hoc. `VpkTool` se INYECTA por constructor (igual que `CommandRunner`/`vpkExe` en `VpkTool`); se reusa tal cual el `VpkTool` de main.

  - **Decisión 3 — Extractor AD-HOC (Opción A2), NO un parser KeyValues propio.** En vez de duplicar el parser KeyValues general (que vive en la rama `path-detector` sin mergear), se escribió un extractor acotado best-effort que reconoce SOLO las 3 claves de nivel superior necesarias. **Motivo:** duplicar un ALGORITMO de parseo es más riesgoso (divergencia) que duplicar un contrato de FS. **Nota de prioridad:** cuando se mergee la sección 5, reconciliar los DOS parsers (ad-hoc vs. KeyValues) tiene PRIORIDAD MÁS ALTA que unificar las interfaces de FS.

**Claves confirmadas (NO asumidas):** dentro del bloque `"AddonInfo"`, título = `addontitle`, autor = `addonauthor`, descripción = `addonDescription`, confirmadas contra la convención de L4D2 (wiki de Valve + addons reales). Existen `addonversion`, `addonSteamAppID`, etc. que se IGNORAN. **Casing variable:** en addons reales el casing varía (`addontitle`/`addonTitle`, `addonauthor`/`addonAuthor`, …) → comparación de claves CASE-INSENSITIVE. Los VALORES aparecen con o sin comillas (se maneja ambos) y puede haber comentarios `//` en la misma línea (se ignora lo que sigue a `//` fuera de comillas).

**Degradación best-effort (AC 2.5, confirmado):** toda la fase de metadata (list, extract, lectura, parseo) va envuelta en try/catch por-addon: cualquier fallo —addoninfo ausente del listado, `vpk l`/`vpk x` con exit ≠ 0 (`VpkToolError`), error de lectura, texto malformado— degrada a `info: null` SIN abortar ni omitir el addon. El addon SIEMPRE se lista con `id`, `vpkPath` y `coverPath` correctos. Campo faltante en el addoninfo → propiedad OMITIDA (no `undefined`, por `exactOptionalPropertyTypes`); bloque ausente / malformado / ningún campo reconocido → `null`. El extractor NUNCA lanza.
**Motivo:** cerrar la tarea 6.1 respetando la disciplina de ramas y dejando registro de por qué se duplican deliberadamente el contrato de FS y el parser.
**Impacto:** `src/main/domain/addon-scanner.ts`, `src/main/domain/addoninfo-extract.ts`, el barrel `index.ts` (exporta `AddonScanner`, `AddonFileSystem`, `DirEntry`, `extractAddonInfo`) y `test/addon-scanner.test.ts`. Condiciona la sección 7 (VScriptDetector, otro consumidor de FS/VpkTool) y los property tests 6.2/6.3 (commits posteriores).

---

### [2026-09-06] Verificación de claves de addoninfo.txt contra un addon REAL (Tarea 6.1)
**Qué:** La confirmación FINAL de las claves que reconoce el extractor `extractAddonInfo` se hizo contra un **archivo real**, NO solo contra fuentes de comunidad (wiki de Valve + addons de referencia). Se extrajo el `addoninfo.txt` real del addon `121272536` ("Urik Game Menu", autor "Urik") desde la Workshop_Folder real del usuario (`C:\Program Files (x86)\Steam\steamapps\common\left 4 dead 2\left4dead2\addons\workshop\121272536.vpk`) usando el `vpk.exe` real, y se corrió `extractAddonInfo` sobre ese contenido real.
**Resultado del extractor sobre el archivo real:**
  `{"title":"Urik Game Menu","author":"Urik","description":"Urik Game Menu v21.0718"}`
**Hallazgos:**
  - **Casing `addonAuthor` (con A mayúscula).** Las claves reales de ESE addon fueron `addontitle`, `addonDescription` y **`addonAuthor`** — es decir, el casing del autor NO fue `addonauthor` como sugería la convención dominante de las fuentes de comunidad. Esto **confirma empíricamente** que la decisión de comparar claves **case-insensitive** era necesaria y correcta: un extractor case-sensitive habría perdido el autor.
  - **Match por TOKEN EXACTO, no por prefijo.** El bloque real contenía muchas otras claves (`vpkname`, `version_template`, `description_template`, `addonAuthorSteamID`, `addonSteamAppID`, etc.). El extractor las ignoró correctamente. En particular, `addonAuthorSteamID` **NO** se confundió con `addonAuthor` porque el match es por token exacto (el primer token completo de la línea, comparado en minúsculas contra el set de claves conocidas), NO por prefijo. Verificado empíricamente.
  - **Conclusión:** la implementación del extractor (claves + case-insensitive + match exacto) quedó CONFIRMADA contra un archivo real; NO hizo falta ajustar nada en el código.
**Nota de versionado:** el `addoninfo.txt` real NO se versiona en el repo (términos de uso de contenido de Workshop), mismo criterio que los fixtures binarios de vpk (ver `.gitignore` / `test/fixtures/README.md`).
**Impacto:** ninguno en código (`addoninfo-extract.ts` sin cambios). Cierra la duda abierta en la entrada de la Tarea 6.1 sobre el casing de `addonauthor`.

---

### [2026-09-06] `tasks.meta.json` agregado a `.gitignore` (metadata del tracker de tareas)
**Qué:** `tasks.meta.json` es el estado interno del orquestador/tracker de tareas de Kiro (sincronización de progreso), NO código del proyecto. Se agregó la regla `**/tasks.meta.json` a `.gitignore` para ignorarlo en cualquier ubicación.
**Motivo:** este archivo puede **desincronizar los checkboxes de `tasks.md` entre ramas**. En esta sesión pasó de forma concreta: al tocar `tasks.md` en la rama `addon-scanner`, `tasks.meta.json` sincronizó y dejó marcados como completados los checkboxes de la **sección 5 (5.1–5.4)**, una sección que en esta rama **no existe** (la rama `addon-scanner` salió de `main`, no de `path-detector`). Se detectó y se revirtió a mano. En `path-detector` ya estaba ignorado, pero como `addon-scanner` salió de `main` (que no tiene esa regla), acá faltaba.
**Mitigación operativa vigente:** además de ignorarlo, la práctica es **revisar el `git diff` de `tasks.md` antes de cada commit** para no arrastrar marcados espurios de checkboxes. No hay solución automática todavía; la revisión manual del diff es la salvaguarda actual.
**Impacto:** `.gitignore`. Evita commitear estado del tracker y reduce el riesgo de checkboxes desincronizados entre ramas.

---
### [2026-09-06] Decisión de rama: `vscript-detector` desde main, ramas hermanas (Opción 1)
**Qué:** La rama `vscript-detector` (secciones 7-8 del plan) se creó DESDE main
(commit cd3e009), NO encadenada sobre `addon-scanner`.
**Motivo:** las secciones 5 (PathDetector), 6 (AddonScanner) y 7-8 (VScript) son
ramas HERMANAS independientes del plan, no una cadena de dependencias. La sección 7
solo necesita `VpkTool.list` y el tipo `ScannedAddon`, ambos YA presentes en main.
Encadenar la sección 7 sobre `addon-scanner` sin necesidad técnica reintroduciría el
mismo acoplamiento evitable que ya se descartó para la sección 6. Los solapamientos de
merge que aparezcan en el checkpoint 9 son esperables y preferibles a ramas acopladas
sin motivo. Coherente con el mapa de ramas de CONTRIBUTING.md (vscript-detector =
secciones 7-8).
**Impacto:** organización de ramas; se materializa en el conflicto trivial anotado en
la entrada siguiente para el checkpoint 9.

---

### [2026-09-06] Aviso para el checkpoint 9: merge del barrel `index.ts` (adición-adición trivial)
**Qué:** Las tres ramas hermanas (path-detector, addon-scanner, vscript-detector) agregan
su bloque de exports en el MISMO punto final de `src/main/domain/index.ts` (después del
bloque de `vpk-tool.js`). Al mergear las tres a main en el checkpoint 9, git marcará un
conflicto de tipo ADICIÓN-ADICIÓN en esa región.
**Motivo/naturaleza:** el conflicto es TRIVIAL y NO estructural: se resuelve CONCATENANDO
los tres bloques. Cada rama exporta símbolos DISTINTOS de módulos DISTINTOS; no hay exports
duplicados, ni renombres, ni reestructuración. Además, `path-detector` inserta 5 tipos
nuevos (RequiredPathKey, PathVerification, PathDetectionSource, PathDetectionFailureReason,
PathDetectionResult) DENTRO del bloque `export type { ... } from "./types.js"` entre
`LibraryEntry` y `AddonInfo`; `addon-scanner` y `vscript-detector` NO tocan ese bloque, así
que ahí NO hay conflicto. `vscript-detector` solo AÑADE un bloque nuevo al final (clase
`VScriptDetector`, `classifyVScriptPaths`, `isVScriptPath`, `VSCRIPTS_PREFIX`,
`VSCRIPT_EXTENSION`).
**Impacto:** se deja anotado para no redescubrirlo durante el checkpoint 9 y resolverlo por
concatenación sin dudar.

---

### [2026-09-06] Decisión de normalización del prefijo/extensión del VScriptDetector (Tarea 7.1)
**Qué:** En `vscript-detector.ts` (tarea 7.1), el match que decide si un path del listado de
`vpk l` cuenta como VScript (AC 3.2/3.3) se normaliza así, antes de comparar:
  - **Case-insensitive** en AMBAS comparaciones: se pasa el path a `toLowerCase()` y se
    compara contra el prefijo `scripts/vscripts/` y la extensión `.nut` en minúsculas. Así
    `Scripts/VScripts/Foo.NUT` cuenta (AC 3.2 exige case-insensitive explícito).
  - **Forma del prefijo:** `path.toLowerCase().startsWith("scripts/vscripts/")`. El prefijo
    termina en `/`, por lo que `scripts/vscripts/ai/bar.nut` (subdir más profundo) CUENTA
    (está bajo el prefijo), y `scripts/vscripts_notdir/foo.nut` NO cuenta. Un `.nut` fuera
    del prefijo (`scripts/foo.nut`, `materials/vscripts/foo.nut`, `vscripts/foo.nut`) NO
    cuenta (AC 3.3).
  - **Extensión:** `endsWith(".nut")` (ya en minúsculas). Un archivo bajo el prefijo que no
    sea `.nut` (p. ej. `scripts/vscripts/readme.txt`) NO cuenta: deben cumplirse AMBAS.
  - **`./` líder opcional:** se recorta un único `./` inicial si está presente antes de
    evaluar el prefijo, contemplando que `vpk l` PODRÍA emitir paths con un prefijo relativo.
    NO se resuelve `../` ni se colapsan segmentos (los paths de `vpk l` son relativos a la raíz
    del VPK, sin navegación hacia arriba).
  - **Separador `/`:** se asume `/` (formato interno del VPK, garantizado por `VpkTool.list`);
    no se normalizan `\`.
Un `.nut` fuera del prefijo NUNCA afecta la clasificación; basta UN `.nut` bajo el prefijo.
La clasificación NO inspecciona `addoninfo.txt` ni el flag `addonContent_Script` (AC 3.4);
solo mira el listado de paths.
**Estructura:** se separó un NÚCLEO PURO (`classifyVScriptPaths(paths): boolean` +
`isVScriptPath(path): boolean`) de la orquestación async (`VScriptDetector.classify`, que
llama a `VpkTool.list` y, ante fallo/exit ≠ 0, envuelve en try/catch y clasifica como
VScript_Addon `listing-failed` POR PRECAUCIÓN, AC 3.5). El núcleo puro es property-testeable
sin mocks (habilita la tarea 7.2, Property 5).
**Verificado contra un VPK real con vscripts (CONFIRMADO):** se ejecutó la verificación empírica
contra un addon REAL con vscripts (id `214630948` de la Workshop) y se CONFIRMÓ que `vpk l` emite
los paths internos con separador `/`, en minúsculas, con prefijo `scripts/vscripts/` y
subdirectorios profundos (p. ej. `scripts/vscripts/admin_system/entitygroups/...`), y SIN `./`
líder. Es decir: lo que antes quedaba "a revisar" pasa a CONFIRMADO — `vpk l` NO emite un `./`
líder. En consecuencia, la tolerancia al `./` líder en el código se MANTIENE únicamente como
MARGEN DE SEGURIDAD sin costo real (por si algún caso no cubierto por esta verificación lo
trajera), NO como deuda ni como suposición abierta pendiente de resolver. Además, el núcleo
`classifyVScriptPaths`/`isVScriptPath` se corrió sobre esos paths reales y clasificó
correctamente: hace match dentro del prefijo, los subdirectorios profundos cuentan, un `.nut`
fuera del prefijo y `materials/vscripts/foo.nut` NO cuentan, y el casing variado cuenta.
**Impacto:** `src/main/domain/vscript-detector.ts` y `src/main/domain/index.ts` (barrel), sus
unit tests `test/vscript-detector.test.ts` (tarea 7.1) y el property test de la tarea 7.2.
Consumido luego por la capa IPC (tarea 20) y la política de inclusión del Active_Set (tarea 8).

---

### [2026-09-06] NOTA DE PROCESO: método fiable para medir contadores de no-vacuidad de property tests
**Qué:** La captura del output de vitest por consola falla de forma recurrente en
este entorno de shell (observado tanto con la Property 2 del PathDetector como con
la Property 5 del VScriptDetector): el stdout/stderr no se recupera de manera
confiable, así que no se puede leer un `console.log` de contadores desde la corrida.
**Método verificado para medir contadores de no-vacuidad:** escribir los contadores
a un archivo con `node:fs` (`writeFileSync`) en una ruta fija DENTRO del test
(temporalmente, SIN commitear el `writeFileSync` ni el import), correr el test una
sola vez, y leer ese archivo directamente con una herramienta de lectura de archivos.
NO depender de la captura de consola. Después de medir, RESTAURAR el test (quitar el
`writeFileSync` y el import temporal) y borrar el archivo temporal antes de commitear.
Este es el método a usar para futuros hardenings de property tests que necesiten
afirmar no-vacuidad.
**Medición concreta (Property 5, VScriptDetector):** los valores de no-vacuidad se
midieron con este método sobre el ARCHIVO COMMITEADO
`test/vscript-detector.property.test.ts` (no una réplica): en 100 iteraciones se
observó `positiveCount=65`, `negativeCount=35`, `trickyCount=61`. El comentario de
no-vacuidad del test se actualizó con esos valores reales.
**Impacto:** `test/vscript-detector.property.test.ts` (comentario de Property 5) y todo
property test futuro con aserciones de no-vacuidad (p. ej. Property 6, tarea 8.2).

---

### [2026-09-06] Forma de la política de inclusión del Active_Set (Tarea 8.1)
**Qué:** `isAllowedInActiveSet` (nuevo módulo `src/main/domain/active-set-policy.ts`)
se modela como una FUNCIÓN PURA sobre un objeto de dos booleanos
(`{ isVScriptAddon, forceConfirmed }`), no sobre el `VScriptClassification` completo.
Lógica = tabla de verdad `permitido = !isVScriptAddon || forceConfirmed`: no-VScript
siempre permitido; VScript con confirmación explícita permitido (AC 3.8); VScript sin
confirmación bloqueado por defecto (AC 3.7).
**Motivo:** la decisión SOLO depende del flag `isVScriptAddon`, no del `reason`
(`nut-in-vscripts` y `listing-failed` son ambos VScript_Addon a efectos del bloqueo).
Tomar la clasificación entera acoplaría innecesariamente la función a la forma del
detector. Se agrega un helper `isVScriptAddonAllowedInput(classification, forceConfirmed)`
que mapea desde un `VScriptClassification` para el llamador (orquestador/IPC), dejando
la función núcleo trivialmente property-testeable (tarea 8.2, Property 6).
**Alcance:** la ADVERTENCIA visual del AC 3.6 es responsabilidad de la UI (tarea 21);
este módulo solo decide la INCLUSIÓN, no emite mensajes.
**Impacto:** `src/main/domain/active-set-policy.ts` y su export en `index.ts` (barrel),
sus unit tests `test/active-set-policy.test.ts` (tarea 8.1) y el property test 8.2
(Property 6). Consumido luego por el orquestador (tarea 18) y la capa IPC (tarea 20).

---

### [2026-09-06] Fix: chequeo de exhaustividad de REQUIRED_KEYS era vacuo (test path-detector)
**Qué:** En `test/path-detector.property.test.ts` el chequeo de exhaustividad agregado en el hardening de la tarea 5.4 (commit 05f4401) no cumplía su función: usaba `Object.fromEntries(...) as Record<RequiredPathKey, true>` y luego un `satisfies Record<RequiredPathKey, true>`. El `as` forzaba el tipo del valor y el `satisfies` lo comparaba contra ese mismo tipo ya forzado, así que SIEMPRE pasaba aunque `REQUIRED_KEYS` estuviera incompleto.
**Decisión:** `REQUIRED_KEYS` pasa a ser una TUPLA literal (`as const satisfies readonly RequiredPathKey[]`) y el chequeo se reemplaza por un assert puramente a nivel de tipos (`type AssertExhaustive<Keys> = [RequiredPathKey] extends [Keys[number]] ? true : never`), SIN ningún `as`. Si el union `RequiredPathKey` crece y la tupla no se actualiza, el assert resuelve a `never` y el typecheck falla.
**Evidencia:** al quitar temporalmente una entrada de la tupla, `npm run typecheck` falla con `TS2322: Type 'true' is not assignable to type 'never'` en `_requiredKeysExhaustive`, confirmando que la comprobación ya no es vacua. Con la tupla completa, typecheck pasa y la suite sigue 76/76.
**Motivo:** un cast anula la verificación; el tipo objetivo debe derivarse de la tupla literal, no de un `as`.

---

### [2026-09-06] Normalización del ÁRBOL COMPLETO de salida en CollisionResolver (Tarea 10 — documentación)
**Qué:** En `collision-resolver.ts`, `mergeInto` construye el `destPath` físico de CADA archivo a partir de la clave normalizada por `toCollisionKey` (minúsculas + separador `/`, luego `\` en disco), la MISMA clave con la que el núcleo puro (`collision-core.ts`) agrupa contribuidores y decide el ganador. Consecuencia: TODO el árbol fusionado en `pak01_dir/` queda escrito en minúsculas y con separadores normalizados, NO solo los paths que colisionan entre addons. Un `Materials/Foo.VMT` aportado por un único addon (sin colisión) también termina físicamente como `materials\foo.vmt`. Igualmente, `FileCollision.relativePath` del `MergeReport` reporta la clave normalizada, no el casing original del autor. Esto quedó IMPLÍCITO en la implementación de las tareas 10.1/10.2 y ahora se documenta explícitamente: se agregó la DECISIÓN 4 al encabezado de `collision-resolver.ts` y un comentario en el sitio de construcción de `destPath` dentro de `mergeInto`.
**Motivo:** la clave canónica debe ser ÚNICA de extremo a extremo — agrupar, decidir ganador y escribir a disco deben usar EXACTAMENTE la misma clave, o el archivo físico podría no coincidir con la ruta bajo la cual se decidió el ganador. Si el destino usara el `relativePath` ORIGINAL sin normalizar, dos addons que aportan el mismo archivo lógico con casing distinto (`Materials/Foo.vmt` vs `materials/foo.vmt`) escribirían a dos rutas de string DISTINTAS: en NTFS (Windows, plataforma primaria, case-insensitive) colapsan igual al mismo archivo, pero en un filesystem CASE-SENSITIVE (Linux/Steam Deck, plataformas secundarias según README.md y design.md) crearían DOS archivos separados y la política "el último gana" dejaría de aplicar. Normalizar el destino hace la fusión determinista en cualquier SO. Escribir en minúsculas es seguro porque el engine de L4D2/Source resuelve las rutas de contenido de forma case-insensitive; el único cambio observable es el casing del árbol de salida. Es a la vez consecuencia de reutilizar una única clave `key` de extremo a extremo (DECISIÓN 2/3) y el comportamiento correcto para case-sensitivity — no un efecto no deseado.
**Mismo criterio que:** la decisión del literal `"\\"` en `vpk-path.ts` (traducción de separadores como regla fija del formato de destino Windows, no dependiente de la plataforma de ejecución) y el casing case-insensitive del match en `vscript-detector.ts`/`addoninfo-extract.ts`: normalización deliberada del formato de destino/comparación, documentada para que no se lea como accidente.
**Nota para la Tarea 21 (UI):** el `relativePath` que se muestre al usuario en un aviso de File_Collision estará en MINÚSCULAS y normalizado, NO en el casing original del addon. Queda anotado aquí y en el comentario del código para que no se descubra como sorpresa al implementar esa tarea. Si la UI necesitara el casing original, habría que propagar el `relativePath` crudo por separado (hoy no se conserva; sería alcance de la 21, no un bug de la fusión).
**Impacto:** solo documentación — `src/main/domain/collision-resolver.ts` (DECISIÓN 4 en el encabezado + comentario en `mergeInto`) y esta entrada del historial. NO se tocó la lógica ni los tests; el comportamiento ya era correcto. `npm test` y `npm run typecheck` siguen verdes.


## Plantilla para entradas futuras

```
### [YYYY-MM-DD HH:MM] Título corto de la decisión
**Qué:** descripción de lo que cambió o se decidió.
**Motivo:** por qué se tomó esta decisión.
**Alternativas descartadas:** (opcional) qué otras opciones se evaluaron.
**Impacto:** qué archivos, módulos o decisiones futuras afecta.
```

---

### [2026-09-06] La firma real de MergeEngine.merge diverge de design.md: Promise<{ vpkPath; report }> en vez de Promise<string>
**Qué:** Se corrigió un gap de diseño detectado en la Sección 11 ya implementada. La interfaz publicada en `design.md` (sección "MergeEngine") especifica `merge(...): Promise<string>` (solo la ruta del `pak01_dir.vpk`). Esa firma DESCARTABA silenciosamente el `MergeReport` que `CollisionResolver.mergeInto` calcula: en el cuerpo de `merge` el resultado de `mergeInto` se ignoraba (`await ...mergeInto(...)` sin asignar). Se cambió la firma REAL a `Promise<{ vpkPath: string; report: MergeReport }>`: `vpkPath` es la ruta del `.vpk` empaquetado y `report` son las colisiones detectadas.
**Motivo:** el Requirement 7.1 y el propio `design.md` dicen que el `MergeReport` existe para que la UI pueda avisar las colisiones, y `OperationResult` (tipo de dominio de la tarea 1) ya reserva `report?: MergeReport` para eso. Con la firma `Promise<string>` ese dato nunca podía llegar hasta el orquestador (tarea 18): se perdía. Se eligió el nombre de campo `report` (no `mergeReport` ni `collisions`) para ALINEAR con `OperationResult.report`, de modo que el orquestador pueda pasar el `report` casi directo; y `vpkPath` para la ruta.
**Alternativas descartadas:** mantener `Promise<string>` y recalcular/propagar las colisiones por otro canal (redundante: `mergeInto` ya las computa); devolver solo el `MergeReport` y derivar la ruta aparte (rompería a los llamadores que necesitan la ruta del `.vpk`).
**IMPORTANTE para quien lea design.md:** el contrato de `MergeEngine.merge` YA NO coincide textualmente con la interfaz publicada (`Promise<string>`). Es una divergencia CONSCIENTE, registrada aquí y en la DECISIÓN 6 del encabezado de `merge-engine.ts`. No asumir que el retorno sigue siendo un `string`.
**Impacto:** `src/main/domain/merge-engine.ts` (nueva firma + DECISIÓN 6 + comentarios de `pack` y de la nota P-14), `test/merge-engine.test.ts` (los tests que inspeccionan el retorno ahora usan `out.vpkPath`; el `FakeCollisionResolver` acepta un `MergeReport` inyectable vía `setReport` y el Caso 1 verifica que ese report con colisiones reales llega intacto en `out.report`) y el futuro orquestador (tarea 18), que consumirá `report` para poblar `OperationResult.report`. Verificación: `npm run typecheck` limpio y `npm test` sigue 144/144.

---

### [2026-09-07] Sección 12 (BackupManager): forma de BackupResult, semántica de ausencia, propagación por throw, nombre del backup, FS mínimo y enfoque del property test
**Qué:** Se implementó la Sección 12 (BackupManager, Requirement 5; AC 5.1, 5.2, 5.3) en la rama `backup-manager` desde `main` actualizada (tras el merge de la Sección 11). Nuevos archivos: `src/main/domain/backup-manager.ts` (tarea 12.1) y `test/backup-manager.property.test.ts` (tarea 12.2, Property 7); más el tipo `BackupResult` en `types.ts`, el barrel `index.ts` y los unit tests `test/backup-manager.test.ts`. Seis decisiones no triviales, todas documentadas también en el encabezado de `backup-manager.ts`:

  - **Decisión 1 — Forma de `BackupResult`: unión discriminada por `created`, SIN campo `ok`.** El tipo es `{ created: true; backupPath: string } | { created: false }`. NO lleva un campo `ok` como sí lo lleva `OperationResult` del orquestador. **Motivo:** los fallos de la operación de backup se propagan SIEMPRE por `throw` (ver Decisión 3), nunca por una rama `ok: false` del retorno; un campo `ok` sería siempre `true` y no discriminaría nada. `created` es el discriminante útil: dice si se creó un backup, y `backupPath` (presente solo cuando `created: true`) da la ruta. **Contraste con `OperationResult`:** ese tipo sí usa `ok: true | false` porque el orquestador (tarea 18) SÍ captura los errores y los convierte en un resultado; BackupManager vive en la capa de dominio y no captura.

  - **Decisión 2 — "pak01_dir.vpk ausente = no-op exitoso, no aborta".** El AC 5.1 ("crear un Backup del pak01_dir.vpk actual antes de modificarlo") presupone que exista un `pak01_dir.vpk` actual. En la PRIMERA instalación todavía no hay ninguno en `modsvs/`; en ese caso `backupExisting` devuelve `{ created: false }` sin tocar nada y el orquestador SIGUE ADELANTE. **Motivo:** no hay nada que respaldar y no hay riesgo de perder un archivo inexistente, así que la ausencia NO es un fallo. El flujo es: `exists(source)` → `false` → `{ created: false }`; `exists(source)` → `true` → `copyFile` → `{ created: true, backupPath }`.

  - **Decisión 3 — Fallos de copia se propagan por throw, sin atrapar (AC 5.2).** `backupExisting` NO envuelve `copyFile` en try/catch. Si la copia lanza (EACCES, EPERM, ENOSPC, etc.), el error sube al orquestador tal cual. **Motivo:** la decisión de qué hacer ante ese fallo es del ORQUESTADOR, no del dominio: puede abortar la fusión (AC 5.2) o, si es un error de permisos, reintentar en una instancia elevada vía `ElevationService.handleWriteFailure` (tarea 17.2). Si BackupManager atrapara el error y devolviera un `{ ok: false }`, el orquestador no podría distinguir un fallo de backup de un EACCES que merece reintento elevado, rompiendo esa lógica. Esta decisión es la razón concreta por la que `BackupResult` no necesita una rama de error (Decisión 1).

  - **Decisión 4 — Nombre y ubicación del backup: `pak01_dir.vpk.backup` en la misma carpeta `modsvs/`, nombre FIJO.** El backup se llama `pak01_dir.vpk.backup` y vive junto al original en `modsvs/`. **Motivo:** el nombre fijo garantiza el único nivel de backup (AC 5.3) por SOBRESCRITURA física —copiar siempre al mismo destino pisa el backup previo—, no por una lógica de conteo/rotación de versiones. Encaja con la convención ya implícita en el `.gitignore` del repo (patrón `*.vpk.backup*`), que además evita versionar el backup por accidente si el Game_Root estuviera dentro del workspace. Al vivir en `modsvs/` (que ya existe cuando hay algo que respaldar) no se necesita `ensureDir`.

  - **Decisión 5 — `BackupFileSystem` mínimo (`exists` + `copyFile`), mismo patrón que el resto del dominio.** BackupManager define su PROPIO contrato de FS inyectable con solo las dos operaciones que necesita: `exists` (¿hay un `pak01_dir.vpk` actual?) y `copyFile` (copiar sobrescribiendo). **Motivo:** es el mismo criterio ya aplicado en `MergeFileSystem` (solo `ensureDir`), `CollisionFileSystem` (walk + ensureDir + copyFile) y `AddonFileSystem`: cada componente de dominio expone el contrato de FS MÍNIMO que requiere, en vez de compartir un FS genérico. BackupManager no recorre ni crea directorios, así que su contrato es el más chico de todos. Se inyecta por constructor para testear sin disco real.

  - **Decisión 6 — Enfoque del property test (12.2, Property 7): ciclo "backup → instalar" simulado, con "instalar" como stand-in del orquestador.** El property test (`test/backup-manager.property.test.ts`) genera SECUENCIAS de 1..8 instalaciones que sobrescriben y verifica dos invariantes sobre toda la secuencia: **(a)** el backup existe (con el contenido del actual previo) ANTES de que se pise el `pak01_dir.vpk` actual en cada paso donde había un actual, y **(b)** en cualquier punto hay A LO SUMO un nivel de backup (nunca un `pak01_dir.vpk.backup.backup` ni versiones numeradas). Para poder observar el invariante (a) —que es sobre el ORDEN entre "crear el backup" y "pisar el actual"— el test simula el ciclo COMPLETO backup→instalar. **Punto clave documentado en el encabezado del test:** la ÚNICA unidad de producción bajo prueba es `BackupManager.backupExisting`; el paso "instalar" (sobrescribir la entrada del `pak01_dir.vpk` en el FS en memoria) es un STAND-IN del `MergeOrchestrator` (tarea 18, aún NO implementada), NO código de BackupManager. La propiedad NO afirma que BackupManager instale nada: afirma que, en el orden en que el orquestador invocará `backupExisting` ANTES de instalar, el backup queda creado antes de la sobrescritura y nunca se acumula más de un nivel. El invariante (b) depende solo de `backupExisting` (nombre fijo + sobrescritura) y se verifica sobre el estado real del FS tras cada llamada real. El FS del property test (`SequenceFs`) modela CONTENIDO (Map ruta→contenido), no solo presencia, para poder verificar (a) por contenido; es equivalente al `MockFs` de los unit tests pero adaptado a secuencias.

**Motivo (global):** cerrar la Sección 12 resolviendo los huecos que design.md dejaba abiertos sobre BackupManager (forma de `BackupResult`, nombre/ubicación del backup y contrato de FS), con el mismo criterio de "documentar toda decisión de forma no trivial inferida del diseño" aplicado en la Tarea 1 (OperationResult), la Sección 11 (firma de `MergeEngine.merge`) y la Sección 10 (normalización de clave en CollisionResolver).

**Alternativas descartadas:**
  - `BackupResult` con campo `ok` (como `OperationResult`): descartada porque no habría nunca una rama `ok: false` (los fallos van por throw), así que el campo sería ruido.
  - Atrapar el fallo de copia dentro de BackupManager y devolver un resultado de error: descartada porque le quitaría al orquestador la información necesaria para decidir entre abortar y reintentar con elevación (tarea 17.2).
  - Backup con nombre versionado/rotado (p. ej. `pak01_dir.vpk.backup.1`, `.2`): descartada; el MVP mantiene deliberadamente UN solo nivel (AC 5.3, trade-off ya aceptado en requirements.md), y el nombre fijo lo garantiza por construcción sin lógica de conteo.

**Impacto:** `src/main/domain/backup-manager.ts` (nuevo, tarea 12.1), `src/main/domain/types.ts` (tipo `BackupResult`), `src/main/domain/index.ts` (barrel: `BackupResult`, `BackupManager`, `BackupFileSystem`), `test/backup-manager.test.ts` (unit tests 12.1) y `test/backup-manager.property.test.ts` (Property 7, tarea 12.2). Condiciona la tarea 18 (MergeOrchestrator), que consumirá `BackupManager.backupExisting` en el paso de backup del flujo, traducirá su throw a `OperationResult`/`handleWriteFailure` y materializará el paso "instalar" que el property test simula. Verificación: `npm run typecheck` limpio y `npm test` en 152/152 (21 archivos previos + `backup-manager.property.test.ts`; el property test suma 1 test que corre >=100 iteraciones internamente). Commits: `4c56ff7` (feat, 12.1) y `8dfb1f7` (test, 12.2) en la rama `backup-manager`, pendientes de merge a `main`.

### [2026-09-07] Sección 13 (GameInfoEditor): error tipado sin SearchPaths, transformación por líneas, núcleo puro + I/O inyectado y forma de GameInfoEditResult (Tarea 13.1)
**Qué:** Se implementó la Tarea 13.1 (GameInfoEditor, Requirement 6, AC 6.10) en la rama `gameinfo-editor` desde `main` actualizada (tras el merge de la Sección 12). Nuevo archivo `src/main/domain/game-info-editor.ts`; más el tipo `GameInfoEditResult` en `types.ts` y su export en el barrel `index.ts`. `ensureModsvsFirst` garantiza que `Game modsvs` sea la PRIMERA y ÚNICA entrada `modsvs` del bloque `SearchPaths`, cubriendo los tres casos de design.md (A: ausente -> insertar primero; B: existe no-primera o múltiple -> mover/colapsar a única primera; C: ya primera y única -> sin cambios, idempotente), preservando el orden relativo del resto de SearchPaths. Cinco decisiones no triviales, todas documentadas también en el encabezado de `game-info-editor.ts`:

  - **Decisión 1 — Sin bloque `SearchPaths` (ausente / vacío / malformado) = error tipado `GameInfoEditError`, NO crear el bloque.** El AC 6.10 y los tres casos de design.md ASUMEN que el bloque `SearchPaths` ya existe (la nota confirmada por el usuario: en la instalación real `Game modsvs` ya está como primer SearchPath, agregado a mano). Cuando el `gameinfo.txt` NO tiene un bloque `SearchPaths` localizable —clave ausente, o presente pero sin su `{ ... }`— `ensureModsvsFirst` lanza `GameInfoEditError` con `reason: "missing-search-paths"` (no hay bloque) o `reason: "malformed"` (hay clave `SearchPaths` pero su bloque no cierra con `}`). NO se extiende el Caso A a "crear un `SearchPaths` desde cero". **Motivo:** insertar una estructura `SearchPaths` completa en un archivo del juego que no la tiene es riesgoso (podría corromper un `gameinfo.txt` con un layout inesperado) y no está avalado por el diseño; es más seguro fallar explícito y que el orquestador (tarea 18) lo informe. Mismo criterio de "propagar por throw y que el orquestador decida" que BackupManager (Sección 12, Decisión 3).

  - **Decisión 2 — Transformación POR LÍNEAS, no round-trip vía el parser KeyValues (`vdf-parser.ts`).** Aunque el parser existente modela `SearchPaths` como `VdfEntry[]` (admite la clave `Game` repetida), un round-trip parse->render PERDERÍA el formato: indentación, comentarios `//`, casing original, EOL (CRLF/LF) y el orden/espaciado de otras claves fuera de `SearchPaths`. `ensureModsvsFirst` opera sobre las LÍNEAS del archivo: localiza el bloque `SearchPaths`, identifica las líneas `Game modsvs` dentro de él, y solo inserta/mueve/elimina esas líneas. Todo lo demás queda intacto CARÁCTER POR CARÁCTER. **Motivo:** es una edición quirúrgica de un archivo del juego; debe minimizar el diff para no alterar nada que el engine o el usuario dependan (comentarios, otras SearchPaths, formato).

  - **Decisión 3 — Preservación de indentación y EOL, entrada canónica `Game modsvs` sin comillas.** La línea que se inserta/mueve replica (a) la INDENTACIÓN (whitespace líder) y (b) el FIN DE LÍNEA (CRLF vs LF) detectados de las demás líneas `Game` del bloque (o, si no hay ninguna, de la línea de apertura del bloque). El texto canónico escrito es `Game modsvs` (clave `Game` + un espacio + `modsvs`, SIN comillas), coherente con el formato real confirmado. Si existiera una ocurrencia con casing/espaciado distinto (`GAME   modsvs`, `Game "modsvs"`) en posición no-primera, se COLAPSA a la forma canónica en primera posición (Caso B). El match de la carpeta `modsvs` es CASE-INSENSITIVE (NTFS y el engine de Source resuelven rutas así; mismo criterio que `vscript-detector`/`collision-resolver`).

  - **Decisión 4 — Núcleo PURO de texto + capa de I/O inyectada (patrón CollisionResolver 10.1/10.2 y BackupManager).** Se separa `ensureModsvsFirstInContent(content: string): GameInfoEditOutcome` (función PURA: recibe el contenido y devuelve `{ content, changed, appliedCase }`, sin I/O) del método `ensureModsvsFirst(gameInfoFile)` de la clase `GameInfoEditor`, que lee el archivo con el FS inyectado, aplica el núcleo puro y ESCRIBE SOLO si `changed === true` (Caso C no toca disco -> idempotencia real y cero reescrituras espurias). El núcleo puro es lo que prueba la Property 12 (tarea 13.2) sin tocar disco.

  - **Decisión 5 — `GameInfoEditResult`: UNIÓN DISCRIMINADA ESTRICTA por `appliedCase`, con `changed` CORRELACIONADO a nivel de tipos, sin campo `ok`.** El tipo es `| { appliedCase: "unchanged"; changed: false } | { appliedCase: "inserted" | "moved"; changed: true }`. NO es un objeto con `changed: boolean` genérico derivado en prosa: el discriminante `appliedCase` está ACOPLADO al literal de `changed` de modo que el compilador garantice la correspondencia (Caso C `unchanged` -> `changed: false`; Casos A/B `inserted`/`moved` -> `changed: true`), haciendo imposible construir un `{ appliedCase: "unchanged", changed: true }` incoherente. Igual que `BackupResult` (Sección 12, Decisión 1): los fallos van por `throw` (`GameInfoEditError`), así que no hay rama de error en el retorno y un `ok` sería siempre `true`. `appliedCase` dice qué caso se aplicó (A->`inserted`, B->`moved`, C->`unchanged`), información barata y útil para logs/UI y para que el property test verifique que una segunda aplicación devuelve `unchanged` con `changed: false`. El núcleo puro devuelve un `GameInfoEditOutcome` que sigue EL MISMO patrón de unión discriminada estricta (añade `content` en ambas ramas), de modo que la correlación caso<->cambio nace ya en el núcleo y no se reconstruye en la capa de I/O.

**Motivo (global):** cerrar la Tarea 13.1 resolviendo los huecos que design.md deja abiertos (comportamiento ante ausencia de `SearchPaths`, forma de `GameInfoEditResult`, técnica de edición y contrato de FS), con el mismo criterio de "documentar toda decisión de forma no trivial inferida del diseño" aplicado en la Tarea 1, la Sección 10, la Sección 11 y la Sección 12.

**Alternativas descartadas:**
  - Tratar la ausencia de `SearchPaths` como Caso A y crear el bloque desde cero: descartada por riesgo de corromper el archivo (Decisión 1).
  - Round-trip vía el parser KeyValues (`vdf-parser.ts`): descartada porque normaliza y pierde formato/comentarios (Decisión 2).
  - `GameInfoEditResult` con campo `ok`: descartada por la misma razón que en BackupManager (los fallos van por throw; el `ok` sería ruido).

**Impacto:** `src/main/domain/game-info-editor.ts` (nuevo, tarea 13.1), `src/main/domain/types.ts` (tipo `GameInfoEditResult`), `src/main/domain/index.ts` (barrel: `GameInfoEditResult`, `GameInfoEditor`, `GameInfoFileSystem`, `GameInfoEditError`, `ensureModsvsFirstInContent`). Condiciona la tarea 13.2 (Property 12, property test del núcleo puro) y la tarea 18 (MergeOrchestrator), que invocará `ensureModsvsFirst` en el paso posterior a instalar en `modsvs/` y traducirá su throw a `OperationResult`/`handleWriteFailure`.

### [2026-09-08] Sección 14 (ProcessGuard): matching exacto case-insensitive, extracción de basename y alcance solo-interfaz del ProcessListProvider (Tareas 14.1 y 14.2)

**Qué:** Se implementó la Sección 14 `ProcessGuard`, Requirement 4) en la rama `process-guard`, creada desde `main` actualizada. Se agregó `src/main/domain/process-guard.ts` (tarea 14.1) con la clase `ProcessGuard`, la constante `GAME_PROCESS_NAME = "left4dead2.exe"` y la interfaz inyectable `ProcessListProvider`; sus unit tests en `test/process-guard.test.ts` (tarea 14.2, 10 casos, sin property test — ProcessGuard no está entre las 15 Correctness Properties del diseño); y el export correspondiente en el barrel `src/main/domain/index.ts`. Nota: la rama parte de `main` sin la Sección 13 (gameinfo-editor) mergeada todavía (el checkpoint de esa etapa es la tarea 16), lo cual es correcto porque la Sección 14 no depende de la 13.

Se tomaron tres decisiones de implementación no fijadas explícitamente por el AC 4.1/4.2 ni por design.md:

- **Decisión 1 — Matching EXACTO (igualdad, no substring/prefix), case-insensitive.** El nombre de proceso se compara contra el literal `"left4dead2.exe"` con igualdad exacta tras `.toLowerCase()` en ambos lados, nunca con `includesstartsWith`. Motivo: nombres como `"left4dead2.exe.bak"` o `"notleft4dead2.exe"` no son el proceso del juego y un matching por substring los daría como falso positivo. El casing se ignora porque Windows no distingue mayúsculas en nombres de ejecutable.

- **Decisión 2 — Extracción de BASENAME antes de comparar, soportando `\` y `/`.** Un proveedor de procesos podría devolver el nombre a secas o una ruta completa (Windows con `\`, o Linux/Steam Deck con `/`). Antes de comparar se extrae el último segmento tras cualquiera de los dos separadores, de modo que la comparación sea siempre sobre el nombre de archivo. Si el nombre ya viene sin ruta, la extracción es un no-op transparente.

- **Decisión 3 — Alcance: `ProcessListProvider` es SOLO una interfaz inyectable, sin implementación real de producción.** `tasks.md` no incluye, para ProcessGuard, una tarea equivalente a la "3" de VpkTool (integración con el binario/API real); por eso `isGameRunning` no tiene error tipado ni rama de fallo `Promise<boolean>` sin más) y el contrato del proveedor se deja sin implementar, del mismo modo que `VpkTool` define `CommandRunner` o `PathDetector` define sus lectores sin implementarlos en la misma tarea. **A revisar:** la enumeración REAL de procesos de Windows (p. ej. parseando `tasklist`, o vía alguna librería nativa) queda pendiente para cuando el orquestador (tarea 18) o la capa IPC (tarea 20) la necesiten; no es un vacío que bloquee la Sección 14, es trabajo diferido explícito.

**Motivo (global):** el AC 4.1 solo dice "verificar que `left4dead2.exe` no esté en ejecución"; no especifica criterio de matching, formato del nombre reportado por el SO, ni el alcance de qué proveedor implementar en esta tarea. Fijar estos tres puntos ahora evita ambigüedad en el consumo futuro (orquestador, tarea 18) y en la eventual implementación real del proveedor.

**Alternativas descartadas:** matching por `includes`/substring (descartado por el riesgo de falsos positivos con nombres como `left4dead2.exe.bak`); implementar ya una versión real del proveedor sobre `tasklist` o similar (descartado por no estar en el alcance de la tarea 14.1 según `tasks.md`, y por introducir una dependencia de plataforma antes de que el orquestador defina cómo la necesita).

**Impacto:** `src/main/domain/process-guard.ts` (tarea 14.1), `test/process-guard.test.ts` (tarea 14.2), el barrel `src/main/domain/index.ts` (export de `ProcessGuard`, `GAME_PROCESS_NAME`, `ProcessListProvider`). Condiciona la futura implementación real de `ProcessListProvider` y su wiring en `MergeOrchestrator` (tarea 18).


### [2026-09-08] Sección 15 (LocalStore): motor SQLite inyectado, esquema de 3 tablas, savePaths con merge parcial y ciclo de vida de la sesión pendiente (Tareas 15.1, 15.2, 15.3)

**Qué:** Se implementó la Sección 15 (LocalStore, Requirement 8; AC 1.13, 8.1, 8.6; soporte de rehidratación del relanzo elevado del Req 9.2) en la rama `local-store`, creada desde `main` actualizada (que ya incluye las Secciones 13 gameinfo-editor y 14 process-guard). Nuevo archivo `src/main/domain/local-store.ts` con la interfaz `LocalStore` y la implementación `SqliteLocalStore`; su export en el barrel `index.ts`; el property test `test/local-store.property.test.ts` (Tarea 15.2, Property 14) y los unit tests `test/local-store.test.ts` (Tarea 15.3). Los tipos `AddonManifestEntry` y `GamePaths` YA existían en `types.ts` (Tarea 1) y se REUSARON sin redefinirlos. Cuatro decisiones no triviales, todas documentadas también en el encabezado de `local-store.ts`:

  - **Decisión 1 — Motor de persistencia: SQLite vía `better-sqlite3`; JSON plano descartado.** La decisión de SQLite ya la había tomado el usuario y el design.md la recomienda. Motivos: transacciones atómicas al reemplazar manifest/sesión, API SÍNCRONA (encaja con el dominio, que no es async salvo el I/O de VpkTool), y escala a las entidades de la Fase Posterior (favoritos/presets/categorías, Req 11-13). JSON queda descartado para esta implementación (sin atomicidad, riesgo de corrupción), pero la interfaz `LocalStore` queda desacoplada del motor: un backend JSON podría implementarla sin tocar consumidores.

  - **Decisión 2 — `Database` de better-sqlite3 INYECTADA por constructor (patrón `CommandRunner`/`ProcessListProvider`/`*FileSystem`).** `SqliteLocalStore` NO abre el archivo por sí misma: recibe una `Database` ya construida. Producción → `new Database(rutaArchivo)`; tests → `new Database(":memory:")`, una base REAL en memoria (no un mock a mano), de modo que property/unit tests ejerciten el MISMO SQL que producción sin tocar disco. El constructor corre el DDL idempotente (`CREATE TABLE IF NOT EXISTS`). **Nota test-time vs package-time (electron-rebuild):** los tests corren bajo Node vía Vitest, que comparte la ABI nativa con el Node del sistema, así que un `npm install` normal basta para que `better-sqlite3` cargue en los tests SIN `electron-rebuild`. `@electron/rebuild` (ya presente en devDependencies) solo hace falta al EMPAQUETAR la app, para recompilar el módulo nativo contra la ABI del runtime de Electron. Por eso la suite pasa sin rebuild. (No se agregó ninguna dependencia nueva a package.json: `better-sqlite3` 13.0.3, `@types/better-sqlite3` 9.6.0 y `@electron/rebuild` 4.2.0 ya estaban declarados de tareas previas.)

  - **Decisión 3 — Esquema SQL (el design.md deja el formato a criterio de implementación).** Tres tablas: (a) `paths`, fila ÚNICA fijada con `id INTEGER PRIMARY KEY CHECK (id = 1)`, una columna nullable por cada clave de `GamePaths` (para admitir el guardado parcial de la Decisión 4); (b) `manifest`, el Active_Set INSTALADO, `(addonId TEXT PRIMARY KEY, priorityOrder INTEGER NOT NULL)`, reemplazado entero por transacción y leído por `priorityOrder` ascendente; (c) `pending_session`, el Active_Set CANDIDATO del relanzo elevado, MISMA forma que `manifest` pero en su PROPIA tabla para que candidato pendiente e instalado no se pisen. `getPaths()` devuelve `null` si falta cualquiera de las 7 rutas (un `GamePaths` incompleto no es válido); `getPendingSession()` devuelve `null` cuando no hay ninguna fila (una sesión candidata vacía no aporta nada que rehidratar, así que `savePendingSession([])` colapsa a `null`).

  - **Decisión 4 — Semántica de `savePaths(paths: Partial<GamePaths>)`: MERGE parcial, NO reemplazo del registro entero.** El tipo `Partial<GamePaths>` implica que el llamador puede suplir solo algunas rutas (p. ej. el flujo de selección manual del PathDetector resuelve una ruta faltante por vez, AC 1.10-1.12). `savePaths` hace UPSERT columna por columna con `COALESCE(nuevo, actual)`: cada clave presente sobrescribe su columna, las ausentes conservan su valor previo. Guardar `{ steamPath }` no borra el `gameRoot` guardado antes. Un reemplazo entero contradiría la forma `Partial` y borraría rutas ya resueltas.

**Alcance (importante):** esta Sección SOLO implementa el CICLO DE VIDA del estado de sesión pendiente (`savePendingSession`/`getPendingSession`/`clearPendingSession`). Su CONSUMO —persistir el candidato ANTES de relanzar con `runas` y rehidratar la UI al arrancar la instancia elevada— es de la Tarea 17 (ElevationService), que NO se tocó aquí.

**Motivo (global):** cerrar la Sección 15 resolviendo los huecos que design.md deja abiertos (esquema físico, semántica de `savePaths`, patrón de inyección del motor), con el mismo criterio de "documentar toda decisión de forma no trivial inferida del diseño" aplicado en las Secciones 10-14.

**Alternativas descartadas:** JSON plano como motor (descartado por falta de atomicidad y no escalar a la Fase Posterior); `savePaths` con reemplazo entero del registro (descartado por contradecir el tipo `Partial<GamePaths>` y perder rutas resueltas parcialmente); una sola tabla compartida manifest + sesión pendiente (descartada para que el candidato pendiente no pise el Active_Set instalado).

**Nota de encoding (proceso):** al marcar los checkboxes de `tasks.md`, `Set-Content -Encoding UTF8` de PowerShell corrompió los acentos del archivo entero (mojibake, 119 líneas tocadas). Se revirtió con `git checkout --` y se rehízo la edición con `System.IO.File.WriteAllText` + `UTF8Encoding($false)` (UTF-8 SIN BOM), que preserva los bytes; el diff final de `tasks.md` quedó en solo 4 líneas (los 4 checkboxes). Método a usar para futuras ediciones de archivos con acentos desde PowerShell.

**Impacto:** `src/main/domain/local-store.ts` (nuevo), `src/main/domain/index.ts` (barrel: `SqliteLocalStore`, `LocalStore`), `test/local-store.property.test.ts` (Property 14), `test/local-store.test.ts` (unit), `tasks.md` (checkboxes 15/15.1/15.2/15.3). Condiciona la Tarea 17 (ElevationService, que consumirá el estado de sesión pendiente), la Tarea 18 (MergeOrchestrator, que persistirá manifest y rutas) y la Tarea 20 (capa IPC). Verificación: `npm run typecheck` limpio y `npm test` en 178/178 (26 archivos, +2 nuevos de local-store; el property test corre >=100 iteraciones).