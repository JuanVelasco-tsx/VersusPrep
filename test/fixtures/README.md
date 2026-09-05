# Test Fixtures

## VPK de prueba: SINTETICOS, no addons reales

Los tests de integracion del wrapper de `vpk.exe` (tarea 3 del plan) necesitan
archivos `.vpk` reales para ejercitar el ciclo `list -> extract -> pack`,
incluyendo un fixture de **mas de 200 archivos** para confirmar que el batching
por longitud de linea de comando evita el fallo `exit -1`.

**Estos VPK NO deben ser copias de addons reales de la Steam Workshop.**
Redistribuir contenido de otros autores en un repositorio publico y permanente
tiene el mismo problema legal (terminos de la Steam Workshop) que ya se
identifico para el hecho de compartir un `pak01_dir.vpk` fusionado. Por eso:

- Los `.vpk` de prueba se **generan sinteticamente** en cada maquina.
- Los binarios `.vpk` estan **excluidos del repositorio** via `.gitignore`
  (`test/fixtures/**/*.vpk`). El repo versiona el *generador* y este README,
  no los binarios.

## Que contiene un fixture sintetico

Un VPK sintetico es un `.vpk` empaquetado a partir de una carpeta con:

- Archivos **dummy** (contenido de relleno arbitrario, p. ej. bytes o texto
  generado), NO texturas/modelos/scripts reales de ningun mod.
- La **estructura de carpetas y la cantidad de archivos** que el test necesita,
  imitando el layout tipico de un addon (`materials/`, `models/`, etc.) solo en
  forma, no en contenido.
- Para el caso de VScript: rutas `scripts/vscripts/<nombre>.nut` con contenido
  dummy, suficientes para ejercitar la deteccion sin usar scripts reales.

## Como se generan (resumen; implementacion en la tarea 3.1)

Un script/util de test genera, en un directorio temporal ignorado por git:

1. Un fixture **pequeno** (unos pocos archivos) para el ciclo basico
   list/extract/pack.
2. Un fixture **grande** con **> 200 archivos** dummy distribuidos en varias
   subcarpetas, para forzar que el batching parta la extraccion en varios lotes
   y confirmar que no ocurre el `exit -1` observado al pasar cientos de
   argumentos de una vez.
3. Opcionalmente, fixtures con **colisiones deliberadas** (mismo path relativo
   en dos fixtures) para el CollisionResolver, y con rutas `scripts/vscripts/*.nut`
   para el VScriptDetector.

Cada fixture se empaqueta con el propio `vpk.exe` (o el `VpkTool`) hacia
`test/fixtures/vpk/generated/`, que esta en `.gitignore`. Los tests generan los
fixtures si no existen y los usan; nada de esto queda en el repo.

## Si la generacion sintetica no fuera viable

Si por alguna razon tecnica no se pudiera generar un `.vpk` valido de forma
sintetica (formato binario que `vpk.exe` rechace sin ciertos assets), las
opciones acordadas son, en orden:

1. Mantener los fixtures **fuera del repo** y generarlos localmente en cada
   corrida (opcion por defecto ya reflejada en `.gitignore`).
2. Evaluar dejar el repositorio **privado** en vez de publico.

En ningun caso se versionan copias de addons reales de la Workshop.
