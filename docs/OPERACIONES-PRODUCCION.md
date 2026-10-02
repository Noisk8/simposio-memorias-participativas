# Operaciones de producción

## Entornos

- `main` es producción y debe aceptar cambios únicamente mediante Pull Request con el check `verify` aprobado.
- `staging` usa un proyecto Supabase independiente y el contexto de rama de Netlify. Nunca debe compartir `SUPABASE_SERVICE_ROLE_KEY`, usuarios ni base de datos con producción.
- El Environment `staging` de GitHub requiere `STAGING_URL` y los secretos `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `E2E_ADMIN_EMAIL` y `E2E_ADMIN_PASSWORD`.

Hasta que exista ese proyecto aislado, las cuatro variables Supabase de la rama `staging` deben conservar valores inertes. El sitio estático seguirá disponible, pero el CMS y el E2E autenticado permanecerán deliberadamente deshabilitados.

## Publicación y archivo

Una operación solo es terminal cuando el PR está fusionado y la API de Netlify devuelve un deploy de contexto `production`, estado `ready` y `commit_ref` idéntico al SHA del merge. `cms-operations` reconcilia intentos pendientes cada diez minutos. Los reintentos de las RPC de merge y finalización son idempotentes.

El runtime de Netlify confirma el deploy actual mediante `COMMIT_REF`, `DEPLOY_ID` y `CONTEXT`. Para reconciliar también despliegues históricos pueden configurarse:

- `NETLIFY_SITE_ID`;
- `NETLIFY_API_TOKEN`, con acceso de solo lectura al sitio correspondiente.

`ALERT_WEBHOOK_URL` sí es obligatorio para que los fallos salgan de los logs de Netlify y lleguen al canal de guardia.

## Verificación de producción (CI)

En cada push a `main`, el workflow `verify` espera a que el deploy de Netlify del commit quede `ready` (`scripts/wait-netlify-ready.mjs`) y luego comprueba que las rutas publicadas respondan `200` en el sitio real (`scripts/verify-production.mjs`). El script extrae las URL de las páginas emitidas por el build (`dist/`) y filtra por entradas, categorías, etiquetas, páginas, museo y ediciones.

Este paso se publica como status check **informativo** (`continue-on-error: true`): un `404` marca el check en rojo sin detener el deploy ya `ready`. Es intencional para no bloquear una publicación por un falso positivo; una vez constatado estable en varias publicaciones, puede pasarse a bloqueante. `SITE_URL` y el `NETLIFY_SITE_ID` son públicos; no requieren token.

## Programación editorial

`scheduled-publish` se ejecuta a las 05:05 UTC (00:05 en Bogotá) y hace `POST` a `SCHEDULED_BUILD_HOOK_URL`. El build hook debe estar limitado a la rama `main`; no reutilices un hook de previews. El rebuild hace visibles los Markdown con `publish_date` igual al nuevo día sin crear commits vacíos.

Usa **hooks separados por entorno** y alterna el valor de `SCHEDULED_BUILD_HOOK_URL` según dónde corras:

- Producción (`main`): build hook del sitio `simposio-memorias-participativas`.
- Staging: build hook del sitio `staging--simposio-memorias-participativas`.

Prueba de activación:

1. crear en staging una entrada con fecha del día siguiente y publicarla;
2. confirmar que el PR/deploy termina pero la URL todavía responde 404;
3. invocar el hook de staging después de adelantar la fecha o al llegar el día;
4. confirmar URL 200, canonical único y alerta ausente;
5. archivar el contenido temporal.

Una respuesta no 2xx o una variable ausente genera un error operativo y una alerta. La siguiente ejecución reintenta el build; no modifica la fecha editorial.

## Respaldo

El workflow `Encrypted production backup` se ejecuta diariamente y exige un respaldo completo:

- esquema y datos exportados por Supabase CLI;
- catálogo de `cms_media` activo y sus binarios, comprobados por checksum;
- objetos de Garage/S3 con manifiesto de rutas, tamaños, SHA-256 y metadata;
- Markdown publicado de `src/content`.

El destino principal es un **bucket privado de Garage**, configurado mediante
`S3_BACKUP_BUCKET`, distinto de `cms-media`. Después del cifrado y la comprobación local,
la subida se verifica descargando el objeto y comparando tamaño y SHA-256. GitHub Actions
conserva una segunda copia verificada durante 30 días, incluso si falla la subida a Garage.
Si falla la exportación o la comprobación local no se publica un artefacto parcial.

El Environment `production-backup` debe disponer de estos secretos (los de Netlify no se
transfieren automáticamente a GitHub):

- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`;
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
- `BACKUP_ENCRYPTION_KEY`: al menos 32 caracteres generados aleatoriamente; conservar una
  copia segura fuera del servidor de medios para poder restaurar;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET=cms-media`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true`, `S3_PUBLIC_BASE_URL`;
- `S3_BACKUP_BUCKET`: bucket privado existente, con permisos de lectura y escritura para
  la credencial S3. El script comprueba que sea distinto del bucket público, pero la
  privacidad debe verificarse en Garage y en su proxy.

La validación aborta antes de exportar si falta algún secreto obligatorio. No se permite
omitir silenciosamente PostgreSQL o el catálogo editorial.

### Certificado TLS de Garage

Preferir un certificado HTTPS válido para el hostname de `S3_ENDPOINT`, con su cadena
completa. Si el servidor usa deliberadamente una CA privada, añadir `S3_CA_CERT_PEM` al
Environment: certificados de confianza en formato PEM obtenidos del administrador por un
canal confiable, **sin claves privadas**. El workflow valida formato y vigencia, crea un
archivo temporal con permisos 0600 y configura `NODE_EXTRA_CA_CERTS` antes de iniciar los
exportadores y la subida. El archivo se elimina al terminar el paso.

No usar `NODE_TLS_REJECT_UNAUTHORIZED=0` ni desactivar la comprobación del certificado.
La CA adicional no corrige un hostname incorrecto, un certificado vencido o una cadena
mal configurada. El soporte es exclusivo del backup; no cambia TLS del sitio ni del CMS.

### Capacidad y alcance

Los 30 días de retención aplican a GitHub, no a Garage: configurar y verificar por separado
la retención del bucket privado. El script actual admite archivos cifrados de hasta 5 GiB.
La copia de Garage comparte el riesgo del servidor que contiene los originales; conservar
la copia independiente y comprobar periódicamente que puede descargarse y restaurarse.
Los exportadores pueden incluir dos copias de medios Garage registrados en el catálogo;
considerar ese espacio al dimensionar el runner y el bucket.

La exportación de Supabase CLI no equivale por sí sola a una copia integral del servicio
Auth y su configuración. Verificar el alcance de los esquemas exportados y documentar la
recuperación de usuarios, roles, secretos y configuración antes de asumir recuperación total.

Para verificar el cambio: ejecutar manualmente el workflow, confirmar la descarga verificada
en Garage y el artefacto de GitHub, y ensayar la restauración en un entorno aislado.

## Restauración

La restauración siempre se ensaya primero en un proyecto Supabase vacío de recuperación:

1. Descargar el artefacto y verificar su checksum desde GitHub Actions.
2. Descifrarlo con `openssl enc -d -aes-256-cbc -pbkdf2` y extraerlo.
3. Aplicar `database/schema.sql` y después `database/data.sql` con `psql` sobre el proyecto de recuperación.
4. Restaurar los objetos de `garage/cms-media/` en Garage según `garage-manifest.json`.
   Restaurar los de `storage/cms-media/` al proveedor identificado por `media-manifest.json`,
   conservando rutas y metadata; verificar SHA-256 y evitar duplicar objetos ya restaurados.
   Recuperar el Markdown desde `published-content/` cuando sea necesario.
5. Comparar los conteos de `cms_content_records`, `cms_content_versions`, `cms_media` y `audit_log`.
6. Ejecutar `npm run check`, el E2E autenticado contra recuperación y una descarga por checksum de una muestra de medios.
7. Documentar fecha, duración, responsable y diferencias. El objetivo de recuperación es RPO 24 horas y RTO 4 horas.

No se restaura directamente sobre producción sin aprobación explícita y una ventana de mantenimiento.

## Monitoreo y alertas

La función programada `cms-operations` comprueba cada diez minutos:

- publicaciones pendientes;
- acceso a PostgreSQL y poda de datos operativos;
- acceso a GitHub;
- último deploy de Netlify;
- disponibilidad HTTP del sitio público.

También limpia recursos operacionales terminales: después de siete días cierra PR fallidos/cancelados, elimina exclusivamente ramas que coincidan con `cms/<uuid>/<timestamp>` y registra `operational_cleaned_at`. La poda SQL conserva auditoría 365 días, eventos editoriales 730 días y elimina intentos terminales ya limpiados a los 180 días (fallidos/cancelados) o 730 días (publicados/archivados). Un fallo de GitHub no marca el registro como limpio y genera alerta para reintento.

Cualquier fallo envía una alerta por `ALERT_WEBHOOK_URL`. Después de cada despliegue se debe confirmar en Netlify que `cms-operations` aparece programada cada diez minutos y `scheduled-publish` a las 05:05 UTC. Se realiza un simulacro trimestral de restauración y un ensayo mensual de alerta.
