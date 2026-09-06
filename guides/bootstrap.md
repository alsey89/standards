# Bootstrapping a Product

The assembly sequence for a new product conforming to the
[architecture standard](../standards/architecture.md). There is no template repo
(the standard's §14 records why); this is a hand-assembled checklist, and the
invariants in the standard's §13 are the acceptance test.

## The skeleton, in order

1. **Root scaffold:** `package.json` (the `marketing` workspace + the build
   pipeline scripts), `vite.config.ts`, `wrangler.jsonc`, both tsconfigs,
   `app.html`, `scripts/merge-marketing.mjs`.
2. **Cross-surface boundaries:** top-level `config/` (`brand.ts`, `routes.ts`
   — pure typed data) and `styles/` (`tokens.css`), with the `#config/*`
   subpath import declared in `package.json` `"imports"` and mirrored in all
   three tsconfigs **and** `vite.config.ts`.
3. **`src/` three-folder split:** `client/` (main.tsx, App.tsx, api.ts,
   i18n.tsx, pages/, components/ui + features, lib/), `worker/` (index.ts,
   routes/ with middleware.ts, services/, db/), `shared/` (types.ts + domain
   helpers).
4. **The serving contract:** the Worker catch-all using `isAppPath()` from
   `config/routes.ts`, `app.html` as the SPA shell, no `not_found_handling`,
   marketing owning `index.html`.
5. **`marketing/`** Astro workspace importing `styles/tokens.css` and
   `#config/*`; static output; built-in i18n with an unprefixed default
   locale.
6. **`migrations/`, `test/`, `docs/`** conventions; run `wrangler types` and
   wire `npm run check`.

Backend-internal conventions — auth shape, testing bar, env validation — are a
later phase (standard §10–§12); copy the reference implementation as a
starting point.

What changes per product: the domain and `wrangler` name, the `Env` bindings
and DB name, the route modules and service/db domains, the `config/` values
and token palette, and the marketing content. The *shape* stays identical.

## Verifying the serving model

Run this after assembly and **after any change to the serving model** — there
are no route-level tests for it, so the check is manual and cheap.

```sh
npm run build && npm run preview
```

Then assert each path returns the expected source and status:

```
/             200 (marketing)   /<section>    200 (shell)
/pricing/     200 (marketing)   /<section>/   200 (shell)
/admin/<page> 200 (shell)       /<res>/<slug> 200 (shell)
/<res>        404 (marketing)   /garbage      404 (marketing)
/api/nope     404 (JSON)
```

The failure modes this catches: a SPA shell served with 200 for garbage URLs
(missing catch-all logic), marketing pages falling through to the shell
(asset merge broke), or app paths 404ing (drift between `config/routes.ts`
and the mounted routes — which the `test/routes.test.ts` boundary pins should
also catch).

Finish with the full gate:

```sh
npm run check && npm test
```
