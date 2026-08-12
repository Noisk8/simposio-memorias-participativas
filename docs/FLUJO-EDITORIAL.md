# Flujo editorial

## Persistencia actual

Supabase almacena la metadata editorial en:

- `cms_content_records`: UUID editorial canónico, path GitHub, colección, propietario, estado, versiones actual/aprobada/publicada y estado del PR;
- `cms_workflow_events`: tipo de evento, transición, SHA editorial, comentario, actor y fecha;
- `audit_log`: decisiones de autorización y operaciones de dominio.

El Markdown guarda también `owner_id` y `workflow_state` cuando pasa por `manage-content`. GitHub conserva tanto borradores (`draft: true`) como documentos publicados y su historial de commits; Supabase no almacena actualmente el cuerpo.

## Máquina de estados implementada

```text
draft ──submit_review──► in_review ──approve──► approved ──publish──► published
  ▲                           │                                      │
  └──── submit_review ◄─ changes_requested ◄─ request_changes       └─archive─► archived
```

`manage-workflow` valida estado anterior, permiso, propiedad al enviar a revisión y concurrencia al actualizar. Las transiciones disponibles son `submit_review`, `request_changes`, `approve`, `publish` y `archive`. Al aprobar copia `current_sha` a `approved_sha` y conserva el SHA del blob Git que fue revisado.

`current_sha` es SHA-256 de una representación canónica del contenido editorial. Excluye únicamente `draft`, `workflow_state` y `owner_id`, porque son campos operativos controlados por servidor. `github_sha` sigue siendo el SHA del blob usado para concurrencia. Cualquier cambio en los demás metadatos o en el cuerpo modifica `current_sha`.

Si una edición posterior deja `current_sha != approved_sha`, el estado pasa a `changes_requested`. Se eligió ese estado —en vez de `draft`— porque expresa que existió una revisión previa y que la nueva versión necesita atención; el SHA aprobado anterior se conserva para mostrar por qué fue invalidado.

## Integración del panel y publicación

- El panel muestra Enviar a revisión para `draft` y `changes_requested` cuando existe permiso.
- Muestra Aprobar para `in_review` cuando existe permiso.
- No muestra todavía controles para solicitar cambios ni archivar.
- Muestra la versión actual, la aprobada y una advertencia cuando difieren.
- El botón Publicar solo aparece para un registro `approved` cuyos SHAs coinciden.
- Publicar crea una rama segura `cms/<uuid>/<timestamp>`, escribe allí el artefacto aprobado y abre un Pull Request.

`manage-content` nunca publica y trata `draft` como campo controlado por servidor. Una edición de una versión aprobada o publicada vuelve a `changes_requested`. Mientras un PR está abierto, el CMS bloquea nuevas ediciones para no dejar una rama publicable obsoleta.

El PR requiere checks y fusión manual. El registro permanece `approved` con `deployment_state=pr_open`; al consultar el workflow, el backend reconcilia GitHub. Solo un PR fusionado con `current_sha == approved_sha` pasa a `published`, fija `published_sha`, `merge_sha` y los datos de autoría, y registra `content_published`.

Los eventos `content_approved`, `content_publish_requested`, `content_published` y `approval_invalidated` incluyen el SHA correspondiente. `audit_log` añade reviewer/publisher, timestamp, rama, PR y merge cuando proceda.

## Activación

1. Aplica todas las migraciones, incluida `202608110007_approved_version_pr_publication.sql`.
2. Desactiva el registro público de Supabase Auth.
3. Crea cuentas desde el panel y asigna exactamente un rol.
4. Configura la GitHub App según `docs/GITHUB-APP.md` y protege `main` con PR, revisión y checks obligatorios.
5. Supervisa `audit.persist.failed` y errores de registro editorial.
