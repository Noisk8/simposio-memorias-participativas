# Manual del panel administrativo

## Acceso

El panel utiliza Supabase Auth como único sistema de identidad.

1. Abre `/admin/`.
2. Si no existe una sesión válida, el sitio redirige a `/admin/login`.
3. Introduce el correo y la contraseña de tu cuenta de Supabase.
4. Al cerrar sesión se eliminan las credenciales locales de Supabase.

No se utilizan Netlify Identity, Git Gateway ni un login separado de Decap.

## Secciones disponibles

### Crear memoria

Ruta: `/admin/crear-memoria`.

Permite crear una memoria mediante una Netlify Function. La función verifica el JWT de Supabase y el permiso `memoria.create` antes de escribir.

### Usuarios y roles

Ruta: `/admin/gestion-usuarios`.

Permite listar usuarios, crear cuentas y asignar los roles `superadmin`, `admin`, `editor`, `reviewer`, `author` y `read_only`. Las operaciones requieren `users.read` o `users.manage`.

### Colecciones

Ruta: `/admin/gestion-colecciones`.

Permite crear la estructura inicial de una colección mediante una función protegida con `settings.manage`.

## Funcionalidad temporalmente no disponible

El editor Decap fue retirado del flujo activo para que Supabase sea la única identidad. Hasta que se complete la API editorial, el panel todavía no incluye formularios generales para editar Entradas, Páginas, Simposios, Taxonomías y Menús existentes.

Estos contenidos siguen en `src/content/` y pueden editarse técnicamente mediante Markdown, pero no deben exponerse nuevamente mediante Git Gateway.

## Desarrollo local

Configura las variables de `.env` y ejecuta:

```bash
npm run dev:netlify
```

Después abre:

```text
http://localhost:8888/admin/
```

Ejecutar únicamente Astro no habilita `/.netlify/functions/*`.

## Seguridad

- El navegador solo utiliza `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` permanece exclusivamente en Netlify Functions.
- Los roles enviados por el navegador se ignoran.
- La autorización real se consulta en Supabase en cada petición.
- Los errores administrativos incluyen un `requestId` para diagnóstico.
