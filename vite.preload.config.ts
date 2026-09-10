import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Bundle del preload (Seccion 20, regresion detectada en Seccion 21 - ver
// Context/04-historial-decisiones.md). El preload SIEMPRE corre bajo sandbox
// (default de Electron >= 20, no lo deshabilitamos), y un preload sandboxed
// NO soporta `import` de nivel superior (confirmado con evidencia real via
// CDP: "SyntaxError: Cannot use import statement outside a module" al cargar
// el preload.js que emitia tsc en ESM). La doc oficial de Electron recomienda
// bundlear el preload a CommonJS para este caso exacto; usamos Vite (ya
// presente como devDependency para el renderer) en modo libreria en vez de
// sumar un bundler nuevo.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: path.join(rootDir, "src/preload/preload.ts"),
      formats: ["cjs"],
      // fileName como funcion (no string) para forzar el nombre EXACTO
      // "preload.js" sin el sufijo ".cjs" que Vite le pondria por default
      // dado que package.json tiene "type": "module" (ver Decision 1 del
      // historial). main.ts espera el archivo en esta ruta exacta.
      fileName: () => "preload.js",
    },
    outDir: path.join(rootDir, "dist/src/preload"),
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    rolldownOptions: {
      // "electron" lo resuelve el propio runtime de Electron via su require
      // especial dentro del preload sandboxed; NO debe quedar bundleado.
      external: ["electron"],
    },
  },
});
