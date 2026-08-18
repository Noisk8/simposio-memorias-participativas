import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const enabled = process.env.E2E_RUN_AUTHENTICATED === '1';
const baseUrl = String(process.env.E2E_BASE_URL || '').replace(/\/+$/, '');
const supabaseUrl = String(process.env.E2E_SUPABASE_URL || '').replace(/\/+$/, '');
const anonKey = String(process.env.E2E_SUPABASE_ANON_KEY || '');
const email = String(process.env.E2E_ADMIN_EMAIL || '');
const password = String(process.env.E2E_ADMIN_PASSWORD || '');

test.describe('flujo editorial autenticado de staging', () => {
  test.skip(
    !enabled || !baseUrl || !supabaseUrl || !anonKey || !email || !password,
    'Requiere el entorno E2E autenticado de staging.'
  );

  test('borrador → PR → deploy → archivo → deploy → limpieza', async ({ request }) => {
    test.setTimeout(20 * 60_000);
    const authResponse = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      data: { email, password },
    });
    expect(authResponse.ok(), await authResponse.text()).toBeTruthy();
    const session = await authResponse.json();
    const token = String(session.access_token || '');
    expect(token).not.toBe('');

    const api = async (path: string, options: Parameters<APIRequestContext['fetch']>[1] = {}) => {
      const response = await request.fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      expect(response.ok(), JSON.stringify(body)).toBeTruthy();
      return body;
    };

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const created = await api('/.netlify/functions/manage-content?collection=entradas', {
      method: 'POST',
      data: {
        data: {
          title: `Verificación E2E ${suffix}`,
          author: 'Automatización de staging',
          simposio: '2026',
          categories: ['general'],
          tags: ['memoria'],
          description: 'Contenido temporal para verificar el ciclo editorial completo en staging.',
        },
        body: 'Este contenido temporal comprueba publicación, despliegue, archivo y limpieza automática.',
      },
    });
    const contentPath = String(created.item.path);
    const publicPath = String(created.publicUrl);
    const revision = Number(created.item.revision);

    const transition = (name: 'publish' | 'archive') =>
      api('/.netlify/functions/manage-workflow', {
        method: 'POST',
        data: { path: contentPath, transition: name, operationKey: randomUUID() },
      });
    const workflow = () =>
      api(`/.netlify/functions/manage-workflow?path=${encodeURIComponent(contentPath)}`);
    const waitForState = async (expected: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await workflow();
        const state = String(current.record?.publication_state || '');
        if (state === expected) return current.record;
        expect(state, JSON.stringify(current.record)).not.toBe('failed');
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
      throw new Error(`El workflow no alcanzó el estado ${expected}.`);
    };

    try {
      await transition('publish');
      await waitForState('live');
      const publicResponse = await request.get(`${baseUrl}${publicPath}`);
      expect(publicResponse.status()).toBe(200);
      expect(await publicResponse.text()).toContain(`Verificación E2E ${suffix}`);

      await transition('archive');
      await waitForState('archived');
      expect((await request.get(`${baseUrl}${publicPath}`)).status()).toBe(404);
    } finally {
      await api(
        `/.netlify/functions/manage-content?collection=entradas&path=${encodeURIComponent(contentPath)}&revision=${revision}`,
        { method: 'DELETE' }
      );
    }
  });
});
