/**
 * Convención compartida del Addon_Cover (Requirement 2, AC 2.4; Tarea 21.1
 * Bloque 1). Extraída como módulo propio (no vive dentro de `addon-scanner.ts`
 * ni de `cover-resolver.ts`) para que NINGUNO de los dos dependa del otro:
 * `addon-scanner.ts` (Sección 6, escaneo) decide si un addon TIENE portada
 * (`coverPath !== null`), y `cover-resolver.ts` (Sección 21, protocolo
 * `l4d2cover://`) decide QUÉ archivo servir para un `<id>` dado - ambos deben
 * coincidir en la extensión, o un cambio de formato futuro (p. ej. a `.png`)
 * actualizado en un solo lugar rompería el otro en silencio (404 en todas las
 * portadas pese a que el scanner las reporta como presentes).
 */

/** Extensión (con punto) del archivo de portada de un Addon. */
export const COVER_EXTENSION = ".jpg";
