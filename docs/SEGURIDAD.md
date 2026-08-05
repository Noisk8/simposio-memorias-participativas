# Seguridad del CMS y las funciones administrativas

## Principios actuales

Las funciones administrativas deben ejecutarse únicamente en Netlify o mediante `netlify dev` con un contexto de Identity válido. La autorización se basa en el usuario verificado por Netlify (`context.clientContext.user`) y en los roles incluidos en `app_metadata.roles`.

No se debe confiar en un JWT decodificado manualmente ni en datos enviados por el navegador para decidir si una persona es administradora.

## Variables de entorno

Configura en Netlify, nunca en el repositorio:

- `GITHUB_TOKEN`: token fine-grained o GitHub App limitado al repositorio y con `Contents: Read and write`.
- `GITHUB_REPO`: repositorio en formato `organizacion/repositorio`.
- `GITHUB_BRANCH`: normalmente `main`.
- `SITE_URL`: origen público autorizado para CORS.
- `ADMIN_EMAILS`: solo para asignar el rol inicial durante el registro de usuarios.

No compartas ni imprimas valores de estas variables en logs, capturas o incidencias.

## Funciones protegidas

Las funciones administrativas actuales son:

- `manage-users`: listar usuarios y asignar roles; requiere rol `admin`.
- `create-coleccion`: crear una colección; requiere rol `admin`.
- `create-proyecto`: endpoint compatible para crear una memoria; requiere rol `admin`.
- `get-revision-history`: consultar historial de contenido; requiere usuario autenticado con rol `admin` o `editor`.

Todas deben validar:

1. método HTTP;
2. usuario verificado por Netlify Identity;
3. rol requerido;
4. formato y tamaño de los datos recibidos;
5. rutas permitidas antes de consultar o escribir en GitHub.

## CORS y cabeceras

Las funciones no deben usar `Access-Control-Allow-Origin: *` en producción. El origen permitido debe ser el dominio público configurado en `SITE_URL`; durante desarrollo se aceptan únicamente los puertos locales definidos por el proyecto.

El archivo `public/_headers` añade cabeceras generales como:

- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Permissions-Policy`;
- `Strict-Transport-Security`.

## Reglas para cambios futuros

- No reintroducir fallbacks que acepten JWT sin verificar firma.
- No añadir tokens, contraseñas o credenciales a `.env.example` con valores reales.
- No permitir que una función escriba rutas arbitrarias del repositorio.
- Validar y limitar los campos antes de generar YAML o Markdown.
- Evitar devolver a los usuarios detalles completos de errores de GitHub.
- Registrar errores sin incluir tokens, cabeceras `Authorization` ni datos sensibles.
- Revisar cualquier cambio de roles, permisos o escritura en `main`.

## Revisión antes de desplegar

Ejecuta:

```bash
npm run lint
npm run check
npm run build
```

Además, comprueba en Netlify que:

- Identity está habilitado;
- Git Gateway o el backend de Decap configurado está operativo;
- las variables de entorno tienen el alcance de Functions;
- el usuario administrador conserva su rol;
- el token de GitHub sigue limitado al repositorio correcto.

## Riesgos pendientes

Git Gateway y Netlify Identity son dependencias que deben revisarse porque su soporte y evolución pueden cambiar. Antes de ampliar el CMS, conviene definir una estrategia de migración hacia un backend de autenticación y escritura con soporte vigente.
