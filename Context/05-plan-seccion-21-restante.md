# Plan de desarrollo — resto de la Sección 21 (21.2 UI, 21.3, 21.4, checkpoint 22)

Fecha: 2026-09-10. Aprobado con decisiones cerradas indicadas abajo. Escrito para arrancar la próxima sesión sin releer todo el historial — si algo acá no cuadra con el código real al momento de retomar, verificar contra el código (puede haber cambiado, sobre todo 21.1 si Kiro lo siguió tocando).

## Contexto de arranque

- **21.1** (Bloque 1: portadas `l4d2cover://`; Bloque 2: `AddonList`/`AddonRow`/`AddonCover`) commiteado en `ui`. **Kiro lo sigue tocando en paralelo** — condiciona el punto 2 de abajo.
- **21.2 backend** (dominio + IPC: `previewActiveSet`, `MergeOrchestrator.preview`, canal `activeSet:preview`) ya hecho y pusheado (commits `35611ad`/`7d4251d`/`d2866c9` en `ui`). Falta **solo la UI**.
- `global.css`/los `*.module.css` de 21.1 hoy tienen **cero tokens de diseño** — colores hex sueltos, sin variables CSS.
- No hay librería de routing ni de testing de componentes en `package.json` (ni `react-router`, ni `@testing-library/react`, ni `jsdom`).
- El checkbox "Incluir" de `AddonRow.tsx` (21.1) es HOY estado efímero de React puro (`useState` local) — el propio comentario del código dice que conectarlo al Active_Set real es trabajo de 21.2.

---

## 1. Tokens de diseño compartidos

**Qué:** extraer de `nocturne.css` (mockup de Claude Design) un subconjunto MÍNIMO de variables CSS — **decisión cerrada: subconjunto mínimo, no la escala completa de Nocturne** — paleta (bg/surface/text/accent/divider/pocos neutros), espaciado (4-5 pasos), radios (sm/md/lg), tipografía (familia Inter + pesos). TSX + CSS nativo, sin Tailwind ni librería de componentes.

**Archivos:** `src/renderer/global.css` (bloque `:root { --... }`). Migrar los `*.module.css` existentes de 21.1 (`AddonRow`, `AddonList`, `AddonCover`, `App`) a `var(--...)` es un paso aparte.

**Secuencia — decisión cerrada:**
- **1a (ya, sin esperar nada):** agregar el bloque de tokens a `global.css`. Puramente aditivo, cero riesgo de choque con el trabajo paralelo de Kiro.
- **1b (después de que Kiro termine su parte de 21.1):** migrar los módulos CSS existentes de 21.1 a usar los tokens. Se pospone a propósito para no pisar su trabajo.

**Tamaño:** 1a CHICO. 1b MEDIANO (toca 4 archivos ya escritos).

---

## 2. UI de 21.2 (panel "Activos" + Priority_Order)

**Qué cubre el mockup 2b:** filas compactas `n / título / tag de colisión ("gana N archivos"/"pierde N archivos") / botón ↑ / botón ↓`, disabled en los extremos. El panel lateral "Resumen de fusión" (addons en la cadena, archivos a empaquetar, colisiones, bloqueados por VScript, botones Aplicar/Descartar) viene del mockup 1b, independiente de la variante de reordenamiento elegida.

**Decisiones ya cerradas:**
- **Navegación:** shell mínimo con **toggle de estado local** (sin router) entre "Biblioteca" y "Activos". Nada de "Backups"/"Ajustes" (fuera del MVP, sin tarea en `tasks.md`).
- **Alcance del botón "Fusionar e instalar":** solo llama a `applyActiveSet` y muestra un **resultado mínimo**. El progreso paso a paso detallado (mockup "1c") queda para 21.4 — no se duplica ese trabajo acá.
- **Debounce en `previewActiveSet`:** las llamadas disparadas desde las flechas de reordenamiento (y agregar/quitar) llevan **debounce de 300-400ms**, como mitigación mientras el pendiente P-20 (`previewActiveSet` reescanea toda la Workshop_Folder) sigue sin resolver. Esto no arregla P-20, solo evita spamear el preview en cada click individual mientras el usuario reordena rápido.
- Copy real de "unavailable" (P-19) y omisión de "Tamaño estimado" (P-18): ya decididos en sesiones previas, solo falta escribir el texto al construir el componente.

**Decisión SIGUE ABIERTA — único bloqueante real para arrancar el sub-paso 5:**

**Integración de estado con 21.1.** El checkbox "Incluir" de `AddonRow.tsx` no llama a `addAddon`/`removeAddon` hoy, es puro `useState` local. Hace falta decidir, **coordinando con Kiro sobre cómo terminó estructurando `AddonList`/`AddonRow`**, entre:
- **(a) Estado levantado a un padre común** (`App.tsx` o un contenedor nuevo) que tanto la lista de 21.1 como el panel de 21.2 lean/muten, convirtiendo `AddonRow` en componente controlado. **Preferencia si la estructura de Kiro lo permite sin fricción.**
- **(b) Desacoplado con refetch:** el checkbox de 21.1 dispara `addAddon`/`removeAddon` directo al toque (sin estado compartido) y el panel de 21.2 vuelve a pedir `getActiveSet()` cada vez que se muestra.

No se puede elegir en el aire — depende de código que Kiro puede seguir cambiando. Esto es lo primero a resolver (hablando con Kiro / revisando el estado real de 21.1) antes de tocar el sub-paso 5.

**Componentes a crear:** un contenedor (`ActiveSetPanel`), `PriorityRow` (fila con flechas), `MergeSummaryPanel` (el aside), cada uno con su CSS Module usando los tokens del punto 1.

**Archivos:** nuevos en `src/renderer/components/`; modificación de `App.tsx` (shell de nav con toggle local); modificación de `AddonRow.tsx`/`AddonList.tsx` SOLO si se elige la opción (a) de integración de estado.

**Tamaño: GRANDE.** Sub-pasos:
1. `ActiveSetPanel` + `PriorityRow`: cargar Active_Set, reordenar localmente con las flechas (sin preview ni apply todavía). El más chico y aislado.
2. `MergeSummaryPanel` conectado a `previewActiveSet` (con el debounce de 300-400ms ya decidido).
3. Cablear "Aplicar"/"Descartar" a `applyActiveSet` (resultado mínimo, ya decidido).
4. Shell de navegación (toggle Biblioteca/Activos).
5. Integración real con 21.1 — **bloqueado hasta resolver la decisión abierta de arriba**; probablemente el sub-paso de mayor riesgo de choque con el trabajo paralelo de Kiro.

---

## 3. 21.3 — Avisos de confianza/seguridad + selección manual de rutas

**Decisión cerrada — needs-manual: opción (a).** `PathDetector.detect()` ya dispara diálogos nativos de Windows (`dialog.showOpenDialog` vía `ManualPathProvider`) automáticamente por cada ruta faltante, dentro del propio `detect()` (Sección 5, ya implementado). `PathDetectionResult.kind === "needs-manual"` es un estado terminal (el diálogo nativo ya se ofreció y el usuario canceló o seguía faltando algo).

21.3 implementa un botón **"Reintentar detección"** que vuelve a llamar `detectPaths()`, reutilizando los diálogos nativos ya existentes. **Cero cambios en `path-detector.ts` ni en el dominio de detección** (se descartó la opción de un selector personalizado in-app con canal IPC nuevo).

**Agregado a la decisión — guard contra doble-click:** sumar un guard simple, mismo espíritu que `operationInFlight` de `ipc-handlers.ts` (aunque sea la versión mínima), para que un doble-click en "Reintentar" no dispare una segunda llamada a `detectPaths()` mientras un diálogo nativo de la primera sigue abierto. Puede vivir en el propio componente de React (deshabilitar el botón mientras la promesa está en curso) sin necesariamente tocar `ipc-handlers.ts` — evaluar al codificar cuál es más simple.

El resto de 21.3 (avisos `sv_pure`, UAC/Program Files, disclaimer fan-made, SmartScreen, reversión por Steam) es contenido estático — texto/banners fijos, sin lógica de dominio nueva.

**Archivos:** componente nuevo (`TrustNotices.tsx` o banners inline según corresponda cada aviso); el botón "Reintentar detección" probablemente vive en `AddonList.tsx` (donde ya se maneja el estado `needs-manual`) o en un componente dedicado que lo reemplace.

**Tamaño:** CHICO en su totalidad — la ambigüedad de scope que existía (selección manual custom) se cerró a favor de la opción trivial.

---

## 4. 21.4 (cableado final) + Tarea 22 (checkpoint)

**Qué implica 21.4:** como 21.1 y 21.2 ya llaman directo a sus propios métodos IPC al construirse, lo que queda es lo TRANSVERSAL que ningún componente individual cubre:
1. **Overlay de progreso — decisión cerrada: modal bloqueante** (pantalla completa, como el mockup "1c"), no toast/barra no bloqueante. Se suscribe a `window.l4d2Api.onProgress` y traduce cada `MergeProgressEvent.step` a la vista de pasos.
2. Manejo de `getResumeState()` al arrancar: si hay una sesión de resume pendiente (relanzo elevado en curso), repoblar el overlay con los eventos bufferizados en vez de arrancar como si nada.
3. Traducir el `OperationResult` final a feedback visible — el caso `"elevating"` es informativo nada más (la ventana se va a cerrar sola en breve).

**Archivos:** componente nuevo (`ProgressOverlay.tsx` o similar) + wiring en `App.tsx` a nivel raíz.

**Tamaño:** MEDIANO, un componente cohesivo — no necesita partirse en sub-pasos.

**Checkpoint 22 — decisión cerrada sobre testing:** se difiere sumar Testing Library/`jsdom`. `npm test` + `npm run typecheck` en verde confirman que el dominio/IPC sigue sano, pero la Sección 21 UI queda sin cobertura automatizada por ahora. Cerrar el checkpoint requiere una pasada manual/exploratoria real de la app completa (detectar → escanear → clasificar → armar Active_Set → preview → aplicar → progreso → resultado), probablemente con el skill `/run`. Se revisita la necesidad de Testing Library recién si esa pasada manual encuentra bugs de UI recurrentes que un test automatizado hubiera atajado antes.

---

## Orden recomendado para la próxima sesión

1. Resolver la ÚNICA decisión que sigue abierta: integración de estado 21.1↔21.2 (coordinar con Kiro sobre la estructura real de `AddonList`/`AddonRow` en ese momento).
2. Paso 1a (tokens aditivos en `global.css`) — sin esperar nada, se puede hacer en paralelo a lo anterior.
3. 21.2 sub-pasos 1-4 (todo lo que no depende de la integración con 21.1); sub-paso 5 recién cuando la decisión del punto 1 esté cerrada.
4. 1b (migrar módulos de 21.1 a tokens) — cuando Kiro termine su parte.
5. 21.3 (needs-manual con guard + avisos estáticos, ambos ya sin ambigüedad de scope).
6. 21.4 (overlay modal de progreso + resume).
7. Checkpoint 22 (tests + pasada manual con `/run`).
