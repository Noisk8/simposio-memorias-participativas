# Migración a Supabase Auth (paneles de administración)

Los paneles propios (`/admin/gestion-usuarios`, `/admin/gestion-colecciones`, `/admin/crear-memoria`) usan **Supabase Auth** con email y contraseña. Las Netlify Functions validan el JWT contra Supabase y leen los roles de la tabla `public.user_roles`.

El editor **Decap** (`/admin/`) no cambia: sigue con Netlify Identity y Git Gateway.

## 1. Crear el proyecto

1. Ve a [supabase.com](https://supabase.com) → **New project**.
2. Elige una región cercana a tus visitantes y guarda la contraseña de la base de datos.
3. Anota desde **Dashboard → Settings → API**:
   - **Project URL** → `SUPABASE_URL` (y `PUBLIC_SUPABASE_URL`).
   - **anon public** → `PUBLIC_SUPABASE_ANON_KEY`.
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (nunca en el navegador).

## 2. Aplicar el esquema

1. Abre **Dashboard → SQL Editor → New query**.
2. Pega el contenido de `supabase/schema.sql` y ejecuta.
3. El script crea `public.admin_emails`, `public.user_roles`, `public.audit_log` y el trigger `on_auth_user_created`.

## 3. Declarar administradores iniciales

**Antes de crear tu cuenta**, inserta tu email en la tabla `admin_emails` para recibir el rol `admin` al registrarte:

```sql
insert into public.admin_emails (email) values ('tu-email@ejemplo.com');
```

## 4. Variables de entorno

### En Netlify (Site settings → Environment variables → Scope: Functions y Builds)

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### En local (`.env`, no se commitea)

Las mismas variables; Astro y Netlify CLI las cargan automáticamente.

## 5. Registrarse y probar

1. Ve a `/admin/gestion-usuarios` en producción (o `netlify dev`).
2. Verás el formulario de **Iniciar sesión**: usa **Sign up** creando la cuenta desde la página (si el proveedor Email está activo en **Auth → Providers**, que es lo habitual).
3. Confirma el email si la confirmación está habilitada (**Auth → Sign In / Up → Confirm email**).
4. Al entrar se muestra el panel. Si tu email estaba en `admin_emails`, el trigger ya te dio rol `admin` y podrás asignar roles a otros usuarios.

## 6. Opciones de Auth recomendadas

- **Auth → Settings**: activa la confirmación de email y deja el resto por defecto.
- Con `public.user_roles` bajo RLS y sin policies, el anon key **no puede** leer ni escribir roles: solo `service_role` (usado por las funciones) y el trigger.

## 7. Comportamiento en local

- Los paneles cargan Supabase Auth desde `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` del `.env`.
- Las funciones validan el JWT con `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
- Si falta configuración, los paneles muestran el aviso y las funciones responden `500`/`401`, sin romper el resto del sitio.

## Notas

- Los usuarios antiguos de Netlify Identity no existen en Supabase: deben registrarse de nuevo.
- La clave `service_role` otorga acceso total al proyecto: guárdala solo en Netlify y en tu `.env` local.
- Los roles asignados desde `/admin/gestion-usuarios` aplican de inmediato (se leen de la base de datos en cada petición).
- El login del sitio público (cabecera) sigue abriendo Netlify Identity, porque es la sesión que usa Decap.
