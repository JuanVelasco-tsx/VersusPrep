/**
 * Copy compartido para "ruta requerida faltante" — extraído de
 * `SettingsPanel.tsx` (README `2d`, Paso 6/8) en el Paso 8/8 para que
 * `FirstLaunchScreen` (README `2e`, Estado 2) lo reuse tal cual, en vez de
 * duplicarlo: ambas pantallas necesitan el mismo mapeo `RequiredPathKey` ->
 * etiqueta/explicación/acción para su respectiva caja roja de "ruta
 * faltante" ("no dupliques esa lógica, reusala", mismo criterio que ya
 * aplicó `SettingsPanel` con `toRequiredPathOptions`).
 *
 * El mock de `2d` solo especifica el texto para `vpkToolPath` (el caso
 * realista: es la única ruta requerida que puede faltar legítimamente
 * DESPUÉS de una detección inicial exitosa, porque las Authoring Tools se
 * instalan aparte). Las otras tres tienen una explicación genérica de
 * respaldo — no inventan contenido de marketing, solo dicen para qué sirve
 * la ruta.
 */
import type { RequiredPathKey } from "../../main/domain/index.js";

// `RequiredPathKey` (tipo de dominio) admite `modsvsFolder`, pero ninguna de
// las dos pantallas la ofrece como banner: la app la CREA, no la verifica
// (ver `settingsDetectionStatus.ts`). Los tres Record de abajo igual
// necesitan una entrada para que el tipo cierre.
export const MISSING_FIELD_LABEL: Record<RequiredPathKey, string> = {
  gameRoot: "la carpeta del juego",
  workshopFolder: "la carpeta de Workshop",
  vpkToolPath: "vpk.exe",
  gameInfoFile: "gameinfo.txt",
  modsvsFolder: "la carpeta modsvs",
};

export const MISSING_FIELD_BODY: Record<RequiredPathKey, string> = {
  gameRoot: "Sin esta carpeta no se puede ubicar el resto de los archivos del juego.",
  workshopFolder: "Sin esta carpeta no se pueden encontrar los addons suscritos.",
  vpkToolPath:
    "Sin esta herramienta no se puede fusionar nada. Viene con las Left 4 Dead 2 Authoring Tools, que se instalan aparte desde Steam.",
  gameInfoFile: "Sin este archivo no se puede activar ningún preset.",
  modsvsFolder: "Acá se instala el VPK fusionado.",
};

/** Carpeta (openDirectory) vs. archivo (openFile) — espeja toRequiredPathOptions (manual-path-provider.ts), sin duplicar su lógica. */
export const MISSING_FIELD_ACTION: Record<RequiredPathKey, string> = {
  gameRoot: "Elegir carpeta",
  workshopFolder: "Elegir carpeta",
  vpkToolPath: "Elegir archivo",
  gameInfoFile: "Elegir archivo",
  modsvsFolder: "Elegir carpeta",
};
