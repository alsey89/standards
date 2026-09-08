# Product Ops Standard

How a product on this stack authenticates a caller, isolates tenant data, holds its
secrets, is tested, and ships.

This document is **normative** and picks up exactly where
[architecture.md](architecture.md) leaves off: that document fixes repo layout and the
three-surface serving model and marks auth and tenant isolation, the testing contract,
and environment and secrets as a later phase. This is that phase. Product repos do not
copy this prose — they pin a version, the same as architecture.md. Route paths and the
API response contract that principals and sessions ride on top of are fixed in
[conventions.md](conventions.md), not here.

## 1. Scope

This document fixes:

- **Principals** — how a session cookie, an API key, or an integration token resolves to
  one caller identity, and how routes guard on it.
- **Sessions** — the D1 session row, its cookie, and its lifecycle.
- **Passwords and OAuth** — hashing, lockout, and the sign-in-via-provider flow.
- **Tenancy** — the `db/` chokepoint that makes cross-tenant data access unrepresentable
  in route and service code.
- **Env and secrets** — where a secret is declared, checked, and never checked in.
- **Rate limiting** — the bindings every product's unauthenticated surface needs.
- **Testing** — the tiers, the runtimes, and what a route must prove.
- **CI and deploy** — the fixed step order and the one config file.

**Left to the product, stated once so nothing invents a rule for it:** the
role/permission model (rank enum, capability strings, bitflags — pick one), the tenant
noun (`org_id`, `temple_id`, `company_id` — §5), and which OAuth providers beyond Google
it needs (§4).

## 2. Principals

**One middleware resolves every credential into a single `Principal`; no other file
constructs one.**

```ts
// src/shared/types/principal.ts
type Principal = {
  kind: "session" | "api_key" | "integration";
  userId?: string;
  tenantId?: string;
  scopes: string[];
  rank?: string; // product-defined ordering; see §5
};
```

— *Why:* three ad hoc credential shapes downstream means every route must know which
kind it got before it can use it; one resolved type means a route only ever asks "is
there a principal, and does it have what I need."

### 2.1 The three credential kinds

| Kind | Carried as | Stored as | Issued |
|---|---|---|---|
| `session` | cookie `${slug}_session` | D1 `sessions` row; token sha256'd (§3) | sign-in creates the row and sets the cookie |
| `api_key` | `Authorization: Bearer <key>` | D1 `api_keys` row: `prefix`, `hash`, `scopes`, `last_used_at`, `revoked_at` | created in-product; the plaintext key is shown once and never stored |
| `integration` | product-defined: webhook signature, OAuth access token, embed URL token | D1 rows, product-defined shape | issued per integration at connect time |

The `api_keys` row and its key format, shown once:

```sql
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  prefix       TEXT NOT NULL,     -- first chars, shown in the UI to identify the key
  hash         TEXT NOT NULL,     -- sha256 of the full key; the plaintext is never stored
  scopes       TEXT NOT NULL,     -- JSON array
  last_used_at INTEGER,
  revoked_at   INTEGER,
  created_at   INTEGER NOT NULL
);
```

Key format: `${slug}_<random>` (e.g. `anysign_7f3a9c2b1e…`) — the slug prefix identifies
the product on sight, in a support ticket or a log line, with no lookup needed.

### 2.2 Resolving and guarding

```ts
// src/worker/middleware/principal.ts — Variables: { principal?: Principal }
import type { MiddlewareHandler } from "hono";

export const resolvePrincipal = createMiddleware(async (c, next) => {
  const principal =
    (await fromSessionCookie(c)) ?? (await fromBearerKey(c)) ?? (await fromIntegrationToken(c));
  if (principal) c.set("principal", principal);
  await next();
});

// Every guard registers the middleware it returns, so test/worker/routes.test.ts
// (§8) can walk the route table and prove each route composed one.
export const GUARDS = new WeakSet<MiddlewareHandler>();
const guard = <H extends MiddlewareHandler>(h: H): H => (GUARDS.add(h), h);

export const requireAuth = guard(createMiddleware(async (c, next) => {
  if (!c.var.principal) throw new ApiError("UNAUTHORIZED");
  await next();
}));

export const requireRank = (min: string) => guard(createMiddleware(async (c, next) => {
  if (!outranks(c.var.principal?.rank, min)) throw new ApiError("FORBIDDEN");
  await next();
}));

export const requireScope = (scope: string) => guard(createMiddleware(async (c, next) => {
  if (!c.var.principal?.scopes.includes(scope)) throw new ApiError("FORBIDDEN");
  await next();
}));

/** The explicit opt-out: a public route says so, in the same place a guarded one names its guard. */
export const allowPublic = guard(createMiddleware(async (_c, next) => next()));
```

**A credential that fails says why it failed** — `SESSION_EXPIRED` for a session past
its window (§3), `SESSION_REVOKED` for one deleted by a password change or a sign-out
everywhere (§3), `UNAUTHORIZED` when nothing was presented at all. All three are `401`
and all three send the caller to sign-in ([conventions §4](conventions.md)); they differ
only in the sentence the reader gets, which is the point. — *Why:* this document already
requires the revocation, so the client can either explain it or leave the reader
wondering why they were signed out; distinguishing costs one branch at the place the
session was looked up anyway.

**A route handler never inspects `principal.kind`.** It composes a guard, or is named in
the authorization map (below), and reads `c.var.principal` for the id it needs. — *Why:*
a route that branches on "is this a session or a key" turns one credential system into
three parallel auth paths that drift apart.

**Every `/api/v1` route declares who may call it, and a route that declares nothing fails
closed.** Two mechanisms conform. The first is the guards above: each route composes at
least one of `requireAuth`, `requireRank(min)`, `requireScope(name)`, `allowPublic` — per
route, not only at the family mount — and `test/worker/routes.test.ts` (§8) fails on any
route that composes none. The second, and the stronger, is one authorization map — a
`"METHOD /path"` to requirement table in a single file — read by one middleware that
answers `403` for any route the map does not name; the same table walk (§8) fails on a
route with no entry, and the map doubles as the document of who may do what. A product
with more than a handful of roles, or a permission model richer than a linear rank, takes
the map. — *Why:* a guard registered in a set is a fact a test can hold, which is what
makes default-deny a property the suite proves rather than a habit reviewers keep. But a
test holds only between runs: a route written without its guard is open to every
authenticated caller from the moment it is mounted until the suite next fails, and a
guard that is absent cannot fire. The map closes that window at runtime — an undeclared
route is a refusal, never a hole. It also frees the declaration from the guard's shape:
`requireRank` assumes roles order linearly, and the guard names in this document
illustrate a rank model rather than mandate one (§1, §5) — capability strings and
bitflags declare in the same map with the same fail-closed property.

```ts
// src/worker/middleware/authorize.ts — the map is the declaration; the middleware only reads it
import { createMiddleware } from "hono/factory";
import { ApiError } from "../services/util";
import { meets, type Requirement } from "../services/auth"; // product-defined: a rank, a capability, a bitmask

export const AUTHZ: Record<`${string} ${string}`, Requirement | "public"> = {
  "GET /api/v1/projects": { auth: true },
  "POST /api/v1/projects": { capability: "projects.create" },
  "GET /api/v1/tours/:tourId": "public",
};

export const authorize = createMiddleware(async (c, next) => {
  const route = c.req.matchedRoutes.at(-1); // the handler this request resolved to
  const required = route && AUTHZ[`${c.req.method} ${route.path}`];
  if (required === undefined) throw new ApiError("FORBIDDEN"); // undeclared fails closed
  if (required !== "public" && !meets(c.var.principal, required)) {
    throw new ApiError(c.var.principal ? "FORBIDDEN" : "UNAUTHORIZED");
  }
  await next();
});
```

**An authenticated route family also mounts `requireAuth` at its prefix, before it mounts
any route** — `family.use("*", requireAuth)` ahead of every `family.route(...)` — so an
anonymous request to a path under that prefix is `401` whether or not the path exists.
The per-route guard above stays: the mount authenticates, the route authorizes. — *Why:*
a family-wide mount is the one guard no route author can forget, because it is not
written per route; it fails closed for a path that was never registered, which is exactly
the case a per-route rule cannot cover. The cost is that an anonymous caller cannot tell a
real route from a fake one under that prefix — which is not a secret worth protecting (a
SPA ships its own route list in its bundle) and not a loss worth taking a hole for: the
only callers who see it are a typo'd `curl` and a stale bundle, both of which were headed
for sign-in anyway, and both of which get an honest `404` once authenticated.

**Every guarded route has a test that proves the guard fires** (§8). — *Why:* a
middleware dropped from a copy-pasted route reads as correct code and fails only at
request time, which is the one place a test can still catch it before a user does.

### 2.3 Transport

- **Cookie-authenticated routes never enable CORS**; a cross-origin caller uses a bearer
  API key instead. — *Why:* CORS on a cookie-trusting route is the textbook
  CSRF-to-any-origin bug; refusing it outright beats trusting every route author to
  configure it correctly.
- **An embed rendered on a third-party origin authenticates with a signed URL token, not
  a cookie.** — *Why:* the session cookie's `SameSite=Lax` (§3) doesn't travel with a
  cross-site iframe load by design.
- **Signed JWTs are for short-lived, single-purpose tokens only, never the session:**
  invite, email confirmation, password reset, signed links, OAuth access tokens. —
  *Why:* a session must be revocable mid-flight (sign-out, password change), which a
  self-contained token structurally cannot be — that's why sessions are D1 rows (§3),
  not JWTs.

## 3. Sessions

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  tenant_id     TEXT,               -- null for a pre-tenant / platform session
  token_hash    TEXT NOT NULL UNIQUE,   -- sha256 of the 32-byte opaque token; UNIQUE = the lookup index
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,   -- sliding-expiry anchor
  expires_at    INTEGER NOT NULL
);
```

**The token is 32 random bytes (`crypto.getRandomValues`); only its sha256 is stored.**
The cookie carries the plaintext; the row never does. — *Why:* a `sessions` leak — a D1
export, a backup — shouldn't hand out a working credential, the same reasoning as a
password hash.

**Every authenticated request does one joined read**, session and user in a single
query:

```sql
SELECT sessions.id         AS session_id,
       sessions.tenant_id  AS session_tenant_id,
       sessions.expires_at AS session_expires_at,
       sessions.last_seen_at,
       users.id            AS user_id,
       users.email, users.rank
FROM sessions JOIN users ON users.id = sessions.user_id
WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2;
```

— *Why:* a route that needs the user's tenant, rank, or name has it from this one read;
a second "also fetch the user" query is a cost that only shows up in aggregate, at
scale, in a bill. The columns are aliased, because D1 keys a row by bare column name and
`sessions.*, users.*` would let `users.id` silently overwrite `sessions.id`. The
`token_hash` column is `UNIQUE`, which is what makes this lookup O(1) rather than a
table scan.

**Sessions are sliding-expiry, 30 days, refreshed at most every 10 minutes.** On a valid
read, if `now - last_seen_at > 10 minutes`, the row is rewritten (`last_seen_at = now`,
`expires_at = now + 30d`); otherwise the request skips the write. — *Why:* a naive
"extend on every request" scheme turns every GET into a write; throttling the refresh
keeps an active session alive without paying for it every time.

The cookie, exact attributes:

```
Set-Cookie: ${slug}_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
```

**Sign-out deletes the row and re-sets the cookie with `Max-Age=0`; sign-out-everywhere
deletes every row for the user; a password change deletes every session except,
optionally, the one that just authenticated the change.** — *Why:* a session that
outlives the credential that vouched for it (a stolen device, a leaked password) is the
exposure a session store exists to prevent — deleting rows is the entire enforcement
mechanism.

### 3.1 Escape hatches — measured latency only

Both require the same precondition: **do not reach for either until profiling shows the
D1 session read is the dominant per-request cost.** — *Why:* adopting one earlier trades
a provable revocation guarantee for a latency win nothing has yet measured.

1. **An isolate-memory cache, 60 s TTL, keyed by token hash.** Trigger: a hot route
   where the joined read profiles as the bottleneck and a 60-second revocation lag is
   acceptable.
2. **A signed, short-lived assertion (5–15 min) carrying `permissionVersion`**,
   re-validated against D1 on expiry and always before a sensitive action. Trigger: a
   fan-out path (e.g. a Durable Object serving many messages per connection) that can't
   afford a D1 read per event.

## 4. Passwords and OAuth

**Passwords are hashed with scrypt via `node:crypto`, async, at `N=2¹⁴, r=8, p=1,
keylen=64`, stored as a PHC string:**

```
$scrypt$ln=14,r=8,p=1$<base64 salt>$<base64 hash>
```

— *Why:* scrypt's memory-hardness is what makes an offline crack of a stolen hash
expensive, and `node:crypto` is the platform's own implementation, so there is no
third-party hashing dependency to keep current.

**A hash is rehashed on the next successful sign-in if its stored parameters are weaker
than current config.** — *Why:* the PHC string records the parameters it was created
under, so raising the cost factor rolls out to the active user base as people sign in —
no mass-migration script, no forced reset.

**Unknown user and wrong password return the same error, at the same approximate
latency.** — *Why:* a distinguishable error, or a fast path that skips hashing for a
nonexistent email, is a user-enumeration oracle; identical failure costs nothing real
users notice.

**A PIN-style credential locks after 5 consecutive failures for 15 minutes; a
full-entropy password does not lock** — it relies on `RL_SIGNIN` (§7) instead. — *Why:*
a PIN's small keyspace makes brute force cheap enough to need lockout; the same lockout
on a real password becomes an attacker's tool for locking a victim out of their own
account.

**A password-reset request always returns 200**, whether or not the email exists. —
*Why:* the same enumeration reasoning as sign-in, on the one other endpoint that takes a
bare email.

**PBKDF2-SHA256 via WebCrypto is the recorded-deviation alternative to scrypt**, for a
product that can't take the platform assumption below. — *Why:* WebCrypto's PBKDF2 runs
with no compatibility flag; the trade is weaker memory-hardness, which is why it's a
deviation and not the default.

**Platform assumptions: Workers Paid; compatibility date ≥ 2026-08-04, or
`nodejs_compat` explicitly enabled.** — *Why:* `node:crypto`'s scrypt needs Node
compatibility, and its cost at `N=2¹⁴` needs the higher CPU-time ceiling Workers Paid
grants — the Free plan can hit its wall under load.

### 4.1 OAuth

- **Google is the baseline provider; LINE is added where the market needs it** (e.g. a
  Taiwan-market consumer product) — neither requires the other. — *Why:* one baseline
  provider means every product's OAuth wiring is the same code path to review, and a
  second is a market decision, not an architectural one.
- **`state` is carried in a cookie with a 10-minute lifetime**, checked on callback
  first. — *Why:* it's the redirect flow's CSRF defense; a state cookie that outlives
  the flow it protects is a replay window.
- **The provider's email must come back verified, or the flow rejects.** — *Why:* an
  unverified email is the provider admitting it hasn't confirmed ownership — trusting it
  anyway hands account takeover to whoever registers that email first.
- **`return_to` accepts only a same-origin relative path**, never an absolute URL. —
  *Why:* an unchecked `return_to` is an open redirect; on an OAuth callback, one with a
  valid session already attached.

## 5. Tenancy

**`src/worker/db/scope.ts` exports exactly three accessor factories — `forTenant`,
`forTenantAsStaff`, `global` — and their names never change even though the tenant
column's name does:**

```ts
// src/worker/db/scope.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "./client";        // the drizzle client, built once from env.DB
import { users, widgets } from "./schema";
import type { Principal } from "#shared/types/principal";
import { RANK } from "#shared/types/principal";
import { ApiError } from "../services/util";

export function forTenant(db: Db, tenantId: string) {
  return {
    // every method closes over tenantId — it is never a parameter
    listWidgets: () =>
      db.select().from(widgets)
        .where(and(eq(widgets.tenantId, tenantId), notDeleted(widgets))),
  };
}

// The one sanctioned "tenant id from user input" path — `grep forTenantAsStaff`
// is the complete cross-tenant audit list. It authorizes before it scopes.
export function forTenantAsStaff(db: Db, staff: Principal, tenantId: string) {
  if (staff.kind !== "session" || (staff.rank ?? 0) < RANK.staff) {
    throw new ApiError("FORBIDDEN");
  }
  return forTenant(db, tenantId);
}

export function global(db: Db) {
  return {
    findUserByEmail: (email: string) =>
      db.select().from(users).where(eq(users.email, email)).get(),
  };
}
```

**The staff check lives inside the accessor, not at the call site.** — *Why:* a call
site can forget; the accessor cannot — and `grep forTenantAsStaff` then lists every place
cross-tenant access is *both* requested and checked.

— *Why:* three fixed names are what let `grep forTenantAsStaff` be the complete
cross-tenant audit list in any product on this stack, however that product spells its
tenant column.

**`src/worker/db/global.ts` implements the unscoped query modules `global()` returns** —
user lookup by email, session create/validate, password-reset tokens, global config —
and nothing else declares an unscoped query. — *Why:* a separate, loudly-named home
keeps "unscoped" a visible decision instead of a quiet default that a reviewer has to
notice the absence of.

**Scoped accessors are constructed only in `src/worker/middleware/scope.ts`, from the
resolved `Principal` (§2)** — never from a client-supplied id, and never in a route or a
service. — *Why:* one construction site is the whole isolation guarantee: below it the
tenant key is closed over and cannot be passed, so the classic
filter-by-client-supplied-workspace-id bug has nowhere to be written.

Full wiring, the scope taxonomy per route family, and the review checklist: [tenant
scoping guide](../guides/tenant-scoping.md), which this document agrees with.

**The tenant column is named for the product's noun, not generically** — `org_id`,
`temple_id`, `company_id`; the accessor names above do not follow it. — *Why:* the
column reads as domain language in SQL; fixed accessor names are what let a reader who
knows one product recognize the pattern in another.

**The D1 binding — `env.DB`, `.prepare(`, `drizzle(` — is touched in exactly three
places: `src/worker/index.ts`, `src/worker/middleware/scope.ts`, and anything under
`src/worker/db/`.** Every other file — routes, services, `lib/` — takes the accessor (or
the drizzle client `db/client.ts` builds from the binding) as a parameter and never
reads it off `Env`.
`scripts/check-boundaries.mjs` enforces exactly that allowlist — the first row of the
boundary table ([architecture §13](architecture.md)) — and runs in `check`. —
*Why:* `index.ts` needs the binding once, for `scheduled()` — cron has no request and no
middleware to construct an accessor, so the handler builds `forTenant(env.DB, tenantId)`
directly per tenant; every request-scoped path gets its accessor from
`middleware/scope.ts`; and `db/` is where the SQL legitimately lives. Three named
places are a fact a script can hold, and anything else touching the binding is a query
that escaped the chokepoint.

**Every `baseFields` table carries `deleted_at`; a row is soft-deleted, never
hard-deleted, and every read composes a `notDeleted` helper alongside the tenant
filter:**

```ts
// src/worker/db/scope.ts
import { isNull } from "drizzle-orm";
export const notDeleted = (table: { deletedAt: unknown }) => isNull(table.deletedAt);
```

— *Why:* recovery and audit trails depend on the row surviving; a hard `DELETE` cannot
be undone by a support request.

**Platform-level system-admin access is an email allowlist, `SYSTEM_ADMIN_EMAILS`, never
a rung inside the product's own role model.** — *Why:* a role rung requires every
tenant's data to agree on what "above owner" means; an allowlist checked once, outside
tenant data, doesn't.

*Role and permission models are product-specific and out of scope here* — a rank enum,
capability strings, or bitflags are all conforming. Record the choice in the product's
own README.

## 6. Env and secrets

**`Env` is generated by `wrangler types` into `worker-configuration.d.ts` and never
hand-maintained.** Secrets are hand-declared in exactly one file, which asserts they're
present and well-formed before anything reads them:

```ts
// src/worker/env.ts
export function assertSecrets(env: Env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  if (!env.OAUTH_GOOGLE_CLIENT_SECRET) {
    throw new Error("OAUTH_GOOGLE_CLIENT_SECRET is required");
  }
  // one assertion per secret the product requires
}
```

Called once per isolate, before the first request is handled. — *Why:* a missing or
truncated secret should fail loudly at the edge, once, not silently downgrade a
signature check in production traffic.

**`.dev.vars.example` is committed and copied to `.dev.vars` by CI** (§9), so a real
value is never required to build. **A value is config in `vars`, or a secret via
`wrangler secret put` — never both, never the same key in each.** — *Why:* a plaintext
`vars` entry silently overwrites the real secret with `""` on the next deploy;
`assertSecrets` turns that mistake into a boot-time error instead of a production
outage.

**Gitignored, unconditionally:** `.dev.vars`, `.env`, `.env.*`, `secrets.*`. — *Why:*
a secret committed once is a secret rotated, not a secret deleted, so the ignore rules
are written before the first local run rather than after the first mistake.

## 7. Rate limiting

**Every unauthenticated write that can be scripted gets a Workers ratelimit binding,
named `RL_<PURPOSE>`.** Minimum set: `RL_SIGNIN`, `RL_SIGNUP`, and `RL_RESET`, each
keyed by IP; `RL_API` keyed by the resolved principal. — *Why:* IP-keyed limits stop
credential-stuffing and signup spam before they reach the deliberately-slow password
hash (§4); principal-keyed limits protect the API from one compromised key regardless of
source IP.

**A rate-limit helper degrades open when its binding is absent.** Local `wrangler dev`
doesn't provision ratelimit bindings by default; a helper that throws instead turns
every local sign-in into a 500. — *Why:* fail-closed belongs where the binding exists —
production; fail-open locally keeps the dev loop working without binding gymnastics per
clone.

**Turnstile guards every unauthenticated form that sends email**: sign-up, password
reset, invite request. — *Why:* these are the forms an attacker turns into an email bomb
against a third party; a challenge is cheaper than the abuse mailbox that follows.

## 8. Testing

**Tests live in four tiers under root `test/`, every file `*.test.ts`:** `test/worker/`,
`test/client/`, `test/shared/`, `test/e2e/`. — *Why:* the tiers are the vitest projects
below, so the directory a test lives in already decides which runtime it gets — no
per-file configuration, and nothing test-shaped inside `src/`
([architecture §2](architecture.md)).

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers/config";

export default defineConfig({
  test: {
    projects: [
      cloudflareTest({
        test: { include: ["test/worker/**/*.test.ts"], setupFiles: ["test/worker/setup.ts"] },
      }),
      { test: { name: "client", environment: "jsdom", include: ["test/client/**/*.test.ts"] } },
      { test: { name: "shared", environment: "node", include: ["test/shared/**/*.test.ts"] } },
    ],
  },
});
```

**`worker` tests run in `cloudflareTest()`** (real workerd, real bindings), **`client`
in jsdom, `shared` in plain node.** — *Why:* client and worker code have incompatible
global environments ([architecture §4](architecture.md)); testing each in the runtime it
actually ships
to is what makes a green suite mean something.

**`test/worker/setup.ts` applies every file in `migrations/` to the test D1 binding
before the suite runs** — the same files `db:migrate:local` and `db:migrate:production`
apply everywhere else (§9). — *Why:*
a schema drift between test fixtures and real migrations is a bug in the migration, and
running the real files is what surfaces it here instead of in production.

**Test setup stubs every secret with a value distinct from `.dev.vars`'s.** — *Why:* a
test passing only because it's silently reusing a real dev secret can't tell you the
code reads its secret from `Env` at all.

**`test/e2e/` runs `@playwright/test` against `wrangler dev`, not a mocked server, and
is non-blocking in CI until the suite proves stable.** — *Why:* the serving model —
asset pipeline vs. Worker catch-all ([architecture §7](architecture.md)) — is exactly
what a mock can't
reproduce, but `wrangler dev` startup flakiness shouldn't gate every PR before the suite
has earned trust.

**Every `/api/v1` route declares who may call it (§2.2); `test/worker/routes.test.ts`
walks the route table and fails on any route that declares nothing; and each guarded
route also has a test that the unguarded call is rejected.** — *Why:* a guard that
regresses silently — a copy-pasted route missing its middleware — is invisible in review;
the table walk catches the missing declaration before any request is made, and the
request-level test catches a guard that is declared but wrong. A product on the
authorization map (§2.2) walks the same table and checks each `METHOD path` against the map
instead of `GUARDS`: the runtime `403` is the safety net, the walk is what turns an
undeclared route into a CI failure before it ships.

```ts
// test/worker/routes.test.ts
import { describe, expect, it } from "vitest";
import { API_BASE } from "#config/routes";
import { app } from "#worker/index";                       // the composed Hono app (architecture §4)
import { GUARDS } from "#worker/middleware/principal";

describe("the API route table", () => {
  it("declares who may call every route", () => {
    const declared = new Map<string, boolean>();
    for (const r of app.routes) {
      if (r.method === "ALL") continue;                    // a family's use() — middleware, not a route
      if (!r.path.startsWith(API_BASE)) continue;          // the asset catch-all and /api/health
      const key = `${r.method} ${r.path}`;
      declared.set(key, (declared.get(key) ?? false) || GUARDS.has(r.handler));
    }
    const undeclared = [...declared].filter(([, ok]) => !ok).map(([key]) => key);
    expect(undeclared).toEqual([]);
    expect(declared.size).toBeGreaterThan(0);              // an empty table would pass vacuously
  });
});
```

## 9. CI and deploy

```yaml
# .github/workflows/ci.yml — one job, steps in order
- run: npm ci
- run: cp .dev.vars.example .dev.vars
- run: npm run check
- run: npm run test
- run: npm run build
- run: npm run verify:serving
```

The `test:e2e` job (§8) runs separately and does not block merge until it's proven
stable.

**`check` runs, at minimum and in this order: `wrangler types`, the typecheck of all
three TypeScript projects, a Prettier format check at defaults, the one lint rule below,
and the boundary scripts (§5); the full list of mechanizable checks a repo wires into
`check` or `npm test` is [architecture §13](architecture.md).** **Prettier at defaults
is the only formatter, and the only lint rule beyond typecheck is
`@typescript-eslint/no-floating-promises`, type-aware, over `src/worker/`** (a Nuxt-based
repo keeps its `withNuxt()` eslint config as a recorded convention, not a deviation). —
*Why:* one opinionated formatter with no config file removes a whole category of style
bikeshedding, and typecheck catches most of what a linter would otherwise exist for. The
exception is the one thing it cannot see: a promise nobody awaits typechecks cleanly and,
on Workers, is cancelled the moment the response returns unless it was handed to
`ctx.waitUntil`. That is a correctness rule of this runtime, not a style, so it is the one
rule that earns a linter — and it stays one rule, because a second would be style.

```json
"scripts": {
  "deploy:production": "CLOUDFLARE_ENV=production npm run build && wrangler deploy --env production"
}
```

**A deploy script builds and deploys. It never migrates.** Applying migrations is its own
command, run deliberately, before the deploy that needs them. — *Why:* the two have to be
separable to express the only sequence that makes a schema change safe — a migration lands
while the *previous* code is still serving, and a destructive follow-up lands only once the
new code is everywhere. A `deploy` that migrates cannot say that, so it pushes every schema
change into the one shape that breaks under it. It also makes a copy-only deploy a
schema-mutation event, and leaves a failed `wrangler deploy` sitting on a migration that
has already applied and cannot be rolled back.

**The unnamed top level of `wrangler.jsonc` is local development. Production lives under
`env.production`, staging under `env.staging`, and neither is ever the default.** The top
level holds the bindings local tooling reads — placeholder identifiers that name nothing
remote — and is never deployed. — *Why:* [architecture §8](architecture.md) makes every
script name the environment it targets so that reaching production is always something
typed on purpose, and wrangler's own default has to obey the same rule. A bare
`wrangler deploy` — typed from memory, or by an agent stepping past `package.json` —
deploys the unnamed top level. With production there, the accident is a production
release. With placeholders there, the accident is an inert `{slug}-dev` Worker that no
route points at. Cloudflare's own guidance is the same: the root is a deployment of its
own, and one you do not use is one you never deploy without `--env`. The reasoning 2.5 gave
for the opposite layout — that starting under `env.production` forces a rename when
staging appears — was wrong: a product deployed as `widgets` from `env.production` adds
`widgets-staging` and renames nothing.

**Every named environment sets `name` explicitly: production is the slug itself, staging
is `{slug}-staging`, and the top level is `{slug}-dev`.** — *Why:* left to derive, wrangler
names a named environment `{name}-{env}` from the top level, which with a `-dev` root gives
`widgets-dev-production`. Naming each block makes the deployed Worker's name a literal in
the file rather than a derivation, keeps the production Worker on the slug
([architecture §9](architecture.md)), and means a repo that already deploys as `widgets`
moves its bindings under `env.production` and keeps its Worker, its routes and its
database as they are.

**The top level is what local tooling reads**: `wrangler dev`, the Vite plugin without
`CLOUDFLARE_ENV`, and the vitest worker pool without a `wrangler.environment` option all
see the unnamed environment, and local D1 and local storage are keyed by whatever
identifiers are written there. — *Why:* the configuration `dev` and the tests run against
is then the one block that can reach nothing remote, so there is no identifier in it that a
stray `--remote` could act on.

**One `wrangler.jsonc`, with every environment inside it rather than a config file per
environment.** — *Why:* not because the environments share bindings — they cannot: every
binding key is non-inheritable, and wrangler requires an environment that overrides one of
them to override all of them, so each block repeats the full set. The reason is that one
file is one diff: a new binding shows up in every environment in the same review, and
`--env` is a flag rather than a path, so no script can be pointed at the wrong file. A
product whose *build* genuinely differs per environment records a second file as a
deviation (§10).

```jsonc
// wrangler.jsonc — production and staging, each named. The top level is local only.
{
  "name": "widgets-dev",
  "d1_databases": [{ "binding": "DB", "database_name": "widgets-dev", "database_id": "local" }],
  "env": {
    "production": {
      "name": "widgets",
      // Repeated in full, because none of it is inherited.
      "d1_databases": [{ "binding": "DB", "database_name": "widgets", "database_id": "…" }]
    },
    "staging": {
      "name": "widgets-staging",
      "d1_databases": [
        { "binding": "DB", "database_name": "widgets-staging", "database_id": "…" }
      ]
    }
  }
}
```

```json
"scripts": {
  "deploy:production": "CLOUDFLARE_ENV=production npm run build && wrangler deploy --env production",
  "db:migrate:production": "wrangler d1 migrations apply widgets --remote --env production",
  "deploy:staging": "CLOUDFLARE_ENV=staging npm run build && wrangler deploy --env staging",
  "db:migrate:staging": "wrangler d1 migrations apply widgets-staging --remote --env staging"
}
```

**Both halves of a deploy name the environment.** The Vite plugin flattens its build output
to the environment `CLOUDFLARE_ENV` selects, and wrangler refuses to deploy that output
under a different `--env`. — *Why:* a build for one environment deployed to another is the
drift the flag exists to refuse, and naming it twice is what lets wrangler check.

**A product with one environment declares `env.production` and nothing beside it; staging
is one more block and two more scripts on the day it exists.** — *Why:* the same rule
`config/` already follows — nothing exists until it has a real consumer — and the top
level is not a spare environment to grow into, it is where local development lives.

**`observability.enabled: true`, and every log line carries the request's
`X-Request-Id`, validated at the boundary before it is adopted
([conventions §4](conventions.md)).** — *Why:* a production incident with no id linking a
client-visible error to the Worker log that explains it turns debugging into grepping
timestamps — and an id the log search is keyed on is one the Worker has to own the shape of.

**`console.*` never appears outside `src/worker/lib/log.ts`; every other file calls its
wrapped `log.info` / `log.warn` / `log.error`.** — *Why:* one choke point is where
request-id injection, log level, and a real sink get added once, not N times across
routes and services.

## 10. Deviations

**A deviation is legitimate when it is recorded.** A repo records each deviation from
this document in its README (what, why, and whether it is permanent), and never copies a
deviation silently into a new product. — *Why:* the standard is a target, not a gate; an
unrecorded deviation is the only kind that costs anything.
