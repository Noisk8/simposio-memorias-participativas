/** @deprecated Usa manage-collections. Se conserva para clientes externos durante la transición. */
import { handler as manageCollections } from './manage-collections.ts';

export const handler = async (event: any, context?: any) => {
  const response = await manageCollections(event, context);
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      Deprecation: 'true',
      Warning: '299 - "create-coleccion está obsoleto; usa manage-collections"',
      Link: '</.netlify/functions/manage-collections>; rel="successor-version"',
    },
  };
};
