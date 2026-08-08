# Supabase Auth y RBAC del CMS

Los paneles propios usan Supabase Auth. Las Netlify Functions verifican la sesión y resuelven permisos desde PostgreSQL con credenciales exclusivas de backend.

## Aplicar la migración

1. Realiza un backup de la base de datos.
2. Abre Supabase SQL Editor.
3. Ejecuta `supabase/migrations/202608080001_phase1_rbac.sql` completo.
4. Comprueba que existen los seis roles y que los usuarios anteriores conservan `admin` o `editor`.
5. Conserva `user_roles_legacy` y `audit_log_legacy` hasta finalizar la verificación en producción.

El archivo `supabase/schema.sql` apunta al historial versionado y ya no contiene un esquema paralelo.

## Administrador inicial

Antes de crear una cuenta inicial en una instalación nueva:

```sql
insert into public.admin_emails (email)
values ('tu-email@ejemplo.com')
on conflict do nothing;
```

Después crea la cuenta mediante un mecanismo administrativo de Supabase. El registro público debe permanecer desactivado.

## Variables

```text
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJ...
SITE_URL=https://sitio.example
ALLOWED_ORIGINS=https://preview-autorizado.example
```

La service role solo se configura en Netlify Functions y en el `.env` local ignorado por Git.

## Verificación

Ejecuta una petición a `manage-users` con:

- sin token: debe responder `401`;
- token válido sin `users.read`: debe responder `403`;
- usuario con permiso: debe responder `200` e incluir `x-request-id`;
- usuario deshabilitado: debe responder `401`.

Cada intento debe dejar una fila de autorización en `audit_log`.

Para detalles de despliegue y rollback consulta [Fase 1: RBAC y seguridad](./FASE-1-RBAC.md).
