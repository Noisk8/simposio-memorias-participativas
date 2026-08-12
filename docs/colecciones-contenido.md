# Colecciones de contenido en Astro

Astro construye el sitio público desde Markdown bajo `src/content/`. `src/content.config.ts` conecta cada carpeta con un esquema Zod canónico de `shared/content-model/`.

## Colecciones actuales

| Colección    | Modelo            | CMS `manage-content` | Publicación                   |
| ------------ | ----------------- | -------------------- | ----------------------------- |
| `entradas`   | `entradaSchema`   | Sí                   | `/entradas/:slug`             |
| `memorias`   | `memoriaSchema`   | Sí                   | `/museo-memorias/:number`     |
| `paginas`    | `paginaSchema`    | Sí                   | `/:pagina` y rutas de edición |
| `simposios`  | `simposioSchema`  | Sí                   | `/ediciones/:slug`            |
| `categorias` | `categoriaSchema` | Sí                   | archivos taxonómicos          |
| `etiquetas`  | `etiquetaSchema`  | Sí                   | archivos taxonómicos          |

La API administrativa usa una allowlist fija y no acepta un nombre de colección arbitrario enviado por el navegador.
La navegación principal es configuración estática de `src/components/Header.astro`, no una colección editorial.

## Publicación

Entradas, memorias y páginas comparten `draft` y `publish_date`. Las rutas principales usan `filterPublished`, que excluye borradores y fechas futuras. Algunas rutas genéricas de colección solo comprueban `draft`; revisa la ruta concreta antes de asumir programación uniforme.

Limitación del panel: `manage-content` cambia una `publish_date` futura a la fecha actual cuando se publica. Por tanto, la programación desde el CMS está **Planeada**, aunque el helper público entienda fechas futuras en contenido creado directamente en el repositorio.

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
npm test
npm run build
```

`scripts/sync-collections.mjs --check` verifica carpetas y definiciones. `scripts/migrate-content-uuids.mjs --check` valida que cada documento tenga un UUID v4 único. Ambos se ejecutan durante el build sin reescribir fuentes.

## Referencias

- [Content Collections de Astro](https://docs.astro.build/en/guides/content-collections/)
- [Rutas de Astro](https://docs.astro.build/en/guides/routing/)
