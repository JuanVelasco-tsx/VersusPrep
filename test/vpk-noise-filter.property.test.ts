import fc from "fast-check";

import { VPK_NOISE_PREFIXES, filterVpkNoise } from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * Property test del filtrado de ruido de la salida de `vpk.exe` (Tarea 2.2).
 *
 * Property 8: Filtrado del ruido de la VPK_Tool
 * **Validates: Requirements 6.2**
 *
 * La función pura `filterVpkNoise` (tarea 2.1) debe, para un stdout con mezcla
 * arbitraria de líneas de RUIDO y líneas VÁLIDAS:
 *   - conservar EXACTAMENTE las líneas que NO comienzan con ninguno de los
 *     prefijos de ruido, sin alterarlas (mismo contenido y mismo orden), y
 *   - descartar EXACTAMENTE las que SÍ comienzan con un prefijo de ruido.
 *
 * ---------------------------------------------------------------------------
 * Estrategia de generación (una lista etiquetada de líneas -> stdout):
 *
 * Se genera un array de longitud variable (incluido el vacío) de "líneas
 * etiquetadas". Cada elemento es o bien una línea de RUIDO o bien una línea
 * VÁLIDA, y sabemos por construcción a cuál categoría pertenece. El esperado
 * (`filterVpkNoise(stdout)`) es entonces, deterministamente, la subsecuencia de
 * las líneas VÁLIDAS en su orden original.
 *
 * Invariantes GARANTIZADAS por los generadores (para que la propiedad sea
 * correcta y no falle por casos borde legítimos):
 *
 *  A) Ninguna línea (válida ni de ruido) contiene `\n` ni `\r`. Se generan con
 *     `noEolString()` (un `fc.string` restringido a code points que no son
 *     `\n` ni `\r`). Esto evita que unir con `\n` introduzca cortes de línea
 *     espurios o `\r` colgantes que cambien la tokenización.
 *
 *  B) Las líneas VÁLIDAS realmente NO comienzan con ningún prefijo de ruido.
 *     El generador base podría, por azar, producir un string que empiece con
 *     "FS:", etc. Para garantizar la invariante SIN sesgar el espacio de
 *     entrada, se neutraliza anteponiendo un ESPACIO cuando el string generado
 *     empieza con algún prefijo. Esto es coherente con la decisión "sin trim"
 *     de la tarea 2.1: "  FS: ..." NO comienza literalmente con "FS:", así que
 *     es una línea válida legítima. Con esto, las líneas válidas cubren tanto
 *     texto arbitrario como el caso borde de espacios iniciales antes de un
 *     prefijo, y siempre son verdaderamente "no ruido".
 *
 *  C) Las líneas de RUIDO llevan el prefijo al inicio EXACTO (sin espacios
 *     previos), coherente con la decisión "sin trim": el prefijo se elige de
 *     `VPK_NOISE_PREFIXES` (fuente de verdad) y se concatena con un sufijo
 *     arbitrario sin saltos de línea.
 *
 * Construcción del stdout: las líneas se unen con `\n` SIN salto final. Así se
 * evita la última línea vacía sintética que `filterVpkNoise` descartaría (regla
 * de la decisión 5 de la tarea 2.1) y la comparación contra el esperado queda
 * sin ambigüedad. Las líneas vacías intermedias (una línea VÁLIDA vacía en el
 * medio) se conservan naturalmente y quedan cubiertas por el generador de
 * strings, que puede producir la cadena vacía.
 *
 * Regla de la línea final vacía (decisión 5): la función descarta la ÚLTIMA
 * línea si queda vacía (sea la vacía sintética de un salto terminal, sea una
 * última línea válida que resulta ser vacía; el filtro no las distingue). El
 * oráculo del test replica exactamente esa regla antes de descartar el ruido,
 * de modo que el modelo esperado no reusa la implementación bajo prueba pero sí
 * su semántica documentada. Los bordes `stdout === ""` (array vacío o única
 * línea válida vacía) caen naturalmente en `[]`.
 * ---------------------------------------------------------------------------
 */

/**
 * Unit de un único carácter Unicode que NO es `\n` ni `\r`.
 *
 * En fast-check 4.x, `fc.string` se compone a partir de un `unit`; aquí se
 * define un unit personalizado (un code point del rango Unicode completo, unit
 * "binary") filtrando los dos caracteres de fin de línea. Así todo string
 * generado con este unit queda garantizado sin saltos de línea (invariante A).
 */
const noEolChar: fc.Arbitrary<string> = fc
  .string({ unit: "binary", minLength: 1, maxLength: 1 })
  .filter((c) => c !== "\n" && c !== "\r");

/** Genera un string arbitrario que NO contiene `\n` ni `\r`. */
function noEolString(): fc.Arbitrary<string> {
  return fc.string({ unit: noEolChar });
}

/** Modelo de una línea etiquetada por categoría. */
type LabeledLine =
  | { kind: "valid"; line: string }
  | { kind: "noise"; line: string };

/**
 * Genera una línea VÁLIDA: texto sin saltos de línea que, garantizadamente, no
 * comienza con ningún prefijo de ruido (invariante B; ver cabecera).
 */
const validLine: fc.Arbitrary<LabeledLine> = noEolString().map((raw) => {
  const line = VPK_NOISE_PREFIXES.some((prefix) => raw.startsWith(prefix))
    ? ` ${raw}` // neutraliza con un espacio inicial (decisión "sin trim")
    : raw;
  return { kind: "valid", line };
});

/**
 * Genera una línea de RUIDO: un prefijo de `VPK_NOISE_PREFIXES` al inicio exacto
 * seguido de texto arbitrario sin saltos de línea (invariante C).
 */
const noiseLine: fc.Arbitrary<LabeledLine> = fc
  .tuple(fc.constantFrom(...VPK_NOISE_PREFIXES), noEolString())
  .map(([prefix, suffix]) => ({ kind: "noise", line: `${prefix}${suffix}` }));

/** Mezcla arbitraria de líneas válidas y de ruido, en orden y cantidad libres. */
const labeledLines: fc.Arbitrary<LabeledLine[]> = fc.array(
  fc.oneof(validLine, noiseLine),
);

propertyTest(
  8,
  "Filtrado del ruido de la VPK_Tool",
  fc.property(labeledLines, (labeled) => {
    const stdout = labeled.map((l) => l.line).join("\n");

    // Modelo esperado (oráculo independiente) que replica la semántica
    // DOCUMENTADA de la tarea 2.1 sobre las líneas etiquetadas, sin reusar la
    // implementación bajo prueba:
    //
    //  1. Se parte de las líneas tal cual (ya sin `\n`/`\r` por construcción).
    //  2. Regla de la línea final vacía (decisión 5): si la ÚLTIMA línea es
    //     vacía, se descarta. Esto cubre tanto el salto terminal como el caso
    //     borde en que la propia última línea válida es vacía; el filtro no
    //     distingue una de otra, así que el oráculo tampoco.
    //  3. Se descartan las líneas de ruido (kind === "noise").
    //
    // El caso `stdout === ""` (array vacío, o única línea válida vacía) cae
    // naturalmente en `[]` por los pasos 2-3.
    const lines = [...labeled];
    if (lines.length > 0 && lines[lines.length - 1]?.line === "") {
      lines.pop();
    }
    const expected = lines
      .filter((l): l is Extract<LabeledLine, { kind: "valid" }> => l.kind === "valid")
      .map((l) => l.line);

    const result = filterVpkNoise(stdout);

    // Igualdad estructural: mismas líneas, mismo orden, sin alterar contenido;
    // implica también que se descartaron exactamente las de ruido.
    return (
      result.length === expected.length &&
      result.every((line, index) => line === expected[index])
    );
  }),
);
