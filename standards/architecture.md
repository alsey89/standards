# Product Architecture Standard

A reference for how these products are structured: **one Cloudflare Worker,
one deploy, one domain — serving three surfaces**: the SPA, the Worker (the
JSON API), and the site. The three share a typed product config, one set of
design tokens, and an internal app contract.

**Standard version: 2.0** — changelog in [CHANGELOG.md](../CHANGELOG.md).

This document is **normative**: it fixes the stack, the top-level layout, how
the three surfaces share code, and how one Worker serves and builds them.
Product repos do **not** copy it — they record which version they conform to
and pin it (§14). Implementation walkthroughs live in the guides:
[tenant scoping](../guides/tenant-scoping.md) and
[bootstrapping a product](../guides/bootstrap.md).

**Scope: repository structure.** The Worker's *internal* behavioral
conventions — error handling, testing depth, env validation, auth/tenancy
beyond the structural rules below — are fixed by the companion documents,
[conventions.md](conventions.md) and [ops.md](ops.md), which §10–§12 point to.
Design tokens, dark mode, and component primitives are fixed by
[styling.md](styling.md).

---

## 1. Principles

1. **One Worker, one deploy, one origin.** No CORS, no cross-service auth, no
   URL migration between "the app" and "the site." Everything ships in a single
   `wrangler deploy`. Static assets are served by the Workers asset pipeline;
   only `/api/*` and unmatched fallbacks invoke Worker code.

2. **Shared by scope, not by convenience.** Three things cross module
   boundaries, and each lives where its *consumers* are:
   - **`config/`** (top level) — typed product facts, consumed by all three
     surfaces.
   - **`styles/`** (top level) — design tokens (CSS), consumed by the SPA and
     the site.
   - **`src/shared/`** — the app's internal type contract, consumed only by
     the SPA and Worker.

   The rule: if a value could appear on the pricing page it's `config/`; if it
   only describes the API/domain it's `src/shared/`. See §5.

3. **Static by default, dynamic only where needed.** Landing, pricing,
   legal, blog, and docs are pre-built static HTML (Astro). The SPA is a
   static bundle. The Worker is invoked only for the API and for serving the
   right HTML shell on a fallback path.

4. **Two isolated TypeScript projects for the app.** Client code (DOM libs)
   and Worker code (workerd types) have incompatible global environments. They
   are compiled by separate `tsconfig`s that share only `src/shared`.

5. **The Worker splits HTTP from logic from data access.** Route files
   (`routes/`) do HTTP; business logic lives in `services/` as plain
   functions; data access lives in `db/` behind per-request scoped accessors
   constructed by each route family's middleware (§4).

---

## 2. Top-level repo layout

```
<product>/
├── config/                   # cross-surface product FACTS (typed data)
│   ├── brand.ts              #   name, slug, origin, support email, locales
│   └── routes.ts             #   app route paths + isAppPath() — the single
│                             #   declaration the Worker, SPA, and site all
│                             #   read (see §5, conventions §2)
├── styles/                   # cross-surface design tokens (CSS)
│   └── tokens.css            #   custom properties + Tailwind @theme
├── src/                      # the app: SPA + Worker + internal contract
│   ├── client/               #   SPA (browser)
│   │   ├── main.ts           #     entry: mounts providers (router, i18n, …)
│   │   ├── router.ts         #     the route table — paths from config/routes.ts
│   │   ├── api.ts            #     the only file that calls fetch (§3)
│   │   ├── i18n/             #     provider + message dictionaries
│   │   ├── pages/            #     one file or folder per route — never views/
│   │   ├── components/       #     ui/ (generated), shell/, feature areas
│   │   ├── stores/           #     client state
│   │   └── lib/              #     cn() and small helpers
│   ├── worker/               #   Cloudflare Worker (API + serving)
│   │   ├── index.ts          #     entry: routes, catch-all, onError, cron
│   │   ├── env.ts            #     the hand-declared secret list (§12)
│   │   ├── routes/           #     HTTP — one Hono sub-app per area
│   │   ├── services/         #     business logic — plain functions
│   │   ├── db/               #     schema/, scope.ts, global.ts, client.ts
│   │   ├── middleware/       #     principal.ts (guards), scope.ts (§4)
│   │   └── lib/              #     worker-only primitives (log, email, …)
│   └── shared/               #   app-internal contract both halves import
│       ├── errors.ts         #     error codes (conventions §4)
│       ├── validators/       #     zod schemas
│       └── types/            #     request/response shapes
├── site/                     # separate Astro workspace — every static page
│   └── public/               #   second asset root — see rule below
├── migrations/               # D1 SQL, 0000_snake_name.sql … (§8)
├── scripts/                  # build/ops scripts (merge-site, checks, seeds)
├── test/                     # vitest, tiered by runtime
│   ├── worker/               #   workerd
│   ├── client/               #   jsdom
│   ├── shared/               #   node
│   └── e2e/                  #   playwright
├── public/                   # app static files — reserved prefix only
├── docs/                     # product-local design specs and plans
│
├── app.html                  # SPA HTML shell (NOT index.html — see §7)
├── seed.sql                  # D1 seed data (npm run seed)
├── vite.config.ts            # builds the SPA + bundles the Worker
├── wrangler.jsonc            # Worker + bindings (D1, DO, AI, assets, vars)
├── worker-configuration.d.ts # generated by `wrangler types` — never hand-edited
├── tsconfig.json             # client project (DOM libs)
├── tsconfig.worker.json      # worker project (generated runtime types, no DOM)
├── drizzle.config.ts         # schema → migrations/ (§8)
├── components.json           # shadcn generator config
├── package.json              # root; declares `site` as a workspace
└── README.md
```

**`src/` keeps its name.** `site/` is a separate workspace package and `src/`
is the root package's source, so the two are not peers and owe each other no
symmetry. — *Why:* renaming it `app/` collides three ways — with the `app/`
directory a file-router framework claims, with the `/app` URL prefix (§7), and
with `app.html`.

**Tests live in `test/`, tiered by runtime** — `test/{worker,client,shared,e2e}`,
files named `*.test.ts`, never beside the code they cover. — *Why:* worker code
runs in workerd and client code in jsdom, so the tiers are separate vitest
projects whatever you do; a root `test/` keeps them out of `src/` and out of
anything that globs it. What must be tested is [ops §8](ops.md).

**Two `public/` directories land in the same deployed asset root, and they are
kept disjoint by construction:** the app's `public/` may only contain files
under a reserved prefix (`/embed/*`, `/widget/*` — the product's embed
surface); the site owns the root namespace (favicon, fonts, generated
robots/sitemap). — *Why:* `scripts/merge-site.mjs` hard-fails on a collision
(§8), but a build that fails at the merge step is a rule discovered too late —
a reserved prefix is the same guarantee held before either file is written.

The mental model: **`src/` is the application, `site/` is the website**,
and they meet only in the merged build output, the shared tokens (`styles/`),
and the shared product config (`config/`).

---

## 3. Surface A — the SPA (`src/client`)

**The framework is a leaf, not the contract.** Vue 3 + Vite + vue-router + Pinia +
shadcn-vue is the default for new products. React is equally conforming — MailMatter,
`tabler` and `slidr` are React and none of them is wrong. What this standard fixes is
everything *around* the framework: the repo layout, `config/`, the route-path
declaration, the design tokens, the i18n shape and the error contract. — *Why:* two
products on different frameworks should still read as the same codebase everywhere
except `src/client`'s component syntax, and that is only true if the framework is the
one thing allowed to differ.

The authenticated app and all dynamic guest pages. A static SPA bundle; the
Worker never renders the SPA.

```
src/client/
├── main.ts                   # entry: mounts providers (router, i18n, toast)
├── router.ts                 # the route table — paths from config/routes.ts
├── api.ts                    # the sole fetch boundary (contract: conventions §4)
├── i18n/                     # provider + typed message dictionaries
├── realtime.ts               # WebSocket client for live updates (if used)
├── styles.css                # imports shared tokens, then app styles
├── pages/                    # one file or folder per route
├── components/
│   ├── ui/                   #   generated primitives — untouched in shape
│   ├── shell/                #   the app shell (chrome, nav, layout)
│   └── <area>/               #   feature components, grouped past ~15 files
├── stores/                   # client state
└── lib/                      # cn(), small helpers (shadcn convention)
```

File extensions follow the framework (`.ts`/`.tsx`/`.vue`); the names and the
shape do not.

**Rules**

- **`router.ts` composes the routes; the *paths* come from `config/routes.ts`.**
  — *Why:* the Worker's shell-vs-404 decision (§7) and the site's CTAs read the
  same module, so a path that lives in only one of the three drifts silently
  into a 404 nobody edited.
- **`src/client/api.ts` is the only file that calls `fetch`.** One wrapper sets
  credentials, sends `X-Request-Id`, unwraps the response envelope, and throws
  a typed error on non-2xx; request/response types come from `src/shared`,
  never redefined. The wire contract it implements — envelopes, error shape,
  pagination, the trace header — is [conventions §4](conventions.md). —
  *Why:* one boundary is the only way a change to that contract is one edit
  rather than a search.
- **`pages/`, never `views/`.** — *Why:* two names for the same directory is a
  coin-flip every time a reader (or an agent) goes looking for the code behind
  a URL.
- **`components/ui/` is exactly what the shadcn CLI for the framework
  generates** — its own file-naming, never renamed, never restructured, and
  `components.json` keeps pointing at it. Edits to its files stay
  theme/behavior-level; feature composition lives in feature components, and
  there is no sibling `ui.tsx` next to the `ui/` directory. — *Why:* the
  generator is the upgrade path, and a restructured `ui/` turns every later
  `add` or `diff` into a hand-merge.
- **A SPA has no `layouts/`; the shell is `components/shell/`.** — *Why:*
  `layouts/` is a file-router framework's slot, and inventing it under an
  explicit router just splits the chrome across two places.
- **Feature components group by area once a flat folder passes ~15 files.**
  — *Why:* that is roughly where scanning a directory stops being faster than
  searching it; grouping earlier invents boundaries the product hasn't earned.
- **User-facing text goes through `i18n/`, and the dictionary is a typed
  object.** — *Why:* a typed dictionary turns a missing key into a compile
  error instead of a raw key rendered into the UI in the locale nobody on the
  team reads.

---

## 4. Surface B — the Worker (`src/worker`)

`/api/*` handlers, the cron entry, Durable Objects, and the HTML-shell
fallback. Hono for routing; plain functions for logic.

```
src/worker/
├── index.ts                  # entry: composes routes, asset fallback,
│                             #   onError, scheduled() cron, DO re-exports
├── env.ts                    # the hand-declared secret list (§12)
├── realtime.ts               # Durable Object class (e.g. a per-tenant hub)
├── routes/                   # HTTP layer — one Hono sub-app per area
│   ├── public.ts             #   guest API
│   ├── admin.ts              #   authenticated API
│   └── <integration>.ts      #   webhooks, OAuth callbacks
├── middleware/               # principal resolution, guards, scope injection
│   ├── principal.ts          #   resolvePrincipal + requireAuth/Rank/Scope
│   └── scope.ts              #   the SOLE scoped-accessor construction site
├── services/                 # business logic — plain functions (repo, args)
│   ├── auth.ts               #   session/authorization
│   ├── <domain>.ts           #   one module per domain area
│   └── util.ts               #   ApiError + tiny shared primitives — keep small
├── lib/                      # worker-only primitives (log, email, crypto)
└── db/                       # data access — the tenant chokepoint
    ├── schema/               #   drizzle tables, one module per domain
    ├── client.ts             #   builds the drizzle client from the binding
    ├── scope.ts              #   exports forTenant / forTenantAsStaff / global
    ├── global.ts             #   the unscoped query modules global() returns
    └── <domain>.ts           #   tenant-scoped queries (via scope.ts factories)
```

**The entry file (`index.ts`) is the spine.** — *Why:* one file naming every
mount point, the catch-all, the error handler and the cron entry is the map a
reader needs before anything else under `src/worker/` makes sense. It creates one
`Hono<{ Bindings: Env }>` app, mounts each route module (most specific prefix
first), defines the catch-all that serves the correct HTML shell (§7),
registers one central `onError`, exports `{ fetch, scheduled }` (cron work
wrapped in `ctx.waitUntil`), and re-exports Durable Object classes.

**Structural rules:**

- **HTTP lives in `routes/`, business logic in `services/`, data access in
  `db/`.** There is no separate handler layer (a Hono sub-app *is* route +
  handler) and no mandated repository stack beyond `db/`. — *Why:* three named
  layers is the smallest split that keeps a request's parsing, its decisions,
  and its SQL independently testable; a fourth layer on this stack is
  ceremony.
- **`db/` is the tenant-isolation chokepoint.** One shared D1 database, a
  `tenant_id` column on every tenant-owned table, and every query issued
  through a per-request scoped accessor whose tenant key is closed over from
  a **verified credential** — never passed as a parameter below the
  middleware that constructs it. In code the accessor is named `repo`, not
  `db`: it wraps the one shared database; nothing here is
  database-per-tenant. — *Why:* a tenant filter that is remembered at each
  call site is a filter that gets forgotten once; closed over at construction,
  the wrongly-scoped query has nowhere to be written.
- **Scoped accessors are constructed only in `src/worker/middleware/scope.ts`,
  from the resolved `Principal`.** The D1 binding (`env.DB`, `.prepare(`,
  `drizzle(`) is touched in exactly three places — `src/worker/index.ts`,
  `src/worker/middleware/scope.ts`, and under `src/worker/db/` — and
  `scripts/check-db-boundary.mjs` enforces exactly that allowlist in
  `npm run check` (§8, §13). Each route family is injected with the scope it
  is entitled to (`global` / `forTenant` / `forTenantAsStaff`); cross-tenant
  access goes only through the distinctly-named `forTenantAsStaff()`, and
  those three names never change whatever the product calls its tenant
  ([ops §5](ops.md)). — *Why:* one construction site is what lets the tenant
  key come only from a credential already verified upstream, and a
  three-entry allowlist is short enough for a script to hold and for a
  reviewer to check. Wiring, code, and the scope taxonomy:
  [tenant scoping guide](../guides/tenant-scoping.md).
- **One middleware resolves any credential into a `Principal`; routes declare
  guards and never inspect the credential.** Session cookie, API key, and
  integration token all arrive as the same object ([ops §2](ops.md)). —
  *Why:* a route that branches on how the caller authenticated is a route that
  will be forgotten when a fourth credential arrives.
- **Drizzle is the ORM, and every table spreads a shared `baseFields`**
  (`id`, `createdAt`, `updatedAt`, `deletedAt`); tables live in
  `db/schema/*.ts`, one module per domain, and the client is built once in
  `db/client.ts`. Raw D1 SQL is a legitimate deviation when it is recorded
  (§15). — *Why:* a single field vocabulary is what makes soft delete,
  ordering, and keyset pagination identical on every table instead of a
  per-table decision, and a typed schema is what makes migrations generated
  rather than hand-written (§8).
- A genuinely single-tenant product may relax `db/` to a growth path (inline
  SQL in services until queries crowd out logic); workspace-scoped is the
  default on this stack.
- **`Env` is generated, never hand-maintained.** `wrangler types` emits
  `worker-configuration.d.ts` from `wrangler.jsonc` + `.dev.vars`, run first
  by `npm run check` (§8). Nothing reads an untyped `env.SOMETHING`; the
  secrets the product needs are hand-declared in `src/worker/env.ts` and
  nowhere else (§12). — *Why:* a hand-written `Env` interface is a copy of
  `wrangler.jsonc` that nothing forces forward, so it goes stale on the first
  binding somebody adds without touching it.

> Behavioral conventions — error mapping, guards, session shape, what a test
> must cover — are fixed by [conventions.md](conventions.md) and
> [ops.md](ops.md); §10–§12 name which.

---

## 5. The shared boundaries — three scopes, three homes

| Home | Holds | SPA | Worker | Site |
|------|-------|:---:|:---:|:---:|
| **`config/`** (top level) | typed product facts | ✅ | ✅ | ✅ |
| **`styles/`** (top level) | design tokens (CSS) | ✅ | — | ✅ |
| **`src/shared/`** | app-internal type contract | ✅ | ✅ | — |

### `config/` — product facts (all three surfaces)

"Facts about the product a customer could see," in the one place all three
surfaces can read: `brand.ts` (name, slug, origin, support address, locales —
§9) and `routes.ts` (app route paths + `isAppPath()`, pinned by
`test/shared/routes.test.ts`).

- **Everything in `config/` is pure data + types with zero runtime imports.**
  — *Why:* three surfaces with three different global environments import it,
  so a single runtime dependency makes the file unusable in at least one of
  them.
- **It resolves via a real Node subpath import** —
  `"imports": { "#config/*": "./config/*.ts" }` in root `package.json` —
  mirrored in all three tsconfigs and `vite.config.ts` (§9). — *Why:* a real
  subpath import is resolvable by Node, the bundler and the typechecker
  alike, so one declaration serves all three instead of a bespoke alias per
  tool.
- **Nothing enters `config/` until it has two real consumers.** — *Why:* one
  consumer is a local constant, and promoting it early costs a cross-surface
  import for no sharing. (Per-tier limits read by both the pricing page and
  the Worker are the canonical future case — add them when tiers exist.)

### `styles/` — design tokens (SPA + site)

**`styles/tokens.css` is the shared home and the only declaration site for
design tokens**; the SPA and the site both import that one file, and neither
forks a parallel token file of its own. — *Why:* two stylesheets defining the
same role differently is invisible until the two surfaces are put side by
side, which is exactly when it is most expensive to unpick.

**The token vocabulary itself — the fixed property names, the `:root`/`.dark`
blocks, and the `@theme inline` mapping — is fixed by
[styling §2](styling.md), not here.** Products **copy the contract, not the
values** (§14): role names identical, palette per brand, with brand literals
declared in this same file and fed into the roles via `var()` rather than
re-typed. — *Why:* one document owning the names is what makes a component
generated in one repo render correctly in another; two documents describing
the same token set is how they drift apart.

If the site uses a vendored/themed template with its own token system, decide
explicitly: remap its tokens onto yours (`--nb-bg: var(--background)`) or
accept two systems and document the boundary. Silently having both is the
option that rots.

### `src/shared/` — the app's internal contract (SPA + Worker)

Request/response shapes, shared enums, and pure domain helpers both app halves
use. No runtime dependencies; the only directory compiled by both app
tsconfigs. The site never imports it. The line against `config/`: this
describes the **API/domain**, not customer-facing product facts.

### Graduating to a workspace package

Top-level dirs resolved via aliases are right for one product. When a second
product needs to share either across repos, promote them to workspace packages
(`@product/config`, `@product/tokens`) — contents unchanged, only the
declaration moves.

---

## 6. Surface C — the site (`site/`)

A **separate Astro project**, its own npm workspace, building all static
non-app pages: landing, pricing, legal, blog, docs. Isolated so its dependency
churn can't destabilize the app.

**The directory is `site/`; through v1.7 it was `marketing/`.** — *Why:* it
holds landing, docs, blog, legal and pricing, and at least two of those are not
marketing — the old name kept arguing for docs and legal to live somewhere
else.

```
site/
├── astro.config.ts           # static output, docs integration,
│                             #   trailingSlash, prefetch, built-in i18n
├── package.json              # its own deps (workspace member)
├── tsconfig.json             # the shared #config/* alias (no ~/* — §9)
├── public/                   # second asset root — root namespace (see §2)
├── src/
│   ├── pages/                #   routes + generated endpoints (og, llms.txt,
│   │                         #   robots, sitemap); locale variants
│   ├── content/              #   content collections (blog/, docs/)
│   ├── layouts/              #   page shells (site vs docs)
│   ├── components/           #   Astro components (+ a ui/ kit)
│   ├── i18n/                 #   the site's own dictionary
│   ├── lib/                  #   helpers
│   └── styles/               #   imports ../../../styles/tokens.css + site CSS
└── AGENT.md                  # authoring rules for this sub-project
```

**Rules**

- **Static output — no SSR; every page is a file at build time.** — *Why:*
  the asset pipeline serves a file with no Worker invocation (§7), so a
  static site costs nothing per request and cannot take the app down with it.
- **Bilingual routing uses Astro's built-in i18n** (`prefixDefaultLocale:
  false`): the default locale from `config/brand.ts` unprefixed, every other
  locale under its own lowercase slug (`/en/*`, `/zh-tw/*`),
  `getRelativeLocaleUrl()` for URL generation. The framework does *not* write
  hreflang: pages that don't exist in both locales must pass their real
  alternates. — *Why:* the built-in is the one URL generator the sitemap and
  canonical helpers already agree with, and hand-rolled alternates are how a
  page ends up advertising hreflang links to 404s.
- **Trailing slashes are load-bearing:** directory-format output serves pages
  at `/pricing/`, so `trailingSlash: "always"` plus slash-normalizing URL
  helpers keep canonical, hreflang, sitemap, and internal links on one form.
  — *Why:* two spellings of the same page is a duplicate URL to a crawler and
  a redirect hop to a reader, and the app's own no-trailing-slash rule
  ([conventions §2](conventions.md)) only stays unambiguous if the site's
  form is fixed too.
- **Shared *values* go in `config/`; shared *prose* does not.** The SPA and
  the site keep separate i18n dictionaries by design. — *Why:* site copy and
  product copy diverge, so one shared dictionary buys nothing and makes every
  wording change a cross-surface edit.
- `AGENT.md` documents authoring rules and must stay honest about the real
  deploy shape: this workspace merges into the app's asset output; it does
  not deploy standalone.

---

## 7. Serving model — how one Worker serves three surfaces

**Build produces one asset directory**: the site's static pages (owning
`index.html` at `/`), the SPA bundle (shell renamed to `app.html`), and all
hashed assets.

**The authenticated app lives under `/app/*`, and the site owns everything
else.** `APP_BASE = "/app"` in `config/routes.ts`; a product surface that has
to sit at the top level — a share link, an embed, a public profile — is
legitimate only when it is declared in `PUBLIC_PREFIXES`
([conventions §2](conventions.md)).
— *Why:* one prefix turns the shell-vs-site decision into a prefix test
instead of a list that grows with every page, and the declared exceptions are
then the complete list of paths the site may not claim.

**At runtime, requests resolve in this order:**

1. `run_worker_first: ["/api/*"]` sends API paths straight to the Worker —
   `/api/v1/*` and `GET /api/health` alike ([conventions §2](conventions.md)).
2. Everything else hits the **static asset pipeline first** — real files are
   served with no Worker invocation.
3. **Unmatched paths fall through to the Worker's catch-all.** There is
   deliberately **no `not_found_handling`** in `wrangler.jsonc` — that's what
   makes misses invoke the Worker instead of blindly serving a SPA shell.
4. The catch-all calls `isAppPath()` from `config/routes.ts` — the same
   module the SPA and the site read. Match → serve `app.html` with **200**.
   No match → serve the site's **`404.html` with 404**.

**`run_worker_first` is derived from `config/routes.ts`, and a test asserts
the derived list equals the one in `wrangler.jsonc`.** — *Why:* the asset
pipeline reads the JSON and never the module, so a prefix added in one and not
the other is a 404 that appears only in production.

**`isAppPath()` strips one trailing slash before matching.** — *Why:* the site
serves directory-style URLs with a trailing slash, so `/app/settings/` and
`/app/settings` both reach the catch-all and must not disagree about whether
they are the app.

Why `app.html`: the site owns `index.html` at the root, so the SPA shell
builds under a different name (`vite.config.ts` sets
`build.rollupOptions.input` to `app.html`) and the Worker hands it out only
for real app routes.

The payoff: garbage URLs get a real 404, the site owns `/`, and the
catch-all is the hook point for future per-route SSR touches. **Re-run
`npm run verify:serving` after any change to the serving model** — it asserts
the expected statuses; the table is in the
[bootstrap guide](../guides/bootstrap.md).

---

## 8. Build & deploy pipeline

Driven entirely by root `package.json` scripts. Order matters.

```
npm run build
  1. vite build                     → SPA bundle + Worker, into dist/client
  2. npm run build -w site          → Astro static site, into site/dist
  3. node scripts/merge-site.mjs    → copies site/dist into dist/client;
                                      HARD-FAILS on any filename collision
```

**Scripts carry these names in every repo:**

| Script | Runs |
|---|---|
| `dev` | the app — Vite + Worker via `@cloudflare/vite-plugin` |
| `build` | the three steps above, in order |
| `deploy` | `build && db:migrate:remote && wrangler deploy` |
| `check` | `wrangler types`, then typecheck, format check, and the boundary scripts |
| `typecheck` | every tsconfig — client, worker, site |
| `test` | vitest across the `test/` tiers |
| `test:e2e` | playwright against a running `wrangler dev` |
| `db:generate` | `drizzle-kit generate --name <snake_name>` |
| `db:migrate` | `wrangler d1 migrations apply <db>` — local |
| `db:migrate:remote` | the same, `--remote` |
| `seed` | apply `seed.sql` to the local D1 |
| `verify:serving` | the §7 status assertions against a running preview |

— *Why:* CI, the guides, and every agent call these by name; a repo that spells
one of them `migrate:local` costs all three a lookup and gets skipped in CI.
Extra scripts are free (`dev:site` for Astro alone, `preview` for the merged
build); what is fixed is that these twelve names mean these twelve things.

- **`check` is the gate**, and it is composed, not ad hoc: `wrangler types`
  first (so `Env` is current), then the typecheck of all three projects, the
  format check, and the boundary scripts (§13). CI runs
  `check && test && build && verify:serving`, in that order
  ([ops §9](ops.md)). — *Why:*
  each stage is ordered by how fast it fails, and a check that only lives in
  CI is a check nobody can run before pushing.
- **`test/`** — vitest + `@cloudflare/vitest-pool-workers`: worker code runs
  in workerd against isolated real bindings; `#config/*` resolves through
  `vite.config.ts`.
- **Migrations are `migrations/0000_snake_name.sql`, always named, in one
  directory.** Generate with `drizzle-kit generate --name <snake_name>` from
  `0000` up, keep drizzle's `meta/` journal in the same directory, and apply
  only through `wrangler d1 migrations apply` — never a migrator at runtime.
  — *Why:* an unnamed generated migration gets a random two-word label that
  tells the next reader nothing, and a second migrations directory always ends
  with one of them silently unapplied.

---

## 9. Config files — what each one owns

| File | Owns |
|------|------|
| `wrangler.jsonc` | Worker name, compat date, **bindings**, asset config (`assets.directory`, `run_worker_first`, no `not_found_handling`), custom domains in `routes`, `observability`, non-secret `vars`. |
| `vite.config.ts` | SPA build + Worker bundling, the `app.html` input rename, bundle-time aliases (`@/*` → `src/client`, `#config` → `config/`). |
| `tsconfig.json` | **Client** project: DOM libs, `jsx`, `@/*`, the `#*` imports; includes `src/client`, `src/shared`, `config`. |
| `tsconfig.worker.json` | **Worker** project: generated runtime types, no DOM, the `#*` imports; includes `src/worker`, `src/shared`, `config`. |
| `package.json` | Root deps + scripts; the `site` workspace; the canonical `"imports"` (`#config/*`, `#shared/*`, `#worker/*`). |
| `site/tsconfig.json` | The shared `#config/*` → `../config/*`; no sigil of its own. |
| `drizzle.config.ts` | `src/worker/db/schema` → `migrations/` (§8). |
| `components.json` | shadcn generator config for the SPA primitives. |

**Alias rules:**

- **`@/*` belongs to the app alone** (`src/client/*`) — shadcn-generated code
  hard-imports it. **`~/*` is not used**: the site imports its own files
  relatively, and only `#config/*` crosses into it. — *Why:* a second sigil
  meaning "this project's source" is a rule to remember at every import, and
  the generator has already claimed the first one.
- **`#config/*`, `#shared/*` and `#worker/*` are real Node subpath imports**,
  declared canonically in root `package.json` `"imports"` with an explicit
  `.ts` (Node does no extension guessing), mirrored in every tsconfig
  (typecheck) and in `vite.config.ts` `resolve.alias` (bundles). The site
  declares its own `#config` alias because root `"imports"` does not reach a
  workspace member. All declarations are exercised by `npm run check` +
  `npm run build`. — *Why:* Node, the bundler and the typechecker each resolve
  imports their own way, so one canonical declaration mirrored into all three
  is what makes an import that typechecks also bundle and also run.

**One name, five places.** The repo directory, the `package.json` name, the
`wrangler.jsonc` name, the D1 database name prefix, and `BRAND.slug` are the
same string. — *Why:* that string is also the prefix on every cookie and API
key, so when the five agree a stray value from another product is visibly
wrong instead of quietly working.

**`config/brand.ts` is the source of that name and of the locale set:**

```ts
// config/brand.ts
export const BRAND = {
  name: "Anysign",
  slug: "anysign",             // repo, package, wrangler, D1 prefix, cookies
  origin: "https://anysign.tv",
  supportEmail: "support@anysign.tv",
  locales: {
    default: "en",             // unprefixed on the site (§6)
    supported: ["en", "zh-TW"] as const, // canonical codes; URL slugs lowercase
  },
} as const;
```

— *Why:* the slug and the locale set are each read by all three surfaces —
they are the `config/` two-consumer test (§5) passed twice over — and both are
things a second copy gets subtly wrong.

**Platform assumptions, stated so they are not rediscovered:** Workers Paid;
`compatibility_date` ≥ 2026-08-04, on which Node compatibility is on without a
flag; `assets.directory` is `./dist/client`; custom domains live in
`wrangler.jsonc` `routes`, never in a `var`; `observability.enabled` is true.
— *Why:* each of these is invisible locally and expensive in production — a
missing runtime API at the first deploy, an empty asset root, a domain that
only one environment knows about, or an incident with no logs.

---

## 10. Auth, sessions, and tenant isolation

The rules live in [ops §2–§5](ops.md): principals and route guards, D1-row sessions and
their cookie, password hashing and OAuth, and the tenancy accessors. Two
invariants are structural and belong here: **the tenant key comes from a
verified credential** — the session for app routes, the verified
signature/token for webhooks — **never from client input**, and it enters
queries only through the `db/` scoped accessor constructed in
`src/worker/middleware/scope.ts` (§4). Cross-tenant access goes only through
`forTenantAsStaff()`; the wiring is
in the [tenant scoping guide](../guides/tenant-scoping.md).

---

## 11. Testing contract

The rules live in [ops §8](ops.md): the runners, the vitest projects, and what a route
must prove before it ships. The structural part is fixed here — tests live in
`test/{worker,client,shared,e2e}` as `*.test.ts`, never beside the code they
cover (§2). `npm test` runs the three vitest tiers; the playwright tier runs
under `npm run test:e2e` and is the one tier CI does not block on (§8).

---

## 12. Environment, secrets, and validation

The rules live in [ops §6](ops.md): generated `Env`, the hand-declared secret list in
`src/worker/env.ts`, the committed `.dev.vars.example`, and the boot-time
checks. The structural split stands: public constants in `config/` (§5),
per-environment values in `wrangler.jsonc` `vars`, secrets via
`wrangler secret put` / `.dev.vars` (§9). One hard rule survives verbatim:
**never put a secret in `vars`** — a plaintext `var` overwrites the real secret
with `""` on the next deploy.

---

## 13. Conformance

**Invariants — this list is the conformance test:**

- One deploy, one origin — never split the API onto a second service.
- Shared things live by consumer: `config/` (all three surfaces), `styles/`
  (app + site), `src/shared/` (app-internal only). No surface redefines
  another's shapes.
- Nothing enters `config/` until it has **two real consumers**.
- The Worker splits HTTP (`routes/`) from logic (`services/`) from data
  access (`db/`).
- The D1 binding is touched only in `src/worker/index.ts`,
  `src/worker/middleware/scope.ts`, and under `src/worker/db/`; services take
  the scoped accessor injected by their route family's middleware; its tenant
  key comes from a verified credential (§4, §10).
- `Env` comes from `wrangler types`, never a hand-maintained interface.
- `api.ts` is the sole client↔API boundary.
- App route paths are declared once in `config/routes.ts` — never
  hand-mirrored.
- The site build merges into the app's assets with a collision guard; the site
  owns `/`; the SPA shell is `app.html`; app `public/` stays under its
  reserved prefix.
- Tests live in `test/{worker,client,shared,e2e}` as `*.test.ts` (§2).
- `npm run check`, `npm test`, and `npm run verify:serving` pass.

**Mechanizable checks** (all of them wired into `npm run check` or `npm test`):

| Invariant | Check |
|---|---|
| Shared things live by consumer | import-boundary lint: `site/**` never imports `src/shared`; `src/worker/**` never imports DOM globals |
| `config/` two-consumer rule | count importing files per export across surfaces; fail under 2 |
| `api.ts` sole boundary | grep for `fetch(` under `src/client` outside `api.ts` |
| Route paths declared once | grep for app-path literals outside `config/routes.ts` and the router — the count must be zero |
| Data access only via `db/` | `scripts/check-db-boundary.mjs` — the D1 binding (`env.DB`, `.prepare(`, `drizzle(`) appears only in `src/worker/index.ts`, `src/worker/middleware/scope.ts`, and under `src/worker/db/` |
| `run_worker_first` agrees with `config/routes.ts` | a test compares the derived list with `wrangler.jsonc` (§7) |
| Formatting | the format check in `check` — one formatter, defaults, no argument |
| Serving model (§7) | `npm run verify:serving` — status table in the [bootstrap guide](../guides/bootstrap.md) |

What changes per product: the domain and `wrangler` name, the `Env` bindings
and DB name, the route modules and service/db domains, the `config/` values
and token palette, and the site's content. The *shape* stays identical.
The step-by-step skeleton sequence: [bootstrap guide](../guides/bootstrap.md).

---

## 14. Versioning

This document is the single source of truth, versioned here (the `Standard
version:` line at top). A product repo records which version it conforms to (a
line in its README or a `standard-version` field) and pins it. When the
standard changes in a way existing products should adopt, the changelog entry
says *what* and *whether it's retroactive*; conforming products bump their pin
deliberately.

| | Where it lives | Why |
|---|---|---|
| This standard | **here, canonical** | products reference a version, never fork the prose |
| Skeleton (layout, configs, serving model) | **this document + the bootstrap guide** | see the note below on why not a template repo |
| `styles/tokens.css` | **copy the contract, not the values** | role names identical; palette per-brand |
| `config/*` | **copy** | values product-specific; only the shape is shared |

**Reference implementations.** `anysign` is the Vue reference and `tabler` is the
React reference. Read them as working examples of this standard, not as the
standard: **both carry recorded deviations from 2.0, and that is the expected
state** — 2.0 is the target for new work, nothing in it is retroactive, and a
repo conforms by recording its gaps (§15), not by being rewritten. Where a repo
and this document disagree, the repo's own conformance record (its README, or a
`docs/architecture-conformance.md`) says whether the deviation is deliberate.
Repos that predate the v1.4–1.5 conventions (`components/ui`, `services/`, the
`db/` chokepoint, generated `Env`, vitest, `package.json` imports, built-in
i18n) record their gaps the same way.

**Decided against: a template repo plus a `create-<stack>` script.** Earlier versions
of this section named that as the mechanism to adopt. It is overruled on evidence:
five template repos exist — `nuxt-template`, `nuxt-tauri-template`,
`lp-nuxt-cf-template`, `fullstack-nuxt-cf-template`, `astro-template` — at 1–12
commits each, all abandoned within five months. Templates rot because nothing forces
them forward; a prose standard that products pin a version of, and bump deliberately,
does not. Recorded so the next reader does not re-derive the idea.

**Changelog.** See [CHANGELOG.md](../CHANGELOG.md).

---

## 15. Deviations

**A deviation is legitimate when it is recorded.** A repo records each
deviation from this document in its README (what, why, and whether it is
permanent), and never copies a deviation silently into a new product. —
*Why:* the standard is a target, not a gate; an unrecorded deviation is the
only kind that costs anything.
