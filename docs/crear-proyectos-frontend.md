# Crear memorias desde el panel

El nombre de este archivo se conserva por compatibilidad documental. El dominio actual usa “memorias”, no “proyectos”.

## Implementación canónica

- Página: `src/pages/admin/crear-memoria.astro`.
- Endpoint: `/.netlify/functions/manage-content?collection=memorias`.
- Permiso: `memoria.create`.
- Modelo: `memoriaSchema` compartido.
- Destino de borrador: Supabase; al publicar, `src/content/memorias/{numero}-{slug}.md` en GitHub.

`src/pages/admin/crear-proyecto` redirige a la ruta nueva por compatibilidad de navegación. La Function `create-proyecto` fue eliminada al no tener consumidores; no existe una segunda implementación de creación.

## Flujo

1. La persona inicia sesión con Supabase Auth.
2. El navegador envía el access token, no roles ni IDs de usuario.
3. La Function valida el JWT y consulta `memoria.create` en Supabase.
4. Valida el contenido y genera el path en servidor.
5. Genera un UUID v4 y guarda el borrador, cuerpo, revisión y propietario verificado en Supabase.
6. Registra la auditoría; no escribe GitHub ni activa un deploy.
7. Solo la acción **Publicar** congela una versión y abre el PR técnico que, después de CI, activa Netlify.

## Variables server-side

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY_BASE64=...
GITHUB_REPO=organizacion/repositorio
GITHUB_BRANCH=main
```

La GitHub App es el mecanismo activo. `GITHUB_TOKEN` existe únicamente como fallback temporal obsoleto y no debe configurarse en instalaciones nuevas.

## Imágenes

El formulario rápido solicita una URL de imagen; no incluye un selector ni subida embebida. Para subirla usa `/admin/medios` o el editor general. La biblioteca guarda el binario en Supabase Storage y devuelve una URL pública estable. Las rutas `/images/…` continúan admitidas durante la migración.

## Desarrollo local

```bash
npm run dev:netlify
```

Abre `http://localhost:8888/admin/crear-memoria`. Ejecutar solo Astro no proporciona el endpoint.
