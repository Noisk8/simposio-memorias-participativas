# Contenido editorial en Garage

Garage guarda el JSON completo de cada revisión (frontmatter y cuerpo), las imágenes y los documentos. Supabase conserva Auth, RBAC, auditoría y las referencias operativas: UUID, path, revisión, hashes, estado y publicación. La columna `data` de borradores/versiones pasa a contener exclusivamente `{ "_garage": { "version": 1, "key": "…", "sha256": "…" } }`; `body` queda vacío. No se crean tablas adicionales.

GitHub conserva una copia derivada del Markdown publicado para el build de Astro y su CI. El sitio público sigue siendo estático. Las nuevas publicaciones se construyen leyendo la versión completa desde Garage; no se requiere consultar Supabase desde el sitio público.

## Preparar Garage

Crear un bucket privado, sin website. En el servidor (o dentro del contenedor Garage):

```sh
garage bucket create cms-content
garage bucket allow --read --write --key <S3_ACCESS_KEY_ID> cms-content
```

Mantener `cms-media` público para imágenes y PDF; `cms-content` y `cms-backups` privados. No apuntar `S3_CONTENT_BUCKET` al bucket público. La migración comprueba que no exista configuración website, y que una solicitud anónima a un objeto de prueba esté bloqueada.

## Orden de despliegue y migración

1. Desplegar el código de esta rama con `CMS_CONTENT_STORAGE_PROVIDER=supabase` (o sin definirlo). Este backend lee tanto filas antiguas como referencias Garage. No migrar referencias con una versión anterior del backend.
2. Configurar en Netlify Functions y en el entorno local:

   ```dotenv
   CMS_CONTENT_STORAGE_PROVIDER=garage
   S3_CONTENT_BUCKET=cms-content
   ```

   Se reutilizan `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y `S3_FORCE_PATH_STYLE=true`. Activar un nuevo deploy con esa configuración. Estas variables nunca llevan el prefijo `PUBLIC_`.

3. Copiar y verificar sin modificar PostgreSQL:

   ```sh
   CONTENT_MIGRATION_REPORT=/tmp/garage-content-copy.json \
     node --env-file=.env --experimental-strip-types scripts/migrate-content-to-garage.mjs --copy
   ```

4. Comprobar desde el panel autenticado: crear borrador, guardar, recargar, editar, consultar historial y publicar una entrada de prueba. Verificar que PostgreSQL recibe una referencia y cuerpo vacío, y que la web publicada conserva el contenido. Mantener cualquier prueba sin publicar hasta decidir su publicación.
5. Después de comprobar el deploy, activar las referencias del contenido anterior:

   ```sh
   CMS_GARAGE_DEPLOY_VERIFIED=true CONTENT_MIGRATION_REPORT=/tmp/garage-content-apply.json \
     node --env-file=.env --experimental-strip-types scripts/migrate-content-to-garage.mjs --apply
   ```

   La copia se verifica con hash editorial y SHA-256 de todos los bytes antes de reemplazar cada fila. Un borrador que cambie de revisión o fecha durante la migración no se reemplaza: el proceso falla y puede repetirse. No se eliminan objetos Garage. Los informes no incluyen los textos ni credenciales; contienen los identificadores y hashes necesarios para localizar la copia.

6. Ejecutar en Supabase SQL Editor el archivo [`sql/finalizar-contenido-garage.sql`](sql/finalizar-contenido-garage.sql). Es la última fase: bloquea nuevas escrituras de texto en borradores/versiones y falla transaccionalmente si todavía queda alguna fila sin migrar. No ejecutarlo antes de desplegar el backend compatible.

Si se omite `CMS_CONTENT_STORAGE_PROVIDER`, los guardados siguen en Supabase durante la transición. No habilitar Garage sin configurar y comprobar el bucket. Las lecturas de referencias Garage funcionan independientemente de ese selector; no hay fallback que convierta errores S3 en contenido vacío.

## Copia del sitio actual

`snapshot-site-to-garage.mjs` copia todos los archivos versionados de `src/content/` y `public/` en un commit explícito, incluyendo medios legacy. No toma archivos sin commit ni modifica el sitio. El snapshot vive en `site-snapshots/<commit>/…` con un manifiesto de paths, tamaños y hashes.

```sh
CONTENT_SNAPSHOT_COMMIT=<sha-completo-del-commit-de-produccion> \
CONTENT_SNAPSHOT_REPORT=/tmp/garage-site-snapshot.json \
  node --env-file=.env --experimental-strip-types scripts/snapshot-site-to-garage.mjs
```

Cada objeto se descarga y compara antes de registrar el resultado. Un reintento no sobreescribe un objeto diferente. Este snapshot es una copia íntegra; no sustituye las referencias activas del editor ni cambia las URLs del sitio.

La migración existente `scripts/migrate-media-to-garage.mjs` sigue encargándose del catálogo de medios y sus URLs. `--copy` copia y verifica sin cambiar PostgreSQL; `--apply` activa las URLs nuevas. Si existen URLs de un dominio Garage anterior, configurar `S3_LEGACY_PUBLIC_BASE_URLS` en el servidor con esos orígenes HTTPS separados por comas. El código solo admite esos aliases explícitos y verifica los objetos en el endpoint S3 actual. No borra originales Supabase ni reemplaza referencias Markdown históricas automáticamente.

## Respaldo y recuperación

Configurar `S3_CONTENT_BUCKET` también en los secretos del entorno GitHub `production-backup`. El workflow exporta medios y el bucket editorial completo antes de cifrar el respaldo. `S3_BACKUP_BUCKET` continúa siendo el destino del archivo cifrado, no el almacén de trabajo.

Los objetos editoriales son inmutables por dirección: `content/<uuid>/<sha256-de-los-bytes>.json`. Dos escrituras concurrentes a una misma dirección tienen exactamente los mismos bytes. La revisión optimista en PostgreSQL decide qué versión queda activa; los objetos subidos por una operación fallida se conservan para no eliminar contenido que otra operación podría usar. La poda de objetos huérfanos no está implementada.

Después de activar las restricciones SQL, no volver a desplegar un backend que escriba textos en Supabase. Recuperar el servicio restaurando un backend compatible y el bucket privado. Las copias históricas de Supabase y los respaldos previos pueden contener textos anteriores: esta migración modifica las tablas activas, no borra esos respaldos históricos.
