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

## Edicion de archivos de texto via terminal (encoding)

Regla fija para evitar corrupcion de encoding al editar prosa (sobre todo en
espanol, con acentos y con backticks de Markdown) desde la terminal de
PowerShell. Estos problemas ya ocurrieron (BOM inyectado, backticks comidos,
acentos convertidos en basura) y NO deben redescubrirse cada vez.

1. **Escribir siempre sin BOM.** Usar `Set-Content -Encoding utf8NoBOM`
   (o `New-Object System.Text.UTF8Encoding($false)` con
   `[System.IO.File]::WriteAllText(...)`). NUNCA `Set-Content -Encoding utf8`
   a secas en Windows PowerShell 5.x: agrega un BOM que ensucia el diff.

2. **Leer con encoding UTF-8 explicito.** Al releer para reemplazar contenido,
   usar `[System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)`.
   Leer sin especificar encoding puede reinterpretar mal los acentos.

3. **Evitar here-strings para texto con acentos o backticks.**
   Dentro de un here-string (`@" ... "@`) de PowerShell el backtick es
   caracter de escape y se come la letra siguiente, y la interpolacion puede
   corromper caracteres. Preferir un **array de lineas simples** unido con
   `-join` un salto de linea.

4. **Backticks de Markdown via variable.** Cuando el texto necesite backticks
   inline (para `codigo`), definir una variable `$bt = [char]0x60` e
   interpolarla/concatenarla, en vez de escribir el backtick literal (que
   PowerShell interpreta como escape).

5. **Usar comillas simples para las lineas, insertar comillas dobles por
   variable.** Dentro de comillas dobles, la secuencia backslash-comilla NO
   es un escape valido en PowerShell; usar strings con comillas simples y
   concatenar `[char]0x22` donde haga falta una comilla doble literal.

6. **Verificar despues de escribir.** Confirmar que (a) los primeros bytes no
   son `EF BB BF` (BOM), (b) los acentos se leen bien, y (c) el `git diff`
   muestra solo el cambio buscado, sin lineas fantasma por encoding.

> Nota: este documento se mantiene sin acentos a proposito, como capa extra
> de seguridad. La regla de encoding aplica a los archivos de prosa que si
> llevan acentos (p. ej. `Context/*.md` y los specs en espanol).
