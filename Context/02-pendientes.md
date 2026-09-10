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

**Decisión tomada (2026-09):** opción **(a)** - base de datos local con manifiesto por addon, para permitir operaciones incrementales. Motor concreto (SQLite vía better-sqlite3, Dexie, o JSON) aún por elegir.

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

### P-17 - Orden tsc→vite del preload sin guard automático
El `"build"` y la pata de Electron de `"dev"` dependen de que `tsc -p tsconfig.json` corra ANTES que `vite build --config vite.preload.config.ts`, a propósito: `tsc` reemite un `dist/src/preload/preload.js` en ESM (porque `src/preload` sigue en el `include` de `tsconfig.json`, deliberado para no perder el typecheck del preload - ver historial del fix de la Sección 20), y el build de Vite lo sobreescribe con el CJS correcto. Ese orden hoy es una convención MANUAL documentada en comentarios, no algo que el propio script/CI haga cumplir. Un reordenamiento futuro del `&&` chain (accidental o por un formateador de `package.json`) reintroduciría en silencio el bug de preload ESM que esta sesión corrigió, y ni `npm run typecheck` ni `npm test` (mockean el dominio, nunca cargan un preload real en un Electron real) lo detectarían. Pendiente decidir un guard real: un chequeo post-build que falle si `dist/src/preload/preload.js` contiene `import`/`export` de nivel superior, o mover el preload fuera del `include` de `tsc` para eliminar la carrera de raíz.
