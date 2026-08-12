# Manual del panel administrativo

El panel propio está disponible en `/admin/` y usa exclusivamente Supabase Auth. Las acciones se autorizan nuevamente en Netlify Functions mediante los permisos almacenados en Supabase.

## Acceso

1. Abre `/admin/`.
2. Si no hay sesión, el navegador redirige a `/admin/login`.
3. Introduce el correo y la contraseña de la cuenta creada por administración.
4. Al cerrar sesión, el cliente elimina la sesión local de Supabase.

El CMS anterior basado en Decap CMS, Netlify Identity y Git Gateway es **legacy** y no forma parte del acceso operativo.

## Gestión de contenidos

Ruta: `/admin/contenidos`.

El editor permite listar, buscar, crear, abrir, modificar y eliminar:

- entradas;
- memorias;
- páginas;
- simposios;
- categorías;
- etiquetas.

Cada documento tiene un `id` UUID v4. La Function lo genera al crear y conserva la identidad existente al editar; no se copia ni se modifica manualmente desde el formulario.

Para entradas, memorias y páginas muestra vistas de borradores y botones para guardar borrador o publicar. La vista previa interpreta un subconjunto de Markdown y permite seleccionar relaciones con simposios y taxonomías. Los archivos existentes muestran su historial de commits de GitHub.

La casilla `draft` determina la visibilidad pública de entradas, memorias y páginas. Al publicar, la Function guarda `draft: false`, normaliza `publish_date`, registra estado `published` y hace commit en GitHub. La nueva versión se verá cuando termine el siguiente deploy de Netlify.

El navegador conserva temporalmente un borrador local en `localStorage` mientras se escribe. Ese respaldo no sustituye el guardado en el servidor y no se sincroniza entre dispositivos.

### Workflow

El panel permite enviar un documento guardado a revisión y aprobar uno que esté `in_review`. Supabase conserva estado, propiedad y eventos.

Limitación actual: el botón Publicar usa el guardado directo y no exige que el documento haya pasado antes por `approved`. Solicitar cambios y archivar existen en la Function, pero aún no tienen controles en el panel. La obligatoriedad completa del workflow está **Planeada**.

## Crear memoria rápidamente

Ruta: `/admin/crear-memoria`.

El formulario usa el endpoint canónico `manage-content?collection=memorias`. Verifica `memoria.create`, valida el modelo y crea un borrador Markdown en GitHub. `/admin/crear-proyecto` se mantiene solo como redirección; la Function homónima fue retirada.

## Biblioteca de imágenes

Ruta: `/admin/medios`.

Estado actual:

- lista medios registrados en `cms_media` y almacenados en Supabase Storage;
- acepta únicamente JPEG, PNG, WebP y PDF, con un máximo de 2 MiB;
- valida MIME, extensión, contenido real, peso y dimensiones antes de almacenar;
- exige crédito, licencia y texto alternativo, o que la imagen se marque explícitamente como decorativa;
- reutiliza un archivo idéntico y rechaza una colisión con contenido diferente;
- impide eliminar una imagen cuando GitHub Code Search encuentra referencias en `src/content`.

Los campos de imagen del editor también pueden subir archivos a esta biblioteca. El campo guarda la URL pública estable devuelta por Storage; las rutas `/images/…` existentes siguen funcionando durante la migración.

## Usuarios y roles

Ruta: `/admin/gestion-usuarios`.

Con `users.read` se listan cuentas. Con `users.manage` se puede:

- crear una cuenta en Supabase Auth;
- asignar exactamente un rol efectivo;
- reemplazar el rol de una cuenta existente.

Los roles disponibles son `superadmin`, `admin`, `editor`, `reviewer`, `author` y `read_only`. Si no se proporciona contraseña, el backend genera una temporal. Con Resend configurado intenta enviarla por correo; sin esa configuración, el panel la muestra para compartirla mediante un canal seguro.

## Gestión de colecciones

Ruta: `/admin/gestion-colecciones`.

Con `settings.manage`, `manage-collections` crea en GitHub una definición basada en `genericContentSchema` y un `.gitkeep` para conservar el directorio vacío. No crea Markdown editorial. La nueva colección requiere revisión técnica y un nuevo build.

El CRUD automático para colecciones creadas por esta pantalla está **Planeado**: `manage-content` mantiene una allowlist fija y no acepta la nueva colección hasta implementar su modelo y soporte explícito.

## Desarrollo local

```bash
cp .env.example .env
npm run dev:netlify
```

Abre `http://localhost:8888/admin/`. Ejecutar solo Astro no habilita las Functions.

## Seguridad para personas editoras

- No compartas tokens ni la contraseña temporal en canales públicos.
- No copies valores de `SUPABASE_SERVICE_ROLE_KEY` o `GITHUB_TOKEN` al navegador.
- Un control oculto en la interfaz no concede ni revoca permisos; la decisión final se toma en servidor.
- Incluye el `requestId` al reportar un error del panel.
