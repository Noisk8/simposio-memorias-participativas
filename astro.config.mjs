// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://simposio-memorias-participativas.netlify.app',
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
