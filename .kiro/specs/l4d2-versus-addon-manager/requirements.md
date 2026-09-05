# Requirements Document

## Introduction

El **L4D2 Versus Addon Manager** es una aplicación de escritorio para gestionar addons de la Steam Workshop en *Left 4 Dead 2*, con foco específico en el modo **Versus**. Jugar Versus con addons requiere fusionar manualmente archivos VPK cada vez que se agrega o quita un mod: desempaquetar los VPK, combinar su contenido, reempaquetar el resultado y reinstalarlo. La aplicación automatiza ese flujo completo.

Este documento organiza los requisitos en dos grupos claramente separados:

- **Requisitos principales (Núcleo validado):** detección de rutas, escaneo de la colección, filtro anti-VScript, fusión de VPK, resolución de colisiones, gestión de addons activos y seguridad/backups. Este núcleo ya fue validado end-to-end con datos reales del usuario y constituye el foco prioritario de implementación.
- **Requisitos de Fase Posterior (Nice to have):** favoritos, presets/perfiles, categorías, ordenamiento, buscador, previsualización al hover, tweak de visión de infectado, resolución de dependencias y botón "Jugar". Estos se implementan después del núcleo y se listan de forma separada al final del documento.

El stack técnico es Electron + React o Angular + TypeScript, con `vpk.exe` (Authoring Tools de L4D2) wrappeado vía `child_process`. La plataforma primaria es Windows; Linux y Steam Deck son plataformas secundarias.

## Glossary

- **Manager**: La aplicación de escritorio descrita en este documento (L4D2 Versus Addon Manager).
- **L4D2**: *Left 4 Dead 2*, videojuego de Valve sobre Source Engine. App ID en Steam: `550`.
- **Versus_Mode**: Modo multijugador de L4D2 con supervivientes contra infectados especiales, objetivo funcional principal del Manager.
- **Steam_Path**: Ruta de instalación de Steam, leída del registro de Windows `HKCU\Software\Valve\Steam`, valor `SteamPath`.
- **Library_Folders_File**: Archivo `libraryfolders.vdf` (formato KeyValues de Valve) ubicado en `<Steam_Path>\steamapps\`, que lista todas las bibliotecas de Steam del sistema.
- **Game_Library**: La biblioteca de Steam cuyo bloque `apps` contiene la clave `550`, es decir, la biblioteca donde está instalado L4D2.
- **Game_Root**: Carpeta raíz de instalación de L4D2 derivada de la Game_Library.
- **Workshop_Folder**: Carpeta `addons\workshop\` bajo la instalación de L4D2, donde residen los archivos de addons descargados.
- **Modsvs_Folder**: Carpeta `modsvs\` en la raíz del juego donde el Manager instala el paquete fusionado.
- **GameInfo_File**: Archivo `gameinfo.txt` de L4D2 que define los SearchPaths que el engine carga.
- **VPK_Tool**: Ejecutable `vpk.exe` ubicado en `<Game_Root>\bin\`, usado para listar, extraer y empaquetar contenido VPK.
- **Addon**: Contenido personalizado de L4D2 distribuido como un archivo `<id>.vpk` dentro de la Workshop_Folder.
- **Addon_Cover**: Imagen de portada de un Addon, presente en disco como `<id>.jpg` junto al `<id>.vpk` correspondiente.
- **Addon_Info**: Archivo `addoninfo.txt` contenido dentro de un Addon con metadata del mod.
- **VScript_Addon**: Un Addon que contiene archivos `.nut` bajo el prefijo de path `scripts/vscripts/`, incompatible con Versus_Mode.
- **Merged_Package**: El archivo `pak01_dir.vpk` resultante de fusionar el contenido de los Addons seleccionados.
- **Backup**: Copia de seguridad del `pak01_dir.vpk` existente creada antes de sobrescribirlo.
- **Active_Set**: Conjunto de Addons actualmente fusionados e instalados, gestionado en la sección "Activos".
- **Addon_Manifest**: Registro persistido que identifica cada Addon del Active_Set junto con su Priority_Order, suficiente para reconstruir el Active_Set mediante una fusión completa desde los VPK originales. No registra los archivos individuales que aportó cada Addon.
- **Local_Store**: Base de datos local del Manager donde se persisten el Addon_Manifest y demás estado.
- **Priority_Order**: Orden de prioridad de los Addons definido por el usuario, que determina qué Addon gana ante una colisión de archivos.
- **File_Collision**: Situación en la que dos o más Addons aportan un archivo con el mismo path relativo.
- **Preset_File**: Archivo exportable que contiene únicamente la lista de identificadores de Addon (Workshop IDs) y su Priority_Order asociado. No contiene el Merged_Package ni el contenido de los VPK.
- **Shared_Preset**: Un Preset_File importado desde otro usuario o comunidad, entendido como la "receta" de una combinación de Addons (lista de Workshop IDs + Priority_Order) y no como el contenido fusionado.

---

## Requirements

Esta sección contiene todos los requisitos del Manager, organizados en dos grupos: el **Núcleo Validado** (Requisitos 1 a 9), que constituye el foco prioritario de implementación, y la **Fase Posterior (Nice to Have)** (Requisitos 10 a 20), que se implementa después de que el núcleo esté completo y estable.

### Núcleo Validado

### Requirement 1: Detección automática de rutas de Steam y L4D2

**User Story:** Como jugador, quiero que la aplicación detecte automáticamente dónde está instalado Steam y L4D2, para no tener que configurar rutas manualmente.

#### Acceptance Criteria

1. WHEN el Manager inicia la detección de rutas, THE Manager SHALL leer el valor `SteamPath` de la clave del registro de Windows `HKCU\Software\Valve\Steam`.
2. IF la clave del registro `HKCU\Software\Valve\Steam` o su valor `SteamPath` está ausente, THEN THE Manager SHALL informar al usuario que Steam no está instalado y ofrecer la selección manual del Steam_Path.
3. WHEN el Steam_Path es conocido, THE Manager SHALL leer el archivo Library_Folders_File ubicado en `<Steam_Path>\steamapps\libraryfolders.vdf` interpretándolo como formato KeyValues.
4. IF el Library_Folders_File está ausente, es ilegible o su contenido KeyValues está malformado, THEN THE Manager SHALL informar al usuario del motivo y ofrecer la selección manual del Game_Root.
5. WHEN el Manager procesa el Library_Folders_File, THE Manager SHALL seleccionar como Game_Library la primera biblioteca cuyo bloque `apps` contiene la clave `550` según el orden de aparición en el archivo.
6. IF ninguna biblioteca del Library_Folders_File contiene la clave `550` en su bloque `apps`, THEN THE Manager SHALL informar al usuario que L4D2 no está instalado y ofrecer la selección manual del Game_Root.
7. WHERE la Game_Library reside en un disco distinto al del Steam_Path, THE Manager SHALL usar la ruta de esa biblioteca para derivar las rutas del juego.
8. WHEN la Game_Library es conocida, THE Manager SHALL derivar las rutas del Game_Root, `left4dead2\`, Workshop_Folder (`addons\workshop\`), VPK_Tool (`bin\vpk.exe`), GameInfo_File (`gameinfo.txt`) y Modsvs_Folder (`modsvs\`).
9. WHEN el Manager deriva cada una de las rutas requeridas (Game_Root, Workshop_Folder, VPK_Tool, GameInfo_File y Modsvs_Folder), THE Manager SHALL verificar que cada ruta derivada exista en disco.
10. IF la detección automática de una ruta requerida falla o la ruta derivada no existe en disco, THEN THE Manager SHALL ofrecer al usuario la selección manual de la ruta correspondiente.
11. WHEN el usuario selecciona manualmente una ruta, THE Manager SHALL verificar que esa ruta exista en disco antes de persistirla.
12. IF una ruta seleccionada manualmente no existe en disco, THEN THE Manager SHALL informar al usuario y solicitar nuevamente la selección de esa ruta.
13. WHEN el usuario confirma una ruta mediante selección manual y esa ruta existe en disco, THE Manager SHALL persistir esa ruta en el Local_Store para usos posteriores.

### Requirement 2: Escaneo de la colección de la Workshop

**User Story:** Como jugador, quiero ver la lista de addons que ya tengo descargados, para elegir cuáles activar en Versus.

#### Acceptance Criteria

1. WHEN el Manager escanea la Workshop_Folder, THE Manager SHALL incluir únicamente los archivos con extensión `.vpk` ubicados directamente en esa carpeta.
2. WHILE escanea la Workshop_Folder, THE Manager SHALL ignorar los subdirectorios residuales que no correspondan a archivos `<id>.vpk`.
3. WHEN el Manager identifica un archivo `<id>.vpk`, THE Manager SHALL tratarlo como un Addon con identificador `<id>`.
4. WHEN el Manager registra un Addon, THE Manager SHALL asociar como Addon_Cover el archivo `<id>.jpg` presente en la misma carpeta que el `<id>.vpk`.
5. WHERE existe un Addon_Info dentro del Addon, THE Manager SHALL leer la metadata del Addon_Info para mostrar información del Addon.
6. WHEN el escaneo finaliza, THE Manager SHALL presentar la lista de Addons detectados con su Addon_Cover asociado.

### Requirement 3: Filtro anti-VScript

**User Story:** Como jugador de Versus, quiero que la aplicación me impida activar addons con VScript, para no perder tiempo con mods que no tienen efecto en Versus.

#### Acceptance Criteria

1. WHEN el Manager evalúa la compatibilidad de un Addon con Versus_Mode, THE Manager SHALL inspeccionar el listado de contenido obtenido mediante `vpk l` sobre el `<id>.vpk`.
2. WHEN el listado de contenido de un Addon incluye al menos un path cuyo prefijo coincide con `scripts/vscripts/` de forma insensible a mayúsculas y minúsculas y cuya extensión coincide con `.nut` de forma insensible a mayúsculas y minúsculas, THE Manager SHALL clasificar el Addon como VScript_Addon.
3. WHEN el listado de contenido de un Addon incluye archivos con extensión `.nut` que no están bajo el prefijo `scripts/vscripts/`, THE Manager SHALL excluir esos archivos del criterio de clasificación como VScript_Addon.
4. THE Manager SHALL determinar la clasificación como VScript_Addon a partir del listado real de contenido del VPK, sin usar el flag `addonContent_Script` del Addon_Info como criterio.
5. IF la ejecución de `vpk l` sobre un Addon falla o devuelve un código de salida distinto de éxito, THEN THE Manager SHALL informar al usuario que la compatibilidad de ese Addon no pudo determinarse y clasificar ese Addon como VScript_Addon por precaución.
6. WHEN un Addon está clasificado como VScript_Addon, THE Manager SHALL advertir al usuario que ese Addon es incompatible con Versus_Mode.
7. IF el usuario intenta incluir un VScript_Addon en el Active_Set, THEN THE Manager SHALL bloquear la inclusión por defecto.
8. WHERE el usuario otorga una confirmación explícita para forzar la inclusión de un VScript_Addon, THE Manager SHALL incorporar ese Addon al Active_Set.

### Requirement 4: Precondición de seguridad antes de modificar archivos

**User Story:** Como jugador, quiero que la aplicación verifique que el juego esté cerrado antes de tocar sus archivos, para evitar corromper la instalación.

#### Acceptance Criteria

1. WHEN el usuario solicita una operación de fusión o instalación, THE Manager SHALL verificar que el proceso `left4dead2.exe` no esté en ejecución antes de continuar.
2. IF el proceso `left4dead2.exe` está en ejecución al iniciar una operación de fusión o instalación, THEN THE Manager SHALL abortar la operación e informar al usuario que debe cerrar el juego.

### Requirement 5: Backup automático antes de sobrescribir

**User Story:** Como jugador, quiero que la aplicación respalde mi paquete actual antes de modificarlo, para poder revertir cambios si algo sale mal.

> Nota (trade-off aceptado para el MVP): el Manager mantiene un único nivel de Backup, por lo que el Backup previo se sobrescribe. Dos operaciones fallidas consecutivas pueden dejar sin acceso a la última versión buena; se acepta esta limitación de forma consciente para el MVP.

#### Acceptance Criteria

1. WHEN el Manager va a sobrescribir el Merged_Package existente en la Modsvs_Folder, THE Manager SHALL crear un Backup del `pak01_dir.vpk` actual antes de modificarlo.
2. IF la creación del Backup falla, THEN THE Manager SHALL abortar la operación de fusión e informar al usuario del motivo.
3. WHEN el Manager crea un Backup y ya existe un Backup previo, THE Manager SHALL sobrescribir el Backup previo, manteniendo un único nivel de Backup.

### Requirement 6: Fusión e instalación del paquete de addons

**User Story:** Como jugador, quiero seleccionar varios addons y activarlos en Versus con una sola acción, para no fusionar los VPK manualmente cada vez.

#### Acceptance Criteria

1. WHEN el usuario confirma la fusión de un conjunto de Addons seleccionados, THE Manager SHALL ejecutar `vpk l` sobre cada Addon para obtener su listado de contenido.
2. WHEN el Manager procesa la salida de la VPK_Tool, THE Manager SHALL descartar las líneas de la salida estándar que comiencen con `CDynamicFunction:`, `FS:` o `Using`.
3. WHEN el Manager va a extraer el contenido de un Addon, THE Manager SHALL crear los subdirectorios de destino antes de invocar la extracción.
4. WHEN el Manager extrae archivos de un Addon con `vpk x`, THE Manager SHALL agrupar los archivos en lotes tales que la longitud total de la línea de comando de cada invocación (ejecutable, VPK y todos los paths de archivo) no exceda un límite seguro por debajo del máximo de línea de comando de Windows.
5. IF un único path de archivo por sí solo excede el límite seguro de longitud de línea de comando, THEN THE Manager SHALL extraer ese archivo en una invocación individual.
6. WHEN el Manager construye paths de destino en disco, THE Manager SHALL usar el separador `\`, y WHEN interpreta paths internos del VPK, THE Manager SHALL usar el separador `/`.
7. WHEN el contenido de todos los Addons seleccionados ha sido extraído, THE Manager SHALL combinar ese contenido en una única carpeta `pak01_dir`.
8. WHEN la carpeta `pak01_dir` está completa, THE Manager SHALL empaquetarla con la VPK_Tool para generar el Merged_Package `pak01_dir.vpk`.
9. WHEN el Merged_Package ha sido generado, THE Manager SHALL instalarlo en la Modsvs_Folder del Game_Root.
10. WHEN el GameInfo_File no incluye `Game modsvs` como primer SearchPath, THE Manager SHALL insertar `Game modsvs` como primer SearchPath del GameInfo_File.
11. WHEN la operación de fusión e instalación finaliza, THE Manager SHALL notificar al usuario el resultado de la operación.
12. IF la extracción de un Addon devuelve un código de salida distinto de éxito, THEN THE Manager SHALL abortar la operación e informar al usuario del Addon que falló.

### Requirement 7: Resolución de colisiones de archivos

**User Story:** Como jugador, quiero controlar qué addon prevalece cuando dos aportan el mismo archivo, para obtener el resultado visual que espero.

#### Acceptance Criteria

1. WHEN dos o más Addons seleccionados aportan un archivo con el mismo path relativo, THE Manager SHALL identificar la situación como una File_Collision.
2. WHEN se resuelve una File_Collision, THE Manager SHALL conservar el archivo aportado por el Addon que aparece en último lugar según el Priority_Order del usuario.
3. THE Manager SHALL permitir al usuario definir el Priority_Order de los Addons seleccionados antes de la fusión.

### Requirement 8: Gestión de addons activos (adición y quita en caliente)

**User Story:** Como jugador, quiero agregar o quitar un addon del conjunto activo sin rehacer todo el proceso, para ajustar mi configuración rápidamente.

#### Acceptance Criteria

1. WHEN el Manager instala un Merged_Package, THE Manager SHALL persistir en el Local_Store un Addon_Manifest que registre, por cada Addon del Active_Set, su identificador y su Priority_Order.
2. THE Manager SHALL mostrar en la sección "Activos" el Active_Set actualmente instalado.
3. WHEN el usuario agrega un Addon al Active_Set, THE Manager SHALL re-generar el Merged_Package fusionando el Active_Set completo resultante desde los VPK originales de esos Addons, mediante una fusión completa desde cero.
4. WHEN el usuario quita un Addon del Active_Set, THE Manager SHALL re-generar el Merged_Package fusionando únicamente los Addons restantes desde sus VPK originales, mediante una fusión completa desde cero.
5. WHEN el usuario agrega o quita un Addon del Active_Set, THE Manager SHALL ejecutar el mismo procedimiento de fusión completa definido en el Requirement 6, sin aplicar operaciones incrementales sobre el Merged_Package existente.
6. WHEN el Active_Set cambia, THE Manager SHALL actualizar el Addon_Manifest persistido en el Local_Store para reflejar el nuevo conjunto de Addons y su Priority_Order.

### Requirement 9: Avisos de confianza y seguridad al usuario

**User Story:** Como jugador nuevo en la herramienta, quiero entender los riesgos y advertencias relevantes, para usar la aplicación con confianza.

#### Acceptance Criteria

1. THE Manager SHALL mostrar un aviso sobre `sv_pure` indicando que los servidores comunitarios estrictos pueden expulsar a jugadores con contenido personalizado activo.
2. WHERE la escritura en la Modsvs_Folder o el GameInfo_File requiere permisos elevados, THE Manager SHALL informar al usuario que la operación puede requerir permisos de administrador.
3. THE Manager SHALL mostrar un disclaimer indicando que es un proyecto fan-made no afiliado a Valve.
4. THE distribución del Manager SHALL documentar que el ejecutable no está firmado digitalmente y que Windows SmartScreen puede mostrar una advertencia al ejecutarlo.
5. THE Manager SHALL mostrar un aviso indicando que, si Steam verifica la integridad de los archivos del juego, puede revertir los cambios del Manager sin avisar.

---

### Fase Posterior (Nice to Have)

> Los siguientes requisitos NO forman parte del núcleo prioritario. Se implementan después de que el núcleo validado (Requisitos 1 a 9) esté completo y estable. Se listan aquí para dejar constancia del scope planificado.

### Requirement 10: Resolución automática de dependencias

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero que la aplicación active automáticamente los addons de los que depende un addon seleccionado, para evitar configuraciones incompletas.

> Nota: la fuente de datos de dependencias es un pendiente abierto (P-05) y debe resolverse antes de implementar este requisito.

#### Acceptance Criteria

1. WHEN el usuario selecciona un Addon que requiere otro Addon según la fuente de datos de dependencias, THE Manager SHALL marcar automáticamente el Addon requerido para su inclusión.
2. IF un Addon requerido no está presente en la colección local, THEN THE Manager SHALL informar al usuario del Addon faltante.

### Requirement 11: Favoritos

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero marcar addons como favoritos, para encontrarlos rápido.

#### Acceptance Criteria

1. WHEN el usuario marca un Addon como favorito, THE Manager SHALL persistir esa marca en el Local_Store.
2. THE Manager SHALL ofrecer una vista que muestre únicamente los Addons marcados como favoritos.

### Requirement 12: Presets y perfiles

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero guardar combinaciones de addons como perfiles y poder exportarlas e importarlas como archivo, para cargarlas con un clic y compartir mis combinaciones con amigos y comunidades.

> Nota: un Preset_File exportado contiene únicamente la lista de Workshop IDs y su Priority_Order (la "receta"), nunca el Merged_Package ni el contenido de los VPK. Esta decisión es deliberada por motivos legales (la redistribución de contenido fusionado quedaría fuera del sistema de suscripción de Steam Workshop y de sus términos) y prácticos (el paquete fusionado es de gran tamaño y queda desactualizado).

#### Acceptance Criteria

1. WHEN el usuario guarda un preset, THE Manager SHALL persistir en el Local_Store la combinación de Addons seleccionados con un nombre.
2. WHEN el usuario carga un preset guardado, THE Manager SHALL establecer el conjunto de Addons seleccionados según ese preset.
3. WHEN el usuario exporta el preset actual a un archivo, THE Manager SHALL generar un Preset_File que contenga únicamente la lista de identificadores de Addon (Workshop IDs) y su Priority_Order.
4. WHEN el usuario exporta un preset a un archivo, THE Manager SHALL excluir del Preset_File el Merged_Package y el contenido de los VPK.
5. WHEN el usuario importa un preset desde un archivo, THE Manager SHALL leer del Preset_File la lista de identificadores de Addon (Workshop IDs) y su Priority_Order.
6. IF el archivo seleccionado para importar no es un Preset_File válido o su contenido está malformado, THEN THE Manager SHALL informar al usuario del motivo y no modificar el conjunto de Addons seleccionados.

### Requirement 13: Categorías, ordenamiento y búsqueda

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador con muchos addons, quiero organizar y filtrar la lista, para navegarla con facilidad.

#### Acceptance Criteria

1. THE Manager SHALL permitir asignar y filtrar Addons por categoría.
2. THE Manager SHALL permitir ordenar la lista de Addons por fecha.
3. WHEN el usuario ingresa un término de búsqueda por nombre o identificador, THE Manager SHALL mostrar únicamente los Addons que coincidan con ese término.

### Requirement 14: Previsualización al hover

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero ver la portada y descripción de un addon al pasar el cursor, para identificarlo sin abrir un detalle.

#### Acceptance Criteria

1. WHEN el usuario posiciona el cursor sobre un Addon en la lista, THE Manager SHALL mostrar su Addon_Cover y su descripción.

### Requirement 15: Tweak de visión de infectado

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero eliminar el filtro visual de visión de infectado, para tener una vista más limpia en modo espectador.

#### Acceptance Criteria

1. WHERE el usuario habilita el tweak de visión de infectado, THE Manager SHALL aplicar la modificación que elimina el filtro visual de color en modo espectador.
2. WHERE el usuario deshabilita el tweak de visión de infectado, THE Manager SHALL revertir la modificación aplicada.

### Requirement 16: Botón "Jugar"

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero lanzar L4D2 desde la aplicación, para no cambiar de ventana.

#### Acceptance Criteria

1. WHEN el usuario activa el botón "Jugar", THE Manager SHALL lanzar L4D2.

### Requirement 17: Detección activa de reversión por verificación de Steam

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero que la aplicación detecte por sí misma cuando una verificación de integridad de Steam revirtió los cambios del Manager, para poder re-aplicar la fusión sin tener que darme cuenta manualmente de que mis addons dejaron de aplicarse.

> Nota: la detección automática de una verificación de integridad de Steam es compleja; el aviso pasivo del escenario está cubierto por el Requirement 9 y este requisito cubre únicamente la detección activa.

#### Acceptance Criteria

1. WHEN el Manager inicia con un Active_Set registrado y detecta que el Merged_Package instalado o la entrada `Game modsvs` del GameInfo_File fueron revertidos o faltan, THE Manager SHALL informar al usuario que los cambios del Manager fueron revertidos.
2. WHERE el Manager detecta que los cambios del Manager fueron revertidos, THE Manager SHALL ofrecer al usuario re-aplicar la fusión del Active_Set registrado.

### Requirement 18: Sincronía con actualizaciones de la Workshop

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero que la aplicación detecte cuando un addon ya fusionado se actualizó en la Workshop, para no quedarme con una versión vieja dentro del Merged_Package.

#### Acceptance Criteria

1. WHEN el Manager detecta que el VPK de origen de un Addon del Active_Set cambió respecto de lo registrado, comparando su timestamp o su hash, THE Manager SHALL avisar al usuario que ese Addon fue actualizado.
2. WHERE un Addon del Active_Set fue actualizado en la Workshop, THE Manager SHALL ofrecer al usuario re-generar el Merged_Package con la versión actualizada.

### Requirement 19: Cache de miniaturas de portadas

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador con cientos de addons, quiero que las portadas se muestren con fluidez, para navegar la colección sin demoras de renderizado.

> Nota: las Addon_Cover ya existen en disco como `<id>.jpg` y el núcleo las lee directamente (cubierto por el Requirement 2). Este requisito cubre únicamente la optimización de cache y redimensionado, no la carga básica de las portadas.

#### Acceptance Criteria

1. WHEN el Manager renderiza la lista de Addons, THE Manager SHALL usar versiones redimensionadas y cacheadas de las Addon_Cover para acelerar el renderizado.
2. WHEN el Manager genera una versión redimensionada de una Addon_Cover, THE Manager SHALL persistir esa versión en un cache local para reutilizarla en renderizados posteriores.

### Requirement 20: Importación y verificación de addons faltantes de un preset compartido

> **Fase Posterior (Nice to Have)**

**User Story:** Como jugador, quiero que al importar un preset compartido la aplicación me diga qué addons ya tengo y cuáles me faltan, para conseguir los que falten antes de aplicar el preset.

#### Acceptance Criteria

1. WHEN el usuario importa un Shared_Preset, THE Manager SHALL comparar los Workshop IDs del Preset_File contra los Addons actualmente presentes en la Workshop_Folder, clasificando cada Addon del preset como presente o faltante.
2. WHEN el Manager termina de comparar un Shared_Preset con la Workshop_Folder, THE Manager SHALL informar al usuario cuáles Addons del preset están presentes y cuáles Addons del preset faltan.
3. WHERE sea posible, THE Manager SHALL ofrecer para cada Addon faltante un enlace a su página de Steam Workshop construido a partir de su Workshop ID.
4. THE Manager SHALL requerir una confirmación explícita del usuario antes de aplicar un Shared_Preset importado, sin descargar ni fusionar los Addons del preset de forma automática.
5. IF un Shared_Preset importado no contiene ningún Addon presente localmente, THEN THE Manager SHALL informar al usuario esa situación y no iniciar ninguna fusión.
