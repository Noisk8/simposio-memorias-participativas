# Configuración de TypeScript en el proyecto Astro

Este documento describe la configuración de TypeScript del proyecto, el problema que surgió con la etiqueta `<script>` en Astro y cómo se resolvió.

---

## Stack del proyecto

- **Framework:** Astro 7.x
- **Integraciones:**
  - `@astrojs/mdx` — soporte para contenido MDX
  - `@astrojs/sitemap` — generación de sitemap
  - `@astrojs/react` — soporte para componentes React (actualmente sin archivos `.tsx`/`.jsx`)
  - `@tailwindcss/vite` — Tailwind CSS v4 con plugin de Vite
- **Entorno:** Node.js >= 22.12.0

---

## Instalación inicial

El proyecto se creó con el CLI de Astro y se agregaron las integraciones necesarias mediante `npx astro add` o instalación manual de paquetes. Las dependencias relevantes están en `package.json`:

```json
{
  "dependencies": {
    "@astrojs/mdx": "^7.0.0",
    "@astrojs/react": "^6.0.0",
    "@astrojs/rss": "^4.0.18",
    "@astrojs/sitemap": "^3.7.3",
    "@tailwindcss/vite": "^4.3.2",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "astro": "^7.0.3",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "sharp": "^0.34.3",
    "tailwindcss": "^4.3.2"
  }
}
```

### Scripts disponibles

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro"
  }
}
```

Para iniciar el servidor de desarrollo:

```bash
npm run dev
```

Para compilar el sitio:

```bash
npm run build
```

---

## Configuración de `tsconfig.json`

### Configuración correcta

El `tsconfig.json` debe extender la configuración estricta de Astro y **no** sobrescribir las opciones de JSX de forma global:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"],
  "compilerOptions": {
    "strictNullChecks": true
  }
}
```

### Configuración que causó el problema

Se había agregado manualmente lo siguiente:

```json
"compilerOptions": {
  "strictNullChecks": true,
  "jsx": "react-jsx",
  "jsxImportSource": "react"
}
```

Esto hizo que el language server de TypeScript tratara todos los archivos — incluidos los `.astro` — como si usaran JSX de React. Como resultado, las etiquetas HTML nativas de Astro como `<script>` no se reconocían como elementos intrínsecos y TypeScript lanzaba el error:

```
Cannot find name 'script'. Did you mean 'WScript'?
```

Ubicación del error: `src/layouts/Layout.astro:30`.

### Solución

Se eliminaron las opciones `jsx` y `jsxImportSource` del `tsconfig.json` para que Astro gestione el JSX de los archivos `.astro` con su propia configuración base.

---

## Uso de React en el proyecto

Aunque el proyecto tiene instalada la integración `@astrojs/react`, actualmente no existen archivos `.tsx` ni `.jsx`. Si en el futuro se agregan componentes React, hay dos opciones recomendadas:

### Opción 1: pragma por archivo (recomendado)

Agregar al inicio de cada archivo `.tsx` o `.jsx`:

```tsx
/** @jsxImportSource react */
```

De esta manera solo esos archivos usan el runtime de JSX de React, sin afectar los archivos `.astro`.

### Opción 2: configuración global con extensión por archivo

Si se prefiere configurar JSX de React de forma global, se debe usar un `tsconfig.json` separado para los archivos React o asegurarse de que los archivos `.astro` no estén incluidos en la configuración de React.

---

## Recomendaciones para mantener la configuración estable

1. **No sobrescribir `jsxImportSource` de forma global** en proyectos Astro que usen React, salvo que sea estrictamente necesario y se entienda el impacto en los archivos `.astro`.
2. **Reiniciar el language server de Astro** después de modificar `tsconfig.json`:
   - VS Code: `Ctrl + Shift + P` → `Astro: Restart Language Server` o `Developer: Reload Window`.
3. **Verificar la compilación** tras cambios de configuración:

   ```bash
   npm run build
   ```

4. **Revisar el archivo `.astro/types.d.ts`** si aparecen errores de tipos inesperados en Astro; a veces es necesario regenerarlo ejecutando `astro sync`.

---

## Referencias

- [Guía de TypeScript en Astro](https://docs.astro.build/en/guides/typescript/)
- [Integración React en Astro](https://docs.astro.build/en/guides/integrations-guide/react/)
- [JSX en Astro](https://docs.astro.build/en/guides/typescript/#jsx)
