# Roles de usuario en el CMS

El sitio tiene dos sistemas de roles:

- **Paneles propios** (`/admin/gestion-usuarios`, `/admin/gestion-colecciones`, `/admin/crear-memoria`): autenticación con **Supabase Auth** (email y contraseña); roles en la tabla `public.user_roles`.
- **Editor Decap** (`/admin/`): autenticación con **Netlify Identity**; roles en `app_metadata.roles` de Identity, declarados en `public/admin/config.yml` para restringir colecciones o campos.

---

## Roles disponibles

Este proyecto maneja dos roles principales:

- **`admin`**: acceso total al CMS.
- **`editor`**: acceso limitado, por ejemplo solo a crear y editar memorias.

---

## 1. Asignar roles a un usuario

Los paneles propios (`/admin/gestion-usuarios`, `/admin/gestion-colecciones`, `/admin/crear-memoria`) usan **Supabase Auth** (email y contraseña). Los roles se guardan en la tabla `public.user_roles` del proyecto Supabase y las Netlify Functions los leen en cada petición.

### Opción A: Página de gestión de usuarios (recomendada)

1. Crea el proyecto Supabase y aplica `supabase/schema.sql` (ver `docs/supabase.md`).
2. Añade tu email a la tabla `public.admin_emails` **antes** de registrarte, para recibir el rol `admin` al crear la cuenta.
3. Inicia sesión y ve a `/admin/gestion-usuarios`.
4. Verás la lista de usuarios registrados en Supabase y podrás asignar o quitar los roles `admin` y `editor` con un clic.
5. En el formulario **Crear usuario**, introduce nombre, email, contraseña y rol inicial. El usuario se crea confirmado y puede iniciar sesión inmediatamente.

> La página usa la Netlify Function `manage-users`, que verifica el JWT de Supabase y exige rol `admin` (leído de `public.user_roles`). La contraseña solo viaja por HTTPS hasta la función y nunca se registra en logs.

### Opción B: Asignación automática al registrarse

El trigger `on_auth_user_created` de Supabase asigna el rol inicial cuando un usuario nuevo se registra:

- Si su email está en `public.admin_emails`, recibe el rol `admin`.
- En caso contrario, recibe el rol `editor`.

> **Importante:** esto solo aplica a usuarios **nuevos**. Para usuarios ya registrados usa la Opción A.

### Después de asignar un rol

No hace falta volver a entrar: las funciones consultan `public.user_roles` en cada petición, así que el cambio aplica de inmediato.

> El editor Decap (`/admin/`) sigue usando Netlify Identity y sus roles se almacenan en `app_metadata.roles` de Identity, no en Supabase.

---

## 2. Declarar roles en el CMS

Edita `public/admin/config.yml`.

### Restringir una colección completa

En la colección `memorias`, ambos roles pueden trabajar:

```yaml
collections:
  - name: "memorias"
    label: "Memorias del Museo de Memorias Vivas"
    folder: "src/content/memorias"
    create: true
    roles: ["admin", "editor"]
    fields:
      ...
```

Si solo quieres que los `admin` vean una colección, usa:

```yaml
roles: ["admin"]
```

### Restringir un campo específico

También puedes ocultar campos según el rol. Por ejemplo, para que solo `admin` pueda editar el número de proyecto:

```yaml
fields:
  - { label: "Número", name: "number", widget: "number", value_type: "int", roles: ["admin"] }
```

---

## 3. Ejemplo de configuración con dos colecciones

```yaml
collections:
  - name: "memorias"
    label: "Memorias"
    folder: "src/content/memorias"
    create: true
    roles: ["admin", "editor"]
    fields:
      - { label: "Número", name: "number", widget: "number", value_type: "int" }
      - { label: "Título", name: "title", widget: "string" }
      - { label: "Imagen", name: "image", widget: "image" }
      - { label: "Texto", name: "body", widget: "markdown" }

  - name: "settings"
    label: "Configuración del sitio"
    files:
      - file: "src/consts.ts"
        label: "Datos generales"
        name: "site-data"
    roles: ["admin"]
```

Con esta configuración:
- `admin` ve **Memorias** y **Configuración**.
- `editor` solo ve **Memorias**.

---

## 4. Verificar en producción

Después de modificar `config.yml`:

1. Commitea y empuja los cambios.
2. Ve a `https://tusitio.netlify.app/admin/`.
3. Inicia sesión con un usuario que tenga rol `editor`.
4. Comprueba que solo ve las colecciones permitidas.

---

## Notas importantes

- Decap CMS lee los roles desde `app_metadata.roles` del objeto de usuario de Netlify Identity.
- Si un usuario no tiene ningún rol, no podrá ver colecciones que requieran un rol.
- Los cambios en `config.yml` no requieren redeploy del sitio; el CMS lee el archivo cada vez que carga `/admin/`.
- Para que Git Gateway funcione, asegúrate de que esté habilitado en Netlify y vinculado con Identity.

---

## Referencias

- [Decap CMS — Collections](https://decapcms.org/docs/collection-overview/)
- [Decap CMS — Workflow](https://decapcms.org/docs/working-with-a-workflow/)
- [Netlify Identity](https://docs.netlify.com/identity/overview/)
