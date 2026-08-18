# I Simposio sobre Memorias Participativas

Sitio público y CMS editorial propio del I Simposio sobre Memorias Participativas. Astro construye el sitio estático desde Markdown publicado y Netlify aloja tanto el frontend como las Functions administrativas.

## Estado actual

| Área                | Implementación actual                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Frontend            | Astro 7, integración React 19, Tailwind CSS 4 y Pagefind               |
| CMS                 | Panel editorial propio en `/admin/`                                    |
| Autenticación       | Supabase Auth                                                          |
| Autorización        | RBAC almacenado en PostgreSQL de Supabase; un rol efectivo por usuario |
| Backend             | Netlify Functions                                                      |
| Contenido publicado | Markdown en `src/content/`, versionado en GitHub                       |
| Workflow            | Borrador, publicación y archivo idempotentes, persistidos en Supabase  |
| Auditoría           | `audit_log` en Supabase y logs JSON con `requestId`                    |
| Medios              | Binarios en Supabase Storage y metadata en `cms_media`                 |
| Deploy              | Netlify, a partir de la rama configurada del repositorio               |

La integración de React está configurada, aunque las pantallas actuales están implementadas principalmente como componentes Astro con scripts de cliente. No hay componentes `.tsx` o `.jsx` en el repositorio.

La publicación y el archivo usan una GitHub App server-side: crean una rama técnica y un Pull Request, esperan el check obligatorio y solo pasan al estado terminal cuando Netlify confirma el deploy del SHA fusionado. `GITHUB_TOKEN` permanece únicamente como fallback obsoleto.

## Arquitectura

```text
Usuario del CMS
      │ inicia sesión
      ▼
Supabase Auth ──► JWT
                    │ Authorization: Bearer
                    ▼
              Netlify Function
                    │
                    ├─ valida el JWT con Supabase Auth
                    ├─ resuelve el usuario y RBAC en Supabase
                    ├─ valida método, origen, path y payload
                    ├─ ejecuta la operación editorial
                    └─ registra auditoría en Supabase y logs JSON
                         │
                         ├─► Supabase: roles, borradores, workflow, medios y auditoría
                         └─► GitHub: Markdown publicado mediante PR técnico
                                      │
                                      ▼
                               Deploy de Netlify
                                      │
                                      ▼
                         Astro + Pagefind → sitio público
```

El navegador nunca decide la autorización. Las Functions obtienen el usuario real mediante `auth.getUser(token)` y consultan `user_roles`, `roles`, `role_permissions` y `permissions`. Los paths editables están restringidos a colecciones conocidas bajo `src/content/`; no se aceptan paths GitHub arbitrarios.

Los modelos editoriales actuales requieren un `id` UUID v4. En creaciones lo genera el servidor y en ediciones conserva el del documento existente; un ID enviado por el navegador no puede sustituir la identidad ya persistida.

Consulta [Arquitectura del CMS](./docs/ARQUITECTURA-CMS.md) para el detalle, incluidos los límites actuales.

## Contenido y rutas

Las Content Collections activas son:

```text
src/content/
├── entradas/
├── memorias/
├── paginas/
├── simposios/
├── categorias/
└── etiquetas/
```

`manage-content` soporta las seis colecciones. La navegación principal se define de forma estática en `src/components/Header.astro`; no es contenido editorial.

Rutas públicas principales:

- `/entradas/` y `/entradas/:slug` para la edición predeterminada.
- `/museo-memorias/` y `/museo-memorias/:number`.
- `/ediciones/:slug/`; las ediciones no predeterminadas conservan ahí sus páginas y entradas.
- `/:pagina` para las páginas informativas de la edición predeterminada.
- `/categorias/`, `/etiquetas/` y `/buscar`.

En memorias, el campo existente se llama `number` en el modelo y el frontmatter. Sigue siendo el número público usado por `/museo-memorias/:number`, pero no es la identidad técnica; cambiarlo a `numero` rompería el contrato actual y queda fuera de esta migración de identidad.

Astro excluye del sitio público las entradas, memorias y páginas con `draft: true`. Un commit del CMS no cambia el sitio desplegado hasta que Netlify complete un nuevo build.

Una `publish_date` futura se conserva: el artefacto se fusiona, pero Astro lo oculta hasta esa fecha. `scheduled-publish` solicita un rebuild diario a las 00:05 de Bogotá mediante un build hook limitado a `main`. La programación tiene precisión de día, no de hora.

Los borradores, su cuerpo y las versiones inmutables viven en Supabase. GitHub contiene únicamente el Markdown público que Astro consume.

## Panel administrativo

- `/admin/`: dashboard.
- `/admin/contenidos`: listado, búsqueda, creación, edición, borradores, publicación, eliminación, previsualización e historial Git de las colecciones soportadas.
- `/admin/crear-memoria`: formulario rápido para memorias.
- `/admin/medios`: biblioteca de medios almacenados en Supabase Storage.
- `/admin/gestion-usuarios`: alta de cuentas y asignación de un rol efectivo.
- `/admin/gestion-colecciones`: crea una colección genérica en GitHub; el formulario editorial para esa colección queda **Planeado**.

`/admin/crear-proyecto` se conserva únicamente como redirección de navegación. La Function legacy `create-proyecto` fue retirada al no tener consumidores; el único endpoint de escritura para memorias es `manage-content?collection=memorias`.

La lógica de dominio vive en `shared/cms/`: `content-service` guarda borradores exclusivamente en Supabase y `publication-service` es el único módulo que modifica Markdown mediante PR. Los handlers de Functions adaptan HTTP, validan la sesión/RBAC y delegan. `manage-collections` administra definiciones de colección y crea solo un `.gitkeep`, nunca contenido de ejemplo. `create-coleccion` es un wrapper temporal obsoleto para clientes externos y el panel ya no lo usa.

### Workflow real

El panel expone un flujo minimalista de borrador, publicación y archivo. Los estados históricos de revisión siguen admitidos solo para compatibilidad de datos. Las operaciones de publicación/archivo no se consideran terminadas con el merge: esperan un deploy `ready` del commit exacto. Véase [Flujo editorial](./docs/FLUJO-EDITORIAL.md).

## Desarrollo local

Requisitos: Node.js 22.12.0 (también fijado en `.nvmrc`) y las variables de `.env.example`.

Para el CMS y las Functions:

```bash
cp .env.example .env
npm install
npm run dev:netlify
```

Abre `http://localhost:8888`. Ejecutar solo Astro no habilita `/.netlify/functions/*`.

Para trabajar únicamente en el sitio público, sigue `AGENTS.md` y ejecuta Astro en segundo plano:

```bash
astro dev --background
```

Gestión del proceso: `astro dev status`, `astro dev logs` y `astro dev stop`.

## Variables de entorno

- Públicas: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`.
- Solo servidor: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, credenciales de GitHub App y `SCHEDULED_BUILD_HOOK_URL`.
- Rate limiting: `RATE_LIMIT_HMAC_KEY` es opcional; si falta se deriva la HMAC de la service role sin exponerla.
- Integración GitHub: `GITHUB_REPO`, `GITHUB_BRANCH`.
- Orígenes: `SITE_URL`, `ALLOWED_ORIGINS`.
- Correo opcional: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- Operación: `ALERT_WEBHOOK_URL`; `NETLIFY_SITE_ID` y `NETLIFY_API_TOKEN` son opcionales para consultar deploys históricos.

Nunca expongas `SUPABASE_SERVICE_ROLE_KEY` ni `GITHUB_TOKEN` con prefijo `PUBLIC_`.

## Comandos

```bash
npm run dev:netlify     # Astro y Functions mediante Netlify Dev
npm run build           # valida contenido/assets, construye, audita SEO e indexa Pagefind
npm test                # pruebas Node
npm run test:api        # contrato HTTP de Functions con Netlify Dev
npm run test:e2e        # build y pruebas Playwright
npm run lint            # ESLint
npm run check           # contenido, taxonomías, relaciones, assets y astro check
npm run check:assets    # formato real y existencia de assets locales
npm run audit:seo       # metadatos y canonical únicos sobre dist/
npm run audit:csp       # CSP generada, sin unsafe-inline/unsafe-eval
npm run audit:client-boundaries # impide cargar Supabase en rutas públicas
npm run audit:reproducibility # versiones directas, lockfile, Node y Actions inmutables
npm run check:content-uuids # valida UUID editoriales únicos
npm run format:check    # Prettier sin modificar archivos
```

## Documentación

- [Arquitectura del CMS](./docs/ARQUITECTURA-CMS.md): fuente de verdad técnica.
- [Manual del panel](./docs/MANUAL-USUARIO.md): tareas editoriales y límites actuales.
- [Despliegue](./docs/despliegue.md): Supabase, GitHub y Netlify.
- [Seguridad](./docs/SEGURIDAD.md): JWT, RBAC, validación, auditoría y riesgos.
- [Roles y permisos](./docs/roles-cms.md).
- [Flujo editorial](./docs/FLUJO-EDITORIAL.md).
- [Supabase](./docs/supabase.md).

`INSTRUCCIONES.md` y `GUIA-DESPLIEGUE.md` no forman parte del repositorio; esta sección y `docs/despliegue.md` son las referencias canónicas para evitar guías duplicadas.

## Calidad y CI

El workflow `.github/workflows/ci.yml` ejecuta auditoría de dependencias, escaneo de secretos, lint, Prettier, validación editorial estricta, assets, pruebas Node, contrato de API, build, SEO, smoke tests y auditoría WCAG A/AA con Playwright. `main` y `staging` están protegidas y exigen el check `verify` antes del merge.

El sitio público no incluye el cliente de Supabase: autenticación, sesión y token se cargan únicamente en `/admin`. Las imágenes nuevas se validan y convierten a WebP redimensionado en `upload-media`; `manage-media` queda libre de Sharp para las operaciones normales. La CSP se genera con hashes por página y CI impide reintroducir `unsafe-inline`.
