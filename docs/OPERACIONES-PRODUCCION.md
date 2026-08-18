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

## Programación editorial

`scheduled-publish` se ejecuta a las 05:05 UTC (00:05 en Bogotá) y hace `POST` a `SCHEDULED_BUILD_HOOK_URL`. El build hook debe estar limitado a la rama `main`; no reutilices un hook de previews. El rebuild hace visibles los Markdown con `publish_date` igual al nuevo día sin crear commits vacíos.

Prueba de activación:

1. crear en staging una entrada con fecha del día siguiente y publicarla;
2. confirmar que el PR/deploy termina pero la URL todavía responde 404;
3. invocar el hook de staging después de adelantar la fecha o al llegar el día;
4. confirmar URL 200, canonical único y alerta ausente;
5. archivar el contenido temporal.

Una respuesta no 2xx o una variable ausente genera un error operativo y una alerta. La siguiente ejecución reintenta el build; no modifica la fecha editorial.

## Respaldo

El workflow `Encrypted production backup` se ejecuta diariamente y exporta:

- esquema y datos PostgreSQL;
- metadata de `cms_media`;
- todos los objetos activos de Supabase Storage.

El artefacto se cifra antes de salir del runner y se conserva 30 días. El Environment `production-backup` necesita `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `BACKUP_ENCRYPTION_KEY`.

## Restauración

La restauración siempre se ensaya primero en un proyecto Supabase vacío de recuperación:

1. Descargar el artefacto y verificar su checksum desde GitHub Actions.
2. Descifrarlo con `openssl enc -d -aes-256-cbc -pbkdf2` y extraerlo.
3. Aplicar `database/schema.sql` y después `database/data.sql` con `psql` sobre el proyecto de recuperación.
4. Subir los objetos de `storage/cms-media/` conservando exactamente sus rutas.
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
