# Styling Standard

How every product declares its design tokens, wires dark mode, and grows its
component primitives. One file is the seam: `styles/tokens.css` is read by
the SPA and by `site/` ([architecture §5](architecture.md)), so this document fixes its
shape once instead of letting each product invent its own token vocabulary.

## 1. Scope

- **In scope**: the token contract (the fixed set of CSS custom property
  names), dark mode wiring, `components.json` and how primitives are added,
  self-hosted type, and the icon library.
- **Not standardised**: the actual palette values (every hex/oklch literal is
  per-brand), spacing beyond the single `--spacing` scale Tailwind reads, and
  animation (durations, easing, which components animate).

## 2. The token contract

**Every product declares exactly this set of custom properties — no more
required, and none renamed:**

```
--background              --foreground
--card                     --card-foreground
--popover                  --popover-foreground
--primary                  --primary-foreground
--secondary                --secondary-foreground
--muted                    --muted-foreground
--accent                   --accent-foreground
--destructive               --destructive-foreground
--border   --input   --ring
--chart-1   --chart-2   --chart-3   --chart-4   --chart-5
--sidebar                        --sidebar-foreground
--sidebar-primary                --sidebar-primary-foreground
--sidebar-accent                 --sidebar-accent-foreground
--sidebar-border                 --sidebar-ring
--radius
--font-sans   --font-serif   --font-mono
--shadow-2xs  --shadow-xs  --shadow-sm  --shadow
--shadow-md   --shadow-lg  --shadow-xl  --shadow-2xl
```

— *Why:* this is the shadcn/tweakcn vocabulary, and it is a contract, not a
palette: a component ported between products references
`--primary`, never a brand color, so the same primitive renders correctly
under any brand without touching component code.

**Names are fixed; values are per brand.** A product may feed an
optional `--brand-*` palette into the roles above via `var()`, but
`--brand-*` itself is never part of the contract. — *Why:* the palette is
the one thing this document deliberately leaves open (§1); the roles are
what components and cross-product review actually depend on.

**`styles/tokens.css` is the only place any of these properties is
declared** — not duplicated in a second stylesheet, not re-declared inside
`site/`. `site/` imports the same file directly (`../../styles/tokens.css`);
it never forks a parallel token file. — *Why:* two files defining
`--primary` differently is the one failure mode this whole contract exists
to prevent, and it is invisible until the SPA and the site are compared
side by side.

A complete minimal skeleton (Tailwind v4; palette values below are
placeholders — see §1):

```css
/* styles/tokens.css — the only declaration site */
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --shadow-sm: 0 1px 3px 0 hsl(0 0% 0% / 0.1);
  /* … every remaining role from the fixed list (§2), each given a value */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --border: oklch(1 0 0 / 10%);
  --ring: oklch(0.556 0 0);
  /* … every role :root sets, overridden — never a partial block */
}

@theme inline {
  --color-background: var(--background);
  --color-primary: var(--primary);
  --color-border: var(--border);
  --color-sidebar: var(--sidebar);
  --radius-lg: var(--radius);
  --font-sans: var(--font-sans);
}
```

## 3. Dark mode

**`:root` and `.dark` are both always present in `tokens.css`,** even
on a product that ships light-only or dark-only today. — *Why:* adding dark
mode later becomes a token-value change instead of a restructuring; a
missing block is what makes "add dark mode" a project instead of a PR.

**The `dark` variant is declared once, `@custom-variant dark
(&:is(.dark *))`; no `prefers-color-scheme` media query drives component
styles directly.** — *Why:* the shell, not the OS, decides the active theme,
so the toggle and the persisted preference below can override the system.

**The `.dark` class is toggled on `<html>` by the shell and the choice is
persisted in the cookie `${slug}_theme`** — the `${slug}_${purpose}` cookie
rule, and `BRAND.slug` as its only source, are in
[conventions §8](conventions.md). — *Why:* a cookie, not `localStorage`, is what
lets the Worker read the preference and render the correct class
server-side on first paint, avoiding a flash of the wrong theme.

**A dark-only product still ships both blocks:** `:root` carries the
dark values plus `color-scheme: dark`, and `.dark` stays present but empty.
— *Why:* an absent `.dark` block is indistinguishable from a product that
forgot dark mode entirely; an empty-but-present block records the decision
as deliberate.

## 4. Components

**`components.json` is committed at the repo root with `style: "new-york"`,
`tailwind.baseColor: "neutral"`, `tailwind.cssVariables: true`, and
`iconLibrary: "lucide"`:**

```json
{
  "style": "new-york",
  "tailwind": {
    "css": "styles/tokens.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "utils": "@/lib/utils"
  },
  "iconLibrary": "lucide"
}
```

— *Why:* one style and base color across every product lets a component
generated in one repo drop into another unchanged; `cssVariables: true` is
what makes the generator emit `var(--primary)`, not a hard-coded color.

**New primitives are added only through the shadcn CLI for the product's
framework, never hand-written into `components/ui/`.** — *Why:*
the CLI keeps a primitive's markup and classes in sync with §2's token
contract; a hand-written primitive drifts the moment upstream changes.

**`--radius` is declared in `:root` on every product, no exceptions.**
— *Why:* every generated primitive computes its corners from `--radius`; a
missing token does not error, it silently flattens every card, button, and
input to square corners at once.

`components/ui/` itself — that it is never restructured or merged with
feature components — is already fixed by [architecture §3](architecture.md); this document
does not repeat that rule, only the token and generator config that feed it.

## 5. Type and fonts

**Fonts are self-hosted via `@fontsource`** (or the framework's
equivalent, e.g. `@fontsource-variable/<family>`), **never a runtime Google
Fonts `<link>`.** — *Why:* self-hosting removes a third-party network
round-trip from first paint and keeps the product working when that
third party is unreachable.

**Any product serving zh-TW includes `Noto Sans TC` as (or within)
`--font-sans`.** — *Why:* the Latin-only default stack has no CJK glyphs;
without this the zh-TW locale silently falls back to the OS font and
breaks the visual contract the rest of the tokens establish.

**Base body size is 16px; a product may raise it** (e.g. for an
older or a formal-register audience) **but never lower it.** — *Why:* 16px is
the floor mobile browsers treat as "no auto-zoom on input focus"; going
below it reintroduces that bug on every form.

## 6. Icons

**Lucide is the icon set, via the binding for the product's
framework** (`lucide-react`, `lucide-vue-next`). — *Why:* it is what the
shadcn generator wires into every primitive by default (§4); a second icon
set means two visual weights and two bundle-size line items for the same
job.

## 7. Deviations

**A deviation is legitimate when it is recorded.** A repo records each
deviation from this document in its README (what, why, and whether it is
permanent), and never copies a deviation silently into a new product. —
*Why:* the standard is a target, not a gate; an unrecorded deviation is the
only kind that costs anything.
