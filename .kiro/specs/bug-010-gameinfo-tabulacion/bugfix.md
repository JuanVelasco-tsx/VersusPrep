# Documento de Requisitos del Bugfix

## Introduction

BUG-010 (Alta), reportado en QA V3 (jornada 2). Al garantizar que `Game modsvs` sea la primera y única entrada del bloque `SearchPaths` del `gameinfo.txt`, el Manager inserta/mueve esa línea usando un **separador clave-valor incorrecto**: mete un **espacio simple** entre la clave `Game` y el valor `modsvs` (`Game modsvs`), mientras que las demás entradas del bloque usan **tabulación** (`Game\t\tmodsvs`, o los tabs que alinean la columna en ese archivo). El motor Source es sensible al formato del bloque `SearchPaths`, por lo que un separador distinto del que usa el resto del archivo es un defecto de prioridad alta.

Este spec cubre **únicamente la capa main/dominio** del bug; es autocontenido y no depende del renderer ("Code"). Alcance de archivos: `src/main/domain/game-info-editor.ts` (funciones `canonicalModsvsSegment`, `referenceIndentEol` y el núcleo puro `ensureModsvsFirstInContent`; posiblemente helpers nuevos para extraer el separador clave-valor de una línea `Game`), y `src/main/domain/types.ts` solo si el diseño lo requiere (no se espera). No se toca código de renderer.

La causa raíz ya está confirmada por investigación estática sobre `game-info-editor.ts`:

- `canonicalModsvsSegment(indent, eol)` construye la línea como `${indent}${"Game"} ${MODSVS_FOLDER}`, es decir, hardcodea un **espacio simple** entre `Game` y `modsvs`.
- `referenceIndentEol(segments, block)` **ya** detecta y replica la **indentación líder** (whitespace antes de `Game`) y el **EOL** de una línea `Game` existente del bloque (o defaults si no hay ninguna), pero **NO** detecta ni replica el **separador interno** entre la clave `Game` y su valor: ese separador queda hardcodeado como un espacio simple en `canonicalModsvsSegment`.
- Es coherente con la filosofía ya establecida del componente (DECISIÓN 2: transformación por líneas con preservación carácter por carácter; DECISIÓN 3: la línea insertada/movida replica indentación y EOL de las demás líneas `Game`): además de indentación + EOL, la línea debe replicar el **separador clave-valor** de las otras entradas `Game`.

Decisión ya tomada por el usuario (no se reabre): el fix debe **derivar** el separador entre `Game` y su valor de las **otras entradas `Game <x>` existentes** del bloque `SearchPaths` (replicar su mismo separador de tabs/espacios), **no** usar un tab canónico fijo. Así respeta el formato real del archivo del usuario sea cual sea. Si **no** hay ninguna otra línea `Game` en el bloque de la cual derivar (bloque sin entradas `Game` previas), se usa un default razonable (probablemente un tab, o el default de indentación existente); el default exacto se decide en la fase de diseño, pero el **camino principal** es derivar de una entrada `Game` existente.

La formalización de la bug condition C(X), la elección del default y los helpers concretos se detallan en la fase de diseño. Este documento solo describe el comportamiento observado, el esperado y el que debe preservarse.

## Bug Analysis

### Current Behavior (Defect)

Comportamiento actual al insertar o mover la línea `Game modsvs` dentro del bloque `SearchPaths`.

1.1 WHEN se inserta o mueve la línea `Game modsvs` en el bloque `SearchPaths` (Caso A o Caso B de `ensureModsvsFirst`) THEN el sistema construye la línea con un **espacio simple** entre la clave `Game` y el valor `modsvs`, hardcodeado en `canonicalModsvsSegment`.

1.2 WHEN las otras entradas `Game <x>` del bloque `SearchPaths` usan tabulación (u otro separador) entre la clave y su valor THEN el sistema NO deriva ni replica ese separador y produce una línea `Game modsvs` cuyo separador clave-valor **no coincide** con el del resto de entradas `Game` del bloque.

1.3 WHEN el motor Source lee el bloque `SearchPaths` con la línea `Game modsvs` de separador incorrecto THEN el sistema queda con un `gameinfo.txt` de formato inconsistente respecto al resto de nodos, sensible para el motor.

### Expected Behavior (Correct)

Comportamiento correcto para las mismas condiciones que disparan el bug.

2.1 WHEN se inserta o mueve la línea `Game modsvs` en el bloque `SearchPaths` y existe al menos otra entrada `Game <x>` en el bloque THEN el sistema SHALL usar entre `Game` y `modsvs` **exactamente el mismo separador clave-valor** que esa otra entrada `Game` (derivado de ella).

2.2 WHEN se inserta o mueve la línea `Game modsvs` THEN el sistema SHALL CONTINUAR replicando también la **indentación líder** y el **EOL** de las demás líneas `Game` del bloque, como ya hace hoy, combinándolos con el separador clave-valor derivado.

2.3 WHEN se inserta o mueve la línea `Game modsvs` y **no** existe ninguna otra entrada `Game` en el bloque de la cual derivar el separador THEN el sistema SHALL usar un separador clave-valor por defecto razonable (a decidir en diseño; probablemente un tab), en lugar del espacio simple actual.

### Unchanged Behavior (Regression Prevention)

Comportamiento existente que el fix NO debe romper.

3.1 WHEN `Game modsvs` no existe en el bloque `SearchPaths` (Caso A) THEN el sistema SHALL CONTINUAR insertándola como primera entrada, sin duplicarla.

3.2 WHEN `Game modsvs` existe en posición no-primera y/o múltiple (Caso B) THEN el sistema SHALL CONTINUAR moviéndola/colapsándola a una única primera entrada, preservando el orden relativo del resto de SearchPaths.

3.3 WHEN `Game modsvs` ya es la primera y única entrada `modsvs` del bloque (Caso C) THEN el sistema SHALL CONTINUAR tratándolo como idempotente y **no** reescribir el archivo: si la línea existente ya tiene el separador correcto no debe reescribirse, y una segunda aplicación tras el fix debe seguir siendo un no-op.

3.4 WHEN se transforma el `gameinfo.txt` THEN el sistema SHALL CONTINUAR preservando el resto del archivo **carácter por carácter** (DECISIÓN 2), sin alterar comentarios, casing, orden ni espaciado de otras claves.

3.5 WHEN se determina la referencia de formato para la línea `Game modsvs` THEN el sistema SHALL CONTINUAR detectando y replicando la **indentación líder** y el **EOL** (DECISIÓN 3, que ya funciona), ahora ampliado con el separador clave-valor.

3.6 WHEN el `gameinfo.txt` no contiene un bloque `SearchPaths` localizable THEN el sistema SHALL CONTINUAR lanzando `GameInfoEditError` con el `reason` correspondiente (DECISIÓN 1), sin crear el bloque.
