# Supabase en el CMS

Supabase proporciona Auth y PostgreSQL para RBAC, workflow, auditoría y metadata editorial. Los binarios de medios no usan Supabase Storage actualmente.

## Migraciones

Aplica en orden:

```text
supabase/migrations/202608080001_phase1_rbac.sql
supabase/migrations/202608080002_editorial_workflow.sql
supabase/migrations/202608110001_canonical_content_uuid.sql
supabase/migrations/202608110002_distributed_rate_limits.sql
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
- amplía la restricción de colección para registrar `menus`;
- alinea o crea registros para los 40 documentos versionados migrados.

La cuarta:

- crea `cms_rate_limits`, con una fila por sujeto HMAC y acción;
- crea la RPC atómica `cms_consume_rate_limit` restringida a `service_role`;
- incorpora expiración, índice y poda acotada/completa;
- amplía `cms_prune_operational_data` para limpiar buckets vencidos.

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

Supabase Storage está **Planeado**. La implementación actual de `manage-media` escribe en `public/images/` de GitHub y no persiste metadata de medios en PostgreSQL.

## Verificación

- sin token: `401`;
- token inválido, expirado o usuario deshabilitado: `401`;
- token válido sin permiso: `403`;
- permiso válido: respuesta exitosa con `x-request-id`;
- el bundle del navegador no contiene la service role;
- las tablas protegidas no son accesibles directamente por `anon` o `authenticated`.

La auditoría se intenta persistir para autenticación/autorización y operaciones. Revisa también los logs `audit.persist.failed`, porque una falla de auditoría posterior a un commit GitHub no revierte ese commit.
