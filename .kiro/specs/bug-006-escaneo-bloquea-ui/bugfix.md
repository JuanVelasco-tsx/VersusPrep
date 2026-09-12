# Documento de Requisitos del Bugfix

## Introduction

BUG-006 (Media), reportado en QA. Al abrir la aplicación, el escaneo inicial de la Workshop **bloquea la UI durante ~45 segundos** en la pantalla de carga inicial ("Detectando rutas del juego..."), dejando la aplicación aparentemente congelada (freeze) hasta que el escaneo termina por completo.

**Causa raíz confirmada (medida y trazada end-to-end, no hipótesis).**

- **Causa dominante (costo real): escaneo estrictamente SERIAL.** `AddonScanner.scan` en `src/main/domain/addon-scanner.ts` (método `scan`, ~línea 189) recorre TODOS los `.vpk` de la Workshop en un bucle `for...await` estrictamente serial. Por cada addon lanza 1 o 2 procesos `vpk.exe`: `vpkTool.list(vpkPath)` (siempre) y `vpkTool.extract(...)` del `addoninfo.txt` (si existe). Cada addon espera a que termine el anterior. Con ~200 addons son ~200-400 procesos `vpk.exe` ejecutados en serie. La escala está MEDIDA y documentada en `Context/02-pendientes.md`: 12-17s con 73 addons → ~45s con una Workshop grande (escala lineal con N).
- **Causa del "freeze" percibido: ausencia de feedback.** El renderer (`AddonList.tsx`, ~línea 171) hace un único `Promise.all([scanAddons(), getActiveSet()])` que no resuelve hasta que TODO el escaneo terminó; el handler IPC (`ipc-handlers.ts`, ~línea 190) es un único `await` sin progreso ni resultados parciales. No hay streaming, por lo que la UI no muestra avance intermedio.
- **DESCARTADO: I/O síncrono bloqueante.** Todo el camino usa `node:fs/promises` y `execFile` async; NO hay `readFileSync` / `execSync` / `spawnSync` en la ruta. El hilo de render de Electron NO está técnicamente bloqueado. El problema es la **latencia total** del escaneo serial sumada a la **ausencia de feedback**, no un bloqueo del event loop.
- **Dato clave: la solución YA EXISTE en el código.** La fase POSTERIOR de clasificación VScript ya está paralelizada con `classifyWithBoundedConcurrency` (en `ipc-handlers.ts`, ~línea 83), que usa el pool `DEFAULT_VPK_CONCURRENCY = 4` (definido en `src/main/domain/vpk-tool.ts`) y preserva el orden posicional escribiendo por índice (`results[index]`). El escaneo inicial NO usa ningún pool. Esa **asimetría** (una fase paralelizada, la otra serial) es el núcleo del bug.

**Alcance del fix (YA DECIDIDO por el usuario): "Solo paralelizar el escaneo (concurrencia acotada)".**

- Aplicar concurrencia acotada al bucle de `AddonScanner.scan`, reutilizando el patrón ya existente (`classifyWithBoundedConcurrency` / `DEFAULT_VPK_CONCURRENCY`).
- El RESULTADO debe ser IDÉNTICO al actual: misma lista de addons, MISMO ORDEN (el orden de entrada del listado del directorio), misma metadata (`info` / `coverPath`), mismo manejo best-effort del `addoninfo` (fallo → `info: null`, sin abortar ni omitir addons).
- Baja el tiempo aproximadamente por el factor de concurrencia (~4x: de ~45s a ~11s).
- **NO tocar el renderer** (es zona del equipo "Code"). **NO agregar canal de progreso IPC** en este fix (queda explícitamente fuera de alcance).
- **NO usar `worker_threads`:** el cuello de botella no es CPU en el hilo main, sino la espera de procesos hijo `vpk.exe`. La concurrencia acotada de promesas es suficiente y coherente con el código existente.

La formalización de la bug condition C(X) y el detalle de implementación (dónde y cómo introducir el pool) se desarrollan en la fase de diseño. Este documento solo describe el comportamiento observado, el esperado y el que debe preservarse.

> **Aclaración sobre el texto de la pantalla reportado por QA (verificado contra `src/renderer/components/AddonList.tsx`).** El reporte de QA indica que el freeze ocurre en la pantalla "Detectando rutas del juego...", pero la lectura del JSX del renderer confirma que cada fase renderiza un texto DISTINTO y correcto:
> - Fase `detecting-paths` (`AddonList.tsx`, ~línea 388): muestra "Detectando rutas del juego..." (o "Restaurando tu selección..." si `resuming`). Es una fase LIVIANA (registro + una lectura de VDF + unos `fs.access`) y NO explica los ~45s.
> - Fase `scanning-addons` (`AddonList.tsx`, ~línea 414): muestra "Escaneando addons..." (o "Restaurando tu selección..." si `resuming`). Es aquí donde ocurre el escaneo serial costoso: la causa raíz real del freeze.
>
> Conclusión: el desajuste entre el texto reportado por QA y la fase real es un ERROR DE TRANSCRIPCIÓN/PERCEPCIÓN de QA (vio el freeze durante la carga inicial y anotó el texto de la primera pantalla de carga). NO es un bug de label desactualizado: el label de `scanning-addons` SÍ se actualiza correctamente a "Escaneando addons...". Ambas fases usan el mismo componente `LoadingIndicator` y son pantallas de carga consecutivas visualmente similares, lo que explica la confusión.
>
> Por lo tanto NO hay un hallazgo de UI adicional que corregir. La causa del freeze es exclusivamente el escaneo serial de la fase `scanning-addons`. Se deja esta aclaración para que quien lea el spec no busque la causa en la fase equivocada guiándose por el texto literal de QA.

### Formalización de la Bug Condition (metodología bug condition)

Este bug NO es de corrección de datos, sino de **RENDIMIENTO / latencia**. La formalización se hace sobre el comportamiento observable de tiempo y sobre la equivalencia del resultado.

Sea `F` el escaneo actual (`AddonScanner.scan` serial, concurrencia efectiva = 1) y `F'` el escaneo tras aplicar concurrencia acotada (pool de tamaño `DEFAULT_VPK_CONCURRENCY`).

**Bug Condition C(X)** — identifica las entradas que exhiben el defecto de rendimiento:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X = conjunto de N addons (.vpk de nivel superior) en la Workshop_Folder
  OUTPUT: boolean

  // El escaneo SERIAL ejecuta las invocaciones vpk.exe (list + extract) con
  // concurrencia efectiva = 1: cada addon espera al anterior. El tiempo total
  // crece linealmente con N porque nunca se solapan las esperas de procesos hijo.
  RETURN concurrenciaEfectiva(F, X) = 1
         AND tiempoTotal(F, X) ≈ N * tiempoPromedioPorAddon
         AND N es suficientemente grande como para producir latencia perceptible
             (Workshop grande: ~200 addons ⇒ ~45s medidos)
END FUNCTION
```

**Contraejemplo concreto medido:** una Workshop con ~200 addons ⇒ el escaneo serial tarda ~45s (extrapolado linealmente desde 12-17s con 73 addons, según `Context/02-pendientes.md`), durante los cuales la UI permanece en "Detectando rutas del juego..." sin feedback.

**Property (Fix Checking)** — comportamiento correcto para las entradas de C(X):

```pascal
// El escaneo corregido usa concurrencia acotada y produce el MISMO resultado.
FOR ALL X WHERE isBugCondition(X) DO
  resultado ← F'(X)   // AddonScanner.scan con pool DEFAULT_VPK_CONCURRENCY

  // (1) La concurrencia efectiva es > 1 y está acotada por el pool.
  ASSERT 1 < concurrenciaEfectiva(F', X) ≤ DEFAULT_VPK_CONCURRENCY

  // (2) El tiempo total baja aproximadamente por el factor de concurrencia.
  ASSERT tiempoTotal(F', X) ≈ tiempoTotal(F, X) / DEFAULT_VPK_CONCURRENCY

  // (3) CRUCIAL: el resultado (lista de ScannedAddon) es EXACTAMENTE el mismo
  // que el del escaneo serial: mismo orden, misma metadata.
  ASSERT resultado = F(X)   // igualdad de lista Y de orden Y de metadata (info, coverPath)
END FOR
```

**Preservation (Preservation Checking)** — todas las garantías de correctitud de `AddonScanner.scan` se mantienen intactas:

```pascal
// El fix SOLO cambia CÓMO se recorren los addons (serial -> pool acotado);
// NO cambia QUÉ se produce. Para toda entrada, el contrato de correctitud vale.
FOR ALL X DO
  ASSERT F'(X) = F(X)   // resultado idéntico: misma lista, MISMO ORDEN, misma metadata
  // Se preservan, en particular:
  //  - solo .vpk de nivel superior (subdirectorios y otras extensiones ignorados)
  //  - id derivado del nombre del archivo
  //  - coverPath = <id>.jpg si existe, null si no
  //  - addoninfo best-effort: cualquier fallo (list/extract exit != 0, FS, parseo)
  //    degrada a info: null SIN abortar el escaneo ni omitir el addon
  //  - el ORDEN de la lista resultante es EXACTAMENTE el orden de las entradas
  //    del listado del directorio (preservar índice, como classifyWithBoundedConcurrency
  //    con results[index]); no se pierden, duplican ni reordenan addons
END FOR
```

## Bug Analysis

### Current Behavior (Defect)

Comportamiento actual del escaneo inicial con `AddonScanner.scan` serial.

1.1 WHEN la Workshop contiene N addons `.vpk` de nivel superior THEN el sistema (`AddonScanner.scan`) los procesa uno por uno en un bucle `for...await` estrictamente serial, con concurrencia efectiva igual a 1: cada addon espera a que terminen las invocaciones `vpk.exe` (`list` y, si aplica, `extract`) del addon anterior.

1.2 WHEN aumenta el número de addons N THEN el sistema tarda un tiempo total que crece linealmente con N (≈ N × tiempo por addon): 12-17s con 73 addons, ~45s con una Workshop grande (~200 addons), según lo medido en `Context/02-pendientes.md`.

1.3 WHEN el escaneo inicial está en curso THEN el sistema no entrega resultados parciales ni progreso (el handler IPC es un único `await` y el renderer espera un único `Promise.all`), por lo que la UI permanece en "Detectando rutas del juego..." sin feedback y se percibe como un freeze de ~45s hasta que el escaneo termina por completo.

### Expected Behavior (Correct)

Comportamiento correcto para las mismas condiciones que disparan el bug.

2.1 WHEN la Workshop contiene N addons `.vpk` de nivel superior THEN el sistema (`AddonScanner.scan`) SHALL procesarlos con concurrencia ACOTADA, usando un pool de tamaño `DEFAULT_VPK_CONCURRENCY` (patrón ya existente en `classifyWithBoundedConcurrency`), de forma que varias invocaciones `vpk.exe` se solapen sin superar el límite del pool.

2.2 WHEN aumenta el número de addons N THEN el sistema SHALL reducir el tiempo total aproximadamente por el factor de concurrencia respecto del escaneo serial (~4x con `DEFAULT_VPK_CONCURRENCY = 4`: de ~45s a ~11s).

2.3 WHEN el escaneo corregido finaliza THEN el sistema SHALL devolver una lista de `ScannedAddon` EXACTAMENTE igual a la del escaneo serial: misma cantidad de addons, MISMO ORDEN (el del listado del directorio), y misma metadata (`info` y `coverPath`) para cada addon.

### Unchanged Behavior (Regression Prevention)

Comportamiento existente que el fix NO debe romper. El fix SOLO cambia cómo se recorren los addons (serial → pool acotado); no cambia qué se produce ni las garantías de correctitud de `AddonScanner.scan`.

3.1 WHEN se escanea la Workshop_Folder THEN el sistema SHALL CONTINUAR incluyendo ÚNICAMENTE los archivos `.vpk` ubicados directamente en el nivel superior de la carpeta, ignorando subdirectorios y archivos con otras extensiones.

3.2 WHEN se detecta un archivo `<id>.vpk` THEN el sistema SHALL CONTINUAR derivando el `id` del addon a partir del nombre del archivo (nombre sin la extensión `.vpk`).

3.3 WHEN se resuelve el cover de un addon THEN el sistema SHALL CONTINUAR asignando `coverPath = <id>.jpg` de la misma carpeta si el archivo existe, y `null` si no existe.

3.4 WHEN la lectura del `addoninfo.txt` de un addon falla por cualquier motivo (addoninfo ausente del listado, `vpk list` / `vpk extract` con exit ≠ 0, error de FS, texto malformado) THEN el sistema SHALL CONTINUAR degradando a `info: null` para ese addon SIN abortar el escaneo completo ni omitir el addon de la lista (comportamiento best-effort por-addon, AC 2.5).

3.5 WHEN el escaneo produce la lista resultante THEN el sistema SHALL CONTINUAR preservando EXACTAMENTE el orden de las entradas del listado del directorio: el resultado paralelizado debe escribir cada addon en su posición original (preservar índice, como `classifyWithBoundedConcurrency` con `results[index]`), de modo que el orden sea idéntico al del escaneo serial.

3.6 WHEN el escaneo finaliza THEN el sistema SHALL CONTINUAR sin perder, duplicar ni reordenar addons: cada `.vpk` de nivel superior aparece exactamente una vez en el resultado.

3.7 WHEN se paraleliza el escaneo THEN el sistema SHALL CONTINUAR usando la constante compartida `DEFAULT_VPK_CONCURRENCY` (definida en `src/main/domain/vpk-tool.ts`) como tamaño del pool, sin introducir un límite de concurrencia nuevo ni desincronizado respecto de los pools ya existentes (`classifyWithBoundedConcurrency`, `MergeEngine.preview`).
