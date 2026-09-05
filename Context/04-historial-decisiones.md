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

## Plantilla para entradas futuras

```
### [YYYY-MM-DD HH:MM] Título corto de la decisión
**Qué:** descripción de lo que cambió o se decidió.
**Motivo:** por qué se tomó esta decisión.
**Alternativas descartadas:** (opcional) qué otras opciones se evaluaron.
**Impacto:** qué archivos, módulos o decisiones futuras afecta.
```
