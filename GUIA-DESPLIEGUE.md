# Guía de Despliegue - I Simposio sobre Memorias Participativas

## 1. Subir el proyecto a GitHub

### Preparar el repositorio

```bash
cd /home/noisk8/Documentos/SIMPOSIO/simposio-memorias

# Inicializar git
git init

# Crear archivo .gitignore (ya debería existir, pero verificar)
cat > .gitignore << EOF
# dependencies
node_modules/

# build output
dist/

# misc
.DS_Store
*.log
EOF

# Agregar todo y hacer commit
git add .
git commit -m "Primer commit: sitio del I Simposio sobre Memorias Participativas"
```

### Crear repositorio en GitHub

1. Ir a https://github.com/new
2. Nombre: `simposio-memorias-participativas`
3. **Público** (para que Netlify pueda desplegarlo gratis)
4. No inicializar con README (ya tenemos archivos)
5. Click en **Create repository**

### Conectar y subir

```bash
# Conectar con el repositorio remoto (reemplazar USUARIO por tu usuario de GitHub)
git remote add origin https://github.com/USUARIO/simposio-memorias-participativas.git

# Subir
git branch -M main
git push -u origin main
```

---

## 2. Desplegar en Netlify

### Crear cuenta

1. Ir a https://app.netlify.com
2. Click **Sign up** → **GitHub** (usar la misma cuenta de GitHub)
3. Autorizar la conexión

### Crear el sitio

1. Click **"Add new site"** → **"Import an existing project"**
2. Seleccionar **GitHub**
3. Buscar el repositorio `simposio-memorias-participativas`
4. Click **Connect**

### Configurar el build

En la pantalla de configuración:

| Campo | Valor |
|-------|-------|
| Branch to deploy | `main` |
| Build command | `npm run build` |
| Publish directory | `dist` |

5. Click **"Deploy site"**
6. Esperar 1-2 minutos a que termine el build

### Verificar

- Netlify asignará una URL como `https://simposio-memorias-random123.netlify.app`
- Abrir esa URL para verificar que el sitio funciona
- Si hay errores, revisar los logs en **Deploys** → click en el deploy fallido

---

## 3. Configurar dominio personalizado

### Opción A: Dominio gratuito de Netlify

1. Ir a **Site settings** → **Domain management**
2. Click **"Add custom domain"**
3. Escribir el dominio que quieras (ej: `simposioparticipativas.netlify.app`)
4. Click **Verify**

### Opción B: Dominio propio (~10-15€/año)

1. Comprar dominio en un registrador (Namecheap, Google Domains, Porkbun, etc.)
2. En Netlify: **Site settings** → **Domain management** → **Add custom domain**
3. Escribir el dominio comprado
4. Netlify mostrará los DNS que debes configurar en tu registrador:

| Tipo | Nombre | Valor |
|------|--------|-------|
| A | @ | 75.2.60.5 |
| CNAME | www | `tu-sitio.netlify.app` |

5. En el registrador de dominios, ir a DNS → agregar esos registros
6. Esperar hasta 48 horas para que se propague (generalmente 1-4 horas)
7. En Netlify: **Site settings** → **Domain management** → activar **HTTPS** (botón automático)

---

## 4. Configurar Netlify Identity (para el CMS)

### Activar Identity

1. Ir a **Site settings** → **Identity**
2. Click **"Enable Identity"**
3. Configurar:

| Opción | Valor |
|--------|-------|
| Registration | Invite only |
| Git Gateway | Connect with GitHub |

4. Click **"Enable Git Gateway"**
5. Se abrirá GitHub → autorizar la conexión

### Configurar roles

En **Identity** → **Settings**:

- **External providers** (opcional): agregar Google, GitHub, etc. para login alternativo
- **Roles**: crear rol `admin` para los editores

### Invitar usuarios

1. Ir a **Identity** → **Users**
2. Click **"Invite users"**
3. Escribir el email del usuario que podrá editar
4. El usuario recibirá un email con un link para crear contraseña
5. Una vez dentro, puede acceder a `/admin/` en el sitio

---

## 5. Configurar el CMS (Decap CMS)

### Archivo de configuración

El archivo `public/admin/config.yml` ya está creado. Revisa que esté correcto y apunte a la rama que uses (`main` por defecto):

```yaml
backend:
  name: git-gateway
  branch: main

media_folder: "public/images"
public_folder: "/images"
```

El CMS incluye las siguientes colecciones (equivalentes a WordPress):

| Colección | Descripción |
|-----------|-------------|
| **Categorías** | Taxonomía jerárquica (padre/hijo). |
| **Etiquetas** | Taxonomía plana de palabras clave. |
| **Memorias** | Custom post type del Museo de Memorias Vivas. |
| **Entradas** | Posts genéricos del sitio. |
| **Borradores · Entradas** | Filtro de entradas con `draft: true`. |
| **Borradores · Memorias** | Filtro de memorias con `draft: true`. |

> El campo `draft` es interno y se gestiona automáticamente con **Publish** (publica) y **Guardar como borrador** (borrador).

### Acceder al CMS

1. Ir a `https://tusitio.com/admin/`
2. Login con el email invitado en Netlify Identity
3. Ver el panel con las colecciones:
   - **Entradas**: crear/editar posts
   - **Memorias del Museo de Memorias Vivas**: crear/editar memorias
   - **Categorías/Etiquetas**: gestionar taxonomías
   - **Borradores · Entradas/Memorias**: gestionar borradores

### Cómo crear contenido

1. Click en la colección deseada (ej: **Entradas**).
2. Click en **"New Entrada"**.
3. Rellenar los campos:
   - **Título**: título de la entrada
   - **Fecha**: se rellena automáticamente con la fecha actual si se deja vacía
   - **Autor/a**: opcional
   - **Categorías/Etiquetas**: seleccionar o crear taxonomías
   - **Imagen destacada**: opcional
   - **Extracto**: resumen corto
   - **Contenido**: cuerpo en Markdown
4. Click **"Publish"** para publicar o **"Guardar como borrador"** para guardar como borrador.
5. Los cambios se suben a GitHub automáticamente y Netlify reconstruye el sitio (1-2 minutos).

---

## 6. Configurar build hooks (opcional)

Si quieres que el sitio se reconstruya automáticamente cuando hay cambios:

1. Ir a **Site settings** → **Build & deploy** → **Build hooks**
2. Click **"Add build hook"**
3. Nombre: `Decap CMS`
4. Branch: `main`
5. Click **"Save"** → copiar la URL generada

En `config.yml`, agregar al final:

```yaml
site_url: https://tusitio.com
```

---

## 7. Variables de entorno (si son necesarias)

En **Site settings** → **Environment variables**:

```
NODE_VERSION=22.12.0
# Variables opcionales para funciones de admin:
# ADMIN_EMAILS=admin@ejemplo.com,otro@ejemplo.com
# GITHUB_TOKEN=...                # Solo si usas create-coleccion desde el frontend
# GITHUB_REPO=usuario/repo
# GITHUB_BRANCH=main
```

Netlify Identity y Git Gateway se configuran desde la interfaz.

---

## 8. Comandos útiles

### Desarrollo local

```bash
cd simposio-memorias
npm install
npm run dev
# Abrir http://localhost:4321
```

### Build de producción

```bash
npm run build
# Los archivos se generan en dist/
```

### Verificar build y calidad de código

```bash
npm run build
npm run check     # astro check
npm run lint      # ESLint
npm run format    # Prettier
```

---

## 9. Solución de problemas

### El build falla en Netlify

1. Ir a **Deploys** → click en el deploy fallido
2. Revisar el log de errores
3. Soluciones comunes:
   - `npm: command not found` → agregar variable `NODE_VERSION=18` en Environment variables
   - Errores de build → probar `npm run build` localmente primero

### El CMS no carga

1. Verificar que Netlify Identity esté activo
2. Verificar que Git Gateway esté conectado
3. Verificar que el usuario tenga permisos (rol `admin` o ser el owner)
4. Abrir consola del navegador (F12) para ver errores

### El sitio no se actualiza después de editar en el CMS

1. Verificar que el deploy automático esté activo en **Deploys** → **Deploy notifications**
2. Verificar que los cambios se subieron a GitHub (ir al repositorio y verificar)
3. Si no se subieron, revisar la configuración de Git Gateway

### Imágenes no cargan

1. Verificar que `media_folder` y `public_folder` estén bien configurados en `config.yml`
2. Las imágenes subidas van a `public/images/` en el repositorio
3. Verificar que las imágenes existen en la URL correcta

---

## 10. Resumen de URLs importantes

| URL | Descripción |
|-----|-------------|
| `https://tusitio.netlify.app/` | Sitio principal |
| `https://tusitio.netlify.app/admin/` | Panel del CMS |
| `https://app.netlify.com/sites/tusitio/` | Dashboard de Netlify |
| `https://github.com/USUARIO/simposio-memorias-participativas` | Repositorio |

---

## 11. Checklist final

- [ ] Repositorio creado en GitHub
- [ ] Código subido a GitHub
- [ ] Sitio desplegado en Netlify
- [ ] Build exitoso (34 páginas)
- [ ] Sitio accesible en la URL de Netlify
- [ ] Netlify Identity activado
- [ ] Git Gateway conectado con GitHub
- [ ] Usuarios invitados al CMS
- [ ] CMS accesible en `/admin/`
- [ ] Dominio personalizado configurado (opcional)
- [ ] HTTPS activado
- [ ] Contenido verificado en todas las páginas
