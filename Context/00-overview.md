# L4D2 Versus Addon Manager — Resumen Ejecutivo

## Qué es
Aplicación de escritorio (Windows, potencialmente Linux/Steam Deck) para gestionar mods de la Steam Workshop en *Left 4 Dead 2*, con foco específico en el modo **Versus**.

## El problema que resuelve
Jugar Versus con mods activos requiere fusionar manualmente archivos `.vpk` cada vez que se agrega o quita un addon. El proceso implica desempaquetar VPKs, copiar archivos, reconstruir el paquete y repetirlo desde cero ante cualquier cambio. Esta herramienta automatiza ese flujo completo.

## Diferenciadores frente a herramientas existentes (ej. *funky*)
1. **Filtro anti-VScript**: detecta y bloquea addons que usan VScript, los cuales no tienen efecto en Versus.
2. **Resolución automática de dependencias**: si un addon requiere otro para funcionar, la app lo detecta y lo activa automáticamente.
3. **Fusión de VPKs resuelta de forma explícita**: el problema técnico central de Versus (límite de VPKs cargados simultáneamente) queda resuelto en la app, no como flujo manual del usuario.

## Estado actual del proyecto
- Fase: **diseño / pre-implementación**.
- Funcionalidades, stack y diferenciadores están definidos en alto nivel.
- El mecanismo técnico central (cómo leer, fusionar y escribir VPKs desde la app) **aún no está diseñado** — es el próximo paso crítico antes de escribir código.
- No existe código todavía.

## Archivos de contexto disponibles
| Archivo | Contenido |
|---|---|
| `00-overview.md` | Este archivo. Resumen ejecutivo del proyecto. |
| `01-decisiones-tecnicas.md` | Stack, arquitectura y decisiones ya tomadas vs. pendientes. |
| `02-pendientes.md` | Preguntas abiertas y vacíos técnicos sin resolver. |
| `03-glosario.md` | Términos del dominio explicados. |
| `04-historial-decisiones.md` | Log de cambios de rumbo con fecha y motivo. |
| `archive/` | Documentos de diseño originales (v1, v2) para referencia histórica. |
