# I Simposio sobre Memorias Participativas

Sitio web del **I Simposio sobre Memorias Participativas** de la Universidad de Granada, construido con [Astro](https://astro.build) y desplegado en [Netlify](https://www.netlify.com/). El panel administrativo usa Supabase Auth y RBAC granular como única autoridad de identidad.

## Tecnologías

- **Framework:** Astro 7.
- **Interfaz:** React 19 y Tailwind CSS 4.
- **CMS propio:** Supabase Auth + Netlify Functions.
- **Contenido:** Markdown mediante Astro Content Collections.
- **Funciones serverless:** Netlify Functions.
- **Búsqueda:** Pagefind.
- **Hosting:** Netlify.

## Arquitectura de contenido

El proyecto sigue una arquitectura editorial inspirada en WordPress:

- **Entradas:** noticias, artículos y novedades generales.
- **Memorias del Museo:** piezas, experiencias y registros del [Museo de Memorias Vivas](https://simposio-memorias-participativas.netlify.app/museo-memorias/). En WordPress equivalen a un tipo de contenido personalizado.
- **Páginas informativas:** páginas estructurales como El Simposio, Organización, Programa y Contacto.
- **Ediciones de simposio:** información general de cada edición, año, lugar, tema, cartel y programa.
- **Categorías:** taxonomía jerárquica para clasificar temáticamente entradas y memorias.
- **Etiquetas:** taxonomía plana para palabras clave.
- **Borradores:** colecciones filtradas mediante `draft: true`; no aparecen en el sitio público.

Las colecciones principales se encuentran en:

```text
src/content/
├── entradas/
├── memorias/
├── paginas/
├── simposios/
├── categorias/
├── etiquetas/
└── menus/
```

La página pública `/museo-memorias/` funciona como archivo de las memorias. Las rutas públicas de cada memoria se mantienen en `/museo-memorias/:number`.

## Desarrollo local

### Sitio Astro

Para trabajar en páginas, estilos y contenido sin funciones Netlify:

```bash
npm run dev
```

### Backend local con Supabase y Netlify Functions

Para ejecutar Astro junto con las Netlify Functions —incluidos los endpoints que validan usuarios y roles contra Supabase— copia `.env.example` a `.env` y completa las variables. La clave `SUPABASE_SERVICE_ROLE_KEY` solo debe existir en `.env` o en Netlify; nunca se expone al navegador.

```bash
cp .env.example .env
# Edita .env y añade las credenciales de tu proyecto Supabase
npm run dev:netlify
```

Abre la aplicación en:

```text
http://localhost:8888
```

El backend local queda disponible bajo `/.netlify/functions/*`. La URL pública y la anon key se inyectan también en `/admin/supabase-config.js`, mientras que la service role key solo la usa el backend.

### Otros comandos

```bash
npm run sync           # Verifica carpetas y Content Collections sin reescribir fuentes
npm run build          # Genera el sitio y el índice de Pagefind
npm run test           # Ejecuta pruebas unitarias y de autorización
npm run preview        # Previsualiza el build de producción
npm run check          # Ejecuta lint de taxonomías y astro check
npm run lint           # Ejecuta ESLint
npm run lint:fix       # Corrige problemas de ESLint cuando es posible
npm run format         # Formatea el proyecto
npm run format:check  # Comprueba el formato
```

## Estructura del proyecto

```text
simposio-memorias/
├── public/
│   └── images/                 # Imágenes públicas existentes
├── src/
│   ├── assets/                 # Fuentes y recursos procesados por Astro
│   ├── components/             # Componentes reutilizables Astro/React
│   ├── content/                # Colecciones Markdown
│   │   ├── categorias/
│   │   ├── entradas/
│   │   ├── etiquetas/
│   │   ├── memorias/
│   │   ├── menus/
│   │   ├── paginas/
│   │   └── simposios/
│   ├── layouts/                # Layouts generales del sitio
│   ├── lib/                    # Taxonomías, fechas y utilidades
│   ├── pages/                  # Rutas públicas y administrativas
│   │   ├── admin/              # Gestión adicional del CMS
│   │   ├── categorias/
│   │   ├── entradas/
│   │   ├── etiquetas/
│   │   ├── ediciones/
│   │   ├── museo-memorias/
│   │   └── simposios.astro
│   └── styles/                 # Estilos globales y Tailwind
├── netlify/
│   └── functions/              # Funciones serverless
├── scripts/
│   ├── lint-taxonomies.mjs     # Valida categorías y etiquetas
│   └── sync-collections.mjs    # Sincroniza carpetas y configuraciones
├── docs/
│   ├── MANUAL-USUARIO.md       # Manual de gestión de contenidos
│   └── ...                     # Documentación técnica adicional
├── astro.config.mjs
├── netlify.toml
├── package.json
└── tsconfig.json
```

## Panel de administración

El panel está disponible en:

```text
/admin/
```

Si no hay sesión, redirige a `/admin/login`. Tanto el encabezado como todas las páginas administrativas usan la misma sesión de Supabase.

El panel gestiona entradas, memorias, páginas, ediciones, categorías, etiquetas, medios, usuarios y roles. Los contenidos editoriales cuentan con propiedad, borradores, revisión, aprobación y publicación.

La página administrativa adicional para crear una memoria es:

```text
/admin/crear-memoria
```

Las funciones administrativas no confían en roles enviados por el navegador: validan el JWT de Supabase y consultan permisos efectivos en PostgreSQL. Antes de desplegarlas aplica la migración indicada en [`docs/FASE-1-RBAC.md`](./docs/FASE-1-RBAC.md).

La ruta anterior `/admin/crear-proyecto` redirige a la nueva para mantener compatibilidad.

## Documentación

- **[Manual de usuario del CMS](./docs/MANUAL-USUARIO.md):** guía práctica para acceder al panel y gestionar entradas, memorias, páginas, taxonomías, imágenes y borradores.
- **[Instrucciones generales](./INSTRUCCIONES.md):** estructura, comandos y operaciones básicas.
- **[Guía de despliegue](./GUIA-DESPLIEGUE.md):** configuración y publicación en Netlify.
- **[Documentación técnica](./docs/):** colecciones, roles, creación de contenido y configuración del proyecto.
- **[Seguridad del CMS](./docs/SEGURIDAD.md):** autenticación, funciones administrativas, variables y checklist de seguridad.
- **[Fase 1: RBAC y seguridad](./docs/FASE-1-RBAC.md):** migración, despliegue, pruebas y reversión.

Si una persona solo necesita gestionar contenidos, debe comenzar por el **[Manual de usuario del CMS](./docs/MANUAL-USUARIO.md)**.

## Calidad y validación

Antes de publicar cambios técnicos, se recomienda ejecutar:

```bash
npm run lint
npm run test
npm run check
npm run format:check
npm run build
```

El proyecto incluye ESLint, `astro check`, Prettier, validación de taxonomías y Pagefind.
