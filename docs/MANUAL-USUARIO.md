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

El recorrido normal tiene dos acciones: **Guardar borrador** y **Publicar**. La vista previa interpreta un subconjunto de Markdown y permite seleccionar relaciones con simposios y taxonomías. Los contenidos existentes muestran el historial de versiones guardadas en Supabase.

El servidor controla la visibilidad pública. Guardar nunca toca GitHub ni provoca un deploy. Publicar congela la versión actual y prepara internamente un Pull Request técnico; los checks y el merge son automáticos y la persona editora no necesita entrar en GitHub.

Después del primer guardado, el panel hace autosave en Supabase. También conserva temporalmente una copia en `localStorage` como respaldo ante una interrupción del navegador.

### Publicación

El botón **Publicar** aparece cuando existe una versión actual diferente de la publicada y la cuenta tiene permiso. El panel muestra `Publicación en curso`, `Desplegando`, `Publicado`, `Programado`, `Archivado` o el error correspondiente. Un fallo puede reintentarse sin duplicar una publicación activa.

Si **Fecha de publicación** es posterior al día actual, el panel conserva esa fecha y muestra **Programado**. El contenido versionado permanece oculto hasta el rebuild diario de las 00:05 de Bogotá. La unidad de programación es el día; para publicar de inmediato, deja la fecha vacía o usa hoy.

Una entrada publicable necesita autoría, tipo de autoría (persona u organización), descripción, imagen y cuerpo. Una memoria necesita una persona autora o un colectivo responsable, además de descripción, imagen y cuerpo. Slugs con mayúsculas, tildes o espacios, taxonomías inexistentes y referencias rotas son rechazados antes del PR.

Si se sigue editando durante una publicación, los nuevos cambios permanecen como borrador; no alteran la versión inmutable que ya estaba publicándose.

## Crear memoria rápidamente

Ruta: `/admin/crear-memoria`.

El formulario usa el endpoint canónico `manage-content?collection=memorias`. Verifica `memoria.create`, valida el modelo y crea el borrador en Supabase. `/admin/crear-proyecto` se mantiene solo como redirección; la Function homónima fue retirada.

## Biblioteca de imágenes

Ruta: `/admin/medios`.

Estado actual:

- lista medios registrados en `cms_media` y almacenados en Supabase Storage;
- acepta únicamente JPEG, PNG, WebP y PDF, con un máximo de 2 MiB;
- valida MIME, extensión, contenido real, peso y dimensiones antes de almacenar;
- exige crédito, licencia y texto alternativo, o que la imagen se marque explícitamente como decorativa;
- reutiliza un archivo idéntico y rechaza una colisión con contenido diferente;
- impide eliminar una imagen cuando GitHub Code Search o un borrador de Supabase contiene referencias;
- al reutilizar un archivo idéntico solo permite cambiar su metadata a perfiles con `media.update`.

Los campos de imagen del editor también pueden subir archivos a esta biblioteca. El campo guarda la URL pública estable devuelta por Storage; las rutas `/images/…` existentes siguen funcionando durante la migración.

## Usuarios y roles

Ruta: `/admin/gestion-usuarios`.

Con `users.read` se listan cuentas. Con `users.manage` se puede:

- crear una cuenta en Supabase Auth;
- asignar exactamente un rol efectivo;
- reemplazar el rol de una cuenta existente.

Las altas directas en Supabase quedan **sin rol** y no pueden entrar al panel. La única excepción es un correo predeclarado en `admin_emails`. Desde esta pantalla, administración debe escoger explícitamente el rol de la cuenta creada.

Los roles disponibles son `superadmin`, `admin`, `editor`, `reviewer`, `author` y `read_only`. Si no se proporciona contraseña, el backend genera una temporal. Con Resend configurado intenta enviarla por correo; sin esa configuración, el panel la muestra para compartirla mediante un canal seguro.

## Colecciones de contenido

El panel administra únicamente las colecciones canónicas del proyecto: entradas, memorias, páginas,
simposios, categorías y etiquetas. La creación de colecciones genéricas desde la interfaz está
deshabilitada porque no tendría todavía formulario, permisos, relaciones ni rutas públicas completas.
Una nueva colección debe incorporarse mediante un cambio de código revisado, su esquema de Astro,
permisos y pruebas correspondientes.

El CRUD automático para colecciones creadas por esta pantalla está **Planeado**: `manage-content` mantiene una allowlist fija y no acepta la nueva colección hasta implementar su modelo y soporte explícito.

## Desarrollo local

```bash
cp .env.example .env
npm run dev:netlify
```

Abre `http://localhost:8888/admin/`. Ejecutar solo Astro no habilita las Functions.

## Seguridad para personas editoras

- No compartas tokens ni la contraseña temporal en canales públicos.
- No copies valores de `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_PRIVATE_KEY` o `GITHUB_TOKEN` al navegador.
- Un control oculto en la interfaz no concede ni revoca permisos; la decisión final se toma en servidor.
- Incluye el `requestId` al reportar un error del panel.
