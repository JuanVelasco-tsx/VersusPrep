import { defineConfig } from "vitest/config";

/**
 * Configuración de Vitest para el núcleo del proceso main (agnóstico de UI).
 *
 * - `environment: "node"`: el núcleo main corre sobre Node/Electron-main y no
 *   necesita DOM. La capa renderer (tarea 21) podrá añadir su propia config si
 *   requiere jsdom.
 * - `include`: cubre tanto los tests colocados junto al código (`src/**\/*.test.ts`)
 *   como los tests centralizados en `test/`.
 * - Se excluyen los helpers y fixtures para que no se interpreten como suites.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "test/fixtures/**", "test/helpers/**"],
  },
});
