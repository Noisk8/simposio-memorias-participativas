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

El cuerpo editorial se modifica mediante un WYSIWYG basado en Lexical. El editor ofrece títulos,
subtítulos, citas, negrita, cursiva, listas y enlaces, además de deshacer y rehacer. Markdown continúa
siendo el formato canónico que se guarda en Supabase y se publica en GitHub: un campo oculto mantiene
la conversión sincronizada para no cambiar el contrato del backend ni exigir una migración del corpus.
La vista previa interpreta CommonMark y GitHub Flavored Markdown mediante `marked` y sanitiza el
resultado con `DOMPurify` antes de insertarlo en el DOM. La vista previa no ejecuta HTML activo
aportado por el contenido.

Las entradas disponen además de una barra de bloques controlados para insertar imágenes de la
biblioteca, galerías, carruseles, citas y listados de entradas por categoría en la posición del
cursor. En el WYSIWYG, los bloques CMS son tarjetas visuales indivisibles con miniatura, descripción,
eliminación, movimiento accesible mediante botones y reordenamiento por arrastre. Se guardan como
bloques cercados `cms-image`, `cms-gallery` y `cms-entries` con configuración JSON: siguen siendo
legibles y versionables dentro del Markdown, pero el backend rechaza tipos desconocidos, JSON
inválido y URLs de medios inseguras. El mismo renderizador genera la vista previa y el HTML estático
público; los listados por categoría se resuelven durante el build y excluyen borradores y la propia
entrada.

Una entrada puede apuntar opcionalmente a una página mediante `page_id`, que conserva el UUID estable de la página y no su título o slug mutable. El selector del panel limita las opciones a la misma edición del simposio. Una entrada publicada conserva su ruta canónica y aparece además como tarjeta relacionada en la página asignada; el build rechaza referencias inexistentes, páginas no publicadas y relaciones entre ediciones diferentes.

## Funciones activas

| Function               | Responsabilidad                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `manage-content`       | CRUD de borradores Supabase, UUID canónico, validación, autosave y concurrencia por revisión  |
| `manage-workflow`      | Publicación/archivo y reconciliación idempotente de GitHub y Netlify                          |
| `manage-media`         | Lista, actualiza metadata y elimina medios en Supabase Storage                                |
| `upload-media`         | Valida, redimensiona, convierte a WebP y sube imágenes; conserva PDF sin transformación       |
| `manage-users`         | Lista/crea usuarios de Supabase Auth y reemplaza su rol efectivo                              |
| `get-revision-history` | Hasta 30 snapshots editoriales inmutables almacenados en Supabase                             |
| `deploy-status`        | Estado combinado de GitHub y del último deploy de Netlify                                     |
| `cms-operations`       | Reconciliación, salud operativa y poda programadas cada diez minutos                          |
| `scheduled-publish`    | Rebuild diario de Netlify para activar contenido cuya `publish_date` ya venció                |
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

`upload-media` acepta únicamente JPEG, PNG, WebP y PDF, con un máximo absoluto de 2 MiB. Para imágenes contrasta extensión, MIME declarado, firma y formato decodificado por `sharp`; fuerza la decodificación completa, limita ancho/alto/píxeles, aplica orientación, reduce a un máximo predeterminado de 2560×2560 y almacena WebP con calidad 82. Cualquier otro tipo, imágenes animadas, nombres peligrosos y archivos corruptos se rechazan antes de consultar Storage. Los límites de salida pueden ajustarse con `CMS_IMAGE_OUTPUT_MAX_WIDTH`, `CMS_IMAGE_OUTPUT_MAX_HEIGHT` y `CMS_IMAGE_WEBP_QUALITY`.

Las imágenes nuevas requieren crédito, licencia y una decisión explícita entre texto alternativo no vacío o `is_decorative=true`. El original se conserva en `original_filename`, pero nunca se usa como key: las cargas nuevas emplean `images|documents/YYYY/MM/<uuid>-<slug-seguro>.<ext>`. Los paths históricos por SHA-256 siguen siendo válidos. El SHA-256 permanece en `checksum_sha256` para deduplicación, integridad y trazabilidad.

Los campos de imagen del editor permiten elegir un recurso existente mediante un selector autenticado que consulta `manage-media`, además de subir una imagen nueva. La URL manual se conserva únicamente para compatibilidad con referencias legacy; seleccionar o subir un medio actualiza el borrador y su vista previa sin exponer credenciales de Storage al navegador.

No se generan variantes `thumbnail`, `medium` y `large`: el Markdown consume una única URL ya optimizada. `sharp` solo forma parte del endpoint `upload-media`; listar, editar metadata o eliminar medios no carga su binario nativo.

## Límite navegador/administración

El sitio público no consulta sesiones ni incluye `@supabase/supabase-js`. El encabezado carga únicamente navegación y el acceso oculto al login. Supabase Auth, su clave anónima y el manejo de tokens se importan desde `src/scripts/admin/` solo en rutas `/admin`; los permisos siempre se vuelven a comprobar en Functions. La configuración pública de Auth ya no tiene un endpoint JSON adicional.

Las pantallas administrativas usan módulos compartidos para autenticación, llamadas HTTP, layout y configuración del editor. Astro procesa estos scripts como módulos versionados; las páginas públicas no descargan los chunks administrativos.

El bucket permite lectura pública para el sitio estático. Políticas RLS restrictivas bloquean `INSERT`, `UPDATE` y `DELETE` desde clientes incluso si hubiera otra política permisiva; la Function usa `service_role` únicamente server-side después de RBAC. La tabla permite lectura directa solo a usuarios con `media.read`, pero las mutaciones se hacen por la Function.

Durante la transición, Astro admite tanto `/images/…` como URLs HTTP de Storage. `scripts/migrate-media-to-storage.mjs` detecta referencias Markdown, verifica archivos, deduplica por checksum, sube y registra idempotentemente, y opcionalmente reescribe Markdown. Nunca elimina originales: solo informa cuáles quedan sin referencias en `src/`.

## Límites conocidos

- Los modelos exigen UUID v4 y el corpus actual ya fue migrado. `migrate-content-uuids.mjs --check` bloquea check/build si falta un ID o está duplicado.
- El panel expone guardar borrador, publicar y archivar; los estados legacy de revisión quedan admitidos solo para migración de datos históricos.
- La navegación pública es estática en `src/components/Header.astro`; no forma parte del dominio editorial del CMS.
- Las colecciones genéricas creadas por `manage-collections` no obtienen automáticamente CRUD en el panel.
- La escritura GitHub y la auditoría Supabase no forman una transacción distribuida. Si la auditoría no persiste, queda el evento estructurado `audit.persist.failed`.
- La confirmación ocurre al consultar el workflow y también mediante `cms-operations`; el merge y el deploy son estados separados.
- La programación conserva fechas futuras y depende de `scheduled-publish` + `SCHEDULED_BUILD_HOOK_URL`; su precisión es diaria (00:05 America/Bogota).
- Netlify se confirma por las variables confiables del runtime para el deploy actual y, opcionalmente, por API para despliegues históricos.
- La importación inicial desde GitHub ocurre al abrir una colección que todavía no tenga copias editables. No se borran los Markdown legacy automáticamente.

Los PR técnicos que modifican únicamente `src/content/` o `public/images/` usan una ruta de CI
editorial sin instalación de dependencias ni build de Astro. Esta ruta conserva las validaciones de
taxonomías, preparación para producción, relaciones, assets e identidad UUID. Los cambios de código
mantienen el CI completo. Netlify omite deliberadamente los deploy previews de ramas `cms/**`; el
reconciliador ignora solo los checks de preview con los nombres exactos del repositorio y nunca los
checks de CI o seguridad. Después del merge se ejecuta el único build completo, correspondiente al
deploy de producción.

## Arquitectura objetivo aún no completada

```text
Implementado                              Planeado
────────────                              ────────
Supabase Auth + Storage                   Webhook inmediato de GitHub/Netlify (la tarea programada ya reconcilia)
RBAC, borradores y versiones Supabase     Restauración de snapshots desde la interfaz
Autosave y concurrencia por revisión      Idempotencia genérica para operaciones no editoriales
Publicación exacta e idempotente
Archivo/despublicación idempotente
GitHub App + PR técnico automático
Confirmación del deploy exacto de Netlify
CI editorial ligero y un solo deploy
Auditoría Supabase + logs
Rate limit distribuido
Panel propio
SEO, canonical, assets y WCAG bloqueantes en CI
Publicación programada diaria
```
