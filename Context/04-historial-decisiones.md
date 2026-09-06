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
**A verificar (Tarea 3):** confirmar con un fixture de integración que incluya paths
de VPK CON ESPACIOS (y, si aplica, otros caracteres que fuercen quoting) que la
extracción real por lotes no excede el límite del SO ni reproduce el fallo `exit -1`.
Si se observa que el quoting empuja por encima del límite, habrá que (a) bajar el
margen por defecto o (b) incorporar el costo del quoting al modelo.
**Impacto:** `src/main/domain/vpk-batch.ts` (tarea 2.3), el property test 2.4 (que
razona sobre el MISMO modelo vía `commandLengthForBatch`), y el test de integración
de la tarea 3. Consumido por `VpkTool.extract()` (tarea 2.7).

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

## Plantilla para entradas futuras

```
### [YYYY-MM-DD HH:MM] Título corto de la decisión
**Qué:** descripción de lo que cambió o se decidió.
**Motivo:** por qué se tomó esta decisión.
**Alternativas descartadas:** (opcional) qué otras opciones se evaluaron.
**Impacto:** qué archivos, módulos o decisiones futuras afecta.
```
