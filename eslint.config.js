import eslintPluginAstro from 'eslint-plugin-astro';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import astroParser from 'astro-eslint-parser';

const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  fetch: 'readonly',
  AbortSignal: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
  global: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'readonly',
  require: 'readonly',
  exports: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  localStorage: 'readonly',
  fetch: 'readonly',
  Headers: 'readonly',
  RequestInit: 'readonly',
  URLSearchParams: 'readonly',
  CustomEvent: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  EventTarget: 'readonly',
  Event: 'readonly',
  FileReader: 'readonly',
  CSS: 'readonly',
  crypto: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  confirm: 'readonly',
  clearTimeout: 'readonly',
  Window: 'readonly',
};

export default [
  ...eslintPluginAstro.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/scripts/**/*.{js,ts}'],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    files: ['**/*.astro'],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: ['.astro'],
      },
      globals: nodeGlobals,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // La configuración recomendada de eslint-plugin-astro activa reglas de
    // @typescript-eslint que no siempre están disponibles. Las desactivamos
    // globalmente para evitar falsos errores de configuración.
    files: ['**/*.{js,mjs,cjs,ts,astro}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '.astro/', 'public/admin/index.html'],
  },
];
