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
    '/admin': '/admin/index.html',
    '/admin/crear-proyecto': '/admin/crear-memoria',
  },

  fonts: [
      {
          provider: fontProviders.local(),
          name: 'Atkinson',
          cssVariable: '--font-atkinson',
          fallbacks: ['sans-serif'],
          options: {
              variants: [
                  {
                      src: ['./src/assets/fonts/atkinson-regular.woff'],
                      weight: 400,
                      style: 'normal',
                      display: 'swap',
                  },
                  {
                      src: ['./src/assets/fonts/atkinson-bold.woff'],
                      weight: 700,
                      style: 'normal',
                      display: 'swap',
                  },
              ],
          },
      },
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});