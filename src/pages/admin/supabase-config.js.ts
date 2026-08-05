export const prerender = true;

export function GET() {
  return new globalThis.Response(
    JSON.stringify({
      url: import.meta.env.PUBLIC_SUPABASE_URL || '',
      anonKey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY || '',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    },
  );
}
