# Colecciones y extensibilidad

El panel no permite crear colecciones genéricas. Administra seis colecciones canónicas con esquemas,
permisos, relaciones y rutas públicas completas.

## Qué hace

1. El navegador envía el JWT a `manage-collections`.
2. La Function valida sesión, permiso, CORS, rate limit y payload.
3. Comprueba que nombre y carpeta correspondan a `src/content/<nombre>`.
4. Modifica `src/content.config.ts` para usar `genericContentSchema`.
5. Crea `src/content/<nombre>/.gitkeep`; no crea contenido editorial ficticio.
6. Registra la acción en auditoría.

No se genera configuración del CMS legacy ni se modifica la autorización.

## Requisitos

- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
- `GITHUB_TOKEN`, `GITHUB_REPO` y, opcionalmente, `GITHUB_BRANCH`.
- Un identificador TypeScript en minúsculas con guion bajo permitido.
- Carpeta exacta `src/content/<nombre>`.

## Limitaciones

- La operación realiza dos commits/escrituras GitHub sin transacción entre ellos: configuración y marcador de directorio.
- El esquema genérico incluye el `id` UUID v4 obligatorio, además de `simposio`, `title`, `date`, `image` y `description`.
- No crea rutas públicas.
- No añade la colección a la allowlist de `manage-content` ni genera formularios del panel.
- La colección requiere revisión de código, pruebas y un build exitoso.

Las colecciones nuevas requieren un cambio de código revisado y no se habilitan automáticamente.

`create-coleccion` se conserva temporalmente como wrapper para clientes externos, añade cabeceras `Deprecation`, `Warning` y `Link`, y ejecuta exactamente la misma autorización, validación, rate limit y auditoría que `manage-collections`. El panel ya no lo consume.

## Desarrollo local

```bash
npm run dev:netlify
```

Abre `http://localhost:8888/admin/gestion-colecciones`.
