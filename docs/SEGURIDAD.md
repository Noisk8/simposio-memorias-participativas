# Seguridad del CMS

## Límite de confianza

Supabase Auth es la única autoridad de identidad. Cada Netlify Function protegida extrae el bearer token y llama a `auth.getUser(token)`. Después consulta en PostgreSQL los permisos asociados al `user.id` verificado.

No participan en la autorización los roles o IDs enviados en el body, `localStorage`, `user_metadata` ni `app_metadata`. El sistema editorial anterior —Decap CMS, Netlify Identity y Git Gateway— es **legacy**, está fuera del flujo activo y no debe reactivarse.

```text
Navegador no confiable
  │ JWT
  ▼
Netlify Function
  ├─ auth.getUser
  ├─ consulta RBAC
  ├─ valida input y path
  ├─ aplica permiso
  ├─ opera con GitHub/Supabase
  └─ registra requestId y auditoría
```

## Funciones y permisos

| Function               | Operación                     | Permiso                                        |
| ---------------------- | ----------------------------- | ---------------------------------------------- |
| `manage-content`       | GET                           | `*.read` según colección                       |
| `manage-content`       | POST nuevo; PUT/PATCH edición | `*.create` o `*.update`                        |
| `manage-content`       | DELETE                        | `*.delete`                                     |
| `manage-workflow`      | GET                           | `admin.access`                                 |
| `manage-workflow`      | POST                          | permiso de transición derivado de la colección |
| `manage-media`         | GET/PATCH/DELETE              | `media.read`, `media.update/delete`            |
| `upload-media`         | POST                          | `media.upload`                                 |
| `manage-users`         | GET/POST                      | `users.read`, `users.manage`                   |
| `manage-collections`   | POST                          | `settings.manage`                              |
| `create-coleccion`     | wrapper obsoleto              | delega en `manage-collections`                 |
| `get-revision-history` | GET                           | `*.read` según path permitido                  |
| `deploy-status`        | GET                           | `admin.access`                                 |

`create-proyecto` fue eliminado al no tener consumidores. Todos los cambios de Markdown editorial pasan por `manage-content` y `shared/cms/content-service.ts`.

`requirePermission` devuelve el usuario verificado, roles, permisos y `requestId`. El panel puede usar esa respuesta para adaptar la interfaz, pero la Function siempre repite la autorización.

## Validación y paths

- `manage-content` solo admite `entradas`, `memorias`, `paginas`, `simposios`, `categorias` y `etiquetas`.
- `isSafeContentPath` restringe los paths a un Markdown directo dentro de esas carpetas.
- El path de un documento nuevo se genera en servidor a partir de datos validados.
- El UUID editorial se genera en servidor al crear y se preserva desde el documento/registro existente al editar; no se confía en un reemplazo enviado por el cliente.
- Los modelos Zod compartidos validan frontmatter y el cuerpo se limita a 200.000 caracteres.
- Las ediciones usan una revisión optimista de Supabase; GitHub solo interviene al publicar o archivar.
- `upload-media` rechaza nombres peligrosos y genera una key UUID-slug independiente del original.
- Solo admite JPEG, PNG, WebP y PDF, con máximo absoluto de 2 MiB. Para imágenes contrasta MIME, extensión, firma y decodificación `sharp`, y limita dimensiones y píxeles antes de Storage.
- Las imágenes exigen crédito, licencia y texto alternativo o declaración decorativa explícita.
- CORS acepta `SITE_URL`, `URL`, `ALLOWED_ORIGINS` y los orígenes locales definidos.

## Propiedad

Autores solo pueden modificar registros cuyo `owner_id` coincida con el usuario verificado. `superadmin`, `admin` y `editor` pueden operar sobre contenido ajeno. La propiedad se consulta en `cms_content_records`, no en un ID enviado por el cliente.

Contenido existente en GitHub que aún no tenga registro en `cms_content_records` no puede ser actualizado por un autor; un perfil manager puede adoptarlo al guardar.

## Errores, logs y auditoría

Los errores usan este contrato:

```json
{
  "ok": false,
  "error": {
    "code": "AUTHORIZATION_DENIED",
    "message": "Permisos insuficientes.",
    "requestId": "uuid"
  }
}
```

El `requestId` también aparece en `x-request-id` y logs JSON. El logger redacta campos relacionados con tokens, contraseñas, cookies, secretos y claves privadas.

`requirePermission` intenta registrar comprobaciones permitidas y denegadas en `audit_log`; las mutaciones registran eventos de dominio. Si una escritura GitHub ya se confirmó y falla la inserción de auditoría, `recordAudit` emite `audit.persist.failed` sin convertir la respuesta en un falso fallo. Por eso GitHub y Supabase no ofrecen una transacción distribuida.

## Secretos

Solo servidor:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `GITHUB_APP_ID` y `GITHUB_APP_INSTALLATION_ID`;
- `GITHUB_APP_PRIVATE_KEY`;
- `GITHUB_TOKEN`, solo durante la retirada del fallback obsoleto;
- `RESEND_API_KEY`, si se usa correo.
- `SCHEDULED_BUILD_HOOK_URL`, build hook limitado a la rama de despliegue.
- `ALERT_WEBHOOK_URL`, canal de alertas operativas.

Expuestos deliberadamente al navegador para Supabase Auth:

- `PUBLIC_SUPABASE_URL`;
- `PUBLIC_SUPABASE_ANON_KEY`.

La service role y la credencial GitHub nunca deben tener prefijo `PUBLIC_`, incluirse en logs o llegar al bundle del navegador.

Las variables `PUBLIC_SUPABASE_*` solo se consumen en los módulos de `/admin`. El sitio público no carga el SDK ni inspecciona la sesión. Son parámetros públicos de Supabase Auth, no credenciales privilegiadas; toda autorización efectiva ocurre en servidor.

## CSP y cadena de suministro

Astro genera una CSP por página con hashes SHA-256 para scripts y estilos procesados. La política no contiene `unsafe-inline` ni `unsafe-eval`, limita scripts a origen propio y Giscus, restringe conexiones a Supabase, y bloquea objetos. `X-Frame-Options: DENY` permanece como cabecera porque `frame-ancestors` no es efectivo en una CSP entregada mediante `<meta>`.

`npm run build` ejecuta `audit-csp` y falla si una página renderizable pierde la política o reintroduce fuentes inseguras. Las versiones directas de npm, Node y Netlify están fijadas; todas las Actions usan SHA completo e inmutable.

## Controles de base de datos

- RLS está habilitado en tablas RBAC, auditoría y workflow.
- Los roles `anon` y `authenticated` no tienen acceso directo a esas tablas.
- `cms_set_user_roles` solo puede ser ejecutada por `service_role`.
- La segunda migración impone un único rol por usuario.
- El trigger solo asigna `admin` a correos predeclarados en `admin_emails`; las demás altas directas quedan sin rol.
- La creación desde `manage-users` asigna el rol indicado explícitamente.
- `cms_consume_rate_limit` solo puede ejecutarse con `service_role` y actualiza cada bucket de forma atómica.
- `cms_rate_limits` no guarda IDs ni IPs en claro: usa claves HMAC y expira mediante TTL/poda.

## Rate limiting y fallback

| Acción            | Límite actual | Ventana | Falla de Supabase    |
| ----------------- | ------------: | ------: | -------------------- |
| `read`            |           120 |    60 s | fail-open            |
| `write`           |            30 |    60 s | fail-closed          |
| `login-sensitive` |            20 |   300 s | conserva rechazo 401 |
| `media-upload`    |            12 |   300 s | fail-closed          |
| `user-management` |            20 |   300 s | fail-closed          |
| `publish`         |            10 |   300 s | fail-closed          |

El sujeto autenticado es el `user.id` obtenido de `auth.getUser`; el anónimo usa la IP confiable de Netlify. `x-forwarded-for` y `x-real-ip` se ignoran. Superar el bucket devuelve `429`, `Retry-After`, `x-request-id` y el error normalizado. Si la RPC no está disponible, solo las lecturas continúan; las acciones autenticadas críticas devuelven `503 RATE_LIMIT_UNAVAILABLE`. Una petición sin identidad continúa rechazada con `401`, aunque su bucket no pueda consultarse.

## Riesgos y trabajo planeado

- Variantes `thumbnail`/`medium`/`large`: **Planeado** hasta que el modelo público consuma `srcset`/`picture`.
- La publicación exige snapshot inmutable, GitHub App, rama, PR, CI y confirmación del deploy exacto; auto-merge o `cms-operations` realizan el merge cuando `verify` termina correctamente. Un webhook para reducir la latencia de reconciliación está **Planeado**.
- La creación de publicación es idempotente para rama y PR. El uso general de `cms_operation_keys` por las demás Functions está **Planeado**.
- MFA para administración: configuración manual recomendada en Supabase; el repositorio no puede imponerla por sí solo.
