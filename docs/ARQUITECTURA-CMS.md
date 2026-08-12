# Arquitectura actual del CMS

Este documento es la fuente de verdad técnica del CMS. Describe lo que está implementado en el repositorio; cualquier capacidad futura se etiqueta como **Planeado**.

## Componentes y autoridad

| Componente          | Responsabilidad actual                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| Astro               | Genera el sitio público estático desde Content Collections                  |
| React               | Integración habilitada; actualmente no hay componentes `.tsx`/`.jsx`        |
| Tailwind CSS        | Estilos del sitio y del panel                                               |
| Pagefind            | Índice de búsqueda generado después del build de Astro                      |
| Panel propio        | Interfaz administrativa bajo `/admin/`                                      |
| Supabase Auth       | Identidad y sesiones del CMS                                                |
| Supabase PostgreSQL | RBAC, workflow, rate limiting, metadata de medios, idempotencia y auditoría |
| Supabase Storage    | Binarios públicos del CMS; escritura exclusiva desde Functions              |
| Netlify Functions   | Límite de confianza para validación, autorización y operaciones externas    |
| GitHub              | Fuente versionada del Markdown; conserva medios legacy durante la migración |
| Netlify             | Functions, build y hosting del sitio                                        |

Supabase es la única autoridad de identidad y autorización editorial y también la fuente de trabajo para los borradores. GitHub conserva únicamente el Markdown publicado que Astro consume durante el build. Los documentos legacy con `draft: true` no se eliminan durante la transición, pero dejan de recibir escrituras del panel.

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
  ├─ guarda borradores y versiones en Supabase
  ├─ usa GitHub exclusivamente al publicar
  └─ emite auditoría y logs con requestId
       │
       ├─► Supabase: RBAC, borrador, versiones, publicación y auditoría
       ├─► Supabase Storage: binario de medios
       └─► GitHub: commit de Markdown
                    │
                    ▼
             build/deploy de Netlify
                    │
                    ▼
             sitio público Astro
```

El frontend puede usar los permisos devueltos por la API para mostrar u ocultar controles, pero esa decisión es solo de interfaz. Cada Function vuelve a autorizar la operación.

## Funciones activas

| Function               | Responsabilidad                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `manage-content`       | CRUD de borradores Supabase, UUID canónico, validación, autosave y concurrencia por revisión  |
| `manage-workflow`      | Publicación directa para el usuario y reconciliación de la infraestructura Git automática     |
| `manage-media`         | Lista, sube, actualiza metadata y elimina medios en Supabase Storage                          |
| `manage-users`         | Lista/crea usuarios de Supabase Auth y reemplaza su rol efectivo                              |
| `get-revision-history` | Hasta 30 snapshots editoriales inmutables almacenados en Supabase                             |
| `deploy-status`        | Estado combinado del commit de la rama configurada en GitHub                                  |
| `manage-collections`   | Modifica `src/content.config.ts` y crea el marcador `.gitkeep`; no escribe Markdown editorial |
| `create-coleccion`     | Wrapper temporal obsoleto que delega íntegramente en `manage-collections`                     |

`create-proyecto` fue retirado: no tenía consumidores internos. La redirección de página `/admin/crear-proyecto` permanece por compatibilidad de navegación.

Los handlers delegan en `shared/cms/content-service.ts`, `publication-service.ts`, `workflow-service.ts`, `media-service.ts` y `collection-service.ts`. `content-service` no ejecuta escrituras GitHub; únicamente `publication-service` crea o actualiza Markdown editorial después de RBAC, validación, snapshot e idempotencia.

## Persistencia

### GitHub

- Markdown: `src/content/{coleccion}/*.md`.
- Identidad: UUID v4 en el campo `id` del frontmatter, generado o preservado por servidor.
- Medios legacy: `public/images/*`, conservados temporalmente y sin nuevas escrituras del CMS.
- Historial: commits consultados por path.
- Autenticación: GitHub App server-side; `GITHUB_TOKEN` es solo fallback temporal obsoleto.
- Ningún guardado de borrador escribe en GitHub. Publicar crea internamente una rama `cms/<uuid>/<timestamp>` y un PR con auto-merge condicionado a CI.
- Paths de contenido: allowlist de colecciones y patrón seguro en servidor.

### Supabase

- Auth: usuarios y sesiones.
- RBAC: `roles`, `permissions`, `role_permissions`, `user_roles`.
- Contenido editable: `cms_content_drafts` mantiene una copia mutable con revisión optimista.
- Historial: `cms_content_versions` mantiene snapshots inmutables sin crear una versión por pulsación.
- Publicación: `cms_publications` conserva idempotencia, intentos, PR, merge, errores y despliegue; `cms_content_records` apunta a las versiones actual y publicada.
- Auditoría editorial: `cms_workflow_events` y `audit_log` conservan SHA, actor y timestamps.
- Auditoría: `audit_log`.
- Medios: `cms_media` guarda ubicación, URL pública, checksum, dimensiones, metadata editorial y borrado lógico; el binario vive en el bucket público `cms-media`.
- Operaciones: `cms_operation_keys` existe en esquema, pero el código de Functions todavía no lo usa para idempotencia.
- Rate limiting: `cms_rate_limits` y `cms_consume_rate_limit`, con una fila por sujeto HMAC/acción, ventana atómica y expiración.

### Rate limiting distribuido

Las categorías activas son `read`, `write`, `login-sensitive`, `media-upload`, `user-management` y `publish`. Después de validar la sesión, la clave se deriva del `user.id` verificado; las peticiones sin identidad se agrupan por la IP del contexto confiable de Netlify. No se usan `x-forwarded-for` ni `x-real-ip`.

Cada consumo es un `INSERT ... ON CONFLICT DO UPDATE` atómico sobre la clave primaria. La tabla mantiene como máximo una fila activa por sujeto/acción, tiene índice de expiración, poda oportunista acotada y limpieza completa mediante `cms_prune_operational_data`.

La migración `202608110008_fix_rate_limit_timestamp.sql` corrige una colisión con la palabra reservada PostgreSQL `CURRENT_TIME`: la RPC usa `v_now timestamptz` explícito para que las escrituras no fallen al crear o actualizar el bucket.

Fallback explícito:

- `read`: fail-open, registrando `rate_limit.unavailable` para no derribar consultas de bajo riesgo.
- `write`, `media-upload`, `user-management` y `publish`: fail-closed con `503 RATE_LIMIT_UNAVAILABLE`.
- `login-sensitive`: si el bucket falla, la autenticación conserva su rechazo `401`; nunca se abre la operación protegida.
- Un límite consumido responde `429 RATE_LIMIT_EXCEEDED`, `Retry-After` y `x-request-id`.

El inicio de sesión del navegador llama directamente a Supabase Auth y conserva los límites configurables del proveedor. `login-sensitive` limita intentos no autenticados contra las Functions; no sustituye la configuración de Auth ni CAPTCHA.

## Estado de medios

`manage-media` acepta únicamente JPEG, PNG, WebP y PDF, con un máximo absoluto de 2 MiB. Para imágenes contrasta extensión, MIME declarado, firma y formato decodificado por `sharp`; fuerza la decodificación completa y limita ancho, alto y píxeles mediante configuración server-side. Cualquier otro tipo, imágenes animadas, nombres peligrosos y archivos corruptos se rechazan antes de consultar Storage.

Las imágenes nuevas requieren crédito, licencia y una decisión explícita entre texto alternativo no vacío o `is_decorative=true`. El original se conserva en `original_filename`, pero nunca se usa como key: las cargas nuevas emplean `images|documents/YYYY/MM/<uuid>-<slug-seguro>.<ext>`. Los paths históricos por SHA-256 siguen siendo válidos. El SHA-256 permanece en `checksum_sha256` para deduplicación, integridad y trazabilidad.

No se generan `thumbnail`, `medium` y `large` en esta fase: el Markdown y los componentes públicos consumen una única URL y todavía no tienen un modelo de variantes. Añadir derivados ahora multiplicaría objetos sin un consumidor ni una política clara de borrado. `sharp` queda centralizado para incorporarlos cuando el modelo público use `srcset`/`picture`.

El bucket permite lectura pública para el sitio estático. Políticas RLS restrictivas bloquean `INSERT`, `UPDATE` y `DELETE` desde clientes incluso si hubiera otra política permisiva; la Function usa `service_role` únicamente server-side después de RBAC. La tabla permite lectura directa solo a usuarios con `media.read`, pero las mutaciones se hacen por la Function.

Durante la transición, Astro admite tanto `/images/…` como URLs HTTP de Storage. `scripts/migrate-media-to-storage.mjs` detecta referencias Markdown, verifica archivos, deduplica por checksum, sube y registra idempotentemente, y opcionalmente reescribe Markdown. Nunca elimina originales: solo informa cuáles quedan sin referencias en `src/`.

## Límites conocidos

- Los modelos exigen UUID v4 y el corpus actual ya fue migrado. `migrate-content-uuids.mjs --check` bloquea check/build si falta un ID o está duplicado.
- El panel expone únicamente guardar borrador y publicar; los estados legacy de revisión quedan admitidos solo para migración de datos históricos.
- La navegación pública es estática en `src/components/Header.astro`; no forma parte del dominio editorial del CMS.
- Las colecciones genéricas creadas por `manage-collections` no obtienen automáticamente CRUD en el panel.
- La escritura GitHub y la auditoría Supabase no forman una transacción distribuida. Si la auditoría no persiste, queda el evento estructurado `audit.persist.failed`.
- La confirmación de merge ocurre al consultar el workflow; auto-merge evita acciones humanas, pero todavía no existe webhook de GitHub para reconciliación inmediata.
- `deploy-status` informa estados de commit de GitHub; no consulta directamente la API de deploys de Netlify.
- La importación inicial desde GitHub ocurre al abrir una colección que todavía no tenga copias editables. No se borran los Markdown legacy automáticamente.

## Arquitectura objetivo aún no completada

```text
Implementado                              Planeado
────────────                              ────────
Supabase Auth + Storage                   Webhook de reconciliación de PR/merge/deploy
RBAC, borradores y versiones Supabase     Restauración de snapshots desde la interfaz
Autosave y concurrencia por revisión      Idempotencia genérica para operaciones no editoriales
Publicación exacta e idempotente
GitHub App + PR técnico automático
CI editorial ligero y un solo deploy
Auditoría Supabase + logs
Rate limit distribuido
Panel propio
```
