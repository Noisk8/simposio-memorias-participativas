# I Simposio sobre Memorias Participativas

Sitio web del **I Simposio sobre Memorias Participativas** de la Universidad de Granada, construido con [Astro](https://astro.build), gestionado con [Decap CMS](https://decapcms.org) y desplegado en [Netlify](https://www.netlify.com/).

## Tecnologías

- **Framework:** Astro 7.
- **Interfaz:** React 19 y Tailwind CSS 4.
- **CMS:** Decap CMS con Netlify Identity y Git Gateway.
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

### CMS local y Netlify Dev

Para trabajar simultáneamente con Decap CMS, `decap-server`, Astro y Netlify Functions:

```bash
npm run dev:netlify-cms
```

Después abre:

```text
http://localhost:8888/admin/
```

El proxy local de Decap funciona en el puerto `8081`. Este flujo permite guardar contenido localmente sin depender de Git Gateway.

### CMS local solamente

```bash
npm run dev:cms
```

Este comando inicia `decap-server` junto con Astro.

### Otros comandos

```bash
npm run cms            # Inicia únicamente decap-server
npm run sync           # Sincroniza colecciones con Astro y Decap
npm run build          # Genera el sitio y el índice de Pagefind
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
│   ├── admin/
│   │   ├── index.html          # Interfaz personalizada de Decap CMS
│   │   └── config.yml          # Colecciones, campos y filtros del CMS
│   └── images/                 # Imágenes públicas del sitio y del CMS
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

Las secciones principales son:

- **Entradas**
- **Memorias del Museo de Memorias Vivas**
- **Páginas informativas**
- **Ediciones de simposio**
- **Categorías**
- **Etiquetas**
- **Borradores · Entradas**
- **Borradores · Memorias**
- **Borradores · Páginas**

La página administrativa adicional para crear una memoria es:

```text
/admin/crear-memoria
```

La ruta anterior `/admin/crear-proyecto` redirige a la nueva para mantener compatibilidad.

## Documentación

- **[Manual de usuario del CMS](./docs/MANUAL-USUARIO.md):** guía práctica para acceder al panel y gestionar entradas, memorias, páginas, taxonomías, imágenes y borradores.
- **[Instrucciones generales](./INSTRUCCIONES.md):** estructura, comandos y operaciones básicas.
- **[Guía de despliegue](./GUIA-DESPLIEGUE.md):** configuración y publicación en Netlify.
- **[Documentación técnica](./docs/):** colecciones, roles, creación de contenido y configuración del proyecto.
- **[Seguridad del CMS](./docs/SEGURIDAD.md):** autenticación, funciones administrativas, variables y checklist de seguridad.

Si una persona solo necesita gestionar contenidos, debe comenzar por el **[Manual de usuario del CMS](./docs/MANUAL-USUARIO.md)**.

## Calidad y validación

Antes de publicar cambios técnicos, se recomienda ejecutar:

```bash
npm run lint
npm run check
npm run build
```

El proyecto incluye ESLint, `astro check`, Prettier, validación de taxonomías y Pagefind.
