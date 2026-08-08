# Fase 1: fundamentos de seguridad y dominio

## Resultado

Las cuatro funciones administrativas existentes verifican Supabase Auth y permisos granulares mediante `requirePermission`. Se añadieron errores estructurados, request ID, logs JSON con redacción, auditoría esperada, seis roles normalizados y pruebas de autorización.

Esta fase no implementa todavía workflow editorial, UUID, Storage, rate limiting distribuido ni publicación por pull request, tal como exige el alcance del diagnóstico.

## Archivos principales

- `shared/auth/`: verificación de sesión y `requirePermission`.
- `shared/observability/`: request ID, errores, logger y auditoría.
- `shared/supabase/`: cliente administrativo exclusivo de backend.
- `shared/content-model/`: esquemas Zod canónicos.
- `netlify/functions/`: migración de las cuatro funciones administrativas.
- `supabase/migrations/202608080001_phase1_rbac.sql`: migración versionada.
- `tests/security.test.mjs`: pruebas unitarias de sesión, RBAC y errores.

## Migración SQL

Aplica `supabase/migrations/202608080001_phase1_rbac.sql` antes de desplegar las Functions nuevas. La migración:

1. renombra las tablas antiguas a `user_roles_legacy` y `audit_log_legacy`;
2. crea y siembra RBAC granular;
3. migra asignaciones y auditoría existentes;
4. actualiza el trigger de usuarios nuevos;
5. crea la RPC atómica `cms_set_user_roles`;
6. activa RLS y revoca acceso directo del cliente.

## Variables

No hay secretos nuevos. Se añade `ALLOWED_ORIGINS` como lista opcional de previews u orígenes administrativos adicionales. `SITE_URL` continúa siendo el origen principal.

## Despliegue

1. Crea un backup de Supabase.
2. Aplica la migración SQL.
3. Verifica las asignaciones con una consulta que una `user_roles` y `roles`.
4. Configura las variables documentadas en `.env.example`.
5. Despliega Functions y sitio en el mismo deploy.
6. Prueba los casos 401, 403 y 200 y confirma `x-request-id`/`audit_log`.
7. Mantén las tablas `*_legacy` durante al menos un ciclo estable.

## Reversión

Primero revierte el deploy de código en Netlify. Después, dentro de una transacción y solo si las tablas legacy existen:

1. elimina el trigger `on_auth_user_created`;
2. elimina o renombra `user_roles` y `audit_log` nuevos;
3. renombra `user_roles_legacy` y `audit_log_legacy` a sus nombres originales;
4. restaura la función/trigger legacy desde el commit anterior;
5. elimina `cms_set_user_roles`, `role_permissions`, `permissions` y `roles` cuando ya no tengan referencias;
6. valida login, roles y auditoría antes de cerrar la reversión.

No borres las tablas nuevas ni legacy sin exportarlas. La reversión del esquema es manual porque puede haber auditoría nueva que deba preservarse.

## Pruebas

`tests/security.test.mjs` cubre extracción del bearer token, sesiones ausentes y usuarios deshabilitados, derivación de permisos, rechazo de metadatos manipulados, 403 y contrato estructurado de errores. La entrega solo se considera lista si pasan `test`, `lint`, `check`, `format:check` y `build`.

Comandos ejecutados para esta entrega:

```bash
npm run test
npm run lint
npm run check
npm run format:check
npm run build
```

El build puede necesitar abrir un puerto local temporal para procesar fuentes de Astro; en entornos sandbox debe ejecutarse con ese permiso habilitado.

## Panel editorial propio

`/admin/contenidos` permite listar, buscar, crear, editar y eliminar entradas, memorias,
páginas, simposios, categorías y etiquetas. También conserva borradores e historial de cambios.
`/admin/medios` permite consultar, subir y eliminar imágenes. Las dos interfaces verifican el JWT
de Supabase y los permisos RBAC en funciones de servidor antes de acceder a GitHub; el token de
GitHub nunca se entrega al navegador.

## Riesgos pendientes

- Decap, Netlify Identity y Git Gateway fueron retirados en el cambio posterior de identidad única.
- El rate limiting actual es por instancia.
- Las escrituras GitHub aún no usan ramas/PR ni GitHub App.
- La auditoría y la escritura GitHub no forman una transacción distribuida; una fase posterior deberá diseñar compensación e idempotencia.
