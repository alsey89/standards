# Bootstrapping a Product

The assembly sequence for a new product conforming to the
[architecture standard](../standards/architecture.md). There is no template repo
([architecture §14](../standards/architecture.md) records why); this is a
hand-assembled checklist, and the invariants in
[architecture §13](../standards/architecture.md) are the acceptance test.

## The skeleton, in order

1. **Root scaffold:** `package.json` (the `site` workspace + the canonical
   scripts — `dev`, `build`, `deploy:production`, `check`, `typecheck`, `test`,
   `test:e2e`, `db:generate`, `db:migrate:local`, `db:migrate:production`,
   `seed:local`, `verify:serving`; a new product declares `env.production` and no
   staging block or scripts, [ops §9](../standards/ops.md)),
   `vite.config.ts`, `wrangler.jsonc`, both tsconfigs,
   `app.html`, `scripts/merge-site.mjs`.
2. **Cross-surface boundaries:** top-level `config/` (`brand.ts`, `routes.ts`
   — pure typed data exporting at least `APP_BASE`, `APP_PATHS`, `PUBLIC_PREFIXES`,
   `API_BASE`, `isAppPath()`, `fillPath()` —
   [conventions §2.1](../standards/conventions.md)) and `styles/`
   (`tokens.css` — the token contract is
   [styling §2](../standards/styling.md)), with the `#config/*` subpath import
   declared in `package.json` `"imports"` and mirrored in all three tsconfigs
   **and** `vite.config.ts`.
3. **`src/` three-folder split:** `client/` (`main.ts`, `router.ts`, `api.ts`,
   `i18n/`, `pages/`, `components/{ui,shell,<area>}`, `stores/`, `lib/`),
   `worker/` (`index.ts`, `env.ts`, `routes/`, `middleware/` — `principal.ts`
   for resolution and guards, `scope.ts` as the sole scoped-accessor
   construction site — `services/`, `db/{schema/,client.ts,scope.ts,global.ts}`),
   `shared/` (`errors.ts`, `validators/`, `types/`).
4. **The serving contract:** the Worker catch-all using `isAppPath()` from
   `config/routes.ts` — exact match against the declared paths — `app.html`
   as the SPA shell, no `not_found_handling`,
   the site owning `index.html`, and `run_worker_first` in `wrangler.jsonc` —
   derived from `config/routes.ts`, never hand-mirrored, and asserted against
   it by `test/shared/routes.test.ts`.
5. **`site/`** Astro workspace importing `styles/tokens.css` and
   `#config/*`; static output; built-in i18n with an unprefixed default
   locale.
6. **`migrations/`, `test/{worker,client,shared,e2e}`, `docs/`** conventions;
   run `wrangler types` and wire `npm run check`.

Backend-internal conventions — auth shape, testing bar, env validation — are
set out in [ops](../standards/ops.md) and
[conventions](../standards/conventions.md); copy the reference implementation
as a starting point for what they leave product-specific (role models,
domain logic).

What changes per product: the domain and `wrangler` name, the `Env` bindings
and DB name, the route modules and service/db domains, the `config/` values
and token palette, and the site content. The *shape* stays identical.

## Verifying the serving model

`npm run verify:serving` is the canonical script for this — it runs against a
built preview and CI gates on it (`check && test && build && verify:serving`,
[architecture §8](../standards/architecture.md)). Wire it during bootstrap, before there is anything else to
run it against: build, preview, and assert each path returns the expected
source and status.

```sh
npm run build && npm run preview
```

```
/                 200 (site)     /app/<page>        200 (shell)
/pricing/         200 (site)     /app/admin/<page>  200 (shell)
/app/auth/sign-in 200 (shell)    /app/<res>/:id     200 (shell)
/<res>            404 (site)     /garbage           404 (site)
/app/nope         404 (site)     /app/<page>/       200 (shell)
/api/v1/nope      404 (JSON)     /api/health        200 (JSON)
```

This table is what `verify:serving` should assert once it is wired — there is
no template repo, so a new product writes the script once, following this
table, and every later change to the serving model reruns it instead of
retyping the checklist.

The failure modes this catches: a SPA shell served with 200 for garbage URLs,
under `/app` included (missing catch-all logic, or a prefix match where an
exact one belongs), site pages falling through to the shell (asset
merge broke), or app paths 404ing (drift between `config/routes.ts`, the
`run_worker_first` list it derives, and the mounted routes — which
`test/shared/routes.test.ts` should also catch).

Finish with the full gate — the same order CI runs:

```sh
npm run check && npm test && npm run build && npm run verify:serving
```
