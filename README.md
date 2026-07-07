# I Simposio sobre Memorias Participativas

Sitio web del **I Simposio sobre Memorias Participativas** de la Universidad de Granada, construido con [Astro](https://astro.build) y gestionado con [Decap CMS](https://decapcms.org) (anteriormente Netlify CMS).

## Tecnologías

- **Framework**: Astro 7
- **UI**: React 19 + Tailwind CSS 4
- **CMS**: Decap CMS con autenticación Netlify Identity
- **Backend serverless**: Netlify Functions
- **Hosting**: Netlify

## Arquitectura de contenido

El proyecto sigue una arquitectura tipo **WordPress**:

- **Entradas**: posts genéricos (noticias, artículos) con fecha, autor, categorías y etiquetas.
- **Proyectos**: custom post type del *Museo de Memorias Vivas*.
- **Categorías**: taxonomía jerárquica.
- **Etiquetas**: taxonomía plana de palabras clave.
- **Borradores**: colecciones filtradas por `draft: true` para gestión de borradores.

## Scripts disponibles

```bash
npm run dev          # Servidor de desarrollo
npm run build        # Build de producción
npm run preview      # Vista previa del build
npm run check        # Type-check con astro check
npm run lint         # ESLint
npm run lint:fix     # ESLint con auto-fix
npm run format       # Formatear con Prettier
npm run format:check # Verificar formato con Prettier
npm run sync         # Sincronizar content.config.ts y config.yml
```

## Estructura del proyecto

```
simposio-memorias/
├── public/
│   └── admin/              # Interfaz de Decap CMS
│       ├── index.html      # UI custom: previews, borradores, admin overlay
│       └── config.yml      # Configuración de colecciones
├── netlify/functions/      # Funciones serverless (gestión de usuarios, colecciones)
├── scripts/
│   └── sync-collections.mjs # Sincroniza carpetas de src/content con config
├── src/
│   ├── components/         # Componentes Astro/React
│   ├── content/            # Colecciones de contenido (Markdown)
│   ├── layouts/            # Layouts Astro
│   ├── lib/                # Utilidades (taxonomías, fechas)
│   ├── pages/              # Páginas y rutas dinámicas
│   └── styles/             # Estilos globales + Tailwind
├── astro.config.mjs
├── netlify.toml
└── package.json
```

## Documentación adicional

- [`INSTRUCCIONES.md`](./INSTRUCCIONES.md) — Guía rápida de uso y despliegue.
- [`GUIA-DESPLIEGUE.md`](./GUIA-DESPLIEGUE.md) — Despliegue paso a paso en Netlify.
- [`docs/`](./docs/) — Documentación técnica adicional.

## Calidad de código

El proyecto incluye:

- `astro check` para type-checking de archivos `.astro` y TypeScript.
- ESLint con `eslint-plugin-astro` y `@typescript-eslint`.
- Prettier con `prettier-plugin-astro`.

---

Generado a partir del template [Astro Starter Kit: Blog](https://github.com/withastro/astro/tree/main/examples/blog).
