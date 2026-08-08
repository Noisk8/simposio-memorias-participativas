# Crear memorias desde el frontend

Esta funcionalidad heredada permite crear memorias desde el panel propio. El formulario envía los datos a una **Netlify Function** autenticada; la autorización se basa en el permiso `memoria.create`, no en un rol enviado por el navegador.

---

## Componentes

- **Página frontend:** `src/pages/admin/crear-memoria.astro`
- **Netlify Function:** `netlify/functions/create-proyecto.ts`
- **Configuración:** `netlify.toml`

---

## Requisitos

1. El usuario debe tener una sesión válida de Supabase Auth.
2. Al menos uno de sus roles normalizados debe conceder `memoria.create`.
3. Netlify Functions debe tener acceso a un token de GitHub con permisos de escritura en el repositorio.

---

## Configuración de variables de entorno

En Netlify, ve a **Site settings → Environment variables** y añade:

| Variable        | Valor                                     | Obligatoria                   |
| --------------- | ----------------------------------------- | ----------------------------- |
| `GITHUB_TOKEN`  | Token de GitHub con scope `repo`          | Sí                            |
| `GITHUB_REPO`   | `Noisk8/simposio-memorias-participativas` | No (hay valor por defecto)    |
| `GITHUB_BRANCH` | `main`                                    | No (valor por defecto `main`) |

### Cómo crear el token de GitHub

1. Ve a GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic).
2. Genera un token fine-grained limitado a este repositorio, con permiso `Contents: Read and write`.
3. Copia el token y guárdalo en Netlify como `GITHUB_TOKEN`. Nunca lo guardes en el repositorio.

---

## Cómo funciona

1. La persona visita `/admin/crear-memoria` e inicia sesión con Supabase Auth.
2. Al enviar, el frontend obtiene el access token vigente y lo envía como bearer token.
3. La función verifica el JWT con Supabase, consulta permisos efectivos con `requirePermission` y valida los datos con el esquema canónico de memoria.
4. Si dispone de `memoria.create`, la función crea el archivo en GitHub y registra la operación en auditoría.
5. Netlify detecta el commit y redeploya el sitio con el nuevo proyecto.

---

## Formato del archivo creado

La función genera un archivo en `src/content/memorias/{numero}-{slug}.md` con este formato:

```md
---
number: 31
title: 'Nuevo proyecto desde el frontend'
place: 'Granada, España'
author: ''
collective: ''
image: '/images/proyecto-31.jpg'
description: 'Descripción corta'
---

Texto completo en Markdown.
```

---

## Limitaciones

- El formulario no sube imágenes automáticamente. Debes subir la imagen a `public/images/` manualmente o mediante el CMS, y luego escribir la ruta pública en el campo.
- Los roles `superadmin`, `admin`, `editor` y `author` reciben inicialmente `memoria.create`; el backend siempre decide usando permisos efectivos.
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
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#create-or-update-file-contents)
