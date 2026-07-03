# Crear proyectos desde el frontend

Esta funcionalidad permite que un usuario con rol `admin` cree nuevos proyectos directamente desde el sitio web, sin entrar al CMS. El formulario envía los datos a una **Netlify Function** que crea el archivo Markdown en GitHub y dispara un nuevo deploy.

---

## Componentes

- **Página frontend:** `src/pages/admin/crear-proyecto.astro`
- **Netlify Function:** `netlify/functions/create-proyecto.ts`
- **Configuración:** `netlify.toml`

---

## Requisitos

1. El usuario debe estar logueado con Netlify Identity.
2. El usuario debe tener el rol `admin` en `app_metadata.roles`.
3. Netlify Functions debe tener acceso a un token de GitHub con permisos de escritura en el repositorio.

---

## Configuración de variables de entorno

En Netlify, ve a **Site settings → Environment variables** y añade:

| Variable | Valor | Obligatoria |
|---|---|---|
| `GITHUB_TOKEN` | Token de GitHub con scope `repo` | Sí |
| `GITHUB_REPO` | `Noisk8/test-simposio-memorias-participativas` | No (hay valor por defecto) |
| `GITHUB_BRANCH` | `main` | No (valor por defecto `main`) |

### Cómo crear el token de GitHub

1. Ve a GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic).
2. Genera un token con el scope `repo`.
3. Copia el token y guárdalo en Netlify como `GITHUB_TOKEN`.

---

## Cómo funciona

1. El admin visita `/admin/crear-proyecto`.
2. El frontend verifica el rol usando `window.netlifyIdentity`.
3. Si el usuario es admin, se muestra el formulario.
4. Al enviar, el frontend obtiene el JWT de Netlify Identity y lo envía en la cabecera `Authorization`.
5. La Netlify Function recibe el token, valida el rol `admin` en `context.clientContext.user` y crea el archivo en GitHub.
6. Netlify detecta el commit y redeploya el sitio con el nuevo proyecto.

---

## Formato del archivo creado

La función genera un archivo en `src/content/proyectos/{numero}-{slug}.md` con este formato:

```md
---
number: 31
title: "Nuevo proyecto desde el frontend"
place: "Granada, España"
author: ""
collective: ""
image: "/images/proyecto-31.jpg"
description: "Descripción corta"
---

Texto completo en Markdown.
```

---

## Limitaciones

- El formulario no sube imágenes automáticamente. Debes subir la imagen a `public/images/` manualmente o mediante el CMS, y luego escribir la ruta pública en el campo.
- Solo los usuarios con rol `admin` pueden crear proyectos. Los usuarios con rol `editor` no verán el formulario.
- El número del proyecto debe ser único dentro de la colección para evitar colisiones.

---

## Probar en local

Para probar la función en local, instala el CLI de Netlify:

```bash
npm install -g netlify-cli
netlify dev
```

> Asegúrate de configurar las variables de entorno en un archivo `.env` local o en el CLI.

---

## Referencias

- [Netlify Functions](https://docs.netlify.com/functions/overview/)
- [Netlify Identity](https://docs.netlify.com/identity/overview/)
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#create-or-update-file-contents)
