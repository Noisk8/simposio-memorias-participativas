# Roles y permisos del CMS

Supabase PostgreSQL es la fuente de verdad de autorización. El modelo usa `roles`, `permissions`, `role_permissions` y `user_roles`. Tras aplicar las migraciones actuales, cada persona tiene como máximo un rol efectivo; sus permisos son los asociados a ese rol.

## Roles sembrados

- `superadmin`: todos los permisos.
- `admin`: todos los permisos sembrados actualmente.
- `editor`: CRUD editorial amplio, revisión, publicación, taxonomías, menús y carga/metadata de medios; no recibe `*.delete` ni `media.delete` en la matriz actual.
- `reviewer`: lectura editorial y aprobación de entradas, memorias y páginas.
- `author`: lectura, creación, edición de contenido propio, envío a revisión y carga de medios.
- `read_only`: lectura administrativa sin mutaciones.

La matriz exacta y canónica está en `supabase/migrations/202608080001_phase1_rbac.sql`. Algunas claves sembradas, como `menu.manage` o `media.update`, aún no tienen una interfaz o endpoint completo; disponer del permiso no implica que la capacidad esté implementada.

## Asignación

`/admin/gestion-usuarios` usa `manage-users`:

- GET exige `users.read`;
- crear una cuenta o cambiar su rol exige `users.manage`;
- la Function acepta exactamente un rol de la allowlist;
- `cms_set_user_roles` reemplaza la asignación de forma atómica;
- la RPC impide retirar los propios permisos administrativos y dejar el sistema sin administradores.

Los cambios se aplican en la siguiente petición porque las Functions consultan Supabase cada vez. Un rol incluido en el JWT, metadata o body no se acepta como autorización.

## Usuarios nuevos

Después de `202608080002_editorial_workflow.sql`, el trigger solo asigna `admin` cuando el correo ya existe en `public.admin_emails`. Cualquier alta directa diferente queda sin rol hasta aprobación administrativa. La creación desde el panel asigna explícitamente el rol seleccionado mediante la RPC.

El registro público debe permanecer desactivado en producción.

## Nota legacy

La primera migración podía conservar varias filas de rol migradas y asignaba `author` por defecto. La segunda migración conserva solo el rol de mayor jerarquía, crea un índice único por usuario y sustituye el trigger. Los roles históricos de Netlify Identity no se consultan.
