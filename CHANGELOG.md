# Changelog

One version number spans the document set (`standards/`, `guides/`).

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
