# Análisis de paridad del CMS

> Documento de transición. Las referencias a Decap CMS, Netlify Identity, Git Gateway y `public/admin/config.yml` describen exclusivamente el sistema **legacy** retirado. Para la arquitectura operativa consulta [ARQUITECTURA-CMS.md](./ARQUITECTURA-CMS.md).

El objetivo de paridad es conservar capacidades editoriales útiles sin reintroducir proveedores de identidad o backends anteriores. La fuente de verdad del estado es el código actual, no las capturas ni la configuración histórica.

## Matriz verificada

| Capacidad                                   | Estado                 | Evidencia o límite                                      |
| ------------------------------------------- | ---------------------- | ------------------------------------------------------- |
| Login único                                 | Implementado           | Supabase Auth en `SupabaseAuth.astro`                   |
| RBAC server-side                            | Implementado           | `requirePermission` y tablas Supabase                   |
| CRUD de entradas, memorias y páginas        | Implementado           | `manage-content` y `/admin/contenidos`                  |
| CRUD de simposios y taxonomías              | Implementado           | misma API y panel                                       |
| Edición de menús                            | **Planeado**           | hay esquema/colección, pero no está en `manage-content` |
| Borradores                                  | Implementado           | `draft`, filtro en panel y respaldo local               |
| Vista previa                                | Implementado           | previsualización reactiva de un subconjunto de Markdown |
| Relaciones                                  | Implementado           | selectores para simposios, categorías y etiquetas       |
| Historial                                   | Implementado           | commits GitHub por path permitido                       |
| Medios                                      | Implementado en GitHub | `public/images/`; no usa Supabase Storage               |
| Gestión de usuarios                         | Implementado           | Supabase Auth Admin + un rol efectivo                   |
| Workflow persistido                         | Implementado           | registros y eventos en Supabase                         |
| Workflow obligatorio                        | **Planeado**           | publicación directa omite aprobación previa             |
| Solicitar cambios/archivar en UI            | **Planeado**           | transiciones disponibles solo en Function               |
| Programación desde el panel                 | **Planeado**           | al publicar, una fecha futura se normaliza a hoy        |
| Colecciones extensibles con CRUD automático | **Planeado**           | solo se crea definición genérica y ejemplo              |
| GitHub App y publicación por PR             | **Planeado**           | se usa token y escritura directa                        |
| Supabase Storage y metadata de medios       | **Planeado**           | binarios y listado permanecen en GitHub                 |

## Reglas de datos conservadas

- Los borradores son Markdown con `draft: true`, no una colección separada.
- Entradas sin fecha reciben la fecha actual al guardar.
- Categorías y etiquetas se limpian y deduplican en los modelos compartidos.
- Las escrituras usan SHA para detectar conflictos.
- El historial enlaza commits de GitHub.
- Los paths se generan o validan en servidor contra una allowlist.
- La propiedad se resuelve con el usuario verificado y `cms_content_records`.

## Sustitución tecnológica legacy

| Componente legacy               | Sustitución activa                                  |
| ------------------------------- | --------------------------------------------------- |
| Netlify Identity                | Supabase Auth                                       |
| Roles en metadata del proveedor | RBAC normalizado en Supabase PostgreSQL             |
| Git Gateway desde el navegador  | Netlify Functions con credencial GitHub server-side |
| Colecciones de Decap CMS        | modelos Zod y `manage-content`                      |
| Biblioteca de Decap CMS         | `manage-media` sobre `public/images/` de GitHub     |
| Hooks del editor anterior       | validación y normalización en Functions             |
| Preview templates anteriores    | previsualizador propio del panel                    |

## Criterio de cierre

La migración funcional solo estará completa cuando todas las filas **Planeado** necesarias para operación editorial se implementen y prueben. La existencia de una tabla o de una transición en backend no equivale por sí sola a una experiencia completa ni a una política obligatoria.
