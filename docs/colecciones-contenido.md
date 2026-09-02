# Colecciones de contenido en Astro

Astro construye el sitio público desde Markdown bajo `src/content/`. `src/content.config.ts` conecta cada carpeta con un esquema Zod canónico de `shared/content-model/`.

## Colecciones actuales

| Colección    | Modelo            | CMS `manage-content` | Publicación                                           |
| ------------ | ----------------- | -------------------- | ----------------------------------------------------- |
| `entradas`   | `entradaSchema`   | Sí                   | actual: `/entradas/:slug`; archivo bajo `/ediciones/` |
| `memorias`   | `memoriaSchema`   | Sí                   | `/museo-memorias/:number`                             |
| `paginas`    | `paginaSchema`    | Sí                   | actual: `/:pagina`; archivo bajo `/ediciones/`        |
| `simposios`  | `simposioSchema`  | Sí                   | `/ediciones/:slug`                                    |
| `categorias` | `categoriaSchema` | Sí                   | archivos taxonómicos                                  |
| `etiquetas`  | `etiquetaSchema`  | Sí                   | archivos taxonómicos                                  |

La API administrativa usa una allowlist fija y no acepta un nombre de colección arbitrario enviado por el navegador.
La navegación principal es configuración estática de `src/components/Header.astro`, no una colección editorial.

## Publicación

Entradas, memorias y páginas comparten `draft` y `publish_date`. Las rutas editoriales usan `filterPublished`, que excluye borradores y fechas futuras. El CMS conserva una fecha futura y `scheduled-publish` solicita un build diario a las 00:05 de Bogotá; cuando llega el día, Astro incorpora el documento. `SCHEDULED_BUILD_HOOK_URL` es obligatorio para esta capacidad.

La edición predeterminada usa rutas cortas. Las rutas bajo `/ediciones/:edicion/` solo generan páginas y entradas para ediciones no predeterminadas, de modo que un documento no produzca dos páginas indexables. La página 1 del museo es siempre `/museo-memorias/`; `/museo-memorias/page/1` no se genera.

## Ejemplo de memoria

```md
---
id: '00000000-0000-4000-8000-000000000031'
draft: true
simposio: '2026'
number: 31
title: 'Título de la memoria'
place: 'Granada, España'
author: ''
collective: ''
categories: []
tags: []
image: '/images/proyecto-31.jpg'
description: 'Descripción breve'
---

Contenido en Markdown.
```

Antes de publicar, una entrada debe declarar `author`; una memoria debe declarar `author` o
`collective`. Ambas requieren descripción e imagen. Slugs, relaciones, taxonomías y colisiones de
ruta se validan en CI.

Todos los modelos actuales exigen `id` como UUID v4. El CMS genera ese identificador para documentos nuevos y preserva el existente en actualizaciones. El ejemplo usa un valor ilustrativo; no lo reutilices. El CMS añade además `owner_id` y `workflow_state` al guardar. No copies un ID de usuario desde el cliente: la Function lo obtiene de la sesión verificada.

El número público de una memoria se conserva en el campo histórico `number` y forma la URL `/museo-memorias/:number`. Es independiente de `id`; esta migración no lo renombra ni modifica sus valores.

En Astro, este valor se consulta como `entry.data.id`. No debe confundirse con `entry.id`, que lo calcula el loader a partir del archivo y puede depender de su nombre o ruta.

## Añadir una colección

Crear una colección es un cambio de código, aunque `/admin/gestion-colecciones` pueda generar el esqueleto. Una integración completa requiere:

1. definir o reutilizar un esquema en `shared/content-model/`;
2. registrar la colección en `src/content.config.ts`;
3. crear rutas públicas que usen `getCollection()` y `render()`;
4. decidir reglas de borrador, fecha y taxonomías;
5. añadir permisos y una entrada explícita a la allowlist del backend si será editable;
6. añadir campos y relaciones al panel;
7. probar build, autorización y publicación.

No construyas paths GitHub a partir de una carpeta libre enviada por el navegador.

## Comprobaciones

```bash
npx astro sync
npm run check:content-uuids
npm run check
npm run check:assets
npm test
npm run build
```

`scripts/sync-collections.mjs --check` verifica carpetas y definiciones. `scripts/migrate-content-uuids.mjs --check` valida que cada documento tenga un UUID v4 único. Ambos se ejecutan durante el build sin reescribir fuentes.

## Referencias

- [Content Collections de Astro](https://docs.astro.build/en/guides/content-collections/)
- [Rutas de Astro](https://docs.astro.build/en/guides/routing/)
