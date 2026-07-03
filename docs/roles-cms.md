# Roles de usuario en el CMS

El CMS usa **Decap CMS** (antes Netlify CMS) con autenticación mediante **Netlify Identity**. Los roles se asignan en el panel de Netlify Identity y se declaran en `public/admin/config.yml` para restringir el acceso a colecciones o campos.

---

## Roles disponibles

Este proyecto maneja dos roles principales:

- **`admin`**: acceso total al CMS.
- **`editor`**: acceso limitado, por ejemplo solo a crear y editar proyectos.

---

## 1. Asignar roles a un usuario

1. Ve al panel de **Netlify Identity** en tu sitio.
2. Selecciona el usuario al que quieres asignar un rol.
3. En la sección **User metadata** o **Roles**, escribe o selecciona el rol:
   - `admin`
   - `editor`
4. Guarda los cambios.

> Los roles se almacenan en el objeto de usuario (`app_metadata.roles`) y Decap CMS los lee para aplicar permisos.

---

## 2. Declarar roles en el CMS

Edita `public/admin/config.yml`.

### Restringir una colección completa

En la colección `proyectos`, ambos roles pueden trabajar:

```yaml
collections:
  - name: "proyectos"
    label: "Proyectos del Museo de Memorias Vivas"
    folder: "src/content/proyectos"
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
  - name: "proyectos"
    label: "Proyectos"
    folder: "src/content/proyectos"
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
- `admin` ve **Proyectos** y **Configuración**.
- `editor` solo ve **Proyectos**.

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
