# skillpack docs

Documentation site for `@morovid/skillpack`, built with [Astro Starlight](https://starlight.astro.build) and deployed to Cloudflare Workers as static assets.

Pages are Markdown files in `src/content/docs/`. The sidebar is set in `astro.config.mjs`.

## Commands

Run from this folder, or from the repository root with `pnpm --filter @morovid/skillpack-docs <command>`.

| Command | Action |
|---|---|
| `pnpm dev` | Start the dev server at `localhost:4321` |
| `pnpm build` | Build the site to `dist/` |
| `pnpm preview` | Preview the build locally |
| `pnpm deploy` | Build and deploy to Cloudflare with `wrangler deploy` |

## Deployment

`wrangler.jsonc` serves `dist/` as static assets at https://skillpack.morovid.com (a Workers custom domain), with `404.html` for missing pages. No Worker code or Astro adapter is needed. The `morovid.com` zone must be on the same Cloudflare account; the DNS record and certificate are created on the first deploy.

- **From your machine:** `pnpm wrangler login`, then `pnpm deploy`.
- **Workers Builds (Git integration):** connect the repository in the Cloudflare dashboard, set the root directory to `docs`, the build command to `pnpm build` and the deploy command to `pnpm wrangler deploy`.
