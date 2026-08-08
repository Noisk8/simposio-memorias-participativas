/**
 * Compatibilidad para clientes antiguos. Toda creación se delega al endpoint
 * canónico para compartir esquema, propiedad, auditoría y control de conflictos.
 */
import { handler as manageContent } from './manage-content.ts';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') return manageContent(event);
  let legacy: any = {};
  try {
    legacy = JSON.parse(event.body || '{}');
  } catch {
    // manage-content devolverá el contrato de error estructurado.
  }
  return manageContent({
    ...event,
    queryStringParameters: { ...(event.queryStringParameters || {}), collection: 'memorias' },
    body: JSON.stringify({
      data: {
        draft: true,
        simposio: legacy.simposio || '2026',
        number: legacy.number,
        title: legacy.title,
        place: legacy.place,
        author: legacy.author || '',
        collective: legacy.collective || '',
        categories: legacy.categories || [],
        tags: legacy.tags || [],
        image: legacy.image || '',
        description: legacy.description || '',
      },
      body: legacy.body || '',
    }),
  });
};
