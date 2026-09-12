# Documento de Requisitos del Bugfix

## Introduction

BUG-007 (Crítica), reportado en QA V3 (jornada 2). Al disparar la elevación UAC, el proceso se reinicia y **se pierde el batch de mods seleccionado**: el usuario tenía una selección de addons (con su Priority_Order) preparada en la UI, aceptó el prompt de administrador y, al reabrirse la app elevada, la selección no quedó restaurada.

Este spec cubre **únicamente la mitad "main"/dominio** del bug: garantizar que el estado necesario para restaurar la selección tras la elevación se persista antes del relanzo `runas` y quede disponible para el renderer al arrancar la instancia elevada. La mitad del lado renderer (consumir ese estado y repintar la UI) la resuelve el equipo de "Code" por separado; este documento debe dejar claro el límite y coordinar con esa mitad sin cerrarla por sí solo.

Decisión ya tomada por el usuario (no se reabre en este spec): **no** agregar un canal IPC `getPendingOperation` nuevo si el flujo existente ya cubre el caso. El fix debe verificar/robustecer lo existente en vez de duplicar. Si hay un hueco real de **datos**, se extiende/renombra lo existente; si el hueco es de **ciclo de vida**, se arregla ahí. La formalización de la bug condition C(X) y la determinación de cuál de los dos sospechosos (carrera de ciclo de vida vs. hueco de captura del estado de selección) es la causa raíz se hará en la fase de diseño; este documento solo describe el comportamiento observado, el esperado y el que debe preservarse.

Alcance de archivos (solo capa main/dominio): `src/main/domain/elevation-service.ts`, `src/main/domain/local-store.ts`, `src/main/domain/merge-orchestrator.ts`, `src/main/app/composition-root.ts`, `src/main/app/ipc-contract.ts`, `src/main/app/ipc-handlers.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/main/data/elevation-os-provider.ts`. No se toca código de renderer.

## Bug Analysis

### Current Behavior (Defect)

Comportamiento actual cuando el usuario tiene un batch de mods seleccionado y una operación de escritura dispara la elevación UAC.

1.1 WHEN el usuario tiene un batch de addons seleccionado (selección + Priority_Order) y una operación de escritura protegida dispara el relanzo elevado `runas` THEN el sistema reinicia la app elevada y la selección del usuario NO queda restaurada en la UI (el batch se percibe como perdido).

1.2 WHEN la instancia elevada arranca tras aceptar el UAC THEN el renderer consulta el estado de resume al montar y puede no obtener el batch a restaurar, ya sea porque el estado todavía no está disponible cuando lo consulta (ventana de carrera de ciclo de vida) o porque el batch seleccionado nunca llegó a persistirse antes del relanzo (hueco de captura del estado de selección).

1.3 WHEN la selección del usuario existe solo como estado de la UI y aún no se materializó en una operación (`applyActiveSet`/`addAddon`/`removeAddon`) THEN el sistema no persiste esa selección antes del relanzo elevado y, tras el reinicio, no hay batch que restaurar.

### Expected Behavior (Correct)

Comportamiento correcto para las mismas condiciones que disparan el bug. El fix debe cerrar el hueco real que se identifique en la fase de diseño (de datos o de ciclo de vida), sin duplicar canales existentes.

2.1 WHEN el usuario tiene un batch de addons seleccionado y una operación de escritura protegida dispara el relanzo elevado `runas` THEN el sistema SHALL persistir el batch (selección + Priority_Order) antes del relanzo y, tras el reinicio elevado, dejar ese batch disponible para que el renderer restaure la selección en la UI.

2.2 WHEN la instancia elevada arranca tras aceptar el UAC THEN el sistema SHALL garantizar que el estado necesario para restaurar la selección esté disponible para el renderer cuando este lo consulte al montar, sin depender de un orden de arranque que pueda producir una ventana de carrera.

2.3 WHEN la selección del usuario aún no se materializó en una operación al momento de disparar la elevación THEN el sistema SHALL asegurar que el batch que el usuario ve como seleccionado sea exactamente el que se persiste y se restaura tras la elevación (que el dato capturado corresponda al batch reportado por el usuario).

### Unchanged Behavior (Regression Prevention)

Comportamiento existente que el fix NO debe romper.

3.1 WHEN se dispara una operación de escritura protegida y la instancia ya está elevada THEN el sistema SHALL CONTINUAR pidiendo elevación UNA SOLA VEZ POR SESIÓN, sin relanzar `runas` ni mostrar UAC de nuevo.

3.2 WHEN la instancia elevada resume una sesión pendiente THEN el sistema SHALL CONTINUAR materializando el resume de forma idempotente y limpiando el estado con `clearPendingSession()` en el `finally`, en cualquier desenlace (éxito o fallo).

3.3 WHEN se consulta la sesión pendiente vía `getPendingSession()` THEN el sistema SHALL CONTINUAR distinguiendo `null` (no hay sesión) de `[]` (sesión activa con Active_Set candidato intencionalmente vacío), vía el flag de estado explícito y no por la cantidad de filas.

3.4 WHEN una operación se ejecuta sin necesidad de elevación (instancia ya escribible o `gameRoot` no protegido) THEN el sistema SHALL CONTINUAR completando el flujo normal sin relanzar la app ni persistir/restaurar sesión pendiente por ese camino.

3.5 WHEN el usuario cancela el prompt de UAC THEN el sistema SHALL CONTINUAR devolviendo el desenlace `denied` y permitiendo que el estado de sesión pendiente se limpie, sin dejar una sesión pendiente huérfana.

3.6 WHEN la instancia elevada termina el resume (éxito o fallo) THEN el sistema SHALL CONTINUAR exponiendo el resultado terminal por los canales IPC existentes (`getResumeState()` / `isResuming()`) que el renderer ya consume (P-25), sin introducir un canal duplicado.
