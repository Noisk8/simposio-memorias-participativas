# TypeScript y Astro

## Configuración actual

El proyecto usa Node.js 22.12 o superior, Astro 7, TypeScript estricto, React 19, Tailwind CSS 4 y modelos Zod compartidos.

`tsconfig.json` extiende `astro/tsconfigs/strict`, incluye los tipos generados de Astro y no fuerza globalmente el runtime JSX de React:

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

La integración `@astrojs/react` está habilitada en `astro.config.mjs`, pero actualmente no existen archivos `.tsx` o `.jsx`. El panel se implementa principalmente con Astro y scripts TypeScript/JavaScript de cliente.

## Motivo para no forzar JSX global

Una configuración global con `jsx: react-jsx` y `jsxImportSource: react` hizo que herramientas TypeScript trataran archivos `.astro` como JSX React y produjeran errores sobre etiquetas HTML. Astro debe controlar el tratamiento de sus archivos.

Si se añaden componentes React, usa archivos `.tsx` y las convenciones de integración de Astro; no cambies la configuración global sin ejecutar `astro check` sobre todo el repositorio.

## Modelos compartidos

Los esquemas de `shared/content-model/` se importan desde `src/content.config.ts` y desde las Functions. Esta reutilización evita que el CMS acepte frontmatter que el build de Astro rechazaría.

Después de modificar colecciones o esquemas:

```bash
npx astro sync
npm run check
npm test
npm run build
```

## Scripts relevantes

```text
npm run dev             Astro sin Functions
npm run dev:netlify     Astro y Netlify Functions
npm run check           taxonomías y astro check
npm run check:content-uuids valida UUID v4 únicos en Markdown
npm run lint            ESLint
npm run format:check    Prettier
npm test                pruebas Node
npm run test:api        contrato HTTP de Functions
npm run test:e2e        build y Playwright
npm run build           Astro y Pagefind
```

Para iniciar únicamente Astro, `AGENTS.md` exige usar `astro dev --background` y gestionarlo con `astro dev status`, `astro dev logs` y `astro dev stop`.
