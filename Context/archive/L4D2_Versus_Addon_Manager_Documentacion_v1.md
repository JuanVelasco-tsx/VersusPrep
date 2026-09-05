# Documentación de Proyecto: Gestor de Addons para L4D2 Versus

## 1. Contextualización y Problema a Resolver
En *Left 4 Dead 2* (L4D2), jugar en el modo **Versus** con *addons* (mods) activos requiere un proceso manual largo y tedioso debido a las restricciones del propio juego. El método clásico obliga al usuario a:
1. Desempaquetar los archivos `.vpk` de la Workshop.
2. Copiar archivos manualmente.
3. Juntar todo en un nuevo archivo `.vpk`.
4. Probar si funciona.
5. Repetir todo el proceso (deshacer y reconstruir) cada vez que se desea agregar o quitar un solo *addon*.

**La Solución:** Una herramienta de escritorio automatizada que unifica, gestiona y habilita/deshabilita estos *addons* con unos pocos clics, eludiendo la necesidad de empaquetar manualmente los `.vpk`.

---

## 2. Características y Funcionalidades Principales

### 2.1. Carga y Detección Automática
* **Detección de Workshop:** Al abrir el programa, este detecta automáticamente todos los *addons* descargados en la carpeta de la Workshop de Steam del usuario.
* **Carga Inicial:** Carga toda la colección en una lista. (Nota de rendimiento: Puede tardar unos segundos extra si la PC es de bajos recursos y hay una cantidad masiva de *addons*).

### 2.2. Interfaz de Usuario (UI) y Exploración
* **Previsualización Rápida:** Al pasar el cursor sobre un *addon* en la lista, se muestra su imagen de portada y su descripción original de la Workshop, evitando tener que buscarlo en Steam para saber qué es.
* **Scroll Nativo:** Navegación sencilla deslizando a través de toda la colección.
* **Lanzador Integrado:** Cuenta con un botón de "Jugar" para iniciar L4D2 directamente desde la interfaz del programa.

### 2.3. Lógica de Selección y Validación de Mods
* **Checkboxes:** Selección individual o múltiple mediante casillas. Botón global para "Desmarcar todos".
* **Filtro Anti-VScript:** La herramienta detecta qué mods utilizan `VScript` (los cuales no tienen efecto en modo Versus) y bloquea su selección, avisando al usuario que no son compatibles.
* **Resolución de Dependencias:** Si el usuario selecciona un *addon* que requiere obligatoriamente otro mod para funcionar, el programa detecta esta dependencia y marca automáticamente los *addons* necesarios.

### 2.4. Proceso de Habilitación (Core del Sistema)
* **Confirmación Previa:** Al hacer clic en "Habilitar seleccionados", el sistema pide confirmación y muestra una previsualización en miniatura de todo lo que se va a activar.
* **Procesamiento Automático:** El programa realiza la inyección/preparación de los archivos en el *background* sin necesidad de copiar uno por uno ni reconstruir el `.vpk` manualmente. Finaliza con una notificación de éxito.

### 2.5. Gestión de Addons Activos ("Sección Activos")
* **Independencia de Estado:** Permite quitar *addons* específicos que ya están activos sin tener que deshabilitar y reconstruir todo el paquete.
* **Adición en Caliente:** Si el usuario quiere agregar un mod nuevo a los que ya están habilitados, simplemente lo selecciona en la lista general y el programa lo suma al paquete activo sin repetir el proceso completo.

### 2.6. Organización y Filtrado
* **Categorías:** Agrupación de mods por categorías para mantener colecciones grandes ordenadas (ej. Armas, Personajes, etc.).
* **Sistema de Favoritos:** Ícono de estrella para marcar *addons* preferidos. Existe una pestaña exclusiva de "Favoritos" para acceder a ellos rápidamente.
* **Ordenamiento (Sorting):** Opción para ordenar la lista por fecha de descarga (de más nuevos a más antiguos o viceversa).
* **Buscador (Searchbar):** Barra de búsqueda instantánea que filtra por palabra completa, parte del nombre o número/ID del *addon*.

### 2.7. Sistema de "Presets" (Perfiles)
* **Creación de Presets:** Permite guardar una combinación exacta de mods seleccionados (ej. "Mis mods de armas", "Skins de Supervivientes").
* **Uso Rápido:** Con un solo clic en "Usar", se cargan y conectan automáticamente todos los mods de ese perfil, ideal para cambiar rápidamente el entorno visual del juego según la partida.

### 2.8. Funciones Extras (Modificaciones al Juego)
* **Eliminar Visión de Infectado:** Un *tweak* opcional que elimina el filtro visual de color naranja/azul que aparece cuando el jugador está en modo fantasma o esperando para reaparecer como infectado especial. Cambia el renderizado para que se vea claro, similar a la visión de un superviviente.

---

## 3. Consideraciones Técnicas y Advertencias de Uso
Para que cualquier desarrollador o usuario tenga en cuenta al utilizar o modificar la herramienta:
1. **Estado del Juego:** Es estrictamente necesario que *Left 4 Dead 2* esté **completamente cerrado** antes de aplicar, agregar o quitar cualquier *addon* desde la herramienta.
2. **Falso Positivo de Windows:** Al ejecutarse, Windows Defender o SmartScreen pueden lanzar una advertencia de seguridad. Esto ocurre puramente porque el archivo ejecutable (`.exe`) no cuenta con una firma digital de pago (Certificado EV/Code Signing), no porque sea software malicioso.
3. **Resolución de Bugs Clásicos:** La automatización de la herramienta previene errores comunes del método manual, como que las armas o personajes se vuelvan invisibles al entrar a una partida.
