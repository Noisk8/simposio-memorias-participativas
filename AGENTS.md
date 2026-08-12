## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## CMS architecture

The current editorial backend is the custom CMS under `/admin/`:

- Supabase Auth is the only identity provider.
- Supabase PostgreSQL is the authority for RBAC, workflow, and audit data.
- Netlify Functions validate the JWT and permissions server-side.
- Published Markdown and the current image library are versioned in GitHub.
- Astro builds the public site from the repository content.

Do not reintroduce Decap CMS, Netlify Identity, or Git Gateway. Do not trust roles, user IDs, permissions, or GitHub paths supplied by the browser. Never expose `SUPABASE_SERVICE_ROLE_KEY` or GitHub credentials to client code.

Read `docs/ARQUITECTURA-CMS.md` before changing CMS behavior. Supabase Storage, media metadata in Supabase, GitHub App/PR publication, and end-to-end workflow enforcement are planned rather than current capabilities.
