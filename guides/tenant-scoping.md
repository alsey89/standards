# Tenant Scoping Wiring

How to implement the tenant-isolation rules in
[architecture §4 and §10](../standards/architecture.md): one shared D1 database, a
tenant column on every tenant-owned table (`tenant_id`, or the product's own
noun — `org_id`, `temple_id`, `company_id`), and a per-request scoped
accessor that makes an unscoped — or wrongly-scoped — query unrepresentable in
route and service code.

## The model

One shared database. Tenancy is a **filter, not a database boundary**: every
tenant-owned table carries a tenant column, and every query includes
`WHERE <tenant column> = ?`. The column is the product's noun (`tenant_id`,
`org_id`, `temple_id`, `company_id`) — the three accessor names below never
change with it. The accessor exists so that filter is baked in rather than
remembered. Name the accessor `repo` in code, never `db` — it wraps the
shared database; it is not a database handle, and nothing in this pattern is
database-per-tenant.

## The accessor factories (`src/worker/db/scope.ts`)

```ts
// src/worker/db/scope.ts — constructed once per request from a verified credential
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";        // the drizzle client, built once from env.DB
import { invoices } from "./schema/invoices";

const notDeleted = (t: { deletedAt: unknown }) => isNull(t.deletedAt);

export function forTenant(db: Db, tenantId: string) {
  return {
    // every method closes over tenantId — it is never a parameter
    listInvoices: () =>
      db.select().from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), notDeleted(invoices))),
  };
}
export type TenantRepo = ReturnType<typeof forTenant>;
```

Because the tenant id is closed over at construction and never appears as a
parameter, the classic multi-tenant bug — filtering by a client-supplied
workspace id — has no place to happen south of the middleware. Soft delete is
enforced the same way: every scoped method filters through the shared
`notDeleted` helper, applied inside the accessor — not left for each call
site to remember.

Two companion factories:

- **`src/worker/db/global.ts`** — the unscoped query modules `global(db)`
  returns, for tenant-free tables: user lookup by email, session
  create/validate, password-reset tokens, global config. `scope.ts` exports
  the `global` factory; `global.ts` implements what it hands back. The
  separate, loudly-named home is what keeps "unscoped" a visible decision
  instead of a quiet default.
- **`forTenantAsStaff(db, staff, tenantId)`** — the one sanctioned
  "id from user input" case: a **verified staff principal** picks a workspace
  to operate on. The authorization is the staff credential, not the id. The
  distinct name means `grep forTenantAsStaff` lists every cross-tenant access
  path in the product — exactly the list you want auditable.

## Construction site: scope middleware (`src/worker/middleware/scope.ts`)

Accessors are constructed **once per request, in
`src/worker/middleware/scope.ts`**, and handed down via Hono's typed context.
Construction reads a resolved `Principal` — the one shape a session cookie, an
API key, and an integration token all resolve into upstream, before any route
runs ([ops §2](../standards/ops.md)) — never a raw credential.

Resolution and the guards themselves live in a sibling file,
`src/worker/middleware/principal.ts` ([ops §2](../standards/ops.md)); `scope.ts`
does nothing but turn an already-verified principal into the scope its route
family is entitled to. It is one of exactly three places allowed to touch the
D1 binding at all — the others being `src/worker/index.ts`, which needs it for
`scheduled()`, and `src/worker/db/` itself.

```ts
// src/worker/middleware/scope.ts — the sole scoped-accessor construction site
import { client } from "../db/client";   // wraps env.DB in the drizzle client
type Authed = { Bindings: Env; Variables: { principal: Principal; repo: TenantRepo } };

// mounted after resolvePrincipal + requireAuth from middleware/principal.ts
export const tenantScope = createMiddleware<Authed>(async (c, next) => {
  const { tenantId } = c.var.principal;        // verified upstream, never client input
  c.set("repo", forTenant(client(c.env.DB), tenantId));   // sole construction site
  await next();
});

export const publicScope = createMiddleware<Pub>(async (c, next) => {
  c.set("repo", global(client(c.env.DB)));     // unscoped, deliberately
  await next();
});

// staff planes only: the workspace is picked, the staff principal is the authority
export const staffScope = createMiddleware<Staff>(async (c, next) => {
  const target = c.req.param("tenantId");
  c.set("repo", forTenantAsStaff(client(c.env.DB), c.var.principal, target));
  await next();
});
```

Routes read `c.var.repo` and pass it to services; services take `(repo, args)`
and never see the raw binding:

```ts
// src/worker/routes/admin.ts
admin.get("/invoices", async (c) => {
  const { items, nextCursor } = await listOverdue(c.var.repo, c.req.query());
  return c.json({ items, nextCursor });   // the list envelope — conventions §4
});
```

Because the accessor lives in the context *type*, a route family without a
scope middleware has no `repo` at all — a public route reaching for
tenant-scoped methods is a compile error, not a code-review catch.

## The scope taxonomy

Each route family declares its scope once, at the mount point in `index.ts`.
Not every family resolves a tenant — that's the taxonomy, not a workaround:

| Route family | Middleware | Scope injected |
|---|---|---|
| sign-in / sign-up / reset | `publicScope` | `global` — pre-tenant by nature; sign-in *mints* the credential and resolves the tenant into the session |
| authenticated app | `requireAuth` + `tenantScope` | `forTenant` — tenant id from the session |
| webhooks / integrations | per-integration verify + `tenantScope` | `forTenant` — tenant id resolved from the verified signature/token |
| system admin | `requireRank(...)` + `staffScope` | `forTenantAsStaff` — verified staff principal picks the workspace |
| cron / `scheduled()` | none (no request) | `src/worker/index.ts` constructs `forTenant(env.DB, tenantId)` per tenant in its loop |

Notes per family:

- **Sign-in** queries by email through the `global` accessor, verifies the password,
  looks up the user's workspace membership — that lookup is where the tenant
  is *resolved* — and writes the session with `tenantId` in it. Every later
  request gets its scope from that session via `requireAuth` + `tenantScope`.
- **Multi-workspace users**: the session carries the active workspace;
  switching workspaces rewrites the session. "Tenant comes from the session"
  stays true.
- **Webhooks** have no cookie; they verify the signature, map the verified
  token to a tenant, then construct `forTenant` — same invariant, different
  credential.
- **Cron** has no request context; `forTenant` is a plain function, so the
  scheduled handler constructs one per tenant as it iterates.

## What conformance checks

From [architecture §13](../standards/architecture.md) and
[ops §5](../standards/ops.md):

- **Enforced by `scripts/check-boundaries.mjs` in `npm run check` — the first
  row of the boundary table ([architecture §13](../standards/architecture.md)):**
  the D1 binding — `env.DB`, `.prepare(`, `drizzle(` — appears only in
  `src/worker/index.ts`, `src/worker/middleware/scope.ts`, and under
  `src/worker/db/`. Every route, service and `lib/` module receives the
  accessor (or a `D1Database`) as a parameter instead.
- **Grep:** `forTenantAsStaff` call sites are the complete cross-tenant
  access list — audit it in review.
- **Review fact (not mechanizable):** the scope middleware constructs its
  accessor from the resolved `Principal` verified upstream
  ([ops §2](../standards/ops.md)). A route that passes any client-supplied id
  into `forTenant()` defeats the chokepoint.
