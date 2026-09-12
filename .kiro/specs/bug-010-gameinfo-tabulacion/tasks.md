# Implementation Plan

## Overview

Este plan implementa el fix de BUG-010 (capa **main/dominio**, archivo
`src/main/domain/game-info-editor.ts`) siguiendo la metodología de bug condition del diseño.

**Causa raíz (del design, confirmada por lectura estática):** `canonicalModsvsSegment(indent, eol)`
construye la línea `Game modsvs` con un **espacio simple hardcodeado** entre la clave `Game` y
el valor `modsvs`. `referenceIndentEol` ya deriva la **indentación líder** y el **EOL** de la
primera entrada `Game` de referencia del bloque `SearchPaths`, pero **NO** deriva el separador
clave-valor. El resto del bloque usa tabulación (a menudo varias tabs para alinear columnas), así
que la línea producida queda con un separador que no coincide con el del archivo.

**Fix (del design):** derivar el separador de la **misma** primera entrada `Game` de referencia
(DECISIÓN 1) capturando la **corrida completa** de whitespace `[ \t]+` (DECISIÓN 2), y usarlo al
construir la línea canónica en los Casos A/B. Cambios en `game-info-editor.ts`: (1) nueva
constante `DEFAULT_SEPARATOR = "\t"`; (2) nuevo helper `extractSeparator(text)`; (3) extender
`referenceIndentEol` a `{ indent, eol, separator }`; (4) `canonicalModsvsSegment(indent, separator, eol)`
usa el separador en vez del espacio; (5) `ensureModsvsFirstInContent` pasa el separador derivado.

**Bug Condition C(X):** se aplica el Caso A (insertar) o el Caso B (mover/colapsar), existe una
primera entrada `Game` de referencia, y el separador que el código produce hoy (espacio simple)
difiere del separador de esa entrada de referencia.

**Property P(result):** la línea `Game modsvs` insertada/movida usa **exactamente** el mismo
separador clave-valor que la primera entrada `Game` de referencia (misma corrida de tabs/espacios),
manteniendo la indentación líder y el EOL de referencia; sin entrada `Game` previa usa
`DEFAULT_SEPARATOR` (un tab).

**Idempotencia (crítico, preservada por construcción):** el early-return del Caso C queda **ANTES**
de `referenceIndentEol`/`canonicalModsvsSegment`, así que `Game modsvs` ya primera-y-única NO se
reescribe, aunque su separador difiera del canónico. El fix **no** mueve ese early-return.

**Metodología:** primero reproducción (fase exploratoria, tests que FALLAN sin el fix), luego el
fix, luego fix-check (property + re-ejecutar exploratorios), preservation-check, unit tests, ajuste
de regresión y checkpoint final. Testing con **vitest + fast-check**, SIN watch
(`npm run test` = `vitest run`) y `npm run typecheck`. Se reutiliza el patrón de
`test/game-info-editor.property.test.ts` y el helper `test/helpers/property.ts` (`propertyTest`).

## Task Dependency Graph

```
                 ┌───────────────────────────────┐
   Wave 1        │ 1. Fase exploratoria (FALLA)   │  (reproduce el bug — sin fix)
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
   Wave 2        │ 2. Preservation (PASA sin fix) │  (baseline observado)
                 └───────────────┬───────────────┘
                                 │
        ┌────────────────────────▼────────────────────────┐
   Wave 3   3. Fix   3.1 DEFAULT_SEPARATOR + extractSeparator
                     3.2 referenceIndentEol → 3.3 canonicalModsvsSegment
                     3.4 ensureModsvsFirstInContent (pasa separador; NO mueve early-return C)
                                 │
        ┌────────────────────────▼────────────────────────┐
   Wave 4   4. Fix-check   4.1 property (fix)   4.2 re-ejecutar exploratorios (PASAN)
                                 │
                 ┌───────────────▼───────────────┐
   Wave 5        │ 5. Preservation re-check       │  (siguen pasando — sin regresión)
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
   Wave 6        │ 6. Unit tests (separadores/Caso B/C)│
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
   Wave 7        │ 7. Regresión (tests `Game modsvs`)│
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
   Wave 8        │ 8. Checkpoint (test+typecheck) │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
   Wave 9        │ 9. Commit + historial (BUG-010)│
                 └───────────────────────────────┘
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "description": "Reproducir el bug con tests exploratorios que FALLAN sobre el código sin fix (Game modsvs con espacio simple en vez del separador de referencia)" },
    { "wave": 2, "tasks": ["2"], "description": "Capturar el baseline de preservación (PASA sobre el código sin fix): Caso C idempotente, resto del archivo, GameInfoEditError" },
    { "wave": 3, "tasks": ["3", "3.1", "3.2", "3.3", "3.4"], "description": "Implementar el fix: DEFAULT_SEPARATOR, extractSeparator, referenceIndentEol {indent,eol,separator}, canonicalModsvsSegment y el paso del separador sin mover el early-return del Caso C" },
    { "wave": 4, "tasks": ["4", "4.1", "4.2"], "description": "Fix-check: property test con fast-check y re-ejecución de los exploratorios (ahora PASAN)" },
    { "wave": 5, "tasks": ["5"], "description": "Preservation re-check: los tests de preservación siguen pasando" },
    { "wave": 6, "tasks": ["6"], "description": "Unit tests: una tab, múltiples tabs, espacios, sin Game previa (DEFAULT_SEPARATOR), idempotencia Caso C, Caso B mover, preservación del resto" },
    { "wave": 7, "tasks": ["7"], "description": "Ajuste de regresión de tests existentes que asertaban `Game modsvs` con espacio simple" },
    { "wave": 8, "tasks": ["8"], "description": "Checkpoint: suite completa (vitest run) + typecheck" },
    { "wave": 9, "tasks": ["9"], "description": "Commit y registro en el historial de decisiones (BUG-010, DECISIÓN 1 y 2)" }
  ]
}
```

## Tasks

- [x] 1. Escribir los tests exploratorios de la Bug Condition (ANTES del fix)
  - **Property 1: Bug Condition** - La línea `Game modsvs` insertada/movida no replica el separador de referencia
  - **CRÍTICO**: estos tests DEBEN FALLAR sobre el código sin arreglar — el fallo confirma que el bug existe (`canonicalModsvsSegment` produce un espacio simple en vez del separador de referencia).
  - **NO intentar arreglar el test ni el código cuando fallen**: el fallo es el resultado esperado en esta fase.
  - **NOTA**: estos tests codifican el comportamiento esperado; validarán el fix cuando pasen tras la implementación (tarea 4.2).
  - **OBJETIVO**: surfar contraejemplos que demuestren que el separador producido difiere del de la primera entrada `Game` de referencia.
  - **Enfoque PBT acotado**: para el bug determinista, acotar cada caso a un `gameinfo.txt` concreto y aseverar el separador EXACTO de la línea `Game modsvs` producida por `ensureModsvsFirstInContent`.
  - Reutilizar el estilo de fixtures y aserciones de `test/game-info-editor.property.test.ts` (construir un `gameinfo.txt` sintético con un bloque `SearchPaths` bien formado).
  - Caso A con **una tab** de referencia: bloque con primera entrada `Game\tupdate` y sin `modsvs`; aseverar que la línea insertada es exactamente `Game\tmodsvs`. Falla sin el fix (produce `Game modsvs` con espacio).
  - Caso A con **múltiples tabs**: primera entrada `Game\t\tleft4dead2_dlc3`; aseverar `Game\t\tmodsvs` con los MISMOS dos tabs. Falla sin el fix.
  - Caso B (**mover/colapsar**): `modsvs` presente en posición no-primera; primera entrada `Game` con separador de tabs; aseverar que la línea colapsada a la primera posición usa el separador de referencia. Falla sin el fix (la colapsada usa espacio simple).
  - **Sin entrada `Game` previa**: bloque sin otras `Game`; aseverar que la línea insertada usa `DEFAULT_SEPARATOR` (una tab). Puede fallar sin el fix (espacio simple).
  - Ejecutar sobre el código SIN fix con `npm run test` (vitest run, sin watch).
  - **RESULTADO ESPERADO**: los tests FALLAN (esto es correcto: prueban que el bug existe).
  - Documentar los contraejemplos encontrados (p. ej. "`Game modsvs` insertado usa un espacio simple en vez del `\t\t` de la primera entrada `Game`").
  - Marcar completa cuando los tests estén escritos, ejecutados y el fallo documentado.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Escribir los tests de preservación (ANTES del fix)
  - **Property 2: Preservation** - Casos, idempotencia y resto del archivo inalterados
  - **IMPORTANTE**: seguir la metodología observación-primero — correr el código SIN fix, observar los outputs reales y aseverarlos.
  - Observar y aseverar (sobre código sin fix) — **Idempotencia del Caso C**: `Game modsvs` ya primera-y-única con separador no canónico (`Game\t\tmodsvs`): `ensureModsvsFirstInContent` devuelve `changed === false`, `appliedCase === "unchanged"` y `content` idéntico carácter por carácter (NO reescribe el separador).
  - Observar y aseverar — **Preservación del resto del archivo**: tras un Caso A/B, el prefijo/sufijo (comentarios, otras claves) queda intacto carácter por carácter (startsWith/endsWith sobre las cadenas literales, mismo criterio que la Property 12 existente).
  - Observar y aseverar — **Casos A/B sin duplicar y orden preservado**: la entrada `modsvs` queda como primera y única, y el orden relativo del resto de SearchPaths se mantiene.
  - Observar y aseverar — **Indentación y EOL**: la línea `Game modsvs` sigue replicando la indentación líder y el EOL de la referencia.
  - Observar y aseverar — **`GameInfoEditError`**: sin bloque `SearchPaths` se lanza `missing-search-paths`; bloque sin cierre, `malformed`.
  - Property-based (fast-check, mín. 100 iter) recomendado para la preservación: para inputs arbitrarios que NO cumplen la bug condition (Caso C idempotente) el resultado observable no cambia.
  - Ejecutar sobre el código SIN fix con `npm run test` (vitest run, sin watch).
  - **RESULTADO ESPERADO**: los tests PASAN (confirma el baseline a preservar).
  - Marcar completa cuando los tests estén escritos, ejecutados y pasando sobre el código sin fix.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix para BUG-010 — derivar el separador clave-valor de la primera entrada `Game`

  - [x] 3.1 Agregar `DEFAULT_SEPARATOR` y el helper `extractSeparator` en `src/main/domain/game-info-editor.ts`
    - Agregar la constante `const DEFAULT_SEPARATOR = "\t";` junto a `DEFAULT_EOL`/`DEFAULT_INDENT`, con JSDoc justificando el tab (el dominio usa tabs y el formato Valve alinea las columnas del bloque `SearchPaths` con tabulación; nunca un espacio simple, que es el defecto de BUG-010).
    - Agregar el helper `extractSeparator(text: string): string | null` que ejecuta `/^\s*game([ \t]+)\S/i` sobre el `text` y devuelve el grupo capturado completo (la corrida `[ \t]+` entre `game` y el valor), o `null` si no matchea. JSDoc referenciando DECISIÓN 2 (se replica la corrida entera, no un único carácter).
    - _Bug_Condition: `isBugCondition(input)` — `producedSeparator (" ") != refSeparator` (del design)_
    - _Expected_Behavior: `separatorOf(modsvsLine) == extractSeparator(firstGameLine)` (Fix Checking del design)_
    - _Requirements: 2.1, 2.3_

  - [x] 3.2 Extender `referenceIndentEol` a `{ indent, eol, separator }`
    - Cambiar la firma de retorno de `{ indent; eol }` a `{ indent; eol; separator }`.
    - En la rama que encuentra la primera línea `Game` de referencia (misma línea de la que ya salen indent+EOL, DECISIÓN 1): `separator = extractSeparator(seg.text) ?? DEFAULT_SEPARATOR`.
    - En las ramas de fallback (línea de apertura `{` sin `Game` previa, y el default final): `separator = DEFAULT_SEPARATOR`.
    - _Bug_Condition: `referenceIndentEol` no derivaba el separador (del design)_
    - _Expected_Behavior: el separador se deriva de la MISMA primera línea `Game` de referencia (DECISIÓN 1); default `DEFAULT_SEPARATOR` sin `Game` previa (Property 1 del design)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 `canonicalModsvsSegment` recibe y usa el separador
    - Cambiar la firma a `canonicalModsvsSegment(indent: string, separator: string, eol: string)`.
    - Construir `text: \`${indent}Game${separator}${MODSVS_FOLDER}\`` en vez del espacio simple hardcodeado (`\`${indent}${"Game"} ${MODSVS_FOLDER}\``). Mantener el manejo de `eol === ""` -> `DEFAULT_EOL`.
    - _Bug_Condition: espacio simple hardcodeado en `canonicalModsvsSegment` (causa raíz del design)_
    - _Expected_Behavior: la línea usa `${indent}Game${separator}modsvs` (Property 1 del design)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.4 `ensureModsvsFirstInContent` pasa el separador derivado (sin mover el early-return del Caso C)
    - Cambiar `const { indent, eol } = referenceIndentEol(segments, block);` por `const { indent, eol, separator } = referenceIndentEol(segments, block);`.
    - Cambiar `const canonical = canonicalModsvsSegment(indent, eol);` por `const canonical = canonicalModsvsSegment(indent, separator, eol);`.
    - **CRÍTICO (idempotencia)**: NO mover el early-return del Caso C. Debe seguir ANTES de la llamada a `referenceIndentEol`/`canonicalModsvsSegment`, para que `Game modsvs` ya primera-y-única se devuelva intacto sin construir la línea canónica (no normaliza el separador existente).
    - _Bug_Condition: `isBugCondition(input)` — Caso A/B con separador de referencia distinto del producido (del design)_
    - _Expected_Behavior: `expectedBehavior(result)` — línea canónica con el separador derivado en Casos A/B (Fix Checking del design)_
    - _Preservation: Caso C idempotente NO reescribe; Casos A/B sin duplicar y orden preservado; indentación y EOL replicados; resto del archivo intacto; `GameInfoEditError` sin bloque (Preservation Requirements del design)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Fix-check — verificar que el fix replica el separador correcto

  - [x] 4.1 Escribir el property test del fix con fast-check
    - **Property 1: Expected Behavior** - La línea `Game modsvs` replica exactamente el separador de referencia
    - Con `fast-check` (mínimo 100 iteraciones), reutilizando `test/helpers/property.ts` (`propertyTest`/`propertyName`) y el patrón de generación de `test/game-info-editor.property.test.ts`: generar un bloque `SearchPaths` cuya **primera** entrada `Game <x>` use un separador `S` que es una corrida arbitraria de 1..N caracteres de `[ \t]`.
    - Tras insertar/mover `Game modsvs` (Caso A o B), aseverar que la línea producida es EXACTAMENTE `Game` + `S` + `modsvs`, con la indentación líder y el EOL de referencia.
    - **Idempotencia**: aplicar `ensureModsvsFirstInContent` dos veces == una vez (la segunda devuelve `appliedCase === "unchanged"`, `changed === false`, `content` idéntico), incluso cuando el separador existente no es el canónico.
    - Mantener la no-vacuidad del generador (que cubra `inserted`, `moved` y `unchanged`), siguiendo el criterio ya aplicado en la Property 12 existente.
    - Ejecutar con `npm run test` (vitest run, sin watch).
    - **RESULTADO ESPERADO**: el property test PASA sobre el código con fix.
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.2 Re-ejecutar los tests exploratorios de la tarea 1
    - **Property 1: Expected Behavior** - Los exploratorios ahora pasan (bug resuelto)
    - **IMPORTANTE**: re-ejecutar los MISMOS tests de la tarea 1 — NO escribir tests nuevos. Esos tests codifican el comportamiento esperado.
    - Ejecutar con `npm run test` (vitest run, sin watch).
    - **RESULTADO ESPERADO**: los casos (una tab, múltiples tabs, Caso B mover, sin `Game` previa) PASAN (confirma que el bug está resuelto).
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 5. Preservation re-check — verificar que no hay regresiones
  - **Property 2: Preservation** - Casos, idempotencia y resto del archivo inalterados
  - **IMPORTANTE**: re-ejecutar los MISMOS tests de la tarea 2 — NO escribir tests nuevos.
  - Ejecutar con `npm run test` (vitest run, sin watch).
  - **RESULTADO ESPERADO**: los tests de preservación siguen PASANDO tras el fix (Caso C idempotente sin reescribir aunque el separador difiera; Casos A/B sin duplicar y orden preservado; indentación y EOL replicados; resto del archivo intacto; `GameInfoEditError` sin bloque).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 6. Unit tests de separadores, Caso B y preservación
  - Separador = **una tab**: la línea `modsvs` replica una tab (`Game\tmodsvs`).
  - Separador = **múltiples tabs** (dos y tres tabs alineando columna): la línea `modsvs` replica los MISMOS N tabs, exactos.
  - Separador = **espacios** (p. ej. tres espacios): la línea `modsvs` replica los tres espacios.
  - **Sin entrada `Game` previa**: la línea `modsvs` usa `DEFAULT_SEPARATOR` (una tab).
  - **Idempotencia (Caso C)**: `Game modsvs` primera-y-única con separador no canónico: NO se reescribe (`changed === false`, `content` idéntico).
  - **Caso B (mover)**: la línea colapsada a la primera posición usa el separador derivado (no el espacio simple).
  - **Preservación**: el resto del archivo (comentarios, otras claves, indentación, EOL) queda intacto carácter por carácter.
  - Ejecutar con `npm run test` (vitest run, sin watch).
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 7. Ajuste de regresión — tests existentes que asertaban `Game modsvs` con espacio simple
  - Localizar todos los tests existentes de `game-info-editor` (incluido `test/game-info-editor.property.test.ts`) que fijaran/aseveraran la línea `Game modsvs` con **espacio simple** como separador.
  - Ajustar esos fixtures/aserciones: el separador ahora se deriva de la primera entrada `Game`, así que un fixture con otras entradas `Game` de tabulación esperará tabs, no espacio. Anticipar en particular las variantes `modsvsVariantArb` / el oráculo del property test existente que comparaban la forma de la línea.
  - No cambiar el comportamiento aseverado (primera-y-única, orden, idempotencia), solo el separador esperado.
  - Ejecutar con `npm run test` (vitest run, sin watch).
  - _Requirements: 2.1, 2.2_

- [x] 8. Checkpoint — suite completa + typecheck
  - Correr `npm run test` (vitest run, SIN watch): todos los tests pasan (exploratorios ahora en verde, preservación intacta, unit + regresión).
  - Correr `npm run typecheck`: sin errores de tipos (la nueva firma de `referenceIndentEol`/`canonicalModsvsSegment` no rompe ningún llamador).
  - Si surgen dudas o fallos inesperados, preguntar al usuario antes de continuar.
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [~] 9. Commit y registro en el historial de decisiones
  - Crear el commit con formato CONTRIBUTING.md: `fix(gameinfo-editor): derivar el separador clave-valor de la primera entrada Game al insertar/mover Game modsvs (bug BUG-010)`. Si se sigue la convención `(task X.Y, req Z.W)` de CONTRIBUTING, anexar las tareas/requisitos cubiertos manteniendo intacto el mensaje base pedido.
  - Preferir stage de archivos específicos (los tocados: `src/main/domain/game-info-editor.ts`, `test/game-info-editor.property.test.ts` y/o los tests nuevos/ajustados, `Context/04-historial-decisiones.md`), no `git add .`.
  - Agregar entrada en `Context/04-historial-decisiones.md` (mismo formato que las secciones anteriores) documentando DECISIÓN 1 y DECISIÓN 2: "BUG-010 (QA V3, jornada 2). Al insertar/mover `Game modsvs`, `canonicalModsvsSegment` hardcodeaba un espacio simple como separador clave-valor, mientras el resto del bloque `SearchPaths` usa tabulación. Se extiende `referenceIndentEol` a `{ indent, eol, separator }` para derivar el separador de la MISMA primera línea `Game` de referencia (DECISIÓN 1) capturando la corrida completa de whitespace (DECISIÓN 2), y `canonicalModsvsSegment` pasa a recibir y usar ese separador. Sin entrada `Game` previa se usa `DEFAULT_SEPARATOR` (un tab). La idempotencia del Caso C se preserva porque su early-return corta antes de construir la línea canónica (no normaliza el separador existente)."
  - **NO mergear sin mostrar el diff primero** (el usuario lo pide siempre): mostrar `git diff`/`git show` antes de cualquier merge y esperar confirmación.
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

## Notes

- **Metodología bug condition**: la tarea 1 (exploratoria) DEBE fallar sobre el código sin fix — ese fallo confirma la causa raíz (separador hardcodeado en `canonicalModsvsSegment`, no derivado en `referenceIndentEol`). La tarea 2 (preservación) DEBE pasar sobre el código sin fix — captura el baseline observado. No se implementa el fix hasta que ambas fases estén ejecutadas y documentadas.
- **Alcance**: solo `src/main/domain/game-info-editor.ts`. No se toca `types.ts` (no se espera) ni el renderer ("Code").
- **DECISIÓN 1 (línea de referencia única)**: el separador se deriva de la MISMA primera línea `Game` de la que `referenceIndentEol` ya deriva indentación y EOL, para mantener una única línea de referencia determinista y evitar ambigüedad si distintas entradas `Game` usan separadores distintos.
- **DECISIÓN 2 (corrida completa)**: el separador es toda la secuencia `[ \t]+` entre `game` y el valor (no un único carácter), porque el formato Valve usa múltiples tabs para alinear columnas; replicar un solo carácter rompería la alineación. Regex sugerido: `/^\s*game([ \t]+)\S/i`.
- **Default sin `Game` previa**: `DEFAULT_SEPARATOR = "\t"` (un tab), nunca un espacio simple. Cubierto en las tareas 3.1, 3.2, 4.1 y 6.
- **Idempotencia (Caso C)**: el early-return del Caso C NO se mueve; queda antes de `referenceIndentEol`/`canonicalModsvsSegment`, así que `Game modsvs` ya primera-y-única no se reescribe aunque su separador difiera del canónico. Verificado en las tareas 2, 3.4, 4.1 y 6.
- **Preservación carácter por carácter**: el resto del archivo (comentarios, otras claves, indentación, EOL) queda intacto; el fix solo cambia el separador de la línea canónica insertada/movida (DECISIÓN 2 del componente).
- **Regresión anticipada**: los tests existentes que fijaban `Game modsvs` con espacio simple deben ajustarse a esperar el separador derivado (tarea 7).
- **Herramientas de test**: vitest + fast-check. SIEMPRE `npm run test` (= `vitest run`, sin watch) y `npm run typecheck`. NUNCA watch mode.
