// scripts/check-preload-cjs.mjs
//
// Guard post-build (P-17): confirma que dist/src/preload/preload.js haya
// quedado en CommonJS (el bundle real que genera vite build --config
// vite.preload.config.ts), no en ESM.
//
// El orden correcto en el && chain de "build" es tsc -p tsconfig.json
// PRIMERO, vite build del preload DESPUES: tsc reemite dist/src/preload/
// preload.js en ESM porque src/preload sigue en el include de tsconfig.json
// (a proposito, para no perder el typecheck del preload), y el build de Vite
// lo pisa con el CJS correcto. Ese orden hoy es solo una convencion manual
// del && chain - nada lo hacia cumplir - y un reordenamiento accidental
// reintroduciria en silencio el bug de preload ESM ya corregido antes (el
// preload sandboxed de Electron no soporta import/export de nivel superior:
// "SyntaxError: Cannot use import statement outside a module", ver
// Context/04-historial-decisiones.md). Ni typecheck ni test lo detectan
// (mockean el dominio, nunca cargan un preload real en Electron real). Este
// chequeo corre al final del paso de vite preload en "build" para fallar
// ruidosamente ACA si el orden se rompe, en vez de recien al abrir la app
// empaquetada.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = resolve(here, "..", "dist/src/preload/preload.js");

// Linea de nivel superior (sin indentacion) que arranca con `import` o
// `export`: la firma inconfundible de ESM. El bundle CJS real de Vite usa
// `require(...)` / `module.exports` y nunca arranca una linea asi.
const ESM_TOP_LEVEL_PATTERN = /^(import|export)\b/m;

async function main() {
  let content;
  try {
    content = await readFile(PRELOAD_PATH, "utf8");
  } catch (err) {
    console.error(
      `[check-preload-cjs] No se pudo leer ${PRELOAD_PATH}: ${err?.message ?? err}`,
    );
    process.exitCode = 1;
    return;
  }

  const match = content.match(ESM_TOP_LEVEL_PATTERN);
  if (match) {
    console.error(
      "[check-preload-cjs] FALLO: dist/src/preload/preload.js quedo en ESM " +
        `(linea de nivel superior que arranca con "${match[0]}"). Esto pasa ` +
        "cuando tsc corre DESPUES de `vite build --config vite.preload.config.ts` " +
        'en el && chain de "build" y reemite el .js en ESM pisando el bundle ' +
        "CJS de Vite. El preload sandboxed de Electron no soporta import/export " +
        'de nivel superior ("SyntaxError: Cannot use import statement outside a ' +
        'module"). Revisa el orden: tsc -p tsconfig.json PRIMERO, vite build ' +
        "del preload DESPUES.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("[check-preload-cjs] OK: dist/src/preload/preload.js esta en CommonJS.");
}

await main();
