# Flujo editorial

## Estados

`draft → in_review → approved → published → archived`

Desde `in_review` una persona revisora puede solicitar cambios, lo que lleva el contenido a `changes_requested`. La autoría puede corregirlo y enviarlo nuevamente.

## Responsabilidades

- **Author:** crea y actualiza únicamente contenido propio; lo envía a revisión.
- **Reviewer:** aprueba o solicita cambios.
- **Editor:** edita, revisa y publica cualquier contenido.
- **Admin/Superadmin:** administra contenido, usuarios y configuración.

La propiedad y los eventos se almacenan en `cms_content_records` y `cms_workflow_events`. El Markdown conserva `owner_id` y `workflow_state` para que el repositorio siga siendo auditable.

## Activación

1. Aplicar `202608080002_editorial_workflow.sql` en Supabase.
2. Desactivar el registro público en Supabase Auth.
3. Crear cada cuenta desde Usuarios y roles, asignando exactamente un rol.
4. Proteger `main` en GitHub y exigir el workflow CI.
5. Verificar el estado de despliegue después de cada publicación.

Una falla al persistir auditoría se registra en los logs, pero no transforma una escritura ya confirmada en GitHub en un falso error. Configura una alerta sobre `audit.persist.failed`.
