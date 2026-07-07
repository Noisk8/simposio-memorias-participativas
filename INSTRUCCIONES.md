# I Simposio sobre Memorias Participativas - Sitio Web

## Tecnologías Utilizadas

- **Framework**: Astro 7
- **UI**: React 19
- **Estilos**: Tailwind CSS 4
- **CMS**: Decap CMS (antes Netlify CMS) con Netlify Identity
- **Hosting**: Netlify (gratuito)

## Estructura del Proyecto

```
simposio-memorias/
├── public/
│   └── admin/
│       ├── index.html          # Interfaz del CMS (previews, borradores, admin overlay)
│       └── config.yml          # Configuración Decap CMS
├── netlify/functions/          # Funciones serverless
│   ├── create-coleccion.ts
│   ├── create-proyecto.ts
│   ├── identity-signup.ts
│   └── manage-users.ts
├── scripts/
│   └── sync-collections.mjs    # Sincroniza carpetas de src/content con config.yml
├── src/
│   ├── components/             # Componentes Astro/React
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── TermPills.astro
│   │   └── ...
│   ├── layouts/
│   │   └── Layout.astro        # Layout principal
│   ├── pages/                  # Páginas y rutas dinámicas
│   │   ├── index.astro
│   │   ├── entradas/           # Listado y detalle de entradas
│   │   ├── categorias/         # Archivos de categorías
│   │   ├── etiquetas/          # Archivos de etiquetas
│   │   ├── museo-memorias/     # Proyectos del Museo
│   │   └── admin/              # Páginas de gestión de admin
│   ├── content/                # Colecciones de contenido Markdown
│   │   ├── entradas/
│   │   ├── proyectos/
│   │   ├── categorias/
│   │   ├── etiquetas/
│   │   └── pages/
│   ├── lib/                    # Utilidades (taxonomías, fechas)
│   └── styles/                 # Estilos globales + Tailwind
├── astro.config.mjs
├── netlify.toml
└── package.json
```

## Colecciones de contenido (CMS)

El CMS está organizado como en WordPress:

| Colección | Tipo | Descripción |
|-----------|------|-------------|
| **Entradas** | Posts | Noticias y artículos con fecha, autor, categorías y etiquetas. |
| **Proyectos** | Custom post type | Proyectos del *Museo de Memorias Vivas*. |
| **Categorías** | Taxonomía jerárquica | Clasificación en árbol padre/hijo. |
| **Etiquetas** | Taxonomía plana | Palabras clave. |
| **Borradores · Entradas** | Filtro | Entradas con `draft: true`. |
| **Borradores · Proyectos** | Filtro | Proyectos con `draft: true`. |

Los borradores usan el mismo almacenamiento que el contenido publicado, pero se filtran por el campo `draft`. El panel de *Borradores recientes* en `/admin/` permite accesos rápidos.

## Instrucciones de Despliegue

Ver [`GUIA-DESPLIEGUE.md`](./GUIA-DESPLIEGUE.md) para el despliegue paso a paso en Netlify.

## Comandos Útiles

```bash
# Desarrollo local
npm run dev

# Construir el sitio
npm run build

# Vista previa del sitio construido
npm run preview

# Calidad de código
npm run check        # astro check
npm run lint         # ESLint
npm run lint:fix     # ESLint con auto-fix
npm run format       # Prettier
npm run format:check # Prettier sin escribir
```

## Personalización

### Cambiar Colores

Los colores principales se definen en `src/styles/global.css`:

```css
--ugr-green: #2f680c;
--ugr-green-light: #70a87a;
--ugr-green-dark: #1e4a08;
--ugr-cream: #f5f0e8;
```

### Agregar Contenido

1. Acceder al CMS en `/admin/`.
2. Seleccionar la colección (Entradas, Proyectos, Categorías, Etiquetas).
3. Crear nueva entrada.
4. Pulsar **Publish** para publicar o **Guardar como borrador** para guardar como borrador.

### Fecha automática

El CMS rellena automáticamente la fecha de publicación (`date`) con la fecha actual si se deja vacía.

## Soporte

Para problemas o preguntas, contactar a través del formulario de contacto en el sitio web.
