# Product standards

The canonical standards for [alsey89](https://github.com/alsey89) products. Plain
markdown, no build step — what you read here *is* the published artifact.

**Current version: Product Standard v1.7.**

| Document | What it fixes |
|---|---|
| [standards/architecture.md](standards/architecture.md) | Repo layout, the three surfaces, the serving model, the build pipeline |
| [standards/styling.md](standards/styling.md) | Design tokens and component conventions *(stub — v2.0)* |
| [guides/bootstrap.md](guides/bootstrap.md) | Assembling a new product on the standard |
| [guides/tenant-scoping.md](guides/tenant-scoping.md) | Wiring tenant isolation through the `db/` chokepoint |

Planned for v2.0: `standards/conventions.md` (route symbols, i18n shape, import
subpaths, migration numbering) and `standards/ops.md` (auth, testing contract,
env/secrets, CI + deploy). Version history: [CHANGELOG.md](CHANGELOG.md).

## How a repo adopts this

Add `.claude/settings.json` — committed, so cloud agents and collaborators get it too:

```json
{
  "extraKnownMarketplaces": {
    "alsey89": {
      "source": { "source": "github", "repo": "alsey89/standards" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "product-standard@alsey89": true }
}
```

The plugin tracks `main`, so an agent in your repo always reads the current text.
Record the version your repo was built to in its README — *"conforms to Product
Standard v1.7"* — and bump that line deliberately when a CHANGELOG entry says a
change is retroactive. Products reference a version; they never fork the prose.

Not using Claude Code? Read the files on GitHub, or fetch them raw:
`https://raw.githubusercontent.com/alsey89/standards/main/standards/architecture.md`

## Checks

`npm test` runs the unit tests; `npm run check` verifies every `§N` cross-reference
resolves, every internal link points at a file that exists, and the version agrees
across `package.json`, `README.md`, `CHANGELOG.md` and the standard itself.
