# Contributing / Flujo de trabajo

Referencia del manejo de ramas y commits para la implementacion del
L4D2 Versus Addon Manager. El plan de tareas vive en
`.kiro/specs/l4d2-versus-addon-manager/tasks.md`.

## Ramas

- **`main` esta protegida en la practica**: no se hace push directo a `main`.
  Todo el trabajo de implementacion pasa por ramas de feature.
- **Una rama por SECCION de `tasks.md`** (no por tarea individual).
- Las ramas se crean **sobre la marcha**, cuando se empieza a trabajar en esa
  seccion, partiendo de la `main` mas actualizada (que ya incluye los merges de
  las secciones anteriores). Esto evita divergencia y conflictos.

### Mapa de ramas -> secciones de tasks.md

| Rama                 | Seccion(es) de tasks.md |
|----------------------|-------------------------|
| `vpk-tool`           | 2-3                     |
| `path-detector`      | 5                       |
| `addon-scanner`      | 6                       |
| `vscript-detector`   | 7-8                     |
| `collision-resolver` | 10                      |
| `merge-engine`       | 11                      |
| `backup-manager`     | 12                      |
| `gameinfo-editor`    | 13                      |
| `process-guard`      | 14                      |
| `local-store`        | 15                      |
| `elevation-service`  | 17                      |
| `merge-orchestrator` | 18                      |
| `ipc-layer`          | 20                      |
| `ui`                 | 21                      |

> Las tareas 1 (andamiaje) y los checkpoints (4, 9, 16, 19, 22) no tienen rama
> propia: la 1 se hizo/hara en el arranque, y los checkpoints son puntos de
> revision antes de mergear (ver abajo).

## Mensajes de commit

Formato:

```
feat(<seccion>): <descripcion corta> (task X.Y, req Z.W)
```

- `<seccion>`: el nombre de la rama/seccion (p. ej. `vpk-tool`, `path-detector`).
- `<descripcion corta>`: que hace el commit, en presente e imperativo.
- `task X.Y`: la(s) tarea(s) de `tasks.md` que cubre.
- `req Z.W`: el/los requisito(s) que cubre.

Ejemplos:

```
feat(vpk-tool): add stdout noise filtering for vpk.exe (task 2.1, req 6.2)
feat(vpk-tool): batch extraction by command-line length (task 2.3, req 6.4, 6.5)
feat(path-detector): parse libraryfolders.vdf and pick lib with 550 (task 5.1, req 1.5)
```

Para tests, se puede usar `test(<seccion>): ...` con la misma referencia a
task/req/propiedad.

## Checkpoints y merge a `main`

Los checkpoints de `tasks.md` son las tareas **4, 9, 16, 19 y 22**.

Al llegar a cada checkpoint, ANTES de mergear la(s) rama(s) de esa etapa a
`main`:

1. Correr y verificar que **todos los tests pasan**.
2. **Mostrar el diff acumulado** de la rama contra `main` para revision:
   ```
   git diff main..<rama>
   ```
3. **Esperar confirmacion explicita** del responsable antes de mergear.
   NO se mergea automaticamente solo porque los tests pasen.
4. Recien con la confirmacion, mergear a `main` (p. ej. `git merge --no-ff <rama>`)
   o via Pull Request en GitHub.

## Push

- Nunca push directo a `main`.
- Las ramas de feature se pushean a `origin` con `git push -u origin <rama>`.
- El merge a `main` se hace tras la revision del checkpoint (localmente con
  `--no-ff` o via PR en GitHub, segun se prefiera).
