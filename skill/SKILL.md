---
name: product-standard
description: Use when making structural, architectural, or styling decisions in this repo - deciding repo layout, where a file belongs, how the Worker serves surfaces, route path declarations, design tokens, tenant scoping, or bootstrapping a new product. Read the standard before proposing a structure.
---

# Product Standard

A pinned copy of the Product Standard lives in `docs/product-standard/`. Upstream is
https://github.com/alsey89/standards; `docs/product-standard/PINNED` holds the upstream
commit this copy was taken from, and the first entry of
`docs/product-standard/CHANGELOG.md` names its version. This repo's README records the
version it was built to.

**Never edit the copy.** Changes go upstream; the copy is refreshed with the adopt
snippet in the upstream README, as a reviewable commit.

## Read before deciding

| Question | Document |
|---|---|
| Where does this file go? How does one Worker serve three surfaces? What does the build do? | `docs/product-standard/standards/architecture.md` |
| Design tokens, component conventions | `docs/product-standard/standards/styling.md` |
| Starting a new product from nothing | `docs/product-standard/guides/bootstrap.md` |
| Wiring tenant isolation through the `db/` chokepoint | `docs/product-standard/guides/tenant-scoping.md` |

Read the relevant document in full before proposing a structure. In `architecture.md`,
§2 (repo layout) and §5 (the shared boundaries) answer most questions. The standard is
normative: where it fixes a structure, follow it rather than inferring a pattern from
neighbouring repos.

## The framework is a leaf

Vue 3 + Vite + vue-router + Pinia + shadcn-vue is the default. React is equally
conforming — MailMatter, Tabler and Slidr are React. What the standard fixes is
everything *around* the framework. Never "migrate this repo to Vue" on the strength of
the standard; it does not say that.

## When the repo and the standard disagree

Deviations are legitimate and are recorded in this repo's README or conformance doc, not
silently. If you find an undocumented deviation, say so and ask — do not quietly conform
the code to the standard, and do not quietly copy the deviation into a new product.

The standard is a guideline, not a gate. Nothing in it fails a build.
