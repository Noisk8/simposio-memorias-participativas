# Gestionar colecciones desde el panel propio

La ruta `/admin/gestion-colecciones` forma parte del panel autenticado exclusivamente con Supabase.

## Flujo

1. La persona inicia sesión en `/admin/login`.
2. El navegador envía el access token de Supabase a `create-coleccion`.
3. La función valida el JWT y exige `settings.manage`.
4. La función incorpora la colección genérica a `src/content.config.ts` y crea un Markdown de ejemplo.
5. La operación queda registrada en auditoría.

No se escribe ni se genera configuración de Decap o Git Gateway.

## Datos solicitados

- Nombre interno: identificador TypeScript en minúsculas, por ejemplo `ponentes`.
- Etiqueta visible: nombre comprensible para administración.
- Carpeta: debe coincidir con `src/content/<nombre>`.

El esquema inicial usa `genericContentSchema`, definido en `shared/content-model/base.ts`.

## Requisitos

- Sesión válida de Supabase.
- Permiso efectivo `settings.manage`.
- Variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN` y `GITHUB_REPO` configuradas en Functions.

## Desarrollo local

```bash
npm run dev:netlify
```

Abre `http://localhost:8888/admin/gestion-colecciones`.

## Limitación actual

La página crea la estructura de una colección, pero todavía no genera un formulario editorial completo para sus documentos. Esa capacidad pertenece a la siguiente fase de la API editorial.
