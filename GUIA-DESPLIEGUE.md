# Guía de despliegue

## Requisitos

- Node.js 22.12 o superior.
- Proyecto Supabase con la migración RBAC aplicada.
- Sitio Netlify conectado al repositorio.
- Credenciales de GitHub limitadas al repositorio mientras se completa la migración a GitHub App.

## Build de Netlify

| Campo                | Valor           |
| -------------------- | --------------- |
| Rama                 | `main`          |
| Comando              | `npm run build` |
| Directorio publicado | `dist`          |

## Supabase

Aplica, en orden, las migraciones de `supabase/migrations/`. La migración inicial de seguridad es:

```text
202608080001_phase1_rbac.sql
```

En Supabase Auth:

- desactiva el registro público;
- habilita confirmación de correo;
- limita las Redirect URLs al dominio de producción, previews autorizados y localhost;
- recomienda MFA para administración.

## Variables de entorno

Configura en Netlify:

```text
NODE_VERSION=22.12.0

SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=...

SITE_URL=https://tu-sitio.example
ALLOWED_ORIGINS=https://preview-autorizado.example

GITHUB_TOKEN=...
GITHUB_REPO=organizacion/repositorio
GITHUB_BRANCH=main
```

`SUPABASE_SERVICE_ROLE_KEY` solo debe estar disponible para Functions. Nunca debe usar prefijo `PUBLIC_`.

## Panel administrativo

El acceso activo es:

```text
/admin/login  → Supabase Auth
/admin/       → panel propio
/admin/*      → sesión Supabase + autorización backend
```

Netlify Identity, Git Gateway y Decap no forman parte del despliegue. Si estaban habilitados previamente en Netlify, pueden desactivarse después de desplegar y verificar esta versión.

## Desarrollo local

Crea `.env` con las mismas variables y ejecuta:

```bash
npm install
npm run dev:netlify
```

Abre `http://localhost:8888/admin/`.

Para trabajar solo en páginas públicas, sigue la instrucción del proyecto y usa Astro en segundo plano:

```bash
astro dev --background
```

## Verificación antes de desplegar

```bash
npm run test
npm run lint
npm run check
npm run format:check
npm run build
```

Comprueba además:

- `/admin/` redirige a `/admin/login` sin sesión;
- el login correcto vuelve al panel;
- cerrar sesión elimina el estado autenticado;
- una llamada sin bearer token responde `401`;
- un usuario sin permiso recibe `403`;
- `x-request-id` aparece en respuestas administrativas;
- no se carga ningún script de Netlify Identity o Decap.

## Reversión

1. Restaura el deploy anterior desde Netlify.
2. No reviertas ni borres tablas de Supabase sin backup.
3. Si es imprescindible restaurar el esquema legacy, sigue `docs/FASE-1-RBAC.md`.
4. Verifica el sitio público y el acceso administrativo antes de cerrar la reversión.
