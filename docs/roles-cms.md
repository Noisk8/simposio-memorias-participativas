# Roles de usuario en el CMS

El CMS usa **Decap CMS** (antes Netlify CMS) con autenticación mediante **Netlify Identity**. Los roles se asignan en el panel de Netlify Identity y se declaran en `public/admin/config.yml` para restringir el acceso a colecciones o campos.

---

## Roles disponibles

Este proyecto maneja dos roles principales:

- **`admin`**: acceso total al CMS.
- **`editor`**: acceso limitado, por ejemplo solo a crear y editar memorias.

---

## 1. Asignar roles a un usuario

El panel de Netlify ya no permite editar roles directamente, así que el proyecto incluye su propio sistema:

### Opción A: Página de gestión de usuarios (recomendada)

1. Configura la variable de entorno `ADMIN_EMAILS` en Netlify (**Site settings → Environment variables**) con tu email, por ejemplo: `ADMIN_EMAILS=tu-email@ejemplo.com`. Puedes poner varios separados por coma.
2. Redeploya el sitio para que la variable se aplique a las funciones.
3. Inicia sesión y ve a `/admin/gestion-usuarios`.
4. Verás la lista de usuarios registrados y podrás asignar o quitar los roles `admin` y `editor` con un clic.

> La página usa la Netlify Function `manage-users`, que exige que el token verificado de Netlify Identity incluya el rol `admin`. `ADMIN_EMAILS` se utiliza únicamente por el hook de registro para asignar el rol inicial.

### Opción B: Asignación automática al registrarse

La función `identity-signup` se ejecuta automáticamente cuando un usuario nuevo se registra:

- Si su email está en `ADMIN_EMAILS`, recibe el rol `admin`.
- En caso contrario, recibe el rol `editor`.

> **Importante:** esto solo aplica a usuarios **nuevos**. Para usuarios ya registrados usa la Opción A.

### Después de asignar un rol

El usuario debe **cerrar sesión y volver a entrar** para que su token JWT incluya el nuevo rol.

> Los roles se almacenan en el objeto de usuario (`app_metadata.roles`) y Decap CMS los lee para aplicar permisos.

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
