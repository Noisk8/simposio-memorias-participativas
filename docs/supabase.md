# Supabase en el CMS

Supabase proporciona Auth, PostgreSQL para RBAC/workflow/auditoría y Storage para los binarios de medios.

## Migraciones

Aplica en orden:

```text
supabase/migrations/202608080001_phase1_rbac.sql
supabase/migrations/202608080002_editorial_workflow.sql
supabase/migrations/202608110001_canonical_content_uuid.sql
supabase/migrations/202608110002_distributed_rate_limits.sql
supabase/migrations/202608110003_remove_menus.sql
supabase/migrations/202608110004_cms_media_storage.sql
supabase/migrations/202608110005_professional_media_validation.sql
supabase/migrations/202608110006_media_types_and_2mib_limit.sql
```

La primera migración:

- conserva tablas antiguas como `user_roles_legacy` y `audit_log_legacy` cuando corresponde;
- crea roles, permisos, relaciones, asignaciones y auditoría;
- siembra seis roles y la matriz de permisos;
- crea `cms_set_user_roles` y restringe su uso a `service_role`;
- habilita RLS y revoca acceso directo del cliente.

La segunda:

- reduce cada cuenta a un único rol efectivo y crea un índice único;
- añade `resource_ref` a auditoría;
- crea `cms_content_records`, `cms_workflow_events` y `cms_operation_keys`;
- reemplaza el trigger de altas para que solo los correos predeclarados reciban `admin` automáticamente;
- crea `cms_prune_operational_data` para una invocación server-side explícita.

La tercera:

- hace que `cms_content_records.id` coincida con el UUID v4 del frontmatter;
- conserva los eventos de workflow mediante una FK con `on update cascade`;
- alinea o crea los registros canónicos del contenido versionado que existía al aplicarla.

La cuarta:

- crea `cms_rate_limits`, con una fila por sujeto HMAC y acción;
- crea la RPC atómica `cms_consume_rate_limit` restringida a `service_role`;
- incorpora expiración, índice y poda acotada/completa;
- amplía `cms_prune_operational_data` para limpiar buckets vencidos.

La quinta:

- retira del dominio editorial la colección y los permisos RBAC de menús;
- elimina cualquier registro operativo asociado a `src/content/menus/`;
- vuelve a limitar `cms_content_records` a las seis colecciones administradas.

La sexta:

- crea el bucket público `cms-media`, con límite de 4 MB y MIME allowlist;
- crea `cms_media`, índices de checksum y trigger de `updated_at`;
- añade la comprobación RBAC server-side `cms_has_permission`;
- permite lectura de metadata con `media.read` y bloquea por RLS toda escritura cliente en el bucket;
- deja las mutaciones a `manage-media` y `upload-media`, que usan `service_role` solo después de validar sesión y permiso.

La séptima:

- limita las imágenes nuevas del bucket a JPEG, PNG y WebP;
- añade `is_decorative` e `image_format` a `cms_media`;
- admite keys opacas UUID-slug sin invalidar los paths SHA-256 históricos;
- impone coherencia MIME/formato/dimensiones y metadata editorial para cargas del CMS;
- eleva el techo físico a 10 MiB para permitir un límite server-side configurable, cuyo default sigue siendo 4 MiB.

La octava establece la política final de recepción:

- máximo absoluto de 2 MiB en Functions, PostgreSQL y Storage;
- únicamente `image/jpeg`, `image/png`, `image/webp` y `application/pdf`;
- elimina audio y vídeo de los tipos y prefijos aceptados.

`supabase/schema.sql` es solo un índice hacia las migraciones y no debe convertirse en un esquema paralelo.

## Administrador inicial

Antes de crear la primera cuenta de una instalación nueva:

```sql
insert into public.admin_emails (email)
values ('tu-email@ejemplo.com')
on conflict do nothing;
```

Después crea la cuenta mediante un mecanismo administrativo de Supabase. El trigger le asignará `admin`. Las demás altas directas quedan sin rol; el flujo normal es crear cuentas desde `/admin/gestion-usuarios`.

## Alta desde el panel

`manage-users` usa `auth.admin.createUser`, confirma el email, asigna un rol mediante `cms_set_user_roles` e intenta enviar las credenciales temporales con Resend si está configurado.

```text
RESEND_API_KEY=...
RESEND_FROM_EMAIL=panel@example.org
SITE_URL=https://tu-dominio.example
```

Sin Resend, la cuenta se crea y el panel muestra la contraseña temporal. La entrega segura y el cambio posterior de contraseña requieren procedimiento operativo.

## Variables

```text
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJ...
SITE_URL=https://sitio.example
ALLOWED_ORIGINS=https://preview-autorizado.example
```

`SUPABASE_SERVICE_ROLE_KEY` solo pertenece al entorno de Functions. La URL y anon key públicas se inyectan al login mediante `/admin/supabase-config.js`.

## Storage

El bucket `cms-media` es público para que el sitio estático use URLs duraderas sin firmarlas. Una URL pública no autoriza listar ni mutar objetos. Los paths son inmutables:

```text
images/YYYY/MM/<uuid>-<slug-seguro>.<ext>
documents/YYYY/MM/<uuid>-<slug-seguro>.<ext>
```

Los objetos importados conservan sus keys históricas `<sha256>-<nombre-seguro>`.

La política se configura solo en Functions:

```text
CMS_IMAGE_MAX_WIDTH=8000
CMS_IMAGE_MAX_HEIGHT=8000
CMS_IMAGE_MAX_PIXELS=40000000
```

Todo archivo está limitado a 2 MiB. Solo se reciben JPEG, PNG, WebP y PDF. Las imágenes requieren `credit`, `license` y `alt_text`, salvo que `is_decorative` se marque explícitamente. El backend obtiene MIME, formato y dimensiones reales mediante `sharp` antes de subir.

Migración controlada:

```bash
npm run migrate:media -- --dry-run
npm run migrate:media -- --upload
npm run migrate:media -- --rewrite-content
# Equivalente en una sola ejecución de escritura:
npm run migrate:media -- --upload --rewrite-content
```

`--dry-run` no necesita credenciales. Los otros modos requieren `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el proceso o en `.env`/`.env.local`. El script es idempotente por SHA-256, comprueba firmas, metadata, objetos y referencias rotas antes de reescribir, y normaliza en Storage extensiones legacy cuyo contenido real tenga otro formato. No borra archivos de `public/`: solo considera elegible para borrado manual un original sin referencias legacy en `src/`.

## Verificación

- sin token: `401`;
- token inválido, expirado o usuario deshabilitado: `401`;
- token válido sin permiso: `403`;
- permiso válido: respuesta exitosa con `x-request-id`;
- el bundle del navegador no contiene la service role;
- las tablas protegidas no son accesibles directamente por `anon` o `authenticated`.

La auditoría se intenta persistir para autenticación/autorización y operaciones. Revisa también los logs `audit.persist.failed`, porque una falla de auditoría posterior a un commit GitHub no revierte ese commit.
