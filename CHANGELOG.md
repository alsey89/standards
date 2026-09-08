# Changelog

One version number spans the document set (`standards/`, `guides/`).

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
