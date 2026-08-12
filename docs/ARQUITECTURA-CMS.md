# Arquitectura actual del CMS

Este documento es la fuente de verdad técnica del CMS. Describe lo que está implementado en el repositorio; cualquier capacidad futura se etiqueta como **Planeado**.

## Componentes y autoridad

| Componente          | Responsabilidad actual                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| Astro               | Genera el sitio público estático desde Content Collections                   |
| React               | Integración habilitada; actualmente no hay componentes `.tsx`/`.jsx`         |
| Tailwind CSS        | Estilos del sitio y del panel                                                |
| Pagefind            | Índice de búsqueda generado después del build de Astro                       |
| Panel propio        | Interfaz administrativa bajo `/admin/`                                       |
| Supabase Auth       | Identidad y sesiones del CMS                                                 |
| Supabase PostgreSQL | RBAC, propiedad, workflow, rate limiting, idempotencia preparada y auditoría |
| Netlify Functions   | Límite de confianza para validación, autorización y operaciones externas     |
| GitHub              | Fuente versionada del Markdown publicado y de `public/images/`               |
| Netlify             | Functions, build y hosting del sitio                                         |

Supabase es la única autoridad de identidad y autorización editorial. GitHub es la fuente versionada que Astro consume durante el build. En la implementación actual también contiene borradores marcados con `draft: true`; Supabase guarda su estado y metadata, pero no el cuerpo Markdown.

## Flujo de una operación administrativa

```text
Usuario
  │ credenciales
  ▼
Supabase Auth
  │ access token JWT
  ▼
Panel propio
  │ Authorization: Bearer <token>
  ▼
Netlify Function
  ├─ verifica el JWT mediante Supabase auth.getUser(token)
  ├─ toma user.id de la sesión verificada
  ├─ consulta roles y permisos en PostgreSQL
  ├─ aplica CORS, rate limit distribuido y validación Zod/path
  ├─ opera con GitHub o Supabase según la acción
  └─ emite auditoría y logs con requestId
       │
       ├─► Supabase: RBAC, workflow, auditoría
       └─► GitHub: commit de Markdown o imagen
                    │
                    ▼
             build/deploy de Netlify
                    │
                    ▼
             sitio público Astro
```

El frontend puede usar los permisos devueltos por la API para mostrar u ocultar controles, pero esa decisión es solo de interfaz. Cada Function vuelve a autorizar la operación.

## Funciones activas

| Function               | Responsabilidad                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `manage-content`       | CRUD de seis colecciones, UUID canónico, validación, propiedad, publicación directa y registro editorial |
| `manage-workflow`      | Consulta de registro/eventos y transiciones de workflow                                                  |
| `manage-media`         | Lista, sube y elimina imágenes de `public/images/` mediante GitHub                                       |
| `manage-users`         | Lista/crea usuarios de Supabase Auth y reemplaza su rol efectivo                                         |
| `get-revision-history` | Hasta 30 commits GitHub de un archivo permitido                                                          |
| `deploy-status`        | Estado combinado del commit de la rama configurada en GitHub                                             |
| `manage-collections`   | Modifica `src/content.config.ts` y crea el marcador `.gitkeep`; no escribe Markdown editorial            |
| `create-coleccion`     | Wrapper temporal obsoleto que delega íntegramente en `manage-collections`                                |

`create-proyecto` fue retirado: no tenía consumidores internos. La redirección de página `/admin/crear-proyecto` permanece por compatibilidad de navegación.

Los handlers delegan en `shared/cms/content-service.ts`, `workflow-service.ts`, `media-service.ts` y `collection-service.ts`. Solo `content-service` ejecuta `PUT`/`DELETE` de Markdown bajo `src/content`; así no existe una segunda ruta que omita RBAC, validación, SHA, workflow/metadata o auditoría.

## Persistencia

### GitHub

- Markdown: `src/content/{coleccion}/*.md`.
- Identidad: UUID v4 en el campo `id` del frontmatter, generado o preservado por servidor.
- Imágenes: `public/images/*`.
- Historial: commits consultados por path.
- Escritura actual: GitHub Contents API con `GITHUB_TOKEN` sobre `GITHUB_BRANCH`.
- Paths de contenido: allowlist de colecciones y patrón seguro en servidor.

### Supabase

- Auth: usuarios y sesiones.
- RBAC: `roles`, `permissions`, `role_permissions`, `user_roles`.
- Workflow y metadata editorial: `cms_content_records`, `cms_workflow_events`; el ID del registro coincide con el UUID del Markdown y resuelve colección, path, estado y último `github_sha` conocido.
- Auditoría: `audit_log`.
- Operaciones: `cms_operation_keys` existe en esquema, pero el código de Functions todavía no lo usa para idempotencia.
- Rate limiting: `cms_rate_limits` y `cms_consume_rate_limit`, con una fila por sujeto HMAC/acción, ventana atómica y expiración.

### Rate limiting distribuido

Las categorías activas son `read`, `write`, `login-sensitive`, `media-upload`, `user-management` y `publish`. Después de validar la sesión, la clave se deriva del `user.id` verificado; las peticiones sin identidad se agrupan por la IP del contexto confiable de Netlify. No se usan `x-forwarded-for` ni `x-real-ip`.

Cada consumo es un `INSERT ... ON CONFLICT DO UPDATE` atómico sobre la clave primaria. La tabla mantiene como máximo una fila activa por sujeto/acción, tiene índice de expiración, poda oportunista acotada y limpieza completa mediante `cms_prune_operational_data`.

Fallback explícito:

- `read`: fail-open, registrando `rate_limit.unavailable` para no derribar consultas de bajo riesgo.
- `write`, `media-upload`, `user-management` y `publish`: fail-closed con `503 RATE_LIMIT_UNAVAILABLE`.
- `login-sensitive`: si el bucket falla, la autenticación conserva su rechazo `401`; nunca se abre la operación protegida.
- Un límite consumido responde `429 RATE_LIMIT_EXCEEDED`, `Retry-After` y `x-request-id`.

El inicio de sesión del navegador llama directamente a Supabase Auth y conserva los límites configurables del proveedor. `login-sensitive` limita intentos no autenticados contra las Functions; no sustituye la configuración de Auth ni CAPTCHA.

## Estado de medios

La biblioteca actual no usa Supabase Storage. `manage-media` valida nombre, extensión, firma binaria y límite de 4 MB, y después escribe la imagen en `public/images/` de GitHub. Antes de borrar busca referencias en `src/content` mediante GitHub Code Search. No existe una tabla de metadata de medios en las migraciones actuales.

**Planeado:** migrar binarios a Supabase Storage y guardar metadata editorial de medios en Supabase. Esa migración deberá definir compatibilidad de URLs, políticas RLS y traslado de los archivos existentes.

## Límites conocidos

- El workflow está persistido, pero publicar mediante `manage-content` no exige que el estado anterior sea `approved`.
- Los modelos exigen UUID v4 y el corpus actual ya fue migrado. `migrate-content-uuids.mjs --check` bloquea check/build si falta un ID o está duplicado.
- El panel solo expone `submit_review` y `approve`; `request_changes` y `archive` están solo en la Function, y la publicación del panel no usa la transición `publish`.
- `menus` tiene esquema Astro y permiso RBAC, pero no forma parte de la allowlist de `manage-content`.
- Las colecciones genéricas creadas por `manage-collections` no obtienen automáticamente CRUD en el panel.
- La escritura GitHub y la auditoría Supabase no forman una transacción distribuida. Si la auditoría no persiste, queda el evento estructurado `audit.persist.failed`.
- El CMS escribe directamente en la rama configurada. GitHub App, ramas por cambio y pull requests están **Planeados**.
- `deploy-status` informa estados de commit de GitHub; no consulta directamente la API de deploys de Netlify.
- Separar los cuerpos no publicados para que GitHub contenga únicamente contenido publicado está **Planeado**; hoy los borradores permanecen versionados y Astro los filtra.

## Arquitectura objetivo aún no completada

```text
Implementado                         Planeado
────────────                         ────────
Supabase Auth                        Supabase Storage para binarios
RBAC en Supabase                     Metadata de medios en Supabase
Workflow persistido                  Workflow obligatorio de punta a punta
Auditoría Supabase + logs            Idempotencia usada por las Functions
Functions con validación             GitHub App y publicación por PR
Markdown versionado en GitHub        Separar cuerpos no publicados de GitHub
Rate limit distribuido
Panel propio
```
