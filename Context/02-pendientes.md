# Pendientes y Vacíos Técnicos

Lista viva. Actualizar a medida que se resuelvan o aparezcan nuevas preguntas.

---

## Resueltos (validados con prueba real)

### P-01 - Mecanismo de fusión/habilitación de VPKs - RESUELTO
**Decisión:** Opción **B** - desempaquetar los VPKs seleccionados y reempaquetar todo en un único `pak01_dir.vpk` fusionado, colocado en la carpeta `modsvs/` referenciada desde `gameinfo.txt`.

**Validado end-to-end el 2026-09** con addons reales del usuario. El ciclo completo funcionó y cargó en Versus dentro del juego sin texturas ni modelos rotos:

```
vpk l <addon.vpk>            -> listar contenido (filtrar ruido de debug)
crear subdirectorios          -> obligatorio, vpk x no los crea
vpk x <addon.vpk> <archivos>  -> extraer (POR LOTES, ver hallazgo abajo)
fusionar carpetas             -> copiar contenido de todos los addons a pak01_dir/
vpk <carpeta pak01_dir>       -> empaquetar -> genera pak01_dir.vpk
copiar a modsvs/              -> instalar
```

**Hallazgo crítico de implementación:** `vpk.exe x` **falla al pasar muchos archivos como argumentos en una sola invocación** (ocurrió con el addon de 232 archivos: extrajo 0, exit code -1). La app DEBE extraer en **lotes** (probado con lotes de 20 -> 232/232 extraídos correctamente). Esto es un requisito de implementación, no opcional.

**Detalles completos:** ver `01-decisiones-tecnicas.md`.

---

### P-13 - Resolución de colisiones de archivos entre addons - RESUELTO
**Decisión validada:** cuando dos addons aportan un archivo con el mismo path relativo, **gana el último de la lista** (según el orden de prioridad definido por el usuario).

**Validado el 2026-09** con 2 addons reales que reemplazan los mismos modelos de brazos en primera persona (`models/weapons/arms/v_arms_*`): compartían 24 archivos. Se fusionaron aplicando "último gana" y se confirmó por **hash SHA256** que el archivo final correspondía al último addon de la lista, más verificación visual en Versus sin roturas ni mezclas a medias.

**Pendiente menor de UX (no bloquea):** decidir si la app avisa al usuario cuando detecta colisiones antes de fusionar, o solo aplica la política silenciosamente. Se puede resolver en fase de diseño de UI.

---

## Importantes (deben resolverse antes de terminar el diseño)

### P-05 - Fuente de datos para resolución de dependencias
El formato VPK no incluye manifiesto de dependencias estándar. Opciones:
- El usuario las declara manualmente en la app
- Scraping/consulta de la página de Steam Workshop (Steam Web API o scraping)
- Base de datos curada dentro del proyecto (requiere mantenimiento)
- Combinación: base curada + declaración manual

---

### P-06 - Modelo de datos y persistencia local
Datos a persistir: addons activos, presets, favoritos, metadatos (nombre, portada, descripción, categoría), cache de miniaturas, dependencias, y **manifiesto por addon** (qué paths aportó cada addon al paquete fusionado - necesario para quitar addons sin rehacer todo).

**Decisión tomada (2026-09):** opción **á** - base de datos local con manifiesto por addon, para permitir operaciones incrementales. Motor concreto (SQLite vía better-sqlite3, Dexie, o JSON) aún por elegir.

---

### P-07 - Sistema de cache de miniaturas
**Dato confirmado:** las portadas ya existen en disco como `<id>.jpg` junto a cada `<id>.vpk` en workshop. No hace falta descargarlas de internet - se leen del disco. El cache aplica más al redimensionado que a la descarga.

**Acción sugerida:** diseñar cache en disco desde el principio.

---

## Confirmados (método validado, sin bloqueo)

### P-02 - Wrapper de vpk.exe
`vpk.exe` del `bin/` quedó validado end-to-end para listar, extraer y empaquetar. Se wrappea vía child_process / ProcessStartInfo. A futuro se puede evaluar una librería nativa para lectura de índices (más rápida en el escaneo inicial), pero no bloquea.
Notas: filtrar `CDynamicFunction:`/`FS:`/`Using` del stdout; paths internos con `/`, en disco con `\`; extraer en lotes (~20).

### P-03 - Detección de rutas de Steam/L4D2
Confirmado por lectura real: registro `HKCU\Software\Valve\Steam` -> `SteamPath`, luego `libraryfolders.vdf` (buscar clave `550`). Fallback a selección manual si falla.

### P-04 - Detección de VScript
Confirmado: inspeccionar listado de `vpk l` buscando `scripts/vscripts/*.nut`. NO confiar en el flag `addonContent_Script` del addoninfo.txt (visto en 0 con scripts reales presentes).

---

## Menores (pueden resolverse durante el desarrollo)

### P-08 - Manejo de actualizaciones de addons ya fusionados
Si un addon activo se actualiza en Workshop, la app lo detecta (hash/timestamp) y avisa o re-fusiona?

### P-09 - Flujo de suscripción nueva
Un addon recién suscrito solo se descarga cuando el juego arranca. Mejorar el flujo o documentarlo como limitación (como funky)?

### P-10 - Permisos de administrador
La instalación por defecto está en `C:\Program Files (x86)\Steam\...`, que puede requerir permisos elevados para escribir en `modsvs/` y `gameinfo.txt`. Problema distinto e independiente del SmartScreen.

### P-11 - Verificación de archivos de Steam
Steam puede re-verificar integridad y pisar cambios manuales sin avisar. Detectar el escenario o documentarlo como advertencia.

### P-12 - Frontend: React vs Angular
Ambos conocidos por el desarrollador. Pendiente de elección. No afecta la arquitectura del núcleo.

---

### P-14 - Limpieza del workDir tras un abort de MergeEngine
Si `MergeEngine.merge()` aborta a mitad (un `VpkToolError` en `list`/`extract` de algún addon corta el flujo), los directorios/archivos ya creados bajo `<workDir>\extract` y `pak01_dir` NO se limpian hoy. Queda como responsabilidad futura del orquestador (Tarea 18) o de quien invoque MergeEngine; el núcleo de fusión no lo resuelve. Documentado también en el encabezado de `merge-engine.ts` (DECISIÓN 4).

**RESUELTO (2026-09) en la Sección 18**: MergeOrchestrator limpia el workDir en todos los casos (éxito, fallo definitivo y elevación) vía un `finally` que borra recursivamente el directorio de trabajo que creó por operación.

### P-15 - Tipo de operación hardcodeado en ElevationService.ensureCanWrite
`ensureCanWrite(gameRoot, entries)` no recibe el tipo de operación real (`applyActiveSet`/`addAddon`/`removeAddon`) del llamador, así que el camino PROACTIVO construye siempre una `PendingOperation` con `type: "applyActiveSet"` hardcodeado. Cuando la Tarea 18 (MergeOrchestrator) exista y dispare el camino proactivo desde `addAddon` o `removeAddon`, la `PendingOperation` va a reportar el tipo incorrecto a la instancia elevada (el camino REACTIVO no tiene este problema: `handleWriteFailure` recibe el `pending` correcto desde afuera). Queda como responsabilidad de la Tarea 18 decidir si extiende la firma de `ensureCanWrite` con un parámetro de tipo de operación, o si resuelve el problema de otra forma.

**RESUELTO (2026-09) en la Sección 18**: `ensureCanWrite` ahora recibe `operationType: PendingOperation["type"]` explícito del MergeOrchestrator (según ejecute `applyActiveSet`/`addAddon`/`removeAddon`) y construye la `PendingOperation` con ese tipo, en vez de hardcodear `"applyActiveSet"`. Se optó por extender la firma (misma DECISIÓN 1 de divergencia consciente de `elevation-service.ts`).

### P-16 - El script "build" no genera dist/renderer/ (falta para app empaquetada)
`npm run build` corre `tsc -p tsconfig.json && vite build --config vite.preload.config.ts` (main + preload), pero nunca corre el build del renderer (`vite build` a secas / `build:renderer`). `main.ts`, en el camino `app.isPackaged === true`, hace `mainWindow.loadFile(dist/renderer/index.html)` - ese archivo no existe si solo se corrió `"build"`. Hallazgo de `/code-review` sobre la Sección 21 (Bloque 2), preexistente (ya faltaba antes del fix del preload de esta sesión, que solo tocó las patas de main/preload). No bloquea el desarrollo (`npm run dev` no depende de `dist/renderer`), pero rompería un empaquetado real (`electron-builder`) hecho a partir de `"build"` sola. Pendiente decidir: sumar el paso del renderer a `"build"` directamente, o documentar que el empaquetado requiere correr `"build"` + `"build:renderer"` (o `"build:renderer"` primero) como dos pasos explícitos.

### P-21 - Bug real (no nit de estilo): decodeURIComponent sin capturar en el handler l4d2cover://
Hallazgo de `/code-review ultra` sobre el diff `ui -> main` (2026-09-10), preexistente de la Sección 21 Bloque 1 (`main.ts`, protocolo `l4d2cover://`), NO de la Sección 21.2 recién agregada. `protocol.handle("l4d2cover", ...)` llama `decodeURIComponent(pathname.replace(/^\//, ""))` ANTES de cualquiera de sus propias ramas de error controladas (`resolveCoverPath` -> Response 400/404), pese a que el comentario del handler dice explícitamente "nunca un throw que tumbe el handler". `decodeURIComponent` lanza `URIError: URI malformed` ante un porcentaje mal formado (`%` suelto, `%FF`, UTF-8 truncado). Escenario real y alcanzable: `AddonScanner` solo valida la extensión `.vpk` del nombre de archivo (no filtra caracteres), y Windows permite `%` en nombres de archivo, así que un `.vpk` de la Workshop con un `%` crudo en el nombre produce una URL de portada como `l4d2cover://local/foo%FFbar` -> `URIError` sin capturar -> la request falla como `net::ERR_FAILED` genérico en vez del 400/404 documentado.

**Pendiente, con commit propio y aislado** (no se toca en los commits de 21.2 - es un bug de una sección distinta y ya cerrada): envolver el `decodeURIComponent` en un try/catch (o mover el parseo DESPUÉS de una validación que no pueda lanzar) para que devuelva la Response 400 controlada en vez de propagar el throw. Referencia: `src/main/main.ts`, línea del `protocol.handle("l4d2cover", ...)`.

### P-20 - previewActiveSet reescanea toda la Workshop_Folder para resolver solo los addons candidatos
Hallazgo de `/code-review ultra` sobre el diff `ui -> main` (2026-09-10). `MergeOrchestrator.previewActiveSet` (y `#runPublic`/`resumePendingOperation`, que comparten el mismo `#resolveOrderedAddons`) llama `AddonScanner.scan(workshopFolder)` completo -que recorre CADA `.vpk` de la Workshop y le extrae `addoninfo.txt` vía `vpk.exe`- solo para resolver el `vpkPath` de los pocos `addonId` que trae `entries`. Para `applyActiveSet` (una acción explícita, disparada una vez por el usuario) el costo ya era aceptable; para `previewActiveSet` -pensado para correr en cada edición de la UI del Active_Set (reordenar, agregar, quitar) según la Sección 21.2- ese mismo costo se vuelve mucho más frecuente: con una Workshop de ~200 addons suscriptos y un Active_Set candidato de 3, cada preview dispara ~200 invocaciones de `vpk.exe` para resolver 3 rutas ya conocidas.

**Decisión: NO optimizar todavía.** Se pospone deliberadamente hasta que exista el componente real de UI de 21.2, porque el patrón de acceso real (¿debounce al reordenar? ¿cache entre ediciones sucesivas del mismo Active_Set candidato? ¿el renderer ya tiene los `ScannedAddon` de un escaneo previo y podría pasarlos en vez de pedir un re-escaneo?) todavía no se conoce - optimizar a ciegas ahora arriesga resolver el problema equivocado. Cuando se construya 21.2, evaluar: pasar los `ScannedAddon` ya escaneados por el renderer en vez de reescanear en el proceso main, o agregar una forma de resolver un subconjunto de ids sin recorrer ni extraer metadata de toda la carpeta.

### P-19 - La UI de 21.2 debe comunicar "unavailable" del preview como bloqueo, no como salteo silencioso
`MergeOrchestrator.previewActiveSet` (nuevo, ver `04-historial-decisiones.md`) excluye BEST-EFFORT del cálculo de colisiones a cualquier addon cuyo `VpkTool.list()` falle (VPK corrupto), y sigue calculando con el resto — mismo criterio que `AddonScanner` usa para metadata. Pero esto es SOLO para no perder la info de los addons sanos DURANTE el preview: `applyActiveSet` real NO tiene ese mismo comportamiento. `MergeEngine.merge()` ABORTA la fusión COMPLETA ante el primer `VpkToolError` (DECISIÓN 4 de `merge-engine.ts`) — un addon con un VPK roto en el Active_Set candidato hace fallar TODO el "Fusionar e instalar", no se saltea solo como sí ocurre en el preview.

**Pendiente para el texto real del componente de 21.2:** el copy de la UI para un addon `unavailable` en el panel de preview NO debe sugerir "este addon se va a omitir automáticamente" (falso: `applyActiveSet` fallaría con ese Active_Set tal cual está). Debe comunicar que hay que SACARLO del Active_Set o ARREGLARLO (VPK corrupto/reinstalar el addon) antes de poder aplicar con éxito. Queda para cuando se escriba el componente real (no antes).

### P-18 - Sin dato de tamaño para el "Resumen de fusión" (Sección 21.2)
El panel "Resumen de fusión" del mockup de referencia (Claude Design, opción 2b de `Addon Manager.dc.html`) muestra un "Tamaño estimado" (p. ej. "438 MB"), pero **no existe ningún dato de tamaño en el dominio hoy**: `ScannedAddon` (`types.ts`) no tiene campo de tamaño, y `VpkTool.list()` (usado para el preview de colisiones, ver `ActiveSetPreview`) solo devuelve paths internos (`string[]`), sin tamaños. Ni siquiera extrayendo (como hace `MergeEngine.merge()`) se obtiene gratis: haría falta `fs.stat` por archivo extraído, o parsear tamaños del propio listado de `vpk l` si el formato los expone (sin confirmar todavía). Queda **fuera del alcance de la Sección 21.2 v1**: el campo se omite directamente del panel (sin placeholder "-"). Pendiente decidir en una sesión futura: de dónde sale el tamaño (suma de tamaño de los `.vpk` de origen como cota superior sin deduplicar, vs. tamaño real post-fusión) y qué componente lo calcula.

### P-17 - Orden tsc→vite del preload sin guard automático
El `"build"` y la pata de Electron de `"dev"` dependen de que `tsc -p tsconfig.json` corra ANTES que `vite build --config vite.preload.config.ts`, a propósito: `tsc` reemite un `dist/src/preload/preload.js` en ESM (porque `src/preload` sigue en el `include` de `tsconfig.json`, deliberado para no perder el typecheck del preload - ver historial del fix de la Sección 20), y el build de Vite lo sobreescribe con el CJS correcto. Ese orden hoy es una convención MANUAL documentada en comentarios, no algo que el propio script/CI haga cumplir. Un reordenamiento futuro del `&&` chain (accidental o por un formateador de `package.json`) reintroduciría en silencio el bug de preload ESM que esta sesión corrigió, y ni `npm run typecheck` ni `npm test` (mockean el dominio, nunca cargan un preload real en un Electron real) lo detectarían. Pendiente decidir un guard real: un chequeo post-build que falle si `dist/src/preload/preload.js` contiene `import`/`export` de nivel superior, o mover el preload fuera del `include` de `tsc` para eliminar la carrera de raíz.

### P-22 - Selección múltiple de addons (bulk select)
La Biblioteca solo permite incluir/excluir addons de a UNO, vía el checkbox "Incluir" de cada `AddonRow`. No hay Shift+clic (rango), Ctrl+clic (selección discontinua) ni un "seleccionar todos"/"limpiar selección" para operar en lote. Es un pedido de UX real (reportado en QA), pero NUNCA estuvo en el alcance de la Tarea 21.1 ni de ningún Requirement (los AC 2.6/3.6-3.8 hablan de mostrar, advertir y permitir/bloquear addons individualmente, no de selección masiva). Se registra como MEJORA FUTURA, no como bug: la funcionalidad de a-uno es correcta y completa para lo especificado.

**No bloquea el resto de la Sección 21.** Si se retoma, evaluar: manejo de rango/multi-selección en `AddonList` (que hoy no mantiene estado de selección compartido - ver la integración desacoplada, opción B), y cómo se traduce un "incluir N addons a la vez" a las llamadas `addAddon` del backend (una por addon vs. una operación de lote nueva en el contrato IPC).

### P-23 - La instancia elevada no cachea el escaneo, vuelve a escanear la Workshop_Folder
Cuando ocurre una elevación UAC (ElevationService, Decisión 1 del ciclo de vida), la instancia sin privilegios se cierra y la elevada arranca de cero. `LocalStore.savePendingSession()`/`getPendingSession()` preserva la SELECCIÓN del usuario (Active_Set candidato + Priority_Order), pero NO los resultados de escaneo (títulos, clasificaciones VScript): la instancia elevada re-ejecuta `scanAddons()`/`classifyVScript()` igual que un arranque normal.

Con ~73 addons esto midió entre 12 y 17 segundos (ver diagnóstico de rendimiento de esta sesión). Es un costo real, pero se paga UNA SOLA VEZ POR SESIÓN (Decisión 2 del ciclo de vida: elevación una vez por sesión; las operaciones siguientes no vuelven a relanzar).

**Decisión consciente - NO cachear por ahora.** Se evaluó cachear los resultados del escaneo para que la instancia elevada los reutilice en vez de re-escanear, y se descartó para esta etapa: requeriría (a) persistir datos nuevos (no solo la selección que ya guarda LocalStore, sino títulos y clasificaciones), (b) decidir una política de invalidación de cache -el usuario pudo suscribirse/desuscribirse de un addon en Steam entre el quit y el relanzo-, y (c) coordinar la lectura en dos componentes independientes (AddonList y ActiveSetPanel) que hoy escanean cada uno por su cuenta. La complejidad no se justifica para un costo de una sola vez por sesión.

Registrado como MEJORA FUTURA, no como bug. No bloquea el checkpoint 22 ni el resto de la Sección 21.
