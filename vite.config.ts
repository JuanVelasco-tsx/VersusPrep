import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Vite se usa UNICAMENTE para el renderer (React). El proceso main y el
// preload siguen compilando con tsc a dist/src/... (ver tsconfig.json).
// Convencion de carpetas: tsc emite el main en dist/src/main/main.js; el
// renderer buildeado va a dist/renderer/ para que main.ts (en dist/src/main/)
// lo localice en prod con el relativo "../../renderer/index.html".
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, "src/renderer"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.join(rootDir, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
