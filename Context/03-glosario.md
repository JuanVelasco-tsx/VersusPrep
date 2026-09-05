# Glosario de Términos del Dominio

Términos específicos del proyecto y del ecosistema de L4D2 / Source Engine que un LLM nuevo debe conocer para entender el contexto sin ambigüedad.

---

## Términos del juego / Source Engine

**L4D2 / Left 4 Dead 2**
Videojuego cooperativo de Valve (2009), corre sobre Source Engine. App ID en Steam: `550`.

**Versus (modo de juego)**
Modo multijugador de L4D2 donde un equipo juega como supervivientes y otro como infectados especiales controlados por jugadores. Tiene restricciones distintas al modo cooperativo normal en cuanto a qué contenido personalizado se carga.

**Addon / Mod**
Contenido personalizado para L4D2 creado por la comunidad. Se distribuye como archivos `.vpk` a través de Steam Workshop. Puede ser cosmético (skins, sonidos) o funcional (scripts).

**VPK (Valve Pak)**
Formato de archivo empaquetado propio de Valve/Source Engine, equivalente a un ZIP para assets del juego. Tiene dos variantes principales:
- **VPK simple:** un solo archivo `.vpk` con directorio y datos internos.
- **VPK multi-archivo:** un archivo `_dir.vpk` que actúa como índice, más archivos de datos `_000.vpk`, `_001.vpk`, etc.

**pak01_dir.vpk / pak01_000.vpk**
Nombres específicos del esquema de VPKs que Source Engine carga como si fueran contenido base del juego. Al nombrar archivos con este esquema en la carpeta correcta, el engine los carga automáticamente al arrancar L4D2.

**Steam Workshop**
Plataforma integrada de Steam donde los usuarios publican y se suscriben a mods. Los addons descargados se guardan en: `<steam_library>/steamapps/workshop/content/550/<addon_id>/`.

**VScript**
Sistema de scripting de Source Engine basado en Squirrel. Los addons que usan VScript (archivos `.nut` en `scripts/vscripts/`) **no tienen efecto en modo Versus** porque ese modo no ejecuta VScripts de addons. Son compatibles solo con modos cooperativos.

**`sv_pure`**
ConVar (variable de configuración) de Source Engine que controla si el servidor permite contenido personalizado. En modo estricto (`sv_pure 2`), el servidor puede expulsar o rechazar a jugadores con addons activos, aunque sean puramente cosméticos. Los servidores oficiales de Valve en L4D2 normalmente no usan el modo más restrictivo.

**Authoring Tools (L4D2)**
Herramientas oficiales de Valve disponibles en Steam para crear contenido para L4D2. Incluyen `vpk.exe`, un ejecutable de línea de comandos para empaquetar y desempaquetar archivos VPK.

**`libraryfolders.vdf`**
Archivo de configuración de Steam (formato KeyValues de Valve) que lista todas las bibliotecas de Steam instaladas en el sistema. Se usa para localizar dónde está instalado L4D2 y su carpeta de Workshop.

**KeyValues (VDF)**
Formato de texto propio de Valve, similar a JSON pero con sintaxis propia, usado en archivos de configuración de Steam y Source Engine (`.vdf`, `.kv`).

**`HKCU\Software\Valve\Steam`**
Clave del registro de Windows donde Steam guarda su ruta de instalación. Usado para localizar Steam automáticamente.

---

## Términos del proyecto

**Fusión de VPKs**
Proceso de combinar el contenido de múltiples VPKs de addons individuales en un único paquete que el juego pueda cargar en Versus. Es el núcleo técnico de la app. (Término adoptado en v2; reemplaza "inyección" usado en v1 — ver `04-historial-decisiones.md`.)

**Filtro anti-VScript**
Funcionalidad de la app que detecta addons que contienen VScripts y los bloquea/advierte al usuario, ya que no tendrían efecto en Versus.

**Resolución de dependencias**
Funcionalidad de la app que detecta si un addon seleccionado requiere otro addon para funcionar correctamente, y lo activa automáticamente.

**Preset / Perfil**
Combinación guardada de addons seleccionados que el usuario puede cargar con un clic. Equivalente a "playlists" en *funky*.

**Sección "Activos"**
Área de la UI que muestra los addons actualmente habilitados/fusionados, y permite agregar o quitar addons puntuales sin rehacer el proceso completo.

**Adición en caliente**
Agregar un nuevo addon al conjunto ya habilitado sin deshabilitar todo y empezar desde cero.

**Tweak de visión de infectado**
Modificación opcional que elimina el filtro visual de color (naranja/azul) que aparece en modo espectador o al esperar para reaparecer como infectado especial.

**Spike técnica**
En el contexto de este proyecto: sesión de investigación enfocada para responder una pregunta técnica específica antes de escribir código de producción (ej: evaluar qué librería VPK usar).

**funky**
Gestor de mods para L4D2 existente (autor: pukmajster), el más completo y activo de los conocidos. Stack: Electron + Svelte + Dexie + Skeleton UI. Referencia principal de comparación para este proyecto.
