# Flujo editorial

## Persistencia actual

Supabase almacena la metadata editorial en:

- `cms_content_records`: UUID editorial canónico, path GitHub, colección, propietario, estado, SHA y autoría de cambios;
- `cms_workflow_events`: transición, comentario, actor y fecha;
- `audit_log`: decisiones de autorización y operaciones de dominio.

El Markdown guarda también `owner_id` y `workflow_state` cuando pasa por `manage-content`. GitHub conserva tanto borradores (`draft: true`) como documentos publicados y su historial de commits; Supabase no almacena actualmente el cuerpo.

## Máquina de estados implementada

```text
draft ──submit_review──► in_review ──approve──► approved ──publish──► published
  ▲                           │                                      │
  └──── submit_review ◄─ changes_requested ◄─ request_changes       └─archive─► archived
```

`manage-workflow` valida estado anterior, permiso, propiedad al enviar a revisión y concurrencia al actualizar. Las transiciones disponibles son `submit_review`, `request_changes`, `approve`, `publish` y `archive`.

## Integración real del panel

- El panel muestra Enviar a revisión para `draft` y `changes_requested` cuando existe permiso.
- Muestra Aprobar para `in_review` cuando existe permiso.
- No muestra todavía controles para solicitar cambios ni archivar.
- El botón Publicar no llama a la transición `publish`: guarda mediante `manage-content` con `draft: false`.

`manage-content` registra directamente `draft` o `published` según el valor de `draft`; por tanto, un usuario con permiso `*.publish` puede publicar sin que el registro estuviera previamente `approved`.

## Estado planeado

Está **Planeado**:

1. exigir el paso por `approved` antes de toda publicación;
2. hacer que el botón Publicar use una transición coordinada con la escritura Markdown;
3. exponer solicitud de cambios y archivo en el panel;
4. sincronizar siempre el evento de workflow, el registro Supabase y el frontmatter;
5. definir reintentos o compensación entre GitHub y Supabase.
6. separar, si se mantiene la arquitectura objetivo, el cuerpo no publicado para que GitHub reciba únicamente contenido publicado.

Hasta completar esos puntos, el workflow es una capacidad persistida y parcialmente integrada, no una compuerta obligatoria de publicación.

## Activación

1. Aplica en orden `202608080001_phase1_rbac.sql`, `202608080002_editorial_workflow.sql` y `202608110001_canonical_content_uuid.sql`.
2. Desactiva el registro público de Supabase Auth.
3. Crea cuentas desde el panel y asigna exactamente un rol.
4. Protege la rama de GitHub según la estrategia compatible con la escritura del CMS.
5. Supervisa `audit.persist.failed` y errores de registro editorial.
