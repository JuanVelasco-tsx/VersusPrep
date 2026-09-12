# BUG-010 — Separador clave-valor de `Game modsvs`: Diseño del Bugfix

## Overview

Al garantizar que `Game modsvs` sea la primera y única entrada del bloque `SearchPaths`
del `gameinfo.txt`, el `GameInfoEditor` inserta (Caso A) o mueve/colapsa (Caso B) esa línea
usando un **separador clave-valor hardcodeado**: un **espacio simple** entre la clave `Game`
y el valor `modsvs`. Las demás entradas del bloque usan tabulación (una o varias tabs que
alinean la columna en ese archivo), por lo que la línea producida queda con un separador que
**no coincide** con el del resto del bloque. El motor Source es sensible al formato del
bloque `SearchPaths`, así que un separador distinto es un defecto de prioridad alta.

La causa raíz está confirmada por investigación estática sobre `game-info-editor.ts`:

- `canonicalModsvsSegment(indent, eol)` construye `{ text: `${indent}${"Game"} ${MODSVS_FOLDER}`, eol }`
  — hardcodea un **espacio simple** entre `Game` y `modsvs`.
- `referenceIndentEol(segments, block)` **ya** detecta y replica la **indentación líder** y
  el **EOL** de la primera línea `Game` del bloque (recorre desde `block.openIndex + 1`
  buscando la primera línea que cumpla `isGameLine`), pero **NO** el separador clave-valor.

El fix, respetando las decisiones ya cerradas por el usuario, **deriva el separador**
clave-valor de la **misma** primera línea `Game` de referencia de la que ya salen la
indentación y el EOL, y lo usa al construir la línea canónica en los Casos A/B. Cuando no
hay ninguna otra línea `Game` en el bloque, se usa una constante `DEFAULT_SEPARATOR` (un
tab). La **idempotencia** del Caso C se preserva: no reescribe para normalizar el separador.

Este spec cubre **únicamente la capa main/dominio** (`src/main/domain/game-info-editor.ts`).
No toca `types.ts` (no se espera) ni el renderer ("Code").

## Glossary

- **Bug_Condition (C)**: la condición que dispara el bug — al insertar o mover la línea
  `Game modsvs` (Casos A/B), el separador clave-valor de la línea producida difiere del
  separador de la primera entrada `Game` de referencia del bloque (hoy: espacio simple
  hardcodeado).
- **Property (P)**: el comportamiento deseado — la línea `Game modsvs` insertada/movida usa
  **exactamente** el mismo separador clave-valor que la primera entrada `Game` de referencia
  del bloque; sin entrada `Game` previa, usa `DEFAULT_SEPARATOR`.
- **Preservation**: el comportamiento existente que el fix NO debe romper — los tres casos
  A/B/C, la idempotencia del Caso C, la preservación carácter por carácter del resto del
  archivo, la replicación de indentación y EOL, y el `GameInfoEditError` sin bloque.
- **Separador clave-valor (separator)**: la corrida completa de whitespace (`[ \t]+`) que
  hay entre el token `game` (la clave, case-insensitive) y el inicio del valor, en una línea
  `Game <valor>`. Formato Valve: suele ser **múltiples tabs** para alinear columnas.
- **Línea `Game` de referencia**: la **primera** línea `Game` del bloque **en orden de
  aparición** en el archivo (la primera que se encuentra al recorrer desde
  `block.openIndex + 1`). Es la misma línea de la que `referenceIndentEol` ya deriva
  indentación y EOL.
- **`canonicalModsvsSegment`**: la función en `game-info-editor.ts` que construye el
  `LineSegment` de la línea canónica `Game modsvs`. Hoy hardcodea el separador.
- **`referenceIndentEol`**: la función que hoy devuelve `{ indent, eol }` derivados de la
  línea `Game` de referencia; el fix la extiende a `{ indent, eol, separator }`.
- **`ensureModsvsFirstInContent`**: el núcleo PURO (`string -> GameInfoEditOutcome`) que
  aplica los Casos A/B/C. Usa `splitLines`/`joinLines`, `locateSearchPaths`, `isGameLine`,
  `isGameModsvsLine`, `leadingIndent`, `canonicalModsvsSegment`, `referenceIndentEol`.
- **`DEFAULT_SEPARATOR`**: constante nueva — separador clave-valor por defecto (`"\t"`, un
  tab) cuando no hay ninguna otra línea `Game` en el bloque de la cual derivarlo.
- **Caso A / Caso B / Caso C**: insertar (`Game modsvs` no existe) / mover-colapsar (existe
  no-primera y/o múltiple) / idempotente (ya es primera-y-única, no reescribe).

## Bug Details

### Bug Condition

El bug se manifiesta cuando se INSERTA (Caso A) o se MUEVE/COLAPSA (Caso B) la línea
`Game modsvs` dentro del bloque `SearchPaths`. En esos casos, `canonicalModsvsSegment`
construye la línea con un **espacio simple** hardcodeado entre `Game` y `modsvs`, en lugar
de replicar el separador clave-valor de la primera entrada `Game` de referencia del bloque
(que en el formato real usa tabulación, a menudo varias tabs para alinear la columna).

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type GameInfoContent
         (el texto completo del gameinfo.txt con un bloque SearchPaths localizable)
  OUTPUT: boolean

  block := locateSearchPaths(splitLines(input))

  // El caso a aplicar es A (insertar) o B (mover/colapsar), NO C (idempotente).
  appliesInsertOrMove := (appliedCase(input) == "inserted")
                         OR (appliedCase(input) == "moved")

  // Existe una primera línea `Game` de referencia de la cual derivar el separador.
  refLine := firstGameLine(block)          // primera `Game` en orden de aparición
  refSeparator := extractSeparator(refLine) // corrida [ \t]+ entre `game` y el valor

  // El separador que el código PRODUCE hoy en la línea `Game modsvs` (espacio simple)
  // difiere del separador de la línea de referencia.
  producedSeparator := " "                 // hardcodeado en canonicalModsvsSegment

  RETURN appliesInsertOrMove
         AND refLine != NONE
         AND producedSeparator != refSeparator
END FUNCTION
```

### Examples

- **Una tab (`Game\tmodsvs`):** el bloque tiene `Game\tupdate` como primera entrada `Game`.
  Actual: se inserta `Game modsvs` (espacio simple). Esperado: `Game\tmodsvs` (una tab).
- **Múltiples tabs alineando columna (`Game\t\tmodsvs`):** la primera entrada `Game` es
  `Game\t\tleft4dead2_dlc3`. Actual: `Game modsvs` (espacio simple). Esperado:
  `Game\t\tmodsvs` (los **mismos** dos tabs).
- **Separador de espacios (`Game   modsvs`):** la primera entrada `Game` usa tres espacios.
  Actual: un solo espacio. Esperado: los **tres** espacios de la referencia.
- **Sin entrada `Game` previa (bloque sin otras `Game`):** no hay línea de la cual derivar.
  Actual: espacio simple. Esperado: `DEFAULT_SEPARATOR` (una tab).
- **Idempotencia (Caso C, edge — NO es bug):** `Game modsvs` ya es primera y única con
  separador `Game\t\tmodsvs`. Esperado (inalterado): NO se reescribe, aunque su separador no
  sea el canónico. El Caso C corta antes de construir la línea canónica.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Caso A (insertar): `Game modsvs` inexistente sigue insertándose como primera entrada, sin
  duplicarla.
- Caso B (mover/colapsar): ocurrencias no-primeras y/o múltiples siguen colapsándose a una
  única primera entrada, preservando el orden relativo del resto de SearchPaths.
- Caso C (idempotente): `Game modsvs` ya primera-y-única sigue tratándose como no-op y NO se
  reescribe el archivo, **aunque su separador difiera del canónico**. Una segunda aplicación
  tras el fix sigue siendo un no-op.
- Preservación **carácter por carácter** del resto del archivo (DECISIÓN 2): comentarios,
  casing, orden y espaciado de otras claves intactos.
- Replicación de la **indentación líder** y el **EOL** de la línea `Game` de referencia
  (DECISIÓN 3), ahora combinada con el separador derivado.
- `GameInfoEditError` (`missing-search-paths` / `malformed`) sin bloque SearchPaths
  localizable (DECISIÓN 1), sin crear el bloque.

**Scope:**
Todo input que NO dispare la construcción de la línea canónica en Casos A/B queda
completamente inalterado. Esto incluye:
- El Caso C idempotente (no reescribe, ni siquiera para normalizar el separador).
- Cualquier `gameinfo.txt` sin bloque SearchPaths (sigue lanzando `GameInfoEditError`).
- Comentarios, otras claves, indentación y EOL del resto del archivo.

**Note:** El comportamiento correcto concreto (usar el separador derivado) está definido en
"Correctness Properties" (Property 1). Esta sección enumera lo que NO debe cambiar.

## Hypothesized Root Cause

La causa raíz está **confirmada** por lectura estática de `game-info-editor.ts` (no es una
mera hipótesis abierta):

1. **Separador hardcodeado en `canonicalModsvsSegment`** (causa raíz confirmada): la línea
   se construye como `${indent}${"Game"} ${MODSVS_FOLDER}`, con un **espacio simple** fijo
   entre `Game` y `modsvs`. Esa función solo recibe `indent` y `eol`, nunca el separador.

2. **`referenceIndentEol` no deriva el separador**: hoy inspecciona la primera línea `Game`
   de referencia y devuelve `{ indent, eol }`, pero descarta el separador clave-valor de esa
   misma línea. La información necesaria ya está a mano (la línea de referencia), solo no se
   extrae.

3. **Ausencia de una constante de separador por defecto**: cuando no hay línea `Game` de
   referencia, hoy se cae igualmente en el espacio simple hardcodeado; no existe un default
   explícito y razonable (tab) como sí existe para indentación (`DEFAULT_INDENT`) y EOL
   (`DEFAULT_EOL`).

### Decisiones cerradas por el usuario (documentadas como decisiones de diseño)

**DECISIÓN 1 — Línea de referencia con múltiples entradas `Game` de separadores distintos:**
se toma **LA PRIMERA** línea `Game` del bloque **en orden de aparición** en el archivo (la
primera que se encuentra al recorrer desde `block.openIndex + 1`).
_Justificación:_ es la misma "línea de referencia" que `referenceIndentEol` ya usa para
indentación y EOL. Mantener una **única línea de referencia** para indentación + EOL +
separador es lo más consistente y determinista, y evita ambigüedad si distintas entradas
`Game` usan separadores distintos. El separador clave-valor se extrae de **la misma línea**
de la que ya se derivan indentación y EOL.

**DECISIÓN 2 — El separador es la CORRIDA COMPLETA de whitespace, no un solo carácter:** el
helper que extrae el separador captura **toda** la secuencia `[ \t]+` que sigue a la clave
`game` (case-insensitive) hasta el inicio del valor, no un único carácter.
_Justificación:_ el formato Valve usa **múltiples tabs** (o espacios) para alinear columnas;
replicar un solo carácter rompería la alineación. Criterio exacto de qué cuenta como
separador: la corrida de espacios/tabs entre el fin del token `game` y el inicio del primer
carácter no-whitespace del valor.
_Implementación sugerida:_ un regex tipo `/^\s*game([ \t]+)\S/i` sobre el `text` de la línea
`Game` de referencia, capturando el grupo `([ \t]+)` completo.

## Correctness Properties

Property 1: Bug Condition — La línea `Game modsvs` insertada/movida replica el separador de referencia

_For any_ contenido de `gameinfo.txt` con un bloque `SearchPaths` localizable donde se aplica
el Caso A (insertar) o el Caso B (mover/colapsar) —es decir, donde la bug condition sería
verdadera en el código sin arreglar—, la función arreglada SHALL producir una línea
`Game modsvs` cuyo separador clave-valor sea **exactamente** el de la primera entrada `Game`
de referencia del bloque (misma corrida de tabs/espacios), y cuando no exista ninguna otra
entrada `Game` en el bloque, SHALL usar `DEFAULT_SEPARATOR` (un tab), manteniendo además la
indentación líder y el EOL de referencia.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Casos, idempotencia y resto del archivo inalterados

_For any_ input donde la bug condition NO se cumple (Caso C idempotente, o cualquier
contenido sin bloque SearchPaths), la función arreglada SHALL producir el mismo resultado
observable que la original: el Caso C devuelve el contenido idéntico carácter por carácter
sin reescribir (aunque el separador existente difiera del canónico), los Casos A/B siguen
insertando/moviendo sin duplicar y preservando el orden relativo del resto de SearchPaths,
la indentación y el EOL se siguen replicando, el resto del archivo queda intacto carácter
por carácter, y sin bloque SearchPaths se sigue lanzando `GameInfoEditError`.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Asumiendo que la causa raíz confirmada (separador hardcodeado + referencia que no lo deriva)
es correcta.

**File**: `src/main/domain/game-info-editor.ts`

**1. Nueva constante `DEFAULT_SEPARATOR`.**

Junto a `DEFAULT_EOL` y `DEFAULT_INDENT`:

```typescript
/**
 * Separador clave-valor por defecto de la línea `Game modsvs` si el bloque no
 * tiene ninguna otra entrada `Game` de la cual derivarlo. Un tab: el resto del
 * dominio usa tabs (DEFAULT_INDENT) y el formato Valve alinea las columnas del
 * bloque SearchPaths con tabulación, así que un tab es el default consistente y
 * razonable (nunca un espacio simple, que es justo el defecto de BUG-010).
 */
const DEFAULT_SEPARATOR = "\t";
```

**2. Nuevo helper para extraer el separador de la línea `Game` de referencia** (DECISIÓN 2):

```typescript
/**
 * Extrae el separador clave-valor de una línea `Game <valor>`: la corrida COMPLETA
 * de whitespace (`[ \t]+`) entre la clave `game` (case-insensitive) y el inicio del
 * valor. Devuelve `null` si la línea no es una entrada `Game <valor>` reconocible
 * (no debería ocurrir sobre una línea ya validada con `isGameLine`, pero se protege).
 * Ver DECISIÓN 2 (BUG-010): se replica la corrida entera de tabs/espacios, no un
 * único carácter, para no romper la alineación de columnas del formato Valve.
 */
function extractSeparator(text: string): string | null {
  const match = /^\s*game([ \t]+)\S/i.exec(text);
  return match ? (match[1] ?? null) : null;
}
```

**3. Extender `referenceIndentEol` a `{ indent, eol, separator }`.**

Cambiar la firma de retorno y derivar el separador de **la misma** primera línea `Game` de
referencia (DECISIÓN 1). En las ramas de fallback (sin línea `Game`) se usa
`DEFAULT_SEPARATOR`:

```typescript
function referenceIndentEol(
  segments: LineSegment[],
  block: SearchPathsBlock,
): { indent: string; eol: string; separator: string } {
  for (let i = block.openIndex + 1; i < block.closeIndex; i++) {
    const seg = segments[i];
    if (seg !== undefined && isGameLine(seg.text)) {
      // La MISMA línea de referencia aporta indentación, EOL y separador (DECISIÓN 1).
      const separator = extractSeparator(seg.text) ?? DEFAULT_SEPARATOR;
      return {
        indent: leadingIndent(seg.text),
        eol: seg.eol === "" ? DEFAULT_EOL : seg.eol,
        separator,
      };
    }
  }
  const openSeg = segments[block.openIndex];
  if (openSeg !== undefined) {
    const baseIndent = leadingIndent(openSeg.text);
    const eol = openSeg.eol === "" ? DEFAULT_EOL : openSeg.eol;
    return { indent: `${baseIndent}\t`, eol, separator: DEFAULT_SEPARATOR };
  }
  return { indent: DEFAULT_INDENT, eol: DEFAULT_EOL, separator: DEFAULT_SEPARATOR };
}
```

**4. `canonicalModsvsSegment` recibe el separador** y lo usa en vez del espacio hardcodeado:

```typescript
function canonicalModsvsSegment(indent: string, separator: string, eol: string): LineSegment {
  return {
    text: `${indent}Game${separator}${MODSVS_FOLDER}`,
    eol: eol === "" ? DEFAULT_EOL : eol,
  };
}
```

**5. `ensureModsvsFirstInContent` pasa el separador al construir la canónica.**

En el punto donde hoy hace:

```typescript
const { indent, eol } = referenceIndentEol(segments, block);
const canonical = canonicalModsvsSegment(indent, eol);
```

pasa a:

```typescript
const { indent, eol, separator } = referenceIndentEol(segments, block);
const canonical = canonicalModsvsSegment(indent, separator, eol);
```

**IDEMPOTENCIA (crítico, preservada por construcción):** el Caso C tiene su **early-return
ANTES** de llamar a `referenceIndentEol`/`canonicalModsvsSegment`:

```typescript
// Caso C — ya es la primera y única entrada modsvs: sin cambios (idempotente).
if (modsvsIndices.length === 1 && modsvsIndices[0] === firstGameIndex) {
  return { content, changed: false, appliedCase: "unchanged" };
}
const { indent, eol, separator } = referenceIndentEol(segments, block); // <- después del corte
```

Por lo tanto, si `Game modsvs` ya es la primera y única entrada, se devuelve el `content`
intacto **sin** construir la línea canónica, aunque su separador difiera del canónico. El
fix **no** normaliza el separador en el Caso C; solo los Casos A/B, que insertan/mueven,
usan el separador derivado. La idempotencia se preserva.

## Testing Strategy

### Validation Approach

Primero se surfan contraejemplos que demuestran el bug sobre el código sin arreglar (la
línea `Game modsvs` insertada/movida usa espacio simple en lugar del separador de
referencia), luego se verifica que el fix replica el separador correcto y que los Casos
A/B/C, la idempotencia y la preservación del resto del archivo quedan inalterados.

### Exploratory Bug Condition Checking

**Goal**: Surfar contraejemplos que demuestren el bug ANTES de implementar el fix y
confirmar la causa raíz (separador hardcodeado). Si se refutara, habría que re-hipotetizar.

**Test Plan**: Construir un `gameinfo.txt` con un bloque `SearchPaths` cuya primera entrada
`Game` use tabulación, correr `ensureModsvsFirstInContent` sobre el código SIN arreglar y
aseverar el separador de la línea `Game modsvs` producida.

**Test Cases**:
1. **Caso A con tab de referencia**: bloque con `Game\tupdate` y sin `modsvs`; aseverar que
   la línea insertada es `Game\tmodsvs` (falla sin el fix: produce `Game modsvs`).
2. **Caso A con múltiples tabs**: primera entrada `Game\t\tleft4dead2_dlc3`; aseverar
   `Game\t\tmodsvs` con los mismos dos tabs (falla sin el fix).
3. **Caso B (mover)**: `modsvs` presente en posición no-primera con separador correcto;
   aseverar que al colapsar a la primera posición la línea usa el separador de referencia
   (falla sin el fix: la colapsada usa espacio simple).
4. **Sin entrada `Game` previa**: bloque sin otras `Game`; aseverar `DEFAULT_SEPARATOR`
   (una tab) (puede fallar sin el fix: espacio simple).

**Expected Counterexamples**:
- La línea `Game modsvs` insertada/movida usa un espacio simple, distinto del separador de
  tabulación de la primera entrada `Game`.
- Causa confirmada: separador hardcodeado en `canonicalModsvsSegment`, no derivado en
  `referenceIndentEol`.

### Fix Checking

**Goal**: Verificar que para todo bloque donde la bug condition se cumple (Caso A/B con una
entrada `Game` de referencia de separador S), la línea insertada/movida usa exactamente S; y
sin entrada `Game` previa, usa `DEFAULT_SEPARATOR`.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  outcome := ensureModsvsFirstInContent_fixed(input)
  modsvsLine := firstGameModsvsLineIn(outcome.content)
  IF firstGameLine(input) != NONE THEN
    ASSERT separatorOf(modsvsLine) == extractSeparator(firstGameLine(input))
  ELSE
    ASSERT separatorOf(modsvsLine) == DEFAULT_SEPARATOR
  END IF
  ASSERT indentOf(modsvsLine) == referenceIndent(input)
  ASSERT eolOf(modsvsLine) == referenceEol(input)
END FOR
```

### Preservation Checking

**Goal**: Verificar que para todo input donde la bug condition NO se cumple, la función
arreglada produce el mismo resultado que la original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT ensureModsvsFirstInContent_original(input) = ensureModsvsFirstInContent_fixed(input)
  // En particular:
  //  - Caso C: content idéntico carácter por carácter, sin reescribir el separador
  //  - Casos A/B: mismo orden relativo, sin duplicar; indentación y EOL replicados
  //  - Sin bloque SearchPaths: mismo GameInfoEditError (missing-search-paths / malformed)
END FOR
```

**Testing Approach**: El property-based testing es adecuado para la preservación: genera
muchos casos automáticamente sobre el dominio (separadores arbitrarios de tabs/espacios,
bloques de tamaño variable), cubre edge cases que los tests manuales podrían omitir y da
garantías fuertes de que el comportamiento no cambió para los inputs no-buggy.

**Test Plan**: Observar en el código SIN arreglar el comportamiento del Caso C (no reescribe)
y de la preservación del resto del archivo, y escribir tests que verifiquen que se mantiene
tras el fix.

**Test Cases**:
1. **Idempotencia del Caso C**: `Game modsvs` ya primera-y-única con separador `Game\t\tmodsvs`
   (distinto del canónico): observar que NO se reescribe en el código sin arreglar y
   verificar que sigue sin reescribirse tras el fix (`changed === false`, `content` idéntico).
2. **Preservación del resto del archivo**: prefijo/sufijo (comentarios, otras claves) intactos
   carácter por carácter tras un Caso A/B.
3. **`GameInfoEditError` sin bloque**: sin `SearchPaths`, sigue lanzando
   `missing-search-paths`; bloque sin cierre, `malformed`.
4. **Indentación y EOL**: la línea `Game modsvs` sigue replicando la indentación líder y el
   EOL de la referencia (combinados con el separador derivado).

### Unit Tests

- Separador = **una tab**: la línea `modsvs` replica una tab.
- Separador = **múltiples tabs** (dos o tres tabs alineando columna): la línea `modsvs`
  replica los MISMOS N tabs.
- Separador = **espacios** (p. ej. tres espacios): la línea `modsvs` replica los tres.
- **Sin entrada `Game` previa**: la línea `modsvs` usa `DEFAULT_SEPARATOR` (una tab).
- **Idempotencia (Caso C)**: `Game modsvs` primera-y-única con separador no canónico: NO se
  reescribe.
- **Caso B (mover)**: la línea colapsada a la primera posición usa el separador derivado.
- **Preservación**: el resto del archivo (comentarios, otras claves, indentación, EOL) queda
  intacto.

### Property-Based Tests

- Con `fast-check` (mínimo 100 iteraciones), reutilizando el patrón de
  `test/game-info-editor.property.test.ts` y el helper `test/helpers/property.ts`
  (`propertyTest`): generar un bloque `SearchPaths` cuya **primera** entrada `Game <x>` use
  un separador `S` que es una corrida arbitraria de tabs/espacios (1..N caracteres de
  `[ \t]`). Tras insertar `Game modsvs` (Caso A o B), la línea insertada tiene EXACTAMENTE
  `Game` + `S` + `modsvs` con la indentación y el EOL de referencia.
- **Idempotencia**: aplicar dos veces == aplicar una (la segunda aplicación devuelve
  `unchanged`, `changed === false`, `content` idéntico), incluso cuando el separador
  existente no es el canónico.
- Mantener la no-vacuidad del generador (que cubra Casos `inserted`, `moved` y `unchanged`),
  siguiendo el criterio ya aplicado en la Property 12 existente.

### Integration Tests

- Flujo completo con `GameInfoEditor` (clase + FS en memoria): leer un `gameinfo.txt` con
  primera entrada `Game` de separador de tabs, `ensureModsvsFirst` y verificar que el
  archivo escrito contiene `Game<tabs>modsvs` como primera y única entrada.
- Escribir/leer con EOL CRLF y LF: el separador derivado se combina correctamente con el EOL
  de referencia.
- Verificar que en el Caso C (idempotente) `GameInfoEditor` NO escribe a disco (sigue sin
  tocar el archivo), preservando la idempotencia real de la capa de I/O.

### Regresión

- Los tests existentes de `game-info-editor` deben seguir pasando. **Anticipar** que algún
  test que asertaba `Game modsvs` con **espacio simple** podría necesitar ajuste si fijaba el
  separador viejo: el separador ahora se deriva de la primera entrada `Game`, así que los
  fixtures que tengan otras entradas `Game` con tabulación esperarán tabs, no espacio.

---

## Nota de commit y trazabilidad

- **Commit** (formato CONTRIBUTING.md): `fix(gameinfo-editor): derivar el separador clave-valor de la primera entrada Game al insertar/mover Game modsvs (bug BUG-010)`.
- **Registro en `Context/04-historial-decisiones.md`** (mismo formato que las secciones
  anteriores): "BUG-010 (QA V3, jornada 2). Al insertar/mover `Game modsvs`,
  `canonicalModsvsSegment` hardcodeaba un espacio simple como separador clave-valor, mientras
  el resto del bloque `SearchPaths` usa tabulación. Se extiende `referenceIndentEol` a
  `{ indent, eol, separator }` para derivar el separador de la MISMA primera línea `Game` de
  referencia (DECISIÓN 1) capturando la corrida completa de whitespace (DECISIÓN 2), y
  `canonicalModsvsSegment` pasa a recibir y usar ese separador. Sin entrada `Game` previa se
  usa `DEFAULT_SEPARATOR` (un tab). La idempotencia del Caso C se preserva porque su
  early-return corta antes de construir la línea canónica (no normaliza el separador
  existente)."
```
