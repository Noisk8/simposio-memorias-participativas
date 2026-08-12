# Fase 1: fundamentos de seguridad y dominio

> Registro histórico. Esta fase ya fue seguida por `202608080002_editorial_workflow.sql`, `202608110001_canonical_content_uuid.sql` y `202608110002_distributed_rate_limits.sql`. No debe leerse de forma aislada como descripción del estado actual. Véanse [ARQUITECTURA-CMS.md](./ARQUITECTURA-CMS.md), [roles-cms.md](./roles-cms.md) y [FLUJO-EDITORIAL.md](./FLUJO-EDITORIAL.md).

## Resultado de la fase

`202608080001_phase1_rbac.sql` introdujo:

- autenticación con Supabase Auth;
- autorización granular mediante `requirePermission`;
- roles y permisos normalizados;
- auditoría, request IDs y errores estructurados;
- RLS y revocación del acceso directo del cliente;
- RPC server-side para asignar roles;
- modelos Zod canónicos compartidos.

La migración renombra esquemas previos compatibles como `user_roles_legacy` y `audit_log_legacy`, migra datos y conserva esas tablas para verificación.

## Cambio posterior obligatorio

`202608080002_editorial_workflow.sql` cambió supuestos de la fase inicial:

- impone un solo rol efectivo por usuario;
- deja sin rol las altas directas salvo correos predeclarados como administradores;
- añade metadata y eventos editoriales;
- incorpora `resource_ref` para paths GitHub;
- define retención operativa invocable desde servidor.

La migración posterior `202608110001_canonical_content_uuid.sql` alinea la clave primaria de `cms_content_records` con el UUID v4 versionado en cada Markdown y conserva las referencias de workflow.

Por ello las tres migraciones deben aplicarse en orden. La primera fase decía que workflow, UUID de recursos y otras capacidades no estaban implementados; esa afirmación solo era válida en el momento histórico de la fase.

## Componentes actuales derivados de esta fase

- `shared/auth/`: verificación de sesión y permisos.
- `shared/observability/`: request ID, errores, logs y auditoría.
- `shared/supabase/`: cliente `service_role` exclusivo del backend.
- `shared/content-model/`: validación compartida por Astro y Functions.
- `netlify/functions/`: límite de confianza administrativo.
- `tests/security.test.mjs` y pruebas relacionadas.

## Reversión histórica

Una reversión de base de datos es manual y requiere backup:

1. revierte primero el deploy de código;
2. exporta datos RBAC, workflow y auditoría producidos después de la migración;
3. confirma que existen las tablas `*_legacy`;
4. restaura triggers y funciones desde el commit anterior correspondiente;
5. reconcilia usuarios, roles y auditoría antes de retirar tablas nuevas.

No ejecutes esta reversión como procedimiento rutinario ni elimines tablas sin validar dependencias de la segunda migración.

## Estado actual de riesgos

- El rate limit por instancia descrito originalmente es **legacy**; la migración `202608110002_distributed_rate_limits.sql` lo sustituyó por buckets atómicos en PostgreSQL.
- GitHub App y publicación por ramas/PR están **Planeados**.
- Supabase Storage y metadata de medios están **Planeados**.
- Workflow existe, pero su obligatoriedad de punta a punta está **Planeada**.
- GitHub y auditoría Supabase no forman una transacción distribuida.

El CMS basado en Decap CMS, Netlify Identity y Git Gateway pertenece al sistema **legacy** retirado.
