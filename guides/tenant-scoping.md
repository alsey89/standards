# Tenant Scoping Wiring

How to implement §4/§10 of the
[architecture standard](../standards/architecture.md): one shared D1 database, a
`tenant_id` column on every tenant-owned table, and a per-request scoped
accessor that makes an unscoped — or wrongly-scoped — query unrepresentable in
route and service code.

## The model

One shared database. Tenancy is a **filter, not a database boundary**: every
tenant-owned table carries `tenant_id`, and every query includes
`WHERE tenant_id = ?`. The accessor exists so that filter is baked in rather
than remembered. Name the accessor `repo` in code, never `db` — it wraps the
shared database; it is not a database handle, and nothing in this pattern is
database-per-tenant.

## The accessor factories (`db/scope.ts`)

```ts
// db/scope.ts — constructed once per request; tenantId from a verified credential
export function forTenant(db: D1Database, tenantId: string) {
  return {
    listInvoices: () =>
      db.prepare("SELECT … FROM invoices WHERE tenant_id = ?1")
        .bind(tenantId).all<Invoice>(),
    // every method closes over tenantId — it is never a parameter
  };
}
export type TenantRepo = ReturnType<typeof forTenant>;
```

Because the tenant id is closed over at construction and never appears as a
parameter, the classic multi-tenant bug — filtering by a client-supplied
workspace id — has no place to happen south of the middleware.

Two companion factories:

- **`db/global.ts`** — explicitly-unscoped queries for tenant-free tables:
  user lookup by email, session create/validate, password-reset tokens,
  global config. The separate, loudly-named home is what keeps "unscoped" a
  visible decision instead of a quiet default.
- **`forTenantAsStaff(db, staff, tenantId)`** — the one sanctioned
  "id from user input" case: a **verified staff principal** picks a workspace
  to operate on. The authorization is the staff credential, not the id. The
  distinct name means `grep forTenantAsStaff` lists every cross-tenant access
  path in the product — exactly the list you want auditable.

## Construction site: scope middleware (`routes/middleware.ts`)

Accessors are constructed **once per request, in middleware**, and handed down
via Hono's typed context. This file is the only place outside `db/` that may
touch the D1 binding.

```ts
// routes/middleware.ts
type Authed = { Bindings: Env; Variables: { session: Session; repo: TenantRepo } };

export const requireAuth = createMiddleware<Authed>(async (c, next) => {
  const session = await validateSession(c);             // 401s on failure
  c.set("session", session);
  c.set("repo", forTenant(c.env.DB, session.tenantId)); // sole construction site
  await next();
});

export const publicScope = createMiddleware<Pub>(async (c, next) => {
  c.set("repo", globalRepo(c.env.DB));                  // unscoped, deliberately
  await next();
});
```

Routes read `c.var.repo` and pass it to services; services take `(repo, args)`
and never see the raw binding:

```ts
// routes/admin.ts
admin.get("/invoices", async (c) => {
  const invoices = await listOverdue(c.var.repo, c.req.query());
  return c.json(invoices);
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
| signin / signup / reset | `publicScope` | `globalRepo` — pre-tenant by nature; signin *mints* the credential and resolves the tenant into the session |
| authenticated app | `requireAuth` | `forTenant` — tenant id from the session |
| webhooks / integrations | per-integration verify | `forTenant` — tenant id resolved from the verified signature/token |
| system admin | `requireStaff` | `forTenantAsStaff` — verified staff principal picks the workspace |
| cron / `scheduled()` | none (no request) | constructs `forTenant` per tenant in its loop |

Notes per family:

- **Signin** queries by email through `globalRepo`, verifies the password,
  looks up the user's workspace membership — that lookup is where the tenant
  is *resolved* — and writes the session with `tenantId` in it. Every later
  request gets its scope from that session via `requireAuth`.
- **Multi-workspace users**: the session carries the active workspace;
  switching workspaces rewrites the session. "Tenant comes from the session"
  stays true.
- **Webhooks** have no cookie; they verify the signature, map the verified
  token to a tenant, then construct `forTenant` — same invariant, different
  credential.
- **Cron** has no request context; `forTenant` is a plain function, so the
  scheduled handler constructs one per tenant as it iterates.

## What conformance checks

From the standard's §13:

- **Grep:** the D1 binding (`env.DB`, `.prepare(`) appears only under
  `src/worker/db/` and in `routes/middleware.ts`.
- **Grep:** `forTenantAsStaff` call sites are the complete cross-tenant
  access list — audit it in review.
- **Review fact (not mechanizable):** each scope middleware constructs its
  accessor from the credential it just verified. A route that passes any
  client-supplied id into `forTenant()` defeats the chokepoint.
