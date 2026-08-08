# Roles y permisos del CMS

Supabase es la fuente de verdad de los paneles propios. El modelo se normaliza en `roles`, `permissions`, `role_permissions` y `user_roles`; una persona puede tener más de un rol y sus permisos efectivos son la unión de todos ellos.

## Roles iniciales

- `superadmin`: control total, incluidos roles y configuración.
- `admin`: administración de usuarios, contenido y configuración.
- `editor`: edición, aprobación y publicación.
- `reviewer`: lectura, revisión y aprobación.
- `author`: creación, edición y envío a revisión.
- `read_only`: consultas administrativas sin escritura.

La matriz completa se siembra en `supabase/migrations/202608080001_phase1_rbac.sql`. Los roles antiguos se migran de forma conservadora: `admin` permanece `admin`, `editor` permanece `editor` y una asignación vacía pasa a `read_only`.

## Asignación

La página `/admin/gestion-usuarios` consulta y modifica roles mediante `manage-users`. La función exige `users.read` para listar y `users.manage` para crear usuarios o asignar roles. Nunca acepta un rol del cliente como prueba de autorización.

La RPC `cms_set_user_roles` hace el reemplazo de forma atómica, valida las claves y evita que una persona retire sus propios permisos administrativos o elimine al último administrador.

Los cambios aplican en la petición siguiente porque los permisos se consultan en Supabase en cada llamada.

## Usuarios nuevos

El trigger asigna `admin` a emails predeclarados en `public.admin_emails` y `author` al resto. En producción debe deshabilitarse el registro público y crearse cuentas desde el panel autorizado o por invitación.

## Identidad única

Los roles de Netlify Identity fueron retirados del flujo activo. Todos los accesos administrativos usan Supabase Auth y este RBAC.
