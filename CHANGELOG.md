# Changelog

One version number spans the document set (`standards/`, `guides/`).

## 2.6 — 2026-09-08

Corrections from a product repo's review of 2.5, and from its re-review of this entry's
first draft, all in one direction: where the standard left a default that could reach
production, or a hole only a test would catch, it now fails closed. **Retroactive in the weak sense** for the wrangler layout and the
exact-match catch-all — a repo keeps working, and each is a small edit worth making —
and **additive** everywhere else.

- **The unnamed top level of `wrangler.jsonc` is local development; production lives
  under `env.production`, named the slug** (ops §9; architecture §8, §9; bootstrap guide).
  2.5 put production at the top level and argued that starting under `env.production`
  forces a rename when staging appears. That was wrong — a product deployed as `widgets`
  from `env.production` adds `widgets-staging` and renames nothing — and it left
  wrangler's own default pointing at production, which is exactly the unpredictable blast
  radius 2.5's script rule exists to remove. Cloudflare's guidance is the same: a root you
  do not use is one you never deploy without `--env`. Every environment block sets `name`
  explicitly, so a repo already deployed as `widgets` moves its bindings under
  `env.production` and keeps its Worker, routes and database. Where the build is
  environment-aware, as it is on this stack, both halves of a deploy name the
  environment, `CLOUDFLARE_ENV` for the build and `--env` for the deploy.
- **A route that declares no authorization fails closed at runtime** (ops §2, §8;
  architecture §4, §11, §13). Per-route guards plus the table-walk test remain conforming;
  a single authorization map read by one middleware, `403` for anything it does not name,
  is the stronger mechanism and the default for a product with more than a rank. The
  guard names in the standard illustrate a rank model and were never a mandate for one;
  the map declares capabilities and bitflags the same way. The map's middleware matches
  the map's own keys against the request; Hono's matched-route list ends in the shell
  catch-all and is for the walk test only.
- **`isAppPath()` matches declared paths exactly** (conventions §2; architecture §7;
  bootstrap guide). A prefix match served a `200` shell for every undeclared path under
  `/app` and left the client router to 404 — the stale deep link, the one URL that most
  needs an honest status, logged as a success. An open-ended app path declares itself
  with a trailing `/*`.
- **Dictionaries are TypeScript, and `satisfies` holds the keys** (conventions §4, §7;
  architecture §11, §13). 2.1 wrote the dictionaries as JSON and added a parity test
  because the typechecker "cannot hold JSON against a TypeScript map" — while
  architecture §3 already asked for a typed object. A `satisfies` clause rejects a
  missing code and an orphan key in every locale at compile time; the test keeps the one
  thing a type cannot see, an empty sentence. A JSON dictionary fed to a translation
  platform is a recorded deviation.
- **`X-Request-Id` is validated before it is adopted** (conventions §4; ops §9). Accepted
  only when it matches `^[A-Za-z0-9_-]{8,64}$`, replaced otherwise. An id the Worker
  writes into every log line and reflects in a header is one it has to own the shape of.
- **One lint rule earns its place: `no-floating-promises`, type-aware, over `src/worker/`**
  (ops §9; architecture §8, §13). A promise nobody awaits typechecks cleanly and, on
  Workers, is cancelled when the response returns unless it went to `ctx.waitUntil`. That
  is a correctness rule of this runtime, not a style, and the one thing typecheck cannot
  hold. `void promise` is the deliberate opt-out.
- **A named failure is not a `500`** (conventions §4). `500` still carries `INTERNAL`
  alone. What the product can name and did not cause — an upstream timeout, a database
  that would not answer — is `502`–`504` with a code of its own, open like every other
  status. 2.4's rationale, that anything nameable belongs at a `4xx`, was too narrow. A
  failure the product detects in its own state stays `INTERNAL` on the wire and is named
  in the log as the error's `cause`; a wire code the client cannot act on exists only for
  the log, and that is what `cause` is for.
- **`config/routes.ts` exports at least six names, not exactly six** (conventions §2;
  bootstrap guide). A further pure function over `APP_PATHS` keeps the one-file-to-grep
  property; a further constant would not, and is still forbidden.
- **The bootstrap serving table no longer contradicts ops §2.** `/api/v1/nope` was listed
  as a `404`; anonymous under a family mount it is `401`, signed in it is `403` on the map
  and `404` under guards, and a `verify:serving` written from the old row failed on a
  conforming repo.
- **Two boundary seed rows sharpened** (architecture §13). The `fetch(` row matched
  `store.fetch(`, about thirty false hits in one repo; it now excludes a preceding dot or
  word character while still catching `window.fetch(`. The DOM-global row's message says
  a local named `window` is renamed, not allowlisted.

## 2.5 — 2026-09-08

Environments and script names. **Retroactive in the weak sense**: a repo keeps working as
it is, and renaming scripts is a package.json edit, but the bare names this replaces are
actively unsafe across repos, so it is worth doing rather than recording.

- **Every script that could target more than one environment names the one it targets**,
  the local one included (architecture §8). No bare `deploy`, `db:migrate` or `seed`.
  Across this portfolio the bare name had already drifted to opposite meanings —
  `db:migrate` applying to a laptop in one repo and to production in another — which makes
  the most-typed command the one whose blast radius nobody can predict. `:remote` is
  retired as a name: it describes the mechanism and says nothing once there are two remotes.
- **Deploy never migrates** (ops §9). The two must be separable to express a migration that
  lands while the previous code still serves, which is what makes a schema change safe.
- **Top level is production; staging arrives later as `env.staging`** (ops §9). Wrangler
  deploys a named environment as `{name}-{env}`, so config that starts under
  `env.production` forces a Worker, route and database rename on the day staging appears.
  A product with one environment declares no `env` block at all.
- **The one-file rule keeps its conclusion and loses its reasoning.** It claimed two files
  drift where one cannot, "on the bindings both share". Environments share no bindings:
  every binding key is non-inheritable and wrangler makes overriding one mean overriding
  all. One file is still the default, now for the reason that actually holds — one diff,
  and `--env` is a flag rather than a path.

## 2.4 — 2026-09-08

`401` and `429` open up. `500` stays the one status that carries a single code.
**Additive**: `UNAUTHORIZED` and `RATE_LIMITED` remain valid at their statuses, so a repo
that sends only those conforms unchanged and gains somewhere to grow.

- 2.1 justified closing three statuses on the grounds that the client's *reaction* is
  fixed. That is weaker than the claim that matters: the *sentence* is fixed. A caller who
  was never signed in and one whose session a password change revoked (ops §3) both get a
  `401` and deserve different sentences — so closing the status recreated, one status over,
  the flattening the open registry exists to end. Same argument for `429`, where ops §7
  already mandates separate limiter bindings.
- Seeded at `401`: `SESSION_EXPIRED`, `SESSION_REVOKED`. `429` opens without new seed
  codes; ops §7's bindings are the natural axis for a product to split on.
- The client still never reads a response's status. `statusOf(code)` reads the shared
  registry, which is build-time knowledge, and is confined to `api.ts` by a boundary row so
  it cannot become the back door to rendering by status.
- `500` stays closed on principle: an unhandled error has nothing to say, and anything the
  product can name is a handled refusal belonging at a `4xx`.

## 2.3 — 2026-09-08

Two fixes to what 2.1 shipped, both found by a product repo adopting it. **Neither is a
rule change**: the rules stand, the examples that implement them were wrong.

- **The boundary script tests code, not prose** (architecture §13). It scans raw file text,
  so every comment mentioning a pattern tripped its row. Measured against a real repo, the
  app-path row flagged 22 files of which 20 were docblocks, and the rational response to
  twenty false failures is to delete the row. The script now blanks block, template and
  line comments before matching, and reports `file:line` instead of `file`.
- **The dictionary parity test moves to `test/client/errors.test.ts`** (conventions §4,
  architecture §11, §13). It reads the dictionaries through the `@/*` alias, which
  architecture §9 gives to the app alone, so it never resolved in the shared tier. A test
  spanning two tiers belongs to the narrower one.

## 2.2 — 2026-09-08

One rule: an authenticated route family mounts `requireAuth` at its prefix, before it
mounts any route, in addition to the per-route guard 2.1 added (ops §2). An anonymous
request to a path under that prefix is then `401` whether or not the path exists.
**Retroactive in the weak sense**: a repo whose families authenticate per route only is
conforming today and records the gap; a repo that already mounts at the prefix — the
reason this rule exists — stops recording it as a deviation.

- The mount authenticates, the route authorizes. Neither replaces the other: the mount is
  the guard no route author can forget, the per-route guard is the one a test can prove.
- A `401` for a path that does not exist is the intended behaviour, not a bug to route
  around. A route table is not a secret; a hole that opens when someone forgets a guard is.

## 2.1 — 2026-09-07

The error registry grows, and one script holds every boundary. **2.1 is additive**: a repo
at 2.0 conforms as it stands — the eight codes remain valid, `params` is optional, and a
boundary script keeps its name until the next rule is added. New work follows 2.1.

- `src/shared/errors.ts` is a map of code → HTTP status, seeded with the eight, grown one
  code per distinct refusal. A code names the refusal, never the route; a fixed-vocabulary
  value becomes its own code, never a param. `401`, `429`, `500` keep one code each.
- The envelope gains `params` (flat; `count` selects the plural). The client renders by
  `code` alone, never by status: an unknown code renders `STALE_CLIENT`, no envelope
  renders `UNREACHABLE`; `httpStatus` is read only in `api.ts`.
  `test/shared/errors.test.ts` proves every locale mirrors the registry.
- `scripts/check-boundaries.mjs` — one table-driven script — replaces
  `scripts/check-db-boundary.mjs`; the standard ships the seed rows (architecture §13),
  the product grows the table, a dropped seed row is a recorded deviation.
- Guards register in `GUARDS`; `allowPublic` is the explicit opt-out;
  `test/worker/routes.test.ts` fails on any `/api/v1` route that declares neither.

## 2.0 — 2026-09-06

The four-document set is complete: `architecture` (revised), `conventions` (new), `ops`
(new), `styling` (filled). Written against a survey of eight product repos; every rule
carries a why. **Nothing in 2.0 is retroactive** — a repo built to 1.7 conforms to 2.0 by
recording its deviations in its README.

- `marketing/` is `site/` (landing, docs, blog, legal, pricing). `src/` stays `src/`.
- The authenticated app lives under `/app/*`; public product surfaces are declared in
  `PUBLIC_PREFIXES`; `run_worker_first` is derived from `config/routes.ts`.
- Auth vocabulary is `sign-in` / `sign-up` / `sign-out`; pages under `/app/auth/*`; API
  under `/api/v1/auth/*`; session read at `GET /api/v1/auth/session`; `GET /api/health`.
- Response contract: `{ item }` and `{ items, nextCursor, total? }`; errors
  `{ error: { code, message, details?, traceId } }`; `204` for actions; `X-Request-Id`.
- Every list endpoint is paginated: strict query validation, keyset by default, opaque
  cursor, `total` opt-in.
- Sessions are D1 rows resolved with API keys and integration tokens into one
  `Principal`; JWTs only for short-lived single-purpose tokens; scrypt for passwords.
- Tenancy accessors are always `forTenant` / `forTenantAsStaff` / `global`; the `db/`
  boundary is enforced by `scripts/check-db-boundary.mjs` in `check`.
- Every cookie is `${slug}_${purpose}`. `test/{worker,client,shared,e2e}` at the root.
  Migrations always named. Canonical script names. Prettier. The shadcn token contract
  with `.dark` always present.

## 1.7 — 2026-09-06

Relocated from `docs.michaelchen.me` (a built Astro site) to this plain-markdown repo.
Source is now the published artifact: the v1.3-committed / v1.6-published split that
went unnoticed for six weeks cannot recur, because no build step sits between them.

- Standards split into a set under one version: `architecture`, `styling`, and —
  from v2.0 — `conventions` and `ops`.
- Framework-neutral: §3 no longer says "React SPA". Vue is the default, React is
  equally conforming; the contract is everything around the framework.
- Reference implementations named: `anysign` (Vue), `tabler` (React).
- Template repo + `create-<stack>` script recorded as decided-against, with evidence.
- Site-absolute links rewritten as relative file paths.

No rule changes. A product conforming to 1.6 conforms to 1.7 unchanged.

## 1.0 – 1.6

- **1.6** — Restructured to normative-only: implementation how-tos moved to
  the guides; rationale essays and roadmap material removed. No rule changes.
- **1.5** — `db/` required by default as the tenant-isolation chokepoint:
  per-request scoped accessors constructed in scope middleware
  (global/tenant/staff taxonomy, `forTenantAsStaff()` for sanctioned
  cross-tenant access). Single-tenant products may relax to a growth path.
- **1.4** — Realigned onto ecosystem defaults: `components/ui/`, worker
  `services/`, generated `Env` via `wrangler types`, `#config/*` as a real
  subpath import, `~/*` for marketing, vitest workers pool, app `public/`
  prefix rule, Astro built-in i18n.
- **1.3** — Extracted to a canonical single-source standard; examples
  genericized; base-token contract added to §5.
- **1.2** — Scope narrowed to repository structure; worker internals became
  later-phase stubs (§10–§12).
- **1.1** — Split cross-surface sharing into `config/` + `styles/`; route
  paths moved to `config/routes.ts`.
- **1.0** — Initial: one-Worker three-surface layout, serving model, build
  pipeline.
