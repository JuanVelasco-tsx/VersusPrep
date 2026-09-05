# Decisiones Técnicas

## Ya decidido

### Stack principal
- **Framework de escritorio:** Electron
  - *Por qué:* el desarrollador tiene experiencia en Angular/React + TypeScript, y Electron reutiliza ese conocimiento directamente. Es también el stack de *funky* (competencia principal), lo que valida su viabilidad para este dominio.
- **Frontend:** React o Angular + TypeScript (por definir cuál de los dos, ambos conocidos por el dev)
- **Plataformas objetivo:** Windows (primaria), Linux y Steam Deck (secundarias, casi gratis con Electron)
- **Alternativa descartada:** Tauri (backend Rust + frontend web) - más liviano, pero introduce curva de aprendizaje en Rust que no vale la pena para un side project. Puede reconsiderarse si el tamaño del instalador o el consumo de RAM se vuelven un problema real.

### Manejo de VPKs - VALIDADO
- **Herramienta:** `vpk.exe` del `bin/` de L4D2 (Authoring Tools), wrappeado vía child_process.
- **Estrategia de habilitación (Opción B):** desempaquetar los VPKs seleccionados, fusionar su contenido en una carpeta `pak01_dir/`, reempaquetar en un único `pak01_dir.vpk`, y colocarlo en la carpeta `modsvs/` de la raíz del juego. `gameinfo.txt` referencia `modsvs` como primer SearchPath, de modo que el engine lo carga como contenido base.
  - *Por qué Opción B y no renombrado (A) o multi-archivo (C):* es el método que el usuario ya validaba manualmente y que se confirmó end-to-end. Da control total sobre el contenido fusionado y es reversible vía backup.
- **Validado end-to-end (2026-09):** ciclo extraer -> fusionar -> empaquetar -> cargar en Versus, con addons reales, sin roturas visuales.
- **Requisitos de implementación confirmados:**
  - `vpk x` NO crea subdirectorios: la app debe crearlos antes de extraer.
  - `vpk x` **debe llamarse por lotes** (~20 archivos por invocación). Pasar cientos de argumentos de una vez falla (exit -1, extrae 0). Confirmado con el addon de 232 archivos.
  - Filtrar del stdout las líneas `CDynamicFunction:`, `FS:`, `Using` (ruido de debug).
  - Paths internos usan `/`; en disco se crean con `\`.
- **Detección de VScript:** leer el listado de `vpk l` y buscar `scripts/vscripts/*.nut`. NO usar el flag `addonContent_Script` del addoninfo.txt (puede estar en 0 aunque haya scripts).
- **Resolución de colisiones - VALIDADA:** cuando dos addons comparten un path, gana **el último de la lista** (orden de prioridad del usuario). Confirmado por hash SHA256 y visualmente en el juego con 2 addons de brazos que compartían 24 archivos.

### Detección de rutas de Steam / L4D2 - CONFIRMADO
- Registro: `HKCU\Software\Valve\Steam` -> `SteamPath`.
- `libraryfolders.vdf` -> biblioteca cuyo bloque `apps` contiene la clave `550`.
- Rutas derivadas: raíz del juego, `left4dead2\`, `addons\workshop\`, `bin\vpk.exe`, `gameinfo.txt`, `modsvs\`.
- Escaneo: solo archivos `*.vpk` en workshop; ignorar subdirectorios residuales.

### Persistencia y modelo de datos - DECIDIDO (motor por elegir)
- **Opción (a):** base de datos local con **manifiesto por addon** (registro de qué paths aportó cada addon al paquete fusionado). Necesario para agregar/quitar addons en caliente sin rehacer toda la fusión.
- Motor concreto (SQLite / Dexie / JSON) aún por elegir - ver `02-pendientes.md` P-06.

### Funcionalidades confirmadas (scope definido)
1. Detección automática de addons desde la carpeta de Workshop de Steam
2. Lista de addons con previsualización al hover (portada + descripción)
3. Selección por checkboxes con botón "Desmarcar todos"
4. Filtro anti-VScript (bloquea addons incompatibles con Versus)
5. Resolución automática de dependencias entre addons
6. Proceso de habilitación en background con confirmación previa y notificación de resultado
7. Sección "Activos": quitar o agregar addons en caliente sin rehacer todo el proceso
8. Categorías, favoritos (estrella), ordenamiento por fecha, buscador por nombre/ID
9. Sistema de presets/perfiles (guardar y cargar combinaciones de addons)
10. Tweak opcional: eliminar filtro visual de visión de infectado (modo espectador)
11. Botón "Jugar" para lanzar L4D2 directamente desde la app
12. Backups automáticos antes de modificar archivos del juego
13. Aviso sobre `sv_pure` en servidores comunitarios estrictos

### Precondición de seguridad confirmada
- Antes de fusionar/instalar, verificar que el proceso **`left4dead2.exe`** NO esté corriendo (no `hl2.exe`, que era un error del plan inicial).

### Distribución
- Ejecutable `.exe` sin firma digital -> advertencia de SmartScreen esperada y documentada (igual que *funky*)
- Disclaimer de proyecto fan-made, no afiliado a Valve, en README y en la propia app
- Nombre propio distinto de "funky" para posicionamiento en búsquedas

---

## Pendiente de decidir

### Frontend: React vs Angular
Ambos válidos. Pendiente de decisión final del desarrollador.

### Motor de persistencia concreto
Opción (a) decidida, pero falta elegir SQLite vs Dexie vs JSON.

### Cache de miniaturas
Las portadas ya están en disco como `<id>.jpg`. Falta diseñar el redimensionado/cache para rendimiento en GPU integrada.

### Flujo de suscripción nueva
Un addon recién suscrito solo se descarga al arrancar el juego. Mejorar o documentar como limitación.

### Detección de actualizaciones de addons ya fusionados
Si un addon activo se actualiza en Workshop, detectarlo y re-fusionar?

### Permisos de administrador
Escribir en `Program Files` puede requerir elevación - distinto del SmartScreen.
