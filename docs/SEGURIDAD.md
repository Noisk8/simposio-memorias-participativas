# Seguridad del CMS y las funciones administrativas

## Autoridad de identidad

Los paneles propios usan exclusivamente Supabase Auth. Cada Netlify Function protegida valida el bearer token con `auth.getUser()`, obtiene el usuario real y consulta sus permisos efectivos en las tablas normalizadas de Supabase. Los roles del body, `localStorage`, `user_metadata` y `app_metadata` no intervienen en la autorización.

El acceso activo de Decap, Netlify Identity y Git Gateway fue retirado. `/admin/` y el encabezado comparten exclusivamente la sesión de Supabase.

## Funciones y permisos

| Función                | Método | Permiso                                            |
| ---------------------- | -----: | -------------------------------------------------- |
| `manage-users`         |    GET | `users.read`                                       |
| `manage-users`         |   POST | `users.manage`                                     |
| `create-coleccion`     |   POST | `settings.manage`                                  |
| `create-proyecto`      |   POST | `memoria.create`                                   |
| `get-revision-history` |    GET | permiso `*.read` derivado de la colección validada |

El helper canónico es `requirePermission(event, permiso)`. Devuelve `requestId`, `user`, `roles` y `permissions`.

## Errores, logs y auditoría

Todas las respuestas de error siguen este contrato:

```json
{
  "ok": false,
  "error": {
    "code": "AUTHORIZATION_DENIED",
    "message": "Permisos insuficientes.",
    "requestId": "uuid"
  }
}
```

El mismo UUID se devuelve en `x-request-id` y se incorpora a logs JSON y `public.audit_log`. El logger elimina campos cuyos nombres indiquen tokens, contraseñas, cookies, secretos o claves privadas. La auditoría de autorización se espera antes de continuar; las escrituras registran además su acción de dominio.

## Variables

- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: solo Functions.
- `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`: login en navegador.
- `RESEND_API_KEY` y `RESEND_FROM_EMAIL`: envío de correo para altas desde `/admin/gestion-usuarios`.
- `SITE_URL`: origen principal permitido.
- `ALLOWED_ORIGINS`: orígenes adicionales separados por comas.
- `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`: integración GitHub heredada hasta las fases 2 y 6.

La service role nunca debe tener prefijo `PUBLIC_`, aparecer en logs ni formar parte del bundle del navegador.

## Controles de Supabase

- RLS está activo en roles, permisos, relaciones, asignaciones y auditoría.
- `anon` y `authenticated` no tienen acceso directo a estas tablas.
- La mutación atómica de roles se ejecuta mediante `cms_set_user_roles` y solo se concede a `service_role`.
- El registro público debe estar desactivado; las cuentas se crean por invitación o desde una función autorizada.
- Se recomienda confirmación de correo y MFA para `superadmin` y `admin`.

## Riesgos aún abiertos

- El rate limiting continúa en memoria hasta la Fase 7; no es distribuido entre instancias.
- Las funciones de escritura heredadas todavía usan un token y escriben en la rama configurada hasta migrarlas a la API editorial y a GitHub App/PR.
- La edición general de varias colecciones aún no tiene formulario en el panel propio; no debe resolverse reactivando Decap o Git Gateway.
- La protección de `main` se configura externamente en GitHub durante la Fase 6.

Consulta [Fase 1: RBAC y seguridad](./FASE-1-RBAC.md) para despliegue y reversión.
