# L4D2 Versus Addon Manager

Aplicacion de escritorio para gestionar addons de la Steam Workshop en
*Left 4 Dead 2*, con foco en el modo **Versus**.

## Que resuelve

Jugar Versus con addons requiere fusionar manualmente archivos `.vpk` cada vez
que se agrega o quita un mod: desempaquetar los VPK, combinar su contenido,
reempaquetar el resultado en un unico `pak01_dir.vpk` y reinstalarlo. Este
Manager automatiza ese flujo completo con unos pocos clics.

### Diferenciadores

- **Filtro anti-VScript**: detecta y bloquea addons que usan VScript, que no
  tienen efecto en Versus, inspeccionando el contenido real del VPK.
- **Resolucion de colisiones**: cuando dos addons aportan el mismo archivo,
  gana el ultimo segun el orden de prioridad que define el usuario.
- **Fusion resuelta de forma explicita** para el caso especifico de Versus,
  validada end-to-end.

## Stack

- **Electron + TypeScript** (proceso main para la logica de sistema; renderer
  para la UI).
- **`vpk.exe`** de las Authoring Tools de L4D2, wrappeado via `child_process`,
  para listar, extraer y empaquetar VPK.
- Persistencia local (recomendado SQLite via `better-sqlite3`, alternativa JSON).
- Plataforma primaria: **Windows**. Linux/Steam Deck: secundarias.

## Estado actual

- **Especificacion completa**: requisitos, diseno tecnico y plan de tareas
  (en `.kiro/specs/l4d2-versus-addon-manager/`).
- **Nucleo tecnico validado end-to-end** con datos reales (deteccion de rutas,
  fusion de VPK, resolucion de colisiones, filtro VScript).
- **Implementacion en progreso**: se construye el nucleo del proceso main
  primero, luego la UI. Ver el plan de tareas.

## Estructura del proyecto

```
src/
  main/
    domain/    # logica de dominio (PathDetector, VpkTool, MergeEngine, ...)
    app/       # orquestacion (MergeOrchestrator, ElevationService)
    data/      # persistencia (LocalStore)
  preload/     # puente IPC tipado (contextBridge)
  renderer/    # UI
test/
  fixtures/    # fixtures de prueba (VPK sinteticos, generados localmente)
Context/       # documentacion de contexto del proyecto
.kiro/specs/   # especificacion (requirements, design, tasks)
```

## Disclaimer

Este es un **proyecto fan-made, no afiliado a Valve**. "Left 4 Dead 2" y la
Steam Workshop son propiedad de Valve Corporation. Esta herramienta no
redistribuye contenido de addons: solo automatiza la fusion local de los VPK que
el usuario ya tiene suscritos en su propia instalacion de Steam.

El ejecutable distribuido no esta firmado digitalmente, por lo que Windows
SmartScreen o el prompt UAC pueden mostrar una advertencia de "editor
desconocido". Es un comportamiento esperado, no software malicioso.

## Licencia

MIT. Ver [LICENSE](LICENSE).
