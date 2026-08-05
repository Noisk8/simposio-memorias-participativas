# Gestionar y crear colecciones desde el frontend

Además del CMS en `/admin`, el sitio tiene una página de gestión de colecciones accesible solo para administradores. Desde ahí puedes ver las colecciones existentes y crear nuevas sin editar manualmente `config.yml` ni `content.config.ts`.

---

## Componentes

- **Página de gestión:** `src/pages/admin/gestion-colecciones.astro`
- **Netlify Function:** `netlify/functions/create-coleccion.ts`
- **Inyección en el CMS:** `public/admin/index.html` (añade enlaces al sidebar del CMS)
- **Enlace en el header:** `src/components/Header.astro` (muestra el enlace **Admin** para usuarios admin)

---

## Acceso

1. Inicia sesión en el sitio con un usuario que tenga rol `admin`.
2. En el header aparecerá el enlace **Admin**.
3. Haz clic en **Admin** y elige:
   - **Crear nuevo memoria** (añade un ítem a la colección existente).
   - **Gestionar colecciones** (ver colecciones y crear nuevas).

También puedes acceder directamente a:

- `/admin/crear-memoria` — crear un ítem en la colección `memorias`.
- `/admin/gestion-colecciones` — gestionar colecciones.

---

## Crear una nueva colección

1. Ve a `/admin/gestion-colecciones` y desplázate a **Crear nueva colección**.
2. Completa los campos:
   - **Nombre interno:** identificador único, ej. `ponentes`.
   - **Etiqueta visible:** nombre que aparecerá en el CMS, ej. `Ponentes del simposio`.
   - **Carpeta:** ruta donde se guardarán los archivos, ej. `src/content/ponentes`.
   - **Slug:** patrón del nombre de archivo. Por defecto `{{slug}}`.
   - **Campos:** definición YAML de los campos del CMS.
3. Haz clic en **Crear colección**.

La Netlify Function hará lo siguiente:

1. Añadir la colección en `public/admin/config.yml`.
2. Añadir la colección en `src/content.config.ts` con un esquema básico.
3. Crear la carpeta `src/content/{nombre}` con un archivo de ejemplo.
4. Commitear los cambios en GitHub.
5. Netlify redeployará el sitio con la nueva colección disponible.

---

## Esquema por defecto

La función crea el siguiente esquema en `src/content.config.ts`:

```ts
const ponentes = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/ponentes' }),
  schema: z.object({
    title: z.string(),
    image: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});

export const collections = { memorias, ponentes };
```

> Si necesitas campos adicionales o más específicos en el esquema de Astro, edita `src/content.config.ts` manualmente después de crear la colección.

---

## Requisitos

- Usuario logueado con rol `admin`.
- Variable de entorno `GITHUB_TOKEN` configurada en Netlify (ver `.env.example`).
- El token debe tener permisos de escritura (`repo`) en el repositorio de GitHub.

---

## Limitaciones y seguridad

- **Solo admin:** la función rechaza la petición si el usuario no tiene rol `admin`.
- **No duplicados:** la función verifica que la colección no exista ya en `config.yml`.
- **Esquema básico:** el esquema inicial de Astro incluye `title`, `image` y `description`. Si defines campos adicionales en el CMS, añádelos también al esquema para evitar errores de compilación.
- **Backup:** la función no hace backup de los archivos. Si algo sale mal, revisa el commit en GitHub y reviértelo si es necesario.

---

## Probar en local

Para probar la función de crear colecciones localmente:

```bash
npm install -g netlify-cli
netlify dev
```

Asegúrate de tener un archivo `.env` con `GITHUB_TOKEN` exportado en el entorno del CLI.

---

## Referencias

- [Netlify Functions](https://docs.netlify.com/functions/overview/)
- [Netlify Identity](https://docs.netlify.com/identity/overview/)
- [Decap CMS Collections](https://decapcms.org/docs/collection-types/)
- [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/)
