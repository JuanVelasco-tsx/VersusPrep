import { describe, expect, test } from "vitest";

import {
  L4D2_APP_ID,
  findGameLibrary,
  parseLibraryFolders,
} from "../src/main/domain/index.js";

/**
 * Tests unitarios mínimos de la Tarea 5.1 (parseo de `libraryfolders.vdf` y
 * `findGameLibrary`, AC 1.3 / AC 1.5 / AC 1.6).
 *
 * NOTA: esto NO es el property test de la tarea 5.2 (Property 1). Son ejemplos
 * representativos que fijan el comportamiento del parser KeyValues y la política
 * de selección "primera biblioteca con 550 en orden de aparición".
 */

// ---------------------------------------------------------------------------
// parseLibraryFolders — parser KeyValues de Valve
// ---------------------------------------------------------------------------

describe("parseLibraryFolders: parseo KeyValues (AC 1.3)", () => {
  test("estructura real confirmada: extrae path y AppIDs en orden", () => {
    const vdf = `
"libraryfolders"
{
    "0"
    {
        "path"    "C:\\\\Program Files (x86)\\\\Steam"
        "apps"
        {
            "228980"  "123456"
            "550"     "789012"
        }
    }
    "1"
    {
        "path"    "D:\\\\SteamLibrary"
        "apps"
        {
            "620"  "111"
        }
    }
}
`;
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([
      { path: "C:\\Program Files (x86)\\Steam", apps: ["228980", "550"] },
      { path: "D:\\SteamLibrary", apps: ["620"] },
    ]);
  });

  test("tolera indentación/espacios/tabs arbitrarios y `apps` inline", () => {
    const vdf =
      '"libraryfolders"{ "0" {\t"path"\t"E:\\\\Lib"   "apps"  { "550" "1" "222" "2" } } }';
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "E:\\Lib", apps: ["550", "222"] }]);
  });

  test("soporta saltos de línea \\r\\n (Windows)", () => {
    const vdf =
      '"libraryfolders"\r\n{\r\n\t"0"\r\n\t{\r\n\t\t"path"\t"F:\\\\S"\r\n\t\t"apps"\r\n\t\t{\r\n\t\t\t"550"\t"9"\r\n\t\t}\r\n\t}\r\n}\r\n';
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "F:\\S", apps: ["550"] }]);
  });

  test("descarta comentarios `//` fuera de comillas (decisión 1)", () => {
    const vdf = `
"libraryfolders"
{
    // esta es la biblioteca principal
    "0"
    {
        "path"    "C:\\\\Steam"   // ruta de instalacion
        "apps"
        {
            "550"  "1" // L4D2
        }
    }
}
`;
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "C:\\Steam", apps: ["550"] }]);
  });

  test("un `//` dentro de comillas NO inicia comentario", () => {
    const vdf = '"libraryfolders" { "0" { "path" "http://x//y" "apps" { } } }';
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "http://x//y", apps: [] }]);
  });

  test("contenido vacío o sin bibliotecas produce []", () => {
    expect(parseLibraryFolders("")).toEqual([]);
    expect(parseLibraryFolders('"libraryfolders" { }')).toEqual([]);
  });

  test("biblioteca sin `apps` produce apps=[] (decisión 6)", () => {
    const vdf = '"libraryfolders" { "0" { "path" "C:\\\\Steam" } }';
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "C:\\Steam", apps: [] }]);
  });
});

// ---------------------------------------------------------------------------
// findGameLibrary — primera biblioteca con 550 en orden de aparición
// ---------------------------------------------------------------------------

describe("findGameLibrary: primera lib con 550 en orden (AC 1.5, 1.6)", () => {
  test("caso: 0 bibliotecas con 550 devuelve null (AC 1.6)", () => {
    const entries = parseLibraryFolders(`
"libraryfolders"
{
    "0" { "path" "C:\\\\Steam" "apps" { "228980" "1" } }
    "1" { "path" "D:\\\\Lib"   "apps" { "620" "2" "570" "3" } }
}
`);
    expect(findGameLibrary(entries)).toBeNull();
  });

  test("caso: varias con 550, gana la primera en orden de aparición (AC 1.5)", () => {
    const entries = parseLibraryFolders(`
"libraryfolders"
{
    "0" { "path" "C:\\\\Steam"      "apps" { "228980" "1" } }
    "1" { "path" "D:\\\\SteamLib"   "apps" { "550" "2" } }
    "2" { "path" "E:\\\\OtherLib"   "apps" { "550" "3" } }
}
`);
    // Gana "D:\SteamLib" (primera con 550), no "E:\OtherLib".
    expect(findGameLibrary(entries)).toBe("D:\\SteamLib");
  });

  test("caso: L4D2 en biblioteca de otro disco (AC 1.7) — devuelve ese path", () => {
    const entries = parseLibraryFolders(`
"libraryfolders"
{
    "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" "apps" { "440" "1" } }
    "1" { "path" "G:\\\\Games\\\\SteamLibrary"        "apps" { "550" "2" } }
}
`);
    expect(findGameLibrary(entries)).toBe("G:\\Games\\SteamLibrary");
  });

  test("caso: única biblioteca con 550 devuelve su path", () => {
    const entries = parseLibraryFolders(
      '"libraryfolders" { "0" { "path" "C:\\\\Steam" "apps" { "550" "1" } } }',
    );
    expect(findGameLibrary(entries)).toBe("C:\\Steam");
  });

  test("lista vacía de entradas devuelve null", () => {
    expect(findGameLibrary([])).toBeNull();
  });

  test("L4D2_APP_ID es el literal '550'", () => {
    expect(L4D2_APP_ID).toBe("550");
  });
});
