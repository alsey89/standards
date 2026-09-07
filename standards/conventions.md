# Product Conventions Standard

Part of Product Standard v2.0 — the exact names and shapes an agent looks up
once it already knows the model [architecture.md](architecture.md) fixes.

## 1. Scope

This document fixes **names and shapes**: URLs and the route declaration, the
API contract, i18n, and file/identifier naming. [architecture.md](architecture.md)
owns layout and serving; [ops.md](ops.md) owns auth, tenancy, and operations.
The [bootstrap guide](../guides/bootstrap.md) is where a new repo's checklist
points back to the rules below.

## 2. Routes and URLs

**Route segments are kebab-case, resources are plural, params are named by
resource.** `/app/projects/:projectId`, never `/app/Projects/:id` or
`/app/project/:id`. — *Why:* a resource-named param reads the same in the
route table, the handler signature, and a log line; a bare `:id` stops being
unambiguous the moment a route nests a second resource.

**No trailing slash in the app or the API; the site always has one.**
`isAppPath()` strips a single trailing slash before matching, so a stray
`/app/projects/` still resolves into the shell instead of 404ing. — *Why:*
the site is static directory output (`trailingSlash: "always"`,
[architecture §6](architecture.md)), where the slash is the real request path; the app and API are code,
where it's just noise a router would otherwise have to special-case.

### 2.1 `config/routes.ts`

**`config/routes.ts` exports exactly six names:** `APP_BASE`, `APP_PATHS`,
`PUBLIC_PREFIXES`, `API_BASE`, `isAppPath()`, `fillPath()`. Nothing else, and
nothing less. — *Why:* six fixed names is what lets an agent open a repo it
has never seen and know the one file to grep for every path in the product.

```ts
// config/routes.ts — the single declaration of every app path. The Worker's
// catch-all, the SPA router, and the site's CTAs all import from here.
// Nothing else in the repo may write an "/app/..." string literal.

export const APP_BASE = "/app";

export const APP_PATHS = {
  // auth — see §3 for the full table
  signIn: "/app/auth/sign-in",
  signUp: "/app/auth/sign-up",
  forgotPassword: "/app/auth/forgot-password",
  resetPassword: "/app/auth/reset-password",
  verifyEmail: "/app/auth/verify-email",
  acceptInvite: "/app/auth/invite/:token",

  // resources — one key per page, params named by resource
  root: "/app",
  projects: "/app/projects",
  project: "/app/projects/:projectId",
  projectMembers: "/app/projects/:projectId/members",

  // admin plane — see §2.2
  admin: "/app/admin",
} as const;

// Public product surfaces NOT under /app — a share link, an invite page, a
// public viewer. Declared, never implied; empty if none exist. Illustrative.
export const PUBLIC_PREFIXES = ["/tours"] as const;

export const API_BASE = "/api/v1";

/** True for a real app path, or one trailing-slash off — both 200 into the shell. */
export function isAppPath(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return p === APP_BASE || p.startsWith(APP_BASE + "/");
}

/** Fills named params into an APP_PATHS entry: fillPath(APP_PATHS.project, { projectId: "abc" }). */
export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`fillPath: missing param "${key}" for "${path}"`);
    return encodeURIComponent(value);
  });
}
```

**Zero app-path literals outside this file and the router.** Every link,
redirect, and email template builds its URL from `APP_PATHS` + `fillPath()`;
`check` greps for the exception:

```bash
grep -rnE "[\"'\`]/app(/|[\"'\`])" src/client src/worker \
  --include='*.ts' --include='*.tsx' --include='*.vue' | grep -v 'src/client/router\.'
```

Expected: no output. — *Why:* a hardcoded path turns a rename into a
repo-wide find-and-replace instead of a one-file edit; the grep is what
makes that mechanizable instead of aspirational.

### 2.2 Admin is a plane, not a role

**One principal type is one shell, so admin lives at `/app/admin/*`.** A
genuinely distinct principal type — not "an admin role among the same
users," but a different credential entirely ([ops §2](ops.md)) — is its own declared
plane at its own top-level prefix with its own cookie (§8), never nested
under `/app`. — *Why:* nesting a second principal type under the first
shell's routes means every guard there has to ask "which kind of admin is
this" instead of the router already knowing from the prefix. Which planes
exist, and what they're called, is product-specific.

### 2.3 Site locale prefix

**The site's default locale is unprefixed; every other locale is a lowercase
slug.** `config/brand.ts` declares which locale is default (§7); that one
serves at `/`, others at `/zh-tw/`, `/ja/`. Locale *codes* stay canonical
(`zh-TW`) everywhere except the URL slug. — *Why:* canonical codes are what
`Accept-Language` matching and a CMS field expect; a lowercase slug is what
a URL is supposed to look like. Writing `zh-TW` into a path is the thing
this rule forecloses.

## 3. Auth paths

**Auth vocabulary is `sign-in` / `sign-up` / `sign-out`, never `login` or
`signin` as one word.** — *Why:* one spelling means a search for `sign-in`
across the repo, the design tokens, and this document turns up everything;
three spellings for the same concept is how a rename job turns into an
afternoon.

| Page | Path |
|---|---|
| Sign in | `/app/auth/sign-in` |
| Sign up | `/app/auth/sign-up` |
| Forgot password | `/app/auth/forgot-password` |
| Reset password | `/app/auth/reset-password` |
| Verify email | `/app/auth/verify-email` |
| Accept invite | `/app/auth/invite/:token` |

**The session-read endpoint is always `GET /api/v1/auth/session`.** — *Why:*
five different spellings of "who am I" across a portfolio means the SPA's
bootstrap sequence can't be copy-pasted between products; one spelling means
it can.

| Method & path | Purpose |
|---|---|
| `POST /api/v1/auth/sign-in` | exchange credentials for a session cookie |
| `POST /api/v1/auth/sign-up` | create the account and a session in one call |
| `POST /api/v1/auth/sign-out` | delete the session row and the cookie |
| `GET /api/v1/auth/session` | resolve the current `Principal` ([ops §2](ops.md)) |
| `POST /api/v1/auth/password/forgot` | request a reset email — always 200 |
| `POST /api/v1/auth/password/reset` | consume the reset token, set a new password |
| `GET /api/v1/auth/oauth/:provider` | redirect to the provider's consent screen |
| `GET /api/v1/auth/oauth/:provider/callback` | exchange the provider's code, establish a session |
| `GET /api/health` | outside `/api/v1` — liveness only, the one bare-envelope exception (§4) |

**`GET /api/health` sits outside `/api/v1` with no envelope at all.** —
*Why:* an uptime check wants `{ ok: true, version }` or a non-200, not `{ item }`;
versioning a liveness probe would just add churn to monitoring configs
every time the API version bumps.

## 4. API contract

**Success is one of two shapes: `{ item }` for one resource, `{ items,
nextCursor, total? }` for a list.** `201 { item }` on create; `204` with an
empty body for an action with nothing to return; `GET /api/health` → `{ ok: true,
version }` is the one bare exception — not the `{ message, data, error: null
}` envelope, and not a bare array. — *Why:* one two-slot shape lets `api.ts`
(§4.3) unwrap generically regardless of resource, and lets a response grow
metadata (`total`, later `warnings`) without polluting the resource itself.

```http
GET /api/v1/projects/proj_123
200 OK
{ "item": { "id": "proj_123", "name": "Lighthouse relaunch", "createdAt": 1767225600000 } }
```

```http
GET /api/v1/projects
200 OK
{
  "items": [{ "id": "proj_123", "name": "Lighthouse relaunch", "createdAt": 1767225600000 }],
  "nextCursor": "eyJjcmVhdGVkQXQiOjE3NjcyMjU2MDAwMDAsImlkIjoicHJval8xMjMifQ"
}
```

```http
POST /api/v1/projects
{ "name": "New harbor" }
201 Created
{ "item": { "id": "proj_130", "name": "New harbor", "createdAt": 1767312000000 } }
```

```http
PATCH /api/v1/projects/proj_130
{ "name": "New harbor (renamed)" }
200 OK
{ "item": { "id": "proj_130", "name": "New harbor (renamed)", "createdAt": 1767312000000 } }
```

```http
DELETE /api/v1/projects/proj_130
204 No Content
```

### 4.1 Errors

**Every error, at the correct HTTP status, is `{ error: { code, message,
params?, details?, traceId } }`.** `code` is SCREAMING_SNAKE from the registry
in `src/shared/errors.ts` (§4.2), which also fixes the status the code is
sent at; `message` is developer-facing, never rendered to a user (§7);
`params` is a flat object of strings and numbers — the facts the translated
sentence is about; `details` appears only on `422`, as a flat array. —
*Why:* one shape lets `api.ts` throw a single `ApiError` class regardless of
which route failed, and a `code` is what makes a localized, non-generic
error message possible at all — provided the registry holds a code for the
*refusal*, not just for the status (§4.2).

```http
DELETE /api/v1/playlists/pl_42
409 Conflict
{
  "error": {
    "code": "PLAYLIST_IN_USE",
    "message": "3 screens still show this playlist.",
    "params": { "count": 3 },
    "traceId": "9f2c1e3a-7b1d-4a51-9c3a-9d3b6e2f9a01"
  }
}
```

```http
POST /api/v1/projects
{ "name": "" }
422 Unprocessable Entity
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request body failed schema validation.",
    "details": [
      { "path": "name", "code": "too_small", "message": "String must contain at least 1 character(s)" }
    ],
    "traceId": "9f2c1e3a-7b1d-4a51-9c3a-9d3b6e2f9a01"
  }
}
```

**`params` carries what has no language: counts, user-entered names, limits,
identifiers.** `count`, when present, selects the plural form (§7). A value
from a fixed vocabulary — a role, a state, a tier — is never a param; it
becomes its own code (§4.2). — *Why:* a translated sentence still has to say
*which* three screens, and the only alternative is prose in the response,
which §7 forbids.

| Status | When | Codes |
|---|---|---|
| `400` | the request is malformed below the level schema validation can even parse (bad JSON, wrong content type) | `BAD_REQUEST`, or any product code registered at `400` |
| `401` | no credential resolves to a `Principal` (missing or invalid session, key, or token) | `UNAUTHORIZED` only |
| `403` | a `Principal` resolves but lacks the rank or scope the route requires | `FORBIDDEN`, or any product code registered at `403` |
| `404` | the resource doesn't exist, or exists in a tenant this principal can't see ([ops §5](ops.md) — never leak existence across tenants) | `NOT_FOUND`, or any product code registered at `404` |
| `409` | the request conflicts with current state (duplicate, stale write, still in use) | `CONFLICT`, or any product code registered at `409` |
| `422` | the request is well-formed but fails validation — the one status that carries `details` | `VALIDATION_FAILED`, or any product code registered at `422` |
| `429` | rate limit exceeded ([ops §7](ops.md)) | `RATE_LIMITED` only |
| `500` | unhandled — the one status a client never branches on by `code` | `INTERNAL` only |

**`401`, `429` and `500` carry exactly one code each.** — *Why:* at each the
client's reaction is fixed — go sign in, wait, report — so there is nothing
product-specific to say, and one code per status is what lets the client key
that reaction on the code rather than on the status (§7).

**`X-Request-Id` is accepted from the client, generated if absent, echoed
back as `X-Request-Id`, and carried in every error body as `traceId`.** —
*Why:* fixing the exact casing here forecloses the `traceId`/`traceID`
mismatch — one file emits one spelling, another reads the other, and the
field is silently `undefined` forever, which is worse than having no trace
id at all: it looks like observability while contributing none.

### 4.2 The error-code registry

**`src/shared/errors.ts` is the sole registry of error codes — a map of code
to HTTP status, seeded with the eight below and grown by the product, one
code per distinct refusal it can make.** The Worker imports it to throw
(§4.3), the client to render (§7). A code used anywhere that isn't in the
map is a typecheck failure, not a new code. — *Why:* the client renders by
`code` alone, so a code the registry has never heard of would reach the user
as a blank; and a status beside each code means the status of a refusal is
decided once, here, where no route can disagree with another.

```ts
// src/shared/errors.ts
export const ERRORS = {
  // The starting set — one per status the API uses (§4.1). Thrown when the
  // product has nothing more specific to say. UNAUTHORIZED, RATE_LIMITED and
  // INTERNAL are the only codes ever registered at their status.
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  // The product's own refusals — one per distinct reason, named for the
  // refusal, never for the route that raised it.
  SCREEN_ALREADY_CLAIMED: 409,
  PLAYLIST_IN_USE: 409,
  MEDIA_NOT_READY: 409,
  FORBIDDEN_FOR_MEMBER: 403,
} as const;

export type ErrorCode = keyof typeof ERRORS;
export type ErrorParams = Record<string, string | number>;
```

**A code names the refusal — not the route that raised it, not the status.**
— *Why:* `PLAYLIST_IN_USE` is thrown by whichever route deletes a playlist
that is still assigned and translated once; `DELETE_PLAYLIST_CONFLICT` would
be translated once per route, and `CONFLICT` says nothing a `409` didn't.

**A value from a fixed vocabulary becomes its own code, never a `params`
value.** `FORBIDDEN_FOR_MEMBER`, not `FORBIDDEN` with `{ role: "member" }`.
— *Why:* the wire value is an enum a translation cannot render — an English
word inside a Japanese sentence, next to a menu that spells the same role
管理者 — and a language that inflects around the noun cannot write the
sentence at all. `params` carries what has no language: counts,
user-entered names, limits, identifiers (§4.1).

**`test/shared/errors.test.ts` proves that every supported locale's
`errors` namespace (§7) holds exactly the registry's codes plus the two
client-only keys `STALE_CLIENT` and `UNREACHABLE` — no missing entry, no
orphan key.** — *Why:* the dictionaries are JSON, which the typechecker
cannot hold against a TypeScript map; a test is what turns "mirrors the
registry" from a sentence into a CI failure.

```ts
// test/shared/errors.test.ts
import { describe, expect, it } from "vitest";
import { ERRORS } from "#shared/errors";
import { BRAND } from "#config/brand";
import en from "@/i18n/en.json";
import zhTW from "@/i18n/zh-TW.json";

const CLIENT_ONLY = ["STALE_CLIENT", "UNREACHABLE"];
const dictionaries: Record<string, { errors: Record<string, string> }> = { en, "zh-TW": zhTW };

describe("the error dictionary", () => {
  it.each(BRAND.locales.supported)("mirrors the registry in %s", (locale) => {
    const expected = [...Object.keys(ERRORS), ...CLIENT_ONLY].sort();
    expect(Object.keys(dictionaries[locale].errors).sort()).toEqual(expected);
  });
});
```

**Request and response shapes validate with zod v4 in `src/shared/validators/`, consumed by both Worker routes and client forms.** — *Why:* a
schema shared by both sides of the wire is what keeps a client form from
drifting from what the Worker actually enforces.

### 4.3 Client boundary

**`src/client/api.ts` is the only file in the SPA that calls `fetch` — and
the only file that reads an error's `httpStatus`.** It sends
`credentials: "same-origin"` (cookies are same-origin only —
[ops §2](ops.md))
and an `X-Request-Id`, and exposes `get`, `list`, `post`, `patch`, `del`:
`get`, `post`, `patch` unwrap `item`; `list` returns the list envelope intact
(it needs `nextCursor`); `del` resolves on 204 — each throwing a typed
`ApiError` on a non-2xx response. — *Why:* one boundary makes "add a header
to every request" a one-file change instead of a grep-and-fix across every
component; and a component that can read the status is a component that will
one day choose a message by it, which §7 forbids — so the field is named for
what it is, and the boundary table ([architecture §13](architecture.md))
holds the grep.

The Worker throws its own `ApiError` (`src/worker/services/util.ts`,
[architecture §4](architecture.md)): the same name on the opposite side of the
wire, sharing the registry in `src/shared/errors.ts` (§4.2). It takes the
code, never the status — the registry decides that.

```ts
// src/worker/services/util.ts
import { ERRORS, type ErrorCode, type ErrorParams } from "#shared/errors";

export class ApiError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    public readonly opts: { params?: ErrorParams; message?: string; details?: unknown[] } = {},
  ) {
    super(opts.message ?? code);
    this.status = ERRORS[code];
  }
}

// in a service:
throw new ApiError("PLAYLIST_IN_USE", { params: { count: screens.length } });
```

```ts
// src/client/api.ts
import { APP_PATHS } from "#config/routes";
import type { ErrorParams } from "#shared/errors";

export class ApiError extends Error {
  constructor(
    /** A registry code — or one this bundle predates, which §7 renders as STALE_CLIENT. */
    public code: string,
    /** For logs only. Never read outside this file: messages come from `code` (§7). */
    public httpStatus: number,
    public traceId: string,
    public params?: ErrorParams,
    public details?: { path: string; code: string; message: string }[],
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const requestId = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId, ...init.headers },
    });
  } catch {
    // fetch rejects only when no response came back at all — offline, DNS, a dropped connection.
    throw new ApiError("UNREACHABLE", 0, requestId);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    // No envelope means the Worker never answered — a proxy page, a gateway error.
    if (!e?.code) throw new ApiError("UNREACHABLE", res.status, requestId);
    // The one reaction keyed on a code rather than rendered from it — and it is the code, not the 401.
    if (e.code === "UNAUTHORIZED") location.assign(APP_PATHS.signIn);
    throw new ApiError(e.code, res.status, e.traceId ?? requestId, e.params, e.details);
  }
  return body as T;
}

export const get = <T>(path: string) => request<{ item: T }>(path).then((b) => b.item);
export const list = <T>(path: string) =>
  request<{ items: T[]; nextCursor: string | null; total?: number }>(path);
export const post = <T>(path: string, data: unknown) =>
  request<{ item: T }>(path, { method: "POST", body: JSON.stringify(data) }).then((b) => b.item);
export const patch = <T>(path: string, data: unknown) =>
  request<{ item: T }>(path, { method: "PATCH", body: JSON.stringify(data) }).then((b) => b.item);
export const del = (path: string) => request<void>(path, { method: "DELETE" });
```

## 5. Pagination

**Every list endpoint is paginated — no exceptions, even the ones with ten
rows today.** — *Why:* declaring the contract before it's load-bearing is
free; adding it retroactively, the day row ten becomes row ten-thousand,
breaks every existing client of the endpoint at once.

| Param | Meaning |
|---|---|
| `limit` | page size — default 50, max 200 |
| `cursor` | opaque, from the previous page's `nextCursor` |
| `sort` | `field:asc\|desc`, from an allowlist declared per resource |
| `total` | opt-in (`?total=true`); the count is omitted from the response otherwise |
| *(resource filters)* | flat query params, declared per resource — exist at the API whether or not the UI exposes them |

**Query validation is strict: an unknown param is a `400`, not a silent
no-op.** — *Why:* a typo'd filter (`stauts=active`) silently ignored
returns the *wrong* page with a `200` — the one failure mode a client can't
detect on its own.

```ts
// src/shared/validators/query.ts — zod v4
import { z } from "zod";

export const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    sort: z.string().regex(/^[a-zA-Z]+:(asc|desc)$/).optional(),
    total: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  })
  .strict();

// A resource extends the base schema with its own filters — still strict,
// so an unrecognized filter is a 400, never a silently-ignored typo.
export const listProjectsQuerySchema = listQuerySchema.extend({
  status: z.enum(["active", "archived"]).optional(),
  sort: z.enum(["createdAt:desc", "createdAt:asc", "name:asc"]).default("createdAt:desc"),
});
```

The base schema's regex is the *format* a `sort` value must match; the resource's
`z.enum` narrows that to the *allowlist* of fields this endpoint actually supports.

**Keyset pagination on `(createdAt, id)` is the default; an endpoint may
encode an offset inside its own cursor instead.** The cursor is opaque to
the client either way — only the endpoint that issued it decodes it.
`total` is opt-in (`?total=true`) and omitted by default (`?total=true` opts in;
anything else is off — `z.coerce.boolean()` would make `?total=false` true). — *Why:* keyset
stays correct while rows are inserted between page reads, unlike offset; an
opaque cursor is what lets an endpoint change its internal strategy without
breaking a client that stored one. `total` is opt-in because counting can
be a full-table scan — a client that doesn't need the number shouldn't pay
for it.

```http
GET /api/v1/projects?status=active&limit=2&sort=createdAt:desc
200 OK
{
  "items": [
    { "id": "proj_123", "name": "Lighthouse relaunch", "createdAt": 1767225600000 },
    { "id": "proj_119", "name": "Harbor onboarding", "createdAt": 1767139200000 }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOjE3NjcxMzkyMDAwMDAsImlkIjoicHJval8xMTkifQ"
}
```

## 6. Data types

**IDs are `crypto.randomUUID()`; timestamps are integer unix milliseconds in
`created_at` / `updated_at` / `deleted_at` (nullable); money is integer minor
units in a `*_minor` column.** — *Why:* a platform-native UUID needs no
library; an integer timestamp sorts without a date-parsing step; integer
minor units are the one representation of money that doesn't accumulate
floating-point error across a million transactions.

**Storage is snake_case, the wire is camelCase — drizzle maps between
them.** — *Why:* snake_case is what a SQL schema expects, camelCase is what
a TypeScript/JSON client expects, and drizzle's column mapping is where that
translation happens exactly once instead of at every call site.

```ts
// src/worker/db/schema/projects.ts
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  amountMinor: integer("amount_minor").notNull(), // money: integer minor units
  createdAt: integer("created_at").notNull(),     // unix ms — updatedAt is the same shape
  deletedAt: integer("deleted_at"),               // unix ms, nullable — soft delete
});
```

`amountMinor` reads and writes camelCase in every query and every `item`
response; the column is `amount_minor` in a raw SQL console. Request bodies
and query params validate through the same zod v4 layer (§4.2, §5).

## 7. i18n

**SPA messages live in `src/client/i18n/{en,zh-TW}.json`** (plus any other
supported locale), nested keys, with an `errors.<CODE>` namespace holding
every code in `src/shared/errors.ts` (§4.2) plus two client-only keys,
`STALE_CLIENT` and `UNREACHABLE`. **The client renders an error by `code`
alone, interpolating `params`, and never reads the HTTP status to choose a
message**: an unknown code renders `STALE_CLIENT`, a response with no
envelope renders `UNREACHABLE`, and the Worker's `message` is never shown. —
*Why:* a developer-facing `message` in English is exactly what a non-English
user should never see; and because the registry is shared and
`test/shared/errors.test.ts` proves every locale mirrors it, an unknown code
has exactly one cause — this bundle is older than the Worker — and the right
message for that is "reload", not a guess shaped by the status.

```json
{
  "nav": { "projects": "Projects", "settings": "Settings" },
  "errors": {
    "BAD_REQUEST": "That request didn't make sense to us.",
    "UNAUTHORIZED": "Sign in to continue.",
    "FORBIDDEN": "You don't have access to this.",
    "NOT_FOUND": "We couldn't find that.",
    "CONFLICT": "That already exists.",
    "VALIDATION_FAILED": "Some fields need a second look.",
    "RATE_LIMITED": "Too many attempts — try again shortly.",
    "INTERNAL": "Something went wrong on our end.",
    "SCREEN_ALREADY_CLAIMED": "This screen is already claimed.",
    "PLAYLIST_IN_USE": "One screen still shows this playlist. | {count} screens still show this playlist.",
    "MEDIA_NOT_READY": "This media is still uploading.",
    "FORBIDDEN_FOR_MEMBER": "Members can't do this — ask an admin.",
    "STALE_CLIENT": "This app has been updated — reload to continue.",
    "UNREACHABLE": "We couldn't reach the server. Check your connection and try again."
  }
}
```

Plural syntax is the framework's (`|` in vue-i18n, `plural` in react-intl);
what the standard fixes is that `count` is the selector (§4.1).

```ts
// src/client/lib/errors.ts — the one place a rejection becomes a sentence
import { ApiError } from "@/api";
import { t, te } from "@/i18n"; // te: "does this key exist" — vue-i18n's name; a React product aliases its own

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    return te(key) ? t(key, e.params) : t("errors.STALE_CLIENT");
  }
  return t("errors.INTERNAL"); // not from the API at all — a bug in this bundle
}
```

**The site keeps its own, separate dictionary** (`site/src/i18n/`). —
*Why:* site copy and product copy diverge by design, so forcing them to share
one dictionary buys nothing ([architecture §6](architecture.md) draws the same
line for values vs. prose).

**The Worker emits codes, never prose** — the one exception is transactional
email, genuinely user-facing text, living as templates in
`src/worker/lib/email/`, not as an error response. — *Why:* prose in a
response bakes one locale's wording into the API contract; a code is
language-neutral and leaves presentation entirely to the client.

**Locale is persisted in cookie `${slug}_locale`** (§8); the default locale
and the supported set are declared once, in `config/brand.ts`. — *Why:* a
cookie is the one store the Worker can read before the SPA boots, so the first
paint is already in the reader's language; declaring the set once keeps the
site's locale prefixes (§2.3) and the SPA's dictionaries from disagreeing about
which locales exist.

```ts
// config/brand.ts
export const BRAND = {
  slug: "anysign",
  name: "Anysign",
  origin: "https://anysign.tv",
  supportEmail: "support@anysign.tv",
  locales: {
    default: "en",
    supported: ["en", "zh-TW"] as const, // "ja" joins here if the product needs it
  },
} as const;
```

`locales.default` is also what §2.3 uses for the site's unprefixed locale.
Which locales beyond `en`/`zh-TW` a product supports is product-specific.

## 8. Naming

| What | Case | Example |
|---|---|---|
| Components and pages | PascalCase | `ProjectCard.vue` / `ProjectCard.tsx`, `ProjectsPage.tsx` |
| Everything else (routes, services, db modules, scripts) | kebab-case | `forgot-password.ts`, `project-members.ts` |
| Test files | mirrors the file under test, `*.test.ts` suffix | `project-members.test.ts` |
| Error codes | SCREAMING_SNAKE | `VALIDATION_FAILED` |
| Env var names | SCREAMING_SNAKE | `SESSION_SECRET` |
| Cookies | `${slug}_${purpose}` | `anysign_session`, `anysign_locale`, `anysign_theme` |
| Ratelimit bindings | `RL_<PURPOSE>` | `RL_SIGNIN`, `RL_API` |
| Request trace header | exact casing `X-Request-Id` | `X-Request-Id` |

**`BRAND.slug` (§7) is the single source for every one of these prefixes.**
Nothing hardcodes `"anysign_"` — a cookie name and a rate-limit binding
reference both read `BRAND.slug` and interpolate. — *Why:* a product rename
becomes a one-line change in `config/brand.ts` instead of a repo-wide
find-and-replace across names nobody remembered were spelled out by hand.

## 9. Deviations

**A deviation is legitimate when it is recorded.** A repo records each
deviation from this document in its README (what, why, and whether it is
permanent), and never copies a deviation silently into a new product. —
*Why:* the standard is a target, not a gate; an unrecorded deviation is the
only kind that costs anything.
