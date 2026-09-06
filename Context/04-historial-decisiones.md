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

## Plantilla para entradas futuras

```
### [YYYY-MM-DD HH:MM] Título corto de la decisión
**Qué:** descripción de lo que cambió o se decidió.
**Motivo:** por qué se tomó esta decisión.
**Alternativas descartadas:** (opcional) qué otras opciones se evaluaron.
**Impacto:** qué archivos, módulos o decisiones futuras afecta.
```

### [2026-09-06] Fix: chequeo de exhaustividad de REQUIRED_KEYS era vacuo (test path-detector)
**Qué:** En `test/path-detector.property.test.ts` el chequeo de exhaustividad agregado en el hardening de la tarea 5.4 (commit 05f4401) no cumplía su función: usaba `Object.fromEntries(...) as Record<RequiredPathKey, true>` y luego un `satisfies Record<RequiredPathKey, true>`. El `as` forzaba el tipo del valor y el `satisfies` lo comparaba contra ese mismo tipo ya forzado, así que SIEMPRE pasaba aunque `REQUIRED_KEYS` estuviera incompleto.
**Decisión:** `REQUIRED_KEYS` pasa a ser una TUPLA literal (`as const satisfies readonly RequiredPathKey[]`) y el chequeo se reemplaza por un assert puramente a nivel de tipos (`type AssertExhaustive<Keys> = [RequiredPathKey] extends [Keys[number]] ? true : never`), SIN ningún `as`. Si el union `RequiredPathKey` crece y la tupla no se actualiza, el assert resuelve a `never` y el typecheck falla.
**Evidencia:** al quitar temporalmente una entrada de la tupla, `npm run typecheck` falla con `TS2322: Type 'true' is not assignable to type 'never'` en `_requiredKeysExhaustive`, confirmando que la comprobación ya no es vacua. Con la tupla completa, typecheck pasa y la suite sigue 76/76.
**Motivo:** un cast anula la verificación; el tipo objetivo debe derivarse de la tupla literal, no de un `as`.
