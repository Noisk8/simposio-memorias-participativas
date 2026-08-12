# Flujo editorial minimalista

## Regla de arquitectura

Ninguna creación, edición, autosave, vista previa o restauración requiere GitHub ni provoca un
deploy. GitHub solo interviene cuando una persona autorizada publica una versión inmutable. Las
ramas, Pull Requests, checks y merges son infraestructura interna y nunca pasos manuales del panel.

## Persistencia

- `cms_content_records`: identidad, propietario, estado y punteros a la versión actual/publicada.
- `cms_content_drafts`: copia editable, cuerpo, metadata, SHA-256 y revisión optimista.
- `cms_content_versions`: snapshots inmutables creados al guardar manualmente o publicar.
- `cms_publications`: intentos idempotentes, estado técnico, rama, PR, merge y errores.
- `cms_workflow_events` y `audit_log`: trazabilidad de guardado y publicación.
- GitHub: únicamente Markdown publicado consumido por Astro.
- Supabase Storage: medios binarios del CMS.

## Recorrido del usuario

```text
Crear ──► Guardar borrador ──► Vista previa ──► Publicar
              │                                      │
              └──── autosave en Supabase             ▼
                                         validación + PR técnico automático
                                                      │
                                                      ▼
                                                merge + Netlify
```

Los estados visibles se reducen a `draft`, `publishing`, `published`, `publish_failed` y
`archived`. Los estados de aprobación anteriores permanecen admitidos en PostgreSQL solo para una
migración aditiva; el endpoint ya no permite `submit_review`, `approve` ni `request_changes`.

## Versiones y concurrencia

`current_sha` es SHA-256 de la representación canónica editorial. Excluye `draft`,
`workflow_state` y `owner_id`. `cms_content_drafts.revision` aumenta con cada guardado y la RPC
`cms_save_content_draft` bloquea actualizaciones basadas en una revisión obsoleta.

El autosave actualiza la copia mutable, pero no crea una fila histórica en cada pulsación. El
guardado manual y la publicación crean o reutilizan un snapshot inmutable por `content_sha`.

Publicar congela el borrador actual y publica ese `version_id`. Si la persona continúa editando
mientras la publicación está en curso, el snapshot sigue siendo estable: la versión fusionada pasa
a `published_version_id` y los cambios posteriores permanecen como un nuevo borrador.

## Publicación técnica

1. Revalidar el documento y su checksum.
2. Reservar `cms_publications.operation_key` para idempotencia.
3. Crear `cms/<uuid>/<timestamp>` desde `main`.
4. Crear o actualizar el Markdown con `draft:false`.
5. Abrir un PR técnico y solicitar auto-merge.
6. Si auto-merge no está disponible, reconciliar y fusionar únicamente cuando los checks pasen.
7. Registrar `published_version_id`, `published_sha`, actor, fecha y `merge_sha`.
8. Netlify construye una sola vez después del merge; los previews de ramas `cms/**` se omiten.

El panel solo muestra `Publicación en curso`, `Desplegando`, `Publicado` o `Error de publicación`.
No muestra enlaces ni acciones GitHub.

## Activación

1. Aplicar las migraciones hasta `202608110009_supabase_drafts_minimal_publication.sql`.
2. Configurar la GitHub App según `docs/GITHUB-APP.md`.
3. Proteger `main` con PR y checks obligatorios, sin exigir una segunda aprobación humana.
4. Ejecutar `npm run migrate:content-drafts -- --dry-run` y después
   `npm run migrate:content-drafts -- --apply`; abrir una colección también importa bajo demanda.
5. Probar crear, autosave, guardar y publicar antes de retirar `GITHUB_TOKEN`.
