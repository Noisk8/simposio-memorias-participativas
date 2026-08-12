# Crear memorias desde el panel

El nombre de este archivo se conserva por compatibilidad documental. El dominio actual usa “memorias”, no “proyectos”.

## Implementación canónica

- Página: `src/pages/admin/crear-memoria.astro`.
- Endpoint: `/.netlify/functions/manage-content?collection=memorias`.
- Permiso: `memoria.create`.
- Modelo: `memoriaSchema` compartido.
- Destino: `src/content/memorias/{numero}-{slug}.md` en GitHub.

`src/pages/admin/crear-proyecto` redirige a la ruta nueva por compatibilidad de navegación. La Function `create-proyecto` fue eliminada al no tener consumidores; no existe una segunda implementación de creación.

## Flujo

1. La persona inicia sesión con Supabase Auth.
2. El navegador envía el access token, no roles ni IDs de usuario.
3. La Function valida el JWT y consulta `memoria.create` en Supabase.
4. Valida el contenido y genera el path en servidor.
5. Genera un UUID v4 y crea un Markdown con `draft: true`, `workflow_state: draft` y propietario verificado.
6. Registra metadata editorial y auditoría en Supabase.
7. El commit en GitHub activa el deploy configurado externamente en Netlify.

## Variables server-side

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GITHUB_TOKEN=...
GITHUB_REPO=organizacion/repositorio
GITHUB_BRANCH=main
```

El token GitHub actual debe ser fine-grained, limitarse al repositorio y disponer de `Contents: Read and write`. La GitHub App está **Planeada**.

## Imágenes

El formulario rápido solicita una ruta `/images/...`; no incluye un selector ni subida embebida. Para subir la imagen usa `/admin/medios` o el editor general. La biblioteca actual escribe en `public/images/` de GitHub. Supabase Storage está **Planeado**.

## Desarrollo local

```bash
npm run dev:netlify
```

Abre `http://localhost:8888/admin/crear-memoria`. Ejecutar solo Astro no proporciona el endpoint.
