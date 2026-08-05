# Colecciones de contenido en Astro

Este proyecto usa las **content collections** de Astro para organizar contenido Markdown con frontmatter tipado. A continuación se explica cómo crear nuevas colecciones y cómo mostrarlas en el sitio.

---

## ¿Qué son las colecciones de contenido?

Las colecciones son grupos de archivos de contenido (por defecto Markdown) ubicados en `src/content/`. Cada colección tiene:

- Una carpeta propia dentro de `src/content/`.
- Un esquema de Zod definido en `src/content.config.ts`.
- Acceso tipado desde cualquier página de Astro mediante `getCollection()`.

---

## Colección actual: `memorias`

### Definición en `src/content.config.ts`

```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const memorias = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/memorias' }),
  schema: z.object({
    number: z.number(),
    title: z.string(),
    place: z.string(),
    author: z.string().optional().default(''),
    collective: z.string().optional().default(''),
    image: z.string(),
    description: z.string().optional().default(''),
  }),
});

export const collections = { memorias };
```

### Estructura de un archivo de la colección

Ubicación: `src/content/memorias/1-arte-sacro-social.md`

```md
---
number: 1
title: "Exposición de Arte Sacro-Social «San Miguel Harto»"
place: "Granada, España"
author: ""
collective: "Asociación de Vecinxs del Cerro de San Miguel"
image: "/images/proyecto-1.jpg"
description: "Lo sagrado y lo social se hibridan para crear una experiencia artística comunitaria."
---

En el barrio de cuevas del Cerro de San Miguel...
```

- El frontmatter debe cumplir el esquema definido en `content.config.ts`.
- El cuerpo del Markdown es el contenido principal y se puede renderizar con `render()` o `render(entry)`.

---

## Crear una nueva colección

Sigue estos pasos para agregar una colección nueva, por ejemplo `publicaciones`:

### 1. Crear la carpeta de contenido

```bash
mkdir src/content/publicaciones
```

### 2. Definir la colección en `src/content.config.ts`

```ts
const publicaciones = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/publicaciones' }),
  schema: z.object({
    title: z.string(),
    author: z.string(),
    date: z.date(),
    tags: z.array(z.string()).optional().default([]),
    featured: z.boolean().optional().default(false),
  }),
});

export const collections = { memorias, publicaciones };
```

### 3. Crear archivos de contenido

Ejemplo: `src/content/publicaciones/introduccion-memorias.md`

```md
---
title: "Introducción a las memorias participativas"
author: "Nombre del autor"
date: 2026-07-02
tags: ["memoria", "participación"]
featured: true
---

Texto del artículo en Markdown.
```

### 4. Sincronizar tipos

Después de modificar `content.config.ts`, ejecuta:

```bash
npx astro sync
```

Esto regenera `src/content.config.ts` y los tipos de `.astro/types.d.ts` para que `getCollection` reconozca la nueva colección.

---

## Mostrar colecciones en una página

### Listado de ítems

Crea una página en `src/pages/publicaciones.astro`:

```astro
---
import { getCollection } from 'astro:content';
import Layout from '../layouts/Layout.astro';

const publicaciones = await getCollection('publicaciones');
---

<Layout title="Publicaciones">
  <section class="py-16 bg-white">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-3xl font-bold mb-8">Publicaciones</h1>

      <ul class="space-y-6">
        {publicaciones.map((entry) => (
          <li class="border-b pb-4">
            <a href={`/publicaciones/${entry.id}/`} class="text-xl font-semibold hover:underline">
              {entry.data.title}
            </a>
            <p class="text-sm text-gray-600">{entry.data.author} — {entry.data.date.toLocaleDateString('es-ES')}</p>
          </li>
        ))}
      </ul>
    </div>
  </section>
</Layout>
```

### Mostrar el contenido de un ítem individual

Crea una ruta dinámica: `src/pages/publicaciones/[id].astro`

```astro
---
import { getCollection, render } from 'astro:content';
import Layout from '../../layouts/Layout.astro';

export async function getStaticPaths() {
  const publicaciones = await getCollection('publicaciones');

  return publicaciones.map((entry) => ({
    params: { id: entry.id },
    props: { entry },
  }));
}

const { entry } = Astro.props;
const { Content } = await render(entry);
---

<Layout title={entry.data.title}>
  <article class="py-16 max-w-3xl mx-auto px-4">
    <h1 class="text-4xl font-bold mb-4">{entry.data.title}</h1>
    <p class="text-gray-600 mb-8">{entry.data.author}</p>
    <div class="prose">
      <Content />
    </div>
  </article>
</Layout>
```

Astro generará automáticamente una página por cada archivo de la colección.

---

## Aplicar estilos del proyecto a los listados

El proyecto usa Tailwind CSS. Para mantener la coherencia visual, se recomienda reutilizar las clases y componentes existentes:

- Colores: `bg-ugr-cream`, `text-ugr-green-dark`, `text-ugr-text`.
- Tipografía: `font-[family-name:var(--font-heading)]`.
- Botones: `btn-green`.
- Tarjetas: `card-shadow`.

Ejemplo de tarjeta para la colección `memorias`:

```astro
<div class="card-shadow bg-white rounded-xl overflow-hidden">
  <img src={entry.data.image} alt={entry.data.title} class="w-full h-48 object-cover" />
  <div class="p-6">
    <h3 class="text-xl font-bold text-ugr-green-dark">{entry.data.title}</h3>
    <p class="text-ugr-text-light mt-2">{entry.data.place}</p>
    <p class="text-ugr-text mt-4">{entry.data.description}</p>
  </div>
</div>
```

---

## Buenas prácticas

1. **Mantener los nombres de colección en minúsculas y sin espacios.** Astro usa el nombre de la carpeta como identificador.
2. **Usar Zod para validar el frontmatter.** Esto evita errores en tiempo de compilación y proporciona autocompletado en el editor.
3. **Ejecutar `npx astro sync` después de crear o modificar colecciones.** Esto actualiza los tipos generados.
4. **Nombrar las rutas dinámicas con corchetes**, por ejemplo `[id].astro`, `[slug].astro` o `[...page].astro`.
5. **Usar `render()` para mostrar el contenido Markdown.** No se debe usar directamente el campo `body`; `render()` devuelve el componente `<Content />`.

---

## Referencias

- [Content collections en Astro](https://docs.astro.build/en/guides/content-collections/)
- [Definir colecciones con `defineCollection`](https://docs.astro.build/en/guides/content-collections/#defining-a-collection)
- [Rutas dinámicas en Astro](https://docs.astro.build/en/guides/routing/)
