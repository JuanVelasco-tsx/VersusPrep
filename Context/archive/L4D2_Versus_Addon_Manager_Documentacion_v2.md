# Documentación de Proyecto: Gestor de Addons para L4D2 Versus (v2)

## 1. Contextualización y Problema a Resolver

En *Left 4 Dead 2* (L4D2), jugar en modo **Versus** con *addons* (mods) activos requiere un proceso manual, largo y tedioso, debido a las restricciones del propio juego para cargar varios mods de forma simultánea. El método clásico obliga al usuario a:

1. Desempaquetar los archivos `.vpk` de la Workshop.
2. Copiar archivos manualmente.
3. Fusionar todo en un nuevo archivo `.vpk` (o renombrar los vpks como `pak01_dir.vpk`, `pak01_000.vpk`, etc., para que el juego los cargue como si fueran parte del contenido base).
4. Probar si funciona.
5. Repetir todo el proceso (deshacer y reconstruir) cada vez que se agrega o quita un solo *addon*.

**La solución:** una herramienta de escritorio automatizada que unifica, gestiona y habilita/deshabilita estos *addons* con pocos clics, eliminando la necesidad de empaquetar manualmente los `.vpk`.

---

## 2. Análisis de la competencia

Antes de escribir la primera línea de código, vale la pena tener claro el panorama: **ya existen gestores de mods para L4D2.**

- **funky** (pukmajster) — el más completo y activo. Stack: Electron + Svelte + Dexie + Skeleton UI. Funciona en Windows, Linux y Steam Deck. Features: grid con miniaturas, búsqueda/filtros, categorización automática, menú de resolución de conflictos (muestra qué mods chocan y por qué), "playlists" (perfiles), modo "shuffle", selección por lotes, des-suscripción vía Steam Web API.
- **L4D2ModManager** (xavier-cai) — alternativa más simple, mencionada en foros de Steam como funcional.

**Lo que ninguno de los dos cubre explícitamente (tu oportunidad real):**

- Compatibilidad específica con **Versus**: ningún README menciona filtrar o advertir sobre mods que usan `VScript` (que no tienen efecto en ese modo).
- **Resolución automática de dependencias** entre addons (distinto a detectar conflictos: un conflicto es "estos dos chocan", una dependencia es "este necesita a aquel para funcionar").
- El problema técnico central que tú describes en la sección 1 — que Versus limita cuántos mods de un mismo tipo se cargan a la vez y por eso hay que fusionar vpks — no aparece resuelto de forma explícita en la documentación de funky. Sus propios "Caveats" reconocen que el flujo sigue siendo incómodo: hay que abrir el juego para que descargue el mod nuevo, cerrarlo, gestionar en la app, y volver a abrir desde ahí.

**Conclusión:** no estás reinventando la rueda. Estás llenando un hueco específico (Versus + VScript + dependencias) que un proyecto más grande y pulido dejó sin cubrir. Vale la pena mantener ese ángulo como eje central del producto en vez de intentar competir en todo lo que funky ya hace bien (shuffle, playlists, etc. son "nice to have", no tu diferenciador).

---

## 3. Características y Funcionalidades Principales

### 3.1. Carga y Detección Automática
- **Detección de Workshop:** al abrir el programa, detecta automáticamente todos los *addons* descargados en la carpeta de Workshop de Steam del usuario.
- **Carga inicial:** carga toda la colección en una lista (puede tardar unos segundos extra en equipos de bajos recursos con una cantidad masiva de *addons*).

### 3.2. Interfaz de Usuario y Exploración
- **Previsualización rápida:** al pasar el cursor sobre un *addon*, se muestra su imagen de portada y descripción original de la Workshop.
- **Scroll nativo** para navegar toda la colección.
- **Lanzador integrado:** botón de "Jugar" para iniciar L4D2 directamente desde la interfaz.

### 3.3. Lógica de Selección y Validación de Mods
- **Checkboxes:** selección individual o múltiple, con botón global de "Desmarcar todos".
- **Filtro anti-VScript:** detecta qué mods usan `VScript` (sin efecto en Versus) y bloquea su selección, avisando al usuario. *(Diferenciador frente a la competencia — ver sección 2.)*
- **Resolución de dependencias:** si un *addon* seleccionado requiere otro mod para funcionar, el programa lo detecta y lo marca automáticamente. *(Diferenciador frente a la competencia.)*

### 3.4. Proceso de Habilitación (núcleo del sistema)
- **Confirmación previa:** al hacer clic en "Habilitar seleccionados", el sistema pide confirmación y muestra una previsualización en miniatura de lo que se va a activar.
- **Procesamiento automático:** la fusión/preparación de archivos ocurre en segundo plano, sin copiar uno por uno ni reconstruir el `.vpk` a mano. Termina con notificación de éxito.

### 3.5. Gestión de Addons Activos ("Sección Activos")
- **Independencia de estado:** permite quitar *addons* activos puntuales sin deshabilitar y reconstruir todo el paquete.
- **Adición en caliente:** si se agrega un mod nuevo a los ya habilitados, el programa lo suma al paquete activo sin repetir el proceso completo.

### 3.6. Organización y Filtrado
- **Categorías** para mantener colecciones grandes ordenadas (armas, personajes, etc.).
- **Favoritos** con ícono de estrella y pestaña exclusiva.
- **Ordenamiento** por fecha de descarga (ascendente/descendente).
- **Buscador** instantáneo por nombre completo, parcial o ID del *addon*.

### 3.7. Sistema de "Presets" (Perfiles)
- **Creación de presets:** guardar una combinación exacta de mods seleccionados (ej. "Mods de armas", "Skins de Supervivientes").
- **Uso rápido:** un clic en "Usar" carga y conecta automáticamente todos los mods del perfil.

### 3.8. Funciones Extras
- **Eliminar visión de infectado:** tweak opcional que quita el filtro de color naranja/azul de la visión de fantasma/espera para reaparecer como infectado especial, dejándola similar a la de un superviviente.

---

## 4. Consideraciones Técnicas, Riesgos y Advertencias

### Ya identificadas en la v1
1. **Estado del juego:** L4D2 debe estar completamente cerrado antes de aplicar, agregar o quitar cualquier *addon*.
2. **Falso positivo de Windows:** al no tener firma digital (Certificado EV/Code Signing), Windows Defender/SmartScreen puede lanzar advertencia de seguridad. No implica software malicioso — funky tiene exactamente el mismo problema y lo advierte en su propio README.
3. **Resolución de bugs clásicos:** la automatización previene errores comunes del método manual (armas/personajes invisibles al entrar a una partida).

### Añadidas en esta revisión (vacíos que conviene resolver antes de programar)
4. **Backups automáticos:** antes de tocar la carpeta de addons/vpks del usuario, la app debería crear un respaldo. Es lo mínimo para que la gente confíe en una herramienta que modifica archivos del juego.
5. **Verificación de archivos de Steam:** Steam puede re-verificar y pisar cambios manuales en la carpeta del juego sin avisar. Hay que documentar (o detectar) este escenario.
6. **Sincronía con actualizaciones de Workshop:** si un addon ya fusionado se actualiza en la Workshop, ¿la app detecta la actualización y vuelve a fusionar, o el usuario se queda con una versión vieja sin saberlo?
7. **Rendimiento de miniaturas:** en equipos con GPU integrada (como el tuyo, Iris Xe), cargar imágenes de portada de cientos de addons en vivo puede sentirse lento. Conviene diseñar un sistema de caché de miniaturas desde el inicio, no como parche después.
8. **Permisos de administrador:** si en algún punto la app escribe en `Program Files`, vas a necesitar permisos elevados además de lidiar con SmartScreen — son dos problemas distintos que hay que resolver por separado.
9. **Flujo de suscripción nueva:** funky reconoce este mismo problema y no lo resuelve del todo — un addon recién suscrito solo se descarga cuando el juego arranca. Vale la pena decidir desde el diseño si tu app va a intentar mejorar ese flujo o simplemente documentarlo como limitación conocida (como hace funky).
10. **`sv_pure` y servidores comunitarios:** en servidores configurados en modo estricto, `sv_pure` puede bloquear o expulsar a jugadores con contenido personalizado activo, aunque sea puramente cosmético. En servidores oficiales de Valve normalmente no hay problema. La app debería mostrar un aviso claro de esto, para que el usuario no piense que la herramienta falló cuando en realidad es el servidor el que rechaza el contenido.

---

## 5. Stack Tecnológico Recomendado

Dado tu perfil (Angular/React + TypeScript, Java/Spring Boot en backend):

- **Electron + React/Angular + TypeScript** — es el camino de menor fricción: reutilizas tu frontend actual y es literalmente lo que usa funky (Electron + Svelte). Cross-platform (Windows/Linux/Steam Deck) casi gratis.
- **Alternativa: Tauri** (backend en Rust, frontend web) — más liviano en tamaño de instalador y consumo de recursos que Electron, pero te mete una curva de aprendizaje extra que quizás no necesitas para un side project con un plazo razonable.
- Para el manejo de vpks (lectura/escritura/fusión), vas a necesitar trabajar con el formato binario VPK de Source Engine — investigar si ya existe una librería en JS/TS o si te conviene un binario auxiliar (como hace el propio juego con `VPK.exe` de las Authoring Tools).

---

## 6. Distribución y Marca

- **Disclaimer de proyecto no oficial:** ni el nombre ni el logo de "Left 4 Dead 2" son tuyos para usar como marca de la app. Un disclaimer tipo "proyecto fan-made, no afiliado a Valve" en el README y en la propia app evita confusiones.
- **Nombre propio, distinto de "funky":** para que alguien que busque "L4D2 versus mod manager" te encuentre como una opción distinta y no como un clon del proyecto existente.

---

## 7. Diferenciación / Propuesta de Valor (resumen)

No compitas con funky en todo. Compite en lo que dejó abierto:

1. Filtro anti-VScript para Versus.
2. Resolución automática de dependencias.
3. Resolver de forma más clara el problema de fusión de vpks específico de Versus (que hoy sigue siendo manual incluso con funky instalado).

Todo lo demás (miniaturas, búsqueda, favoritos, presets) es tabla de apuestas — hay que tenerlo porque el usuario lo espera, pero no es lo que te va a diferenciar.