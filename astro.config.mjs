// @ts-check

import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';
import remarkCmsBlocks from './scripts/remark-cms-blocks.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://simposio-memorias-participativas.netlify.app',
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "img-src 'self' data: blob: https:",
        'frame-src https://giscus.app',
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: {
        resources: ["'self'", 'https://giscus.app'],
      },
      styleDirective: {
        resources: ["'self'"],
      },
    },
  },
  markdown: {
    processor: unified({ remarkPlugins: [remarkCmsBlocks] }),
    syntaxHighlight: false,
  },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/admin/') && !page.includes('/404'),
    }),
    react(),
  ],
  redirects: {
    '/noticias': '/entradas',
    '/noticias/[slug]': '/entradas/[slug]',
    '/admin/crear-proyecto': '/admin/crear-memoria',
  },

  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Montserrat',
      cssVariable: '--font-montserrat',
      weights: ['100 900'],
      styles: ['normal', 'italic'],
      subsets: ['latin', 'latin-ext'],
      formats: ['woff2'],
      fallbacks: ['sans-serif'],
    },
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
