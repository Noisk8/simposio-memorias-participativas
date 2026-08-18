# Análisis de paridad del CMS

> Documento de transición. Las referencias a Decap CMS, Netlify Identity, Git Gateway y `public/admin/config.yml` describen exclusivamente el sistema **legacy** retirado. Para la arquitectura operativa consulta [ARQUITECTURA-CMS.md](./ARQUITECTURA-CMS.md).

El objetivo de paridad es conservar capacidades editoriales útiles sin reintroducir proveedores de identidad o backends anteriores. La fuente de verdad del estado es el código actual, no las capturas ni la configuración histórica.

## Matriz verificada

| Capacidad                                   | Estado                   | Evidencia o límite                                      |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| Login único                                 | Implementado             | Supabase Auth en `SupabaseAuth.astro`                   |
| RBAC server-side                            | Implementado             | `requirePermission` y tablas Supabase                   |
| CRUD de entradas, memorias y páginas        | Implementado             | `manage-content` y `/admin/contenidos`                  |
| CRUD de simposios y taxonomías              | Implementado             | misma API y panel                                       |
| Edición de menús                            | **Planeado**             | hay esquema/colección, pero no está en `manage-content` |
| Borradores                                  | Implementado             | copia mutable y revisión optimista en Supabase          |
| Vista previa                                | Implementado             | previsualización reactiva de un subconjunto de Markdown |
| Relaciones                                  | Implementado             | selectores para simposios, categorías y etiquetas       |
| Historial                                   | Implementado             | snapshots inmutables en `cms_content_versions`          |
| Medios                                      | Implementado en Supabase | Storage + tabla `cms_media`; GitHub conserva legacy     |
| Gestión de usuarios                         | Implementado             | Supabase Auth Admin + un rol efectivo                   |
| Workflow persistido                         | Implementado             | registros y eventos en Supabase                         |
| Workflow de publicación/archivo             | Implementado             | PR, CI y deploy exacto antes del estado terminal        |
| Archivo/despublicación en UI                | Implementado             | elimina Markdown mediante un PR idempotente             |
| Programación desde el panel                 | Implementado             | fecha futura + rebuild diario de Netlify                |
| Colecciones extensibles con CRUD automático | **Planeado**             | solo se crea definición genérica y ejemplo              |
| GitHub App y publicación por PR             | Implementado             | credencial server-side y rama técnica                   |
| Supabase Storage y metadata de medios       | Implementado             | bucket `cms-media` y tabla `cms_media`                  |

## Reglas de datos conservadas

- Los borradores viven en Supabase; GitHub contiene solo Markdown publicado.
- Una `publish_date` vacía recibe la fecha actual al publicar; una fecha futura se conserva.
- Categorías y etiquetas se limpian y deduplican en los modelos compartidos.
- Las ediciones usan revisión optimista y SHA-256 editorial para detectar conflictos.
- El historial se consulta en `cms_content_versions`; GitHub conserva la historia del artefacto público.
- Los paths se generan o validan en servidor contra una allowlist.
- La propiedad se resuelve con el usuario verificado y `cms_content_records`.

## Sustitución tecnológica legacy

| Componente legacy               | Sustitución activa                                                 |
| ------------------------------- | ------------------------------------------------------------------ |
| Netlify Identity                | Supabase Auth                                                      |
| Roles en metadata del proveedor | RBAC normalizado en Supabase PostgreSQL                            |
| Git Gateway desde el navegador  | Netlify Functions con credencial GitHub server-side                |
| Colecciones de Decap CMS        | modelos Zod y `manage-content`                                     |
| Biblioteca de Decap CMS         | `manage-media`/`upload-media` sobre Supabase Storage y `cms_media` |
| Hooks del editor anterior       | validación y normalización en Functions                            |
| Preview templates anteriores    | previsualizador propio del panel                                   |

## Criterio de cierre

La migración funcional solo estará completa cuando todas las filas **Planeado** necesarias para operación editorial se implementen y prueben. La existencia de una tabla o de una transición en backend no equivale por sí sola a una experiencia completa ni a una política obligatoria.
