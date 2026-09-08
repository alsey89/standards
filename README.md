# Product standards

The canonical standards for [alsey89](https://github.com/alsey89) products. Plain
markdown, no build step — what you read here *is* the published artifact.

**Current version: Product Standard v2.3.**

| Document | What it fixes |
|---|---|
| [standards/architecture.md](standards/architecture.md) | Repo layout, the three surfaces, the serving model, the build pipeline |
| [standards/conventions.md](standards/conventions.md) | Routes and URLs, the route declaration, the API contract, pagination, i18n, naming |
| [standards/ops.md](standards/ops.md) | Principals and sessions, passwords and OAuth, tenancy, env and secrets, rate limiting, testing, CI and deploy |
| [standards/styling.md](standards/styling.md) | The token contract, dark mode, components, type, icons |
| [guides/bootstrap.md](guides/bootstrap.md) | Assembling a new product on the standard |
| [guides/tenant-scoping.md](guides/tenant-scoping.md) | Wiring tenant isolation through the `db/` chokepoint |

Version history: [CHANGELOG.md](CHANGELOG.md).

## How a repo adopts this

A product repo carries a **pinned copy** of the documents and a **committed skill** that
points at them. On disk in every clone — cloud sessions and co-founders included — no
plugin, no install step, nothing at user level.

Run this from the repo root (it is also how you update — re-run it with a newer `SHA`):

```bash
SHA=$(git ls-remote https://github.com/alsey89/standards main | cut -f1)   # or pin an older commit
RAW=https://raw.githubusercontent.com/alsey89/standards/$SHA
mkdir -p docs/product-standard .claude/skills/product-standard
for f in $(curl -fsSL "$RAW/MANIFEST"); do curl -fsSL --create-dirs -o "docs/product-standard/$f" "$RAW/$f"; done
curl -fsSL -o .claude/skills/product-standard/SKILL.md "$RAW/skill/SKILL.md"
printf '%s\n' "$SHA" > docs/product-standard/PINNED
```

Commit the result. `docs/product-standard/PINNED` is the machine-readable pin; the
first entry of `docs/product-standard/CHANGELOG.md` names the version; record it in your
README too — *"conforms to Product Standard v2.0"* — and bump deliberately when a
CHANGELOG entry says a change is retroactive.

**Never edit the copy.** Changes go upstream, here. Products reference a version; they
never fork the prose. [`MANIFEST`](MANIFEST) is the list of what gets copied;
[`skill/SKILL.md`](skill/SKILL.md) is the skill a consumer commits.

Not using Claude Code? The copy is plain markdown; read it, or fetch any file raw:
`https://raw.githubusercontent.com/alsey89/standards/main/standards/architecture.md`

## Checks

`npm test` runs the unit tests; `npm run check` verifies every `§N` cross-reference
resolves, every internal link points at a file that exists, the version agrees across
`package.json`, `README.md`, `CHANGELOG.md` and the standard itself, and every
`MANIFEST` entry exists.
