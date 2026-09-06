# Changelog

One version number spans the document set (`standards/`, `guides/`).

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
