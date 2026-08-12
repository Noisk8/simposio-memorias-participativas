# Guía de despliegue

Esta es la guía canónica. No existen `GUIA-DESPLIEGUE.md` ni `INSTRUCCIONES.md` en el repositorio.

## Requisitos

- Node.js 22.12 o superior.
- Proyecto Supabase.
- Repositorio GitHub que contiene el sitio.
- Sitio Netlify conectado al repositorio.
- GitHub App instalada únicamente en el repositorio editorial.

Consulta la creación, permisos mínimos y retirada del token legacy en `docs/GITHUB-APP.md`.

## Configuración versionada

`netlify.toml` define:

| Campo                   | Valor                        |
| ----------------------- | ---------------------------- |
| Build                   | `npm run build`              |
| Directorio publicado    | `dist`                       |
| Directorio de Functions | `netlify/functions`          |
| Node                    | `22.12.0`                    |
| Netlify Dev             | Astro en 4321, proxy en 8888 |

`npm run build` comprueba la estructura de colecciones, construye Astro y genera el índice Pagefind.

## Pasos manuales: Supabase

1. Haz un backup.
2. Aplica, en orden:

   ```text
   202608080001_phase1_rbac.sql
   202608080002_editorial_workflow.sql
   202608110001_canonical_content_uuid.sql
   202608110002_distributed_rate_limits.sql
   202608110003_remove_menus.sql
   202608110004_cms_media_storage.sql
   202608110005_professional_media_validation.sql
   202608110006_media_types_and_2mib_limit.sql
   202608110007_approved_version_pr_publication.sql
   202608110008_fix_rate_limit_timestamp.sql
   202608110009_supabase_drafts_minimal_publication.sql
   ```

3. Predeclara el primer administrador en `public.admin_emails` antes de crear su cuenta.
4. Desactiva el registro público.
5. Limita Site URL y Redirect URLs a producción, previews autorizados y localhost cuando corresponda.
6. Configura MFA para cuentas administrativas como política operativa si el plan de Supabase lo permite.
7. Conserva las tablas `*_legacy` hasta validar la migración.
8. Ejecuta `npm run migrate:media -- --dry-run`; luego sube y reescribe con `--upload --rewrite-content`. Despliega y verifica las URLs antes de retirar manualmente cualquier original.

Los modelos de contenido exigen un `id` UUID v4 por Markdown y el corpus actual ya está migrado. Verifica antes del deploy:

```bash
npm run check:content-uuids
```

Para repositorios históricos usa primero el modo no destructivo y revisa el diff antes de confirmar la escritura:

```bash
node scripts/migrate-content-uuids.mjs --dry-run
node scripts/migrate-content-uuids.mjs --write
```

## Pasos manuales: Netlify

Configura:

```text
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=...

SITE_URL=https://tu-sitio.example
ALLOWED_ORIGINS=https://preview-autorizado.example

GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY=...
GITHUB_REPO=organizacion/repositorio
GITHUB_BRANCH=main

# Opcional; si falta, el backend deriva la HMAC de SUPABASE_SERVICE_ROLE_KEY.
RATE_LIMIT_HMAC_KEY=...

# Opcionales; defaults mostrados.
CMS_IMAGE_MAX_WIDTH=8000
CMS_IMAGE_MAX_HEIGHT=8000
CMS_IMAGE_MAX_PIXELS=40000000
```

Opcionales para correo:

```text
RESEND_API_KEY=...
RESEND_FROM_EMAIL=panel@tu-dominio.example
```

`SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_PRIVATE_KEY` y `RESEND_API_KEY` son secretos server-side. No uses prefijo `PUBLIC_`.

## Pasos manuales: GitHub

1. Sigue `docs/GITHUB-APP.md` y limita la instalación a este repositorio.
2. Configura `GITHUB_BRANCH` como rama base.
3. Activa auto-merge y exige los checks de CI en los PR técnicos; no añadas una segunda revisión humana al flujo editorial y bloquea force-push.
4. Confirma que el merge activa el build de Netlify.

Los borradores viven en Supabase y no generan commits ni deploys. La operación protegida **Publicar** congela un snapshot, crea una rama técnica y solicita auto-merge después de CI. `netlify-ignore-build.mjs` omite previews de `cms/**`, por lo que solo el merge en `main` genera el deploy de producción.

El proveedor editorial anterior basado en Decap CMS, Netlify Identity y Git Gateway es **legacy**. No habilites esos servicios para el despliegue actual.

## Desarrollo local

Para CMS y Functions:

```bash
cp .env.example .env
npm install
npm run dev:netlify
```

Abre `http://localhost:8888/admin/`.

Para el sitio público sin Functions:

```bash
astro dev --background
```

Usa `astro dev status`, `astro dev logs` y `astro dev stop` para gestionar el proceso.

## Verificación previa

```bash
npm test
npm run test:api
npm run lint
npm run check
npm run check:content-uuids
npm run format:check
npm run build
```

Cuando cambie el panel o la navegación, ejecuta además `npm run test:e2e`.

Verifica manualmente:

- redirección de `/admin/` a `/admin/login` sin sesión;
- login y cierre de sesión;
- respuestas `401`, `403` y éxito con `x-request-id`;
- respuestas `429` con `Retry-After` y `x-request-id`, y fallback `503` en mutaciones si falla la RPC;
- CRUD de una colección con un rol autorizado;
- rechazo de paths no permitidos y conflictos SHA;
- subida de un medio válido a Storage, registro `cms_media` y rechazo de firma inválida;
- estado del commit mostrado por `deploy-status`;
- nuevo build de Netlify después de un commit del CMS;
- ausencia de scripts o configuración operativa del CMS legacy.

## Reversión

1. Restaura el deploy anterior en Netlify.
2. Rota o revoca credenciales si hubo exposición.
3. No borres ni reviertas tablas Supabase sin backup y reconciliación de auditoría/workflow.
4. Si se necesita volver al esquema anterior a RBAC, usa el procedimiento histórico de `FASE-1-RBAC.md` y valida los datos legacy.
5. Verifica sitio público, Auth, permisos y Functions antes de cerrar el incidente.
