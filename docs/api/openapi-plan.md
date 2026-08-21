# OpenAPI contract — implementation plan

Status: **all open questions resolved 2026-08-21. Awaiting final sign-off before execution.** Written 2026-08-21.

This is the execution plan for the OpenAPI contract in `docs/api/`. It is not the contract. Once signed off it is handed to an agent that writes the YAML.

**Nothing in this plan is left to the executing agent's discretion.** Every question raised during review has been answered and folded into the section it belongs to; §6 keeps the record of what was asked and how it was settled. If the agent finds a case this plan does not cover, it stops and asks rather than choosing.

Binding inputs, in precedence order:

1. [`CONVENTIONS.md`](CONVENTIONS.md) — the contract's own rules. Every choice below traces back to one of them.
2. [`../database/README.md`](../database/README.md) and [`../database/erd.dbml`](../database/erd.dbml) — the data model, complete and approved.
3. [`../decisions.md`](../decisions.md) — history. Two entries constrain this work: the spec is modular, and Spectral lints it.
4. The repo-root and project `CLAUDE.md` — how we work.

Out of scope: any Nest code, Prisma schema, `@nestjs/swagger` decorator, or dependency install. This phase produces YAML and a linter config, nothing else.

---

## 1. Decisions settled before writing (approved 2026-08-21)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Modular spec files.** Root `openapi.yaml` plus `paths/` and `components/`, joined by external `$ref`. | Already recorded in `decisions.md` — pull-request reviewability over single-file portability. Cost: bundling is a pipeline step. |
| 2 | **Money is a reusable `Money` object**, `{ amount: integer (minor units), currency: string (ISO 4217) }`. | One `$ref`; the unit is enforced by type rather than by naming discipline; amount and currency cannot drift apart. Cost: nested access for consumers, and a flattening step for Stripe payloads. |
| 3 | **Error catalog fixed** (§3). 400 validation, 401, 403, 404, 409, 429, 500. **No 422.** | One renderer per consumer. 422 would split validation failures across two codes for no gain. |
| 4 | **Pagination envelope on every collection *endpoint*, no exceptions.** A list that is a *field* of a parent resource stays a plain array. | The dividing line is "does this list have its own path", not "is this list long" — defensible in review without arguing row counts. So `GET /orders/{id}/status-history` carries `meta` even at 4 rows; `cart.items` does not, because it is a field of the cart. |
| 5 | **Two schemas where the representation varies by role**, joined with `allOf`. `Product`/`ProductAdmin`, `Sku`/`SkuAdmin`, `Order`/`OrderAdmin`. | An honest `required` list per audience. A single schema with everything optional would claim `status` may be absent from a manager response when the implementation always sends it — which `CONVENTIONS.md` calls a broken contract. Cost: OpenAPI cannot express "this field appears if you are a manager", so the operation documents the union and states the rule in `description`. |

---

## 2. File layout

```
docs/api/
├── CONVENTIONS.md                  # exists
├── openapi-plan.md                 # this file
├── .spectral.yaml                  # house ruleset (Phase 1)
├── openapi.yaml                    # root: info, servers, security, tags, paths $refs
├── paths/
│   ├── auth.yaml
│   ├── users.yaml
│   ├── categories.yaml
│   ├── products.yaml
│   ├── skus.yaml
│   ├── likes.yaml
│   ├── cart.yaml
│   ├── orders.yaml
│   ├── payments.yaml
│   └── promo-codes.yaml
└── components/
    ├── security-schemes.yaml
    ├── parameters.yaml             # limit, offset, path ids, common filters
    ├── responses.yaml              # the reusable error responses
    └── schemas/
        ├── common.yaml             # Money, PaginationMeta, Problem, ValidationErrorDetail
        ├── auth.yaml
        ├── user.yaml
        ├── catalog.yaml            # Category, Product, ProductAdmin, ProductImage, Sku, SkuAdmin
        ├── cart.yaml
        ├── order.yaml
        ├── payment.yaml
        └── promo-code.yaml
```

**`$ref` style.** Each file under `components/` is a flat map of component names at the document root — no `components:` wrapper — referenced as `../components/schemas/common.yaml#/Money`. This is the standard split style and what bundlers expect. `paths/*.yaml` are keyed by path template (`/v1/products:`).

**Path templates carry the `/v1` prefix in full** (`/v1/products`, not `/products` with a versioned server URL). `CONVENTIONS.md` mandates the prefix in the path; putting it in `servers` instead would make it invisible at the operation level.

**Bundler: `npx @redocly/cli bundle`, not installed as a dependency.** `$ref`s must be bundled before Swagger UI and most generators will resolve them. `decisions.md` picked Spectral for *linting*, which left bundling open; `@apidevtools/swagger-cli` was the alternative and is thinner but less actively maintained. Running Redocly through `npx` keeps it out of `package.json` entirely, consistent with the still-open question of whether Spectral itself lands as a `devDependency`.

```bash
npx @redocly/cli@latest bundle docs/api/openapi.yaml -o docs/api/openapi.bundled.yaml
```

`openapi.bundled.yaml` is a generated artifact, not a reviewed one: **add it to `.gitignore`** in Phase 1. Committing it would put a second copy of the whole contract in every diff.

---

## 3. Error catalog

### 3.1 The body

One schema, `Problem`, in `components/schemas/common.yaml`, served as `application/problem+json` (RFC 9457):

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `string`, `format: uri` | yes | Stable identifier for the failure kind. Registry in §3.4. |
| `title` | `string` | yes | Short, human-readable, constant per `type`. |
| `status` | `integer` | yes | Duplicates the HTTP status, per RFC. |
| `detail` | `string` | no | Specific to this occurrence. Never leaks internals. |
| `instance` | `string`, `format: uri` | no | The request path that failed. |
| `errors` | `array` of `ValidationErrorDetail` | no | Extension member. Present only on `validation-error`. |

`ValidationErrorDetail`: `{ field: string, message: string }`. `field` uses dot/bracket notation for nested and array paths (`items[0].quantity`).

Some problem types carry their own extension members — see §3.4. Extension members are additive by nature, so adding one later is a safe change under the additive-change rule.

### 3.2 Status codes

| Status | Used for |
|---|---|
| **400** | Malformed or invalid request: body/query validation failure (with `errors`), unparseable JSON, invalid or expired password-reset token. |
| **401** | No credentials, or credentials that are not valid: missing/expired/malformed access token, wrong email or password, invalid or revoked refresh token. |
| **403** | Authenticated, credentials fine, but the *operation* is not permitted for this role — and the resource's existence is not a secret. |
| **404** | The resource does not exist, **or it exists and belongs to another user**. |
| **409** | The request is well-formed and permitted, but conflicts with current state. |
| **413** | Image upload over the size limit. `uploadProductImage` only. |
| **415** | Non-image upload, or a JSON body sent to the multipart endpoint. `uploadProductImage` only. |
| **429** | Rate limit exceeded. Declared on the auth endpoints only. |
| **500** | Unhandled. Declared on every operation so the shape is documented, never with a `detail` that leaks a stack trace. |

**The 403-versus-404 rule, stated once and applied without exception:**

- **404** when the resource is *user-scoped* and the caller is not its owner — another client's order, cart item, or like. Returning 403 would confirm the resource exists, which is an enumeration oracle.
- **403** when the resource is *global* and the caller's **role** is what blocks the action — a client calling `POST /v1/products`, a manager calling `deliverOrder`, a client passing a manager-only query parameter. Product 42 existing is not a secret; being allowed to create products is a role fact, and pretending the endpoint does not exist would be dishonest and hard to debug.

**413 and 415 are an approved extension of the catalog**, scoped to `uploadProductImage` alone. The alternative was folding both into 400 with distinct problem `type`s, keeping the catalog at seven codes; that was rejected because two standard status codes mean exactly these two conditions. They appear on no other operation — a 413 or 415 anywhere else in the spec is a bug.

### 3.3 Which codes each operation declares

Mechanical, and Spectral enforces it:

- Every operation: **500**.
- Every operation with a request body or query parameters: **400**.
- Every operation not marked `security: []`: **401**.
- Every operation whose ability is role-restricted or ownership-restricted: **403** and/or **404** per the rule above.
- Every operation with a path parameter: **404**.
- **409** only where §3.4 names a conflict for it. Declaring 409 everywhere would be noise.

### 3.4 Problem type registry

Base URI: `https://api.tshirt-store.example/problems/`. The registry is the reason 409 is usable: without distinct `type`s, "insufficient stock" and "promo code expired" would be indistinguishable at checkout.

| `type` slug | Status | Extension members | Raised by |
|---|---|---|---|
| `validation-error` | 400 | `errors` | any validated input |
| `malformed-request` | 400 | — | unparseable body |
| `invalid-reset-token` | 400 | — | `resetPassword` |
| `invalid-credentials` | 401 | — | `signIn` |
| `unauthenticated` | 401 | — | missing/expired access token |
| `invalid-refresh-token` | 401 | — | `refreshTokens`, `signOut` |
| `insufficient-permissions` | 403 | `requiredRole` | role-gated operations |
| `not-found` | 404 | `resource` | all |
| `email-already-registered` | 409 | — | `signUp` |
| `category-name-taken` | 409 | — | `createCategory`, `updateCategory` |
| `category-not-empty` | 409 | `productCount` | `deleteCategory` |
| `duplicate-sku` | 409 | `conflictingField` | `createSku`, `updateSku` |
| `sku-reserved` | 409 | `reservedQuantity` | `deleteSku` |
| `cart-empty` | 409 | — | `createOrder` |
| `insufficient-stock` | 409 | `skuId`, `requested`, `available` | `createOrder` only — see the cart section |
| `promo-code-invalid` | 409 | — | `createOrder`, `validatePromoCode` |
| `promo-code-expired` | 409 | `expiresAt` | idem |
| `promo-code-exhausted` | 409 | `usageLimit` | idem |
| `promo-minimum-not-met` | 409 | `minPurchaseAmount`, `subtotal` | idem |
| `promo-code-taken` | 409 | — | `createPromoCode` |
| `invalid-status-transition` | 409 | `from`, `to`, `allowed` | the four order transition operations |
| `order-not-payable` | 409 | `status` | `createPaymentIntent` |
| `invalid-webhook-signature` | 400 | — | `handleStripeWebhook` |
| `image-too-large` | 413 | `maxBytes`, `receivedBytes` | `uploadProductImage` |
| `unsupported-image-type` | 415 | `accepted` | `uploadProductImage` |
| `rate-limit-exceeded` | 429 | `retryAfterSeconds` | auth endpoints |
| `internal-error` | 500 | — | all |

### 3.5 Reusable responses

`components/responses.yaml` defines one response object per status code — `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `PayloadTooLarge`, `UnsupportedMediaType`, `TooManyRequests`, `InternalServerError` — each with `content: application/problem+json` and `schema: $ref Problem`. Operations reference these; **no operation defines an inline error schema.** Per-operation nuance goes in the response `description` (listing which problem `type`s that operation can raise), not in a forked schema.

---

## 4. Shared components

**`Money`** — `{ amount: integer, currency: string }`, both required. `amount` is minor units and may be negative only where a discount is expressed; `currency` is `pattern: ^[A-Z]{3}$`, example `USD`. Note the deliberate mapping: `payments.currency` is `char(3)` storing lowercase `usd` (Stripe's convention); the API exposes uppercase ISO 4217. The mapping is one `toUpperCase`, and the spec is the side a consumer reads.

**`PaginationMeta`** — `{ total: integer, limit: integer, offset: integer }`, all required.

**Collection envelope** — every collection endpoint returns `{ data: [...], meta: PaginationMeta }`. Written per response with an inline `allOf` against the item schema rather than as a generic wrapper, because OpenAPI 3.1 has no generics and a single `Collection` schema with `data: array of object` would lose the item type for generators.

**Parameters** (`components/parameters.yaml`): `LimitParam` (`integer`, 1–100, default 20), `OffsetParam` (`integer`, min 0, default 0), and one `format: uuid` path parameter per resource (`ProductIdParam`, `OrderIdParam`, …). Filter parameters shared by more than one operation live here too; single-use ones stay inline in the operation.

**Security** (`components/security-schemes.yaml`): one `bearerAuth`, `type: http`, `scheme: bearer`, `bearerFormat: JWT`. Applied globally at the root document. Public operations carry `security: []` explicitly — that is what makes "which endpoints are public" answerable from the spec.

**OpenAPI version:** `3.1.0`. It aligns `nullable` with JSON Schema (`type: [string, 'null']`), which this contract needs in several places, and Spectral and Redocly both support it.

**Tags**, declared in the root with descriptions, in this order: `auth`, `users`, `categories`, `products`, `skus`, `likes`, `cart`, `orders`, `payments`, `promo-codes`.

---

## 5. Endpoint inventory

49 operations. Auth column: `public` = `security: []`; otherwise the roles allowed. Error column lists the *non-obvious* codes — 400/401/500 per §3.3 are assumed and not repeated.

### auth — `paths/auth.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `POST /v1/auth/sign-up` | `signUp` | public | 201 `AuthSession` | 409, 429 | Body: `email`, `password`, `firstName`, `lastName`. **`role` is not accepted** — the ERD note is explicit; the contract must not have the property at all, so `forbidNonWhitelisted` rejects an attempt. |
| `POST /v1/auth/sign-in` | `signIn` | public | 200 `AuthSession` | 429 | 401 `invalid-credentials` for both unknown email and wrong password — one message, no enumeration. |
| `POST /v1/auth/refresh` | `refreshTokens` | public | 200 `AuthSession` | 429 | Refresh token in the body, not the `Authorization` header — the access token may be expired. Rotation: the old token is revoked. |
| `POST /v1/auth/sign-out` | `signOut` | any | 204 | — | Body carries the refresh token to revoke; sets `refresh_tokens.revoked_at`. |
| `POST /v1/auth/forgot-password` | `requestPasswordReset` | public | 202 | 429 | **202 whether or not the email exists.** 404 here is a user-enumeration oracle. |
| `POST /v1/auth/reset-password` | `resetPassword` | public | 204 | 429 | Body: `token`, `password`. 400 `invalid-reset-token` covers unknown, expired and already-used. Sets `password_changed_at` and triggers the notification email. |

`AuthSession`: `{ accessToken, refreshToken, expiresIn, user: User }`.

**`signUp` returns a full session, not just the created user.** The alternative — 201 with the `User` alone, forcing an immediate `signIn` — is arguably cleaner separation but costs a round trip for no gain, since a successful sign-up has already proven the credentials. Consequence to keep in mind: `signUp` and `signIn` share a response schema, so a change to `AuthSession` touches both.

### users — `paths/users.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `GET /v1/users/me` | `getCurrentUser` | any | 200 `User` | — | `User`: `id`, `email`, `firstName`, `lastName`, `role`, `passwordChangedAt` (nullable), `createdAt`. |
| `PATCH /v1/users/me` | `updateCurrentUser` | any | 200 `User` | — | `firstName`, `lastName` only. Not `email` (needs re-verification, out of scope), not `role`, not `password`. |

No user-listing or user-admin endpoints: the challenge does not ask for them, and manager/delivery accounts are provisioned out of band per the ERD.

### categories — `paths/categories.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `GET /v1/categories` | `listCategories` | public | 200 collection of `Category` | — | Paginated per §1.4. |
| `GET /v1/categories/{categoryId}` | `getCategory` | public | 200 `Category` | 404 | |
| `POST /v1/categories` | `createCategory` | manager | 201 `Category` | 403, 409 | `name`, `slug`. Both unique in the ERD. |
| `PATCH /v1/categories/{categoryId}` | `updateCategory` | manager | 200 `Category` | 403, 404, 409 | |
| `DELETE /v1/categories/{categoryId}` | `deleteCategory` | manager | 204 | 403, 404, 409 | **Hard delete** — `categories` has no `deleted_at`, and `products.category_id` is `NOT NULL`, so deleting a category with products would violate the FK. 409 `category-not-empty` is the contract for that, and the spec must say so; a 500 from a caught FK violation would be a bug. |

### products — `paths/products.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `GET /v1/products` | `listProducts` | public | 200 collection of `Product` \| `ProductAdmin` | 403 | Filters below. Client scope: `status = active AND deleted_at IS NULL`. Manager scope: all non-deleted. |
| `GET /v1/products/{productId}` | `getProduct` | public | 200 `Product` \| `ProductAdmin` | 404 | A `disabled` product is 404 for a client, 200 for a manager. Soft-deleted is 404 for everyone. |
| `POST /v1/products` | `createProduct` | manager | 201 `ProductAdmin` | 403, 404 | `categoryId`, `name`, `description`. **No SKUs and no images in the body** — SKUs have their own guarded rules and images are multipart. 404 if the category does not exist. |
| `PATCH /v1/products/{productId}` | `updateProduct` | manager | 200 `ProductAdmin` | 403, 404 | `name`, `description`, `categoryId`, `status`. Writing `status` **is** the "disable" capability — no separate `POST .../disable`, because `disabled` is a reversible business toggle on a field, not a guarded state transition like the order statuses. |
| `DELETE /v1/products/{productId}` | `deleteProduct` | manager | 204 | 403, 404 | Soft delete, sets `deleted_at`. Idempotent: a second call on an already-deleted product is 404, since it is invisible everywhere. |
| `POST /v1/products/{productId}/images` | `uploadProductImage` | manager | 201 `ProductImage` | 403, 404, 413, 415 | `multipart/form-data`, one `file` part. Spec declares accepted types (`image/jpeg`, `image/png`, `image/webp`) and the max size in the description — a linter cannot enforce either, so it must be prose a reviewer can check. |
| `PATCH /v1/products/{productId}/images/{imageId}` | `updateProductImage` | manager | 200 `ProductImage` | 403, 404 | `position` only. Renumbering siblings is a service concern; the contract only promises the collection is returned in `position` order. |
| `DELETE /v1/products/{productId}/images/{imageId}` | `deleteProductImage` | manager | 204 | 403, 404 | Hard delete — an image is not referenced by any order. |

`listProducts` query parameters: `categoryId` (uuid), `search` (string, over name and description), `minPrice` / `maxPrice` (integer, minor units — flat, not a `Money` object, because a query string cannot carry a nested object; the description states the currency), `status` (enum, **manager only → 403 for a client**), `sort` (enum: `createdAt`, `-createdAt`, `price`, `-price`; default `-createdAt`), plus `limit` / `offset`.

Note against the ERD: the `(category_id, created_at)` index covers the default sort and the category filter. `sort=price` and the price-range filter cannot use it — they need `skus`. Worth stating in the operation description so the cost is visible in review rather than discovered in a slow query.

**No `GET /v1/products/{id}/images` and no `GET /v1/products/{id}/skus`.** Both collections are fields of the product response. Adding collection endpoints for them would mean paginating lists that are at most a handful of rows and giving them a second representation to keep in sync. If a manager ever needs a standalone paginated SKU list, that is an additive change.

### skus — `paths/skus.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `POST /v1/products/{productId}/skus` | `createSku` | manager | 201 `SkuAdmin` | 403, 404, 409 | `skuCode`, `size`, `color`, `price` (`Money`), `stock`. 409 `duplicate-sku` for either unique constraint. |
| `PATCH /v1/skus/{skuId}` | `updateSku` | manager | 200 `SkuAdmin` | 403, 404, 409 | `skuCode`, `size`, `color`, `price`. **`stock` is deliberately absent** — see below. |
| `POST /v1/skus/{skuId}/restock` | `restockSku` | manager | 200 `SkuAdmin` | 403, 404 | Body `{ quantity: integer, minimum 1 }`, a **delta, not an absolute value**. |
| `DELETE /v1/skus/{skuId}` | `deleteSku` | manager | 204 | 403, 404, 409 | Soft delete. 409 `sku-reserved` when `reserved_stock > 0` — pending orders hold those units and their Release path still needs the row's counters to be coherent. |

**Why `stock` is not in `updateSku`, and why `restockSku` exists.** `README.md` §8 defines five guarded stock transitions, and none of them is "a manager sets stock to N". An absolute `PATCH stock = 5` cannot be written as a guarded conditional `UPDATE` — it silently overwrites concurrent reserve and fulfil operations, and it can drive `stock` below `reserved_stock`, violating `CHECK (reserved_stock BETWEEN 0 AND stock)`. A delta (`stock + qty`) is the Restock transition already in the table, and it composes safely under concurrency. This is a deviation from plain REST that is easy to defend and expensive to get wrong.

Restocking may also resolve an open `low_stock_events` row. The exact rule is an open business decision per `README.md` §9 and is **not** a contract concern — no endpoint changes either way.

`SkuAdmin` exposes `skuCode`, `stock`, `reservedStock`, `deletedAt`. `Sku` (client-facing) exposes `id`, `size`, `color`, `price`, and **`availableQuantity` = `stock - reserved_stock`** — a derived field with no column behind it. Clients never see either raw counter; how many units sit in other people's carts is not their business.

### likes — `paths/likes.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `PUT /v1/products/{productId}/like` | `likeProduct` | client | 204 | 403, 404 | **`PUT`, not `POST`** — `(user_id, product_id)` is unique, so the operation is naturally idempotent; a second `POST` would have to 409 for no reason a caller can act on. |
| `DELETE /v1/products/{productId}/like` | `unlikeProduct` | client | 204 | 403, 404 | Idempotent: 204 whether or not a like existed. |
| `GET /v1/users/me/likes` | `listLikedProducts` | client | 200 collection of `Product` | 403 | Paginated. Returns products, not like records — the like id is of no use to a caller. |

**All three like operations are `client`-only; a manager or delivery person gets 403.** Liking is what builds the low-stock notification set, and a manager receiving a "back in stock" email about their own catalog is incoherent. This is the one place role-gating is about semantics rather than privilege — worth saying in the operation `description`, since a reviewer will otherwise read the 403 as an oversight.

### cart — `paths/cart.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `GET /v1/cart` | `getCart` | client | 200 `Cart` | 403 | The caller's own cart, always — no `{cartId}` anywhere in the API, which removes cross-user access as a category of bug. Created on first read if absent, so this never 404s. `items` is a **plain array** per §1.4. |
| `POST /v1/cart/items` | `addCartItem` | client | 200 `Cart` | 403, 404 | `{ skuId, quantity }`. **Increments** if the SKU is already present, per `(cart_id, sku_id)` unique → `UPDATE quantity`. Returns the whole cart so the client never has to re-fetch for updated totals. **No 409:** no stock check here, see below. |
| `PATCH /v1/cart/items/{cartItemId}` | `updateCartItem` | client | 200 `Cart` | 403, 404 | `{ quantity }`, **absolute**. `quantity: 0` is a 400, not a delete — deletion has its own verb. **No 409**, same reason. |
| `DELETE /v1/cart/items/{cartItemId}` | `removeCartItem` | client | 204 | 403, 404 | 404 if the item belongs to another user's cart, per §3.2. |
| `DELETE /v1/cart/items` | `clearCart` | client | 204 | 403 | Removes all items; the cart row survives. |

`Cart`: `{ id, items: [CartItem], subtotal: Money, updatedAt }`. `CartItem`: `{ id, quantity, lineTotal: Money, sku: Sku, product: { id, name, imageUrl } }`. Per the ERD, `cart_items` holds **no price snapshot** — every price in this response is read live from `skus`, so a cart's subtotal can legitimately change between two reads. The response description must say so.

`CartItem` also carries **`availableQuantity`** (from `Sku`) so a client can see that a line has gone unpurchasable before checkout fails.

**The cart endpoints do not validate stock.** Per `README.md` §8, reservation happens at **order creation**, not at cart add — so `addCartItem` and `updateCartItem` accept any positive quantity, and `insufficient-stock` appears on `createOrder` alone.

The rejected alternative was a soft check returning 409 when `quantity > available`. It is friendlier, but it is not a reservation: it guarantees nothing, since the units can be gone a second later, and it would put the same problem `type` in two places meaning two different things — "you cannot add this" versus "your order failed".

Stock validation before an order is a **service-layer** concern, run at `createOrder` inside the same transaction as the Reserve `UPDATE`s, where the guard is the check. A separate pre-flight validation pass over the cart is an implementation choice for that service and has no contract surface: it either succeeds, in which case the order is created, or it raises `insufficient-stock` with `skuId`, `requested` and `available`. The contract's only obligation is to expose **`availableQuantity`** on every `CartItem` so a client can render a warning before it gets there.

### orders — `paths/orders.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `POST /v1/orders` | `createOrder` | client | 201 `Order` | 403, 409 | Cart checkout. Body: `{ promoCode?: string }`. Creates the order `pending`, snapshots `order_items`, runs **Reserve** on every SKU, reserves the promo code, and inserts the initial `pending` row in `order_status_history`. 409 types: `cart-empty`, `insufficient-stock`, and the four `promo-*` conflicts. |
| `GET /v1/orders` | `listOrders` | any | 200 collection of `Order` \| `OrderAdmin` | 403 | Role-scoped, filters below. |
| `GET /v1/orders/{orderId}` | `getOrder` | any | 200 `Order` \| `OrderAdmin` | 404 | 404, not 403, when a client asks for another client's order. |
| `POST /v1/orders/{orderId}/cancel` | `cancelOrder` | client (own), manager | 200 `Order` | 403, 404, 409 | Allowed while `pending`, `paid` or `processing`. 409 `invalid-status-transition` from `shipped`, `delivered` or `cancelled`. Triggers **Release** or **Restock** depending on the previous status read under lock, plus the promo Release. |
| `POST /v1/orders/{orderId}/process` | `processOrder` | manager | 200 `Order` | 403, 404, 409 | `paid → processing`. |
| `POST /v1/orders/{orderId}/ship` | `shipOrder` | manager | 200 `Order` | 403, 404, 409 | `processing → shipped`. |
| `POST /v1/orders/{orderId}/deliver` | `deliverOrder` | delivery_person | 200 `Order` | 403, 404, 409 | `shipped → delivered`. Any delivery person may act on any `shipped` order — the ERD has no assignment by design. |
| `GET /v1/orders/{orderId}/status-history` | `listOrderStatusHistory` | any | 200 collection of `OrderStatusChange` | 403, 404 | Paginated per §1.4 even though it is bounded. `changedBy` is nullable — webhook transitions have no actor. |

**Four action endpoints rather than one `PATCH /status`.** This is the deferred decision, resolved here. A single `PATCH /v1/orders/{id}/status { status }` is fewer paths, but the request schema would be the full six-value enum for every caller, and OpenAPI has no way to say "a delivery person may write only `delivered`". Separate operations make the authorization matrix readable straight off the spec — which, given `CLAUDE.md`'s note that authorization is the worst place here to accept unexamined code, is worth four paths. Cost accepted: the paths are verbs, which is not resource-oriented REST; the honest framing is that each one is a distinct state transition, not a field update.

`listOrders` scope by role, which the operation description must state explicitly:

- **client** — own orders only. `Order`.
- **manager** — all orders. `OrderAdmin` (adds the buyer, and `promoCode`).
- **delivery_person** — orders in `shipped`, plus orders they personally marked `delivered`. This is the CASL note in `README.md` §5: scoping their read to `shipped` alone would make their own history unreadable, since a delivered order is no longer `shipped`.

`listOrders` query parameters: `status` (enum, repeatable), `createdFrom` / `createdTo` (`date-time`), `minTotal` / `maxTotal` (integer, minor units), `deliveredBy` (enum, single value `me`, **`delivery_person` only → 403 for anyone else**), `sort` (`createdAt` / `-createdAt`, default `-createdAt`), `limit` / `offset`. Note the ERD's `(user_id, status, created_at)` index exists exactly for the client's filtered history, and `(status, created_at)` for the manager's operational view.

**A delivery person's own history is `GET /v1/orders?deliveredBy=me`, not a path of its own.** It resolves through `order_status_history` on `WHERE changed_by = <caller> AND status = 'delivered'` — precisely the query the ERD's `(changed_by, status, created_at)` index was added for — and it inherits every filter and the pagination envelope for free. A dedicated `GET /v1/deliveries/me` was the alternative; it would mean an eleventh tag for one operation, and a second place where order filtering has to be kept in sync.

`deliveredBy` is typed as an enum with the single value `me` rather than as a uuid. Accepting an arbitrary user id would invite "show me what that other delivery person delivered", which no requirement asks for and which the 403/404 rule would then have to arbitrate.

`Order`: `{ id, status, items: [OrderItem], subtotal, discountAmount, total, shippingDetails (nullable), createdAt, updatedAt }`, all money as `Money`. `OrderItem` is the ERD snapshot: `{ id, productId, skuId, productName, size, color, quantity, unitPrice }` — **snapshots, not joins.** `productName` is the name at purchase, not the current catalog name; do not resolve it through `products`. `shippingDetails` is `null` on an unpaid order, since `order_shipping_details` has no row until the payment webhook.

`OrderAdmin`: `allOf Order` plus `user: { id, email, firstName, lastName }` and `promoCode: { id, code } | null`. Per `README.md` §4 there is no code snapshot on `orders`, so `code` here is a join through `promo_code_id` — correct precisely because the code is treated as immutable.

### payments — `paths/payments.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `POST /v1/orders/{orderId}/payment-intent` | `createPaymentIntent` | client (own) | 201 `PaymentIntentSession` | 403, 404, 409 | Cart-checkout flow. 409 `order-not-payable` unless the order is `pending` with no succeeded payment. Returns `{ paymentId, clientSecret, amount: Money }`. |
| `POST /v1/checkout/payment-link` | `createPaymentLinkCheckout` | client | 201 `PaymentLinkCheckout` | 403, 404 | Quick single-SKU purchase. Body `{ skuId, quantity }`. Creates a `pending` order **first** so its id can ride as `client_reference_id`, then returns `{ order: Order, checkoutUrl }`. |
| `POST /v1/webhooks/stripe` | `handleStripeWebhook` | **public** | 204 | 400 | `security: []`, `Stripe-Signature` header required. |

**`createPaymentLinkCheckout` reserves no stock, and the 201 is not a promise of availability.** `README.md` §8 is explicit: Payment Links never reserve ahead of the charge, the Direct-sale guard runs only at the webhook, and the residual oversell is structural rather than a gap to close. The operation description must say this in plain words, because a consumer reading `201 Created` will otherwise assume the units are held.

**Quick purchase gets its own path, `POST /v1/checkout/payment-link`.** It does create an order, so it could have been a second request shape on `POST /v1/orders` discriminated by a `source` field. Rejected: the two flows return fundamentally different things — one an order to confirm client-side, the other a redirect URL to hand the browser — and a `oneOf` request body paired with a `oneOf` response is harder for both a generator and a reader than two plain paths. It also means the two creation paths can diverge later (only this one is single-SKU, only the other one takes a promo code) without either becoming a special case of the other.

The path lives under the `payments` tag, not `orders`, because the order is a means here and the Stripe session is the point.

**`payment_links` gets no endpoints at all.** ERD rows are one-per-SKU and reusable; the row is created lazily by the system on the first quick purchase for a SKU, and `deactivated_at` is set by the system when availability hits zero — never by a human. Manager CRUD would expose Stripe object lifecycle as API surface for no requirement in the challenge, and would hand a human a switch (`deactivated_at`) whose whole purpose is to be flipped automatically.

**Webhook contract notes**, all of which belong in the operation description because none is expressible in schema:

- **Raw body required.** Signature verification runs over the exact bytes; a JSON-parsed body cannot be verified. The spec documents `application/json`, and notes the implementation must keep the raw payload.
- **At-least-once delivery.** Idempotency is `stripe_webhook_events.id` as PK plus the partial `UNIQUE (order_id) WHERE status = 'succeeded'` backstop.
- **2xx on processing failure.** Only an unverifiable signature returns 400. A verified event that fails downstream is still stored and still answered 204, because a 4xx or 5xx makes Stripe retry on its own schedule instead of ours. Internal retry runs off `processed_at IS NULL`.
- **Not a consumer-facing operation.** Marked `x-internal: true`; it is in the spec because it is part of the contract with Stripe, not because a client should call it.

Deliberately excluded: any refund endpoint, and `GET /v1/orders/{id}/payments`. `payments.stripe_refund_id` exists in the ERD, but nothing in the challenge asks a human to trigger a refund — the one refund path named in `README.md` §9 is an automatic response to a Direct-sale guard failing. Adding a manager refund endpoint is an additive change if it turns out to be needed.

### promo-codes — `paths/promo-codes.yaml`

| Method + path | operationId | Auth | Success | Errors | Notes |
|---|---|---|---|---|---|
| `POST /v1/promo-codes` | `createPromoCode` | manager | 201 `PromoCode` | 403, 409 | `code` normalised to uppercase on write, per the ERD note. |
| `GET /v1/promo-codes` | `listPromoCodes` | manager | 200 collection of `PromoCode` | 403 | Filters: `isActive`, `includeExpired`. |
| `GET /v1/promo-codes/{promoCodeId}` | `getPromoCode` | manager | 200 `PromoCode` | 403, 404 | |
| `PATCH /v1/promo-codes/{promoCodeId}` | `updatePromoCode` | manager | 200 `PromoCode` | 403, 404 | `discount`, `minPurchaseAmount`, `expiresAt`, `usageLimit`, `isActive`. **`code` is not updatable.** |
| `POST /v1/promo-codes/validate` | `validatePromoCode` | client | 200 `PromoCodeValidation` | 403, 409 | `{ code }` checked against the caller's current cart. |

**`code` is absent from the update body on purpose.** `README.md` §4 records that `orders` deliberately has no `code` snapshot, and that this is only safe while `code` is immutable by convention; the alternative would require adding a snapshot column. Making the contract enforce the convention is the cheapest place to hold that line — and the README's own warning ("if that convention changes, a snapshot would need to be added") becomes a contract change rather than a silent drift.

**Discount modelling.** `promo_codes.discount_value` is a single `int` meaning either whole percent (1–100) or minor units, depending on `discount_type`. Mirroring that as one integer field would force every consumer to branch on a sibling field to know what the number means. The contract instead exposes a discriminated `oneOf`:

```yaml
Discount:
  oneOf:
    - { type: percentage, percent: integer 1..100 }
    - { type: fixedAmount, amount: Money }
  discriminator: { propertyName: type }
```

This is a deliberate divergence from the column layout, of the kind `CONVENTIONS.md` anticipates ("deliberately lossy in places"). Mapping to the ERD is mechanical and total in both directions.

`PromoCodeValidation`: `{ valid: boolean, reason: enum | null, discount: Money | null, subtotal: Money, total: Money }`. When `valid` is `true`, `reason` is `null` and the three money fields are populated; when `false`, `reason` names which rule failed and `discount` is `null`. `required` covers `valid`, `reason`, `subtotal` and `total` — `reason` is required-and-nullable, not optional, so a consumer never has to distinguish "absent" from "null".

**Validation reserves nothing.** `times_redeemed` moves only at order creation, so a code that validates at 200 can still be exhausted by the time checkout runs. Stated in the description, because a client that treats a successful validation as a hold will report a bug that is not one.

**`validatePromoCode` stays, and answers business rejections with 200 and `valid: false` — not 409.** Without it, the only way a client learns a code is bad is a failed `createOrder`, which by then has to unwind stock reservations it already took.

The status code is the subtle part. "Is this code usable?" is the question being asked, so a negative answer is a *successful* answer to it, and the response body carries a `reason` enum drawn from the same set as the problem types (`invalid`, `expired`, `exhausted`, `minimum-not-met`). The 409 on that list stays reserved for `createOrder`, where those same conditions abort an operation rather than answer a question.

This is a deliberate asymmetry: the same four conditions surface as 200-with-`reason` here and as four distinct 409 `type`s there. The operation `description` must say so, because it looks like an inconsistency until you notice the two endpoints are being asked different things. `validatePromoCode` still returns 409 for nothing at all — the row in §5 shows it only because a malformed or absent cart is a conflict (`cart-empty`), not a code problem.

### notifications — no paths

`low_stock_events` and `stock_notifications` get **no endpoints**. The deliverable is an email sent by a BullMQ worker; there is no client-facing read. A `GET /v1/users/me/notifications` would be a feature nobody asked for, backed by a table whose rows exist for the worker's benefit. Stated here so its absence reads as a decision rather than an oversight.

---

## 6. Questions raised in review, and how they were settled

All resolved 2026-08-21. Each answer is folded into the section it belongs to; this table is the index, not the authority — where it and a section above disagree, the section wins.

| # | Question | Settled | Where |
|---|---|---|---|
| Bundler | Which tool resolves the external `$ref`s | `npx @redocly/cli`, not installed as a dependency; output gitignored | §2 |
| 413/415 | Two status codes beyond the approved catalog, for image upload | Added, scoped to `uploadProductImage` alone | §3.2, §3.4 |
| Q1 | Does `signUp` return a session or just the created user | Full `AuthSession`, shared with `signIn` | §5 `auth` |
| Q2 | Is "disable a product" a `PATCH` field or its own endpoint | `PATCH /v1/products/{productId}` with `status` — a reversible field toggle, not a guarded transition | §5 `products` |
| Q3 | May any authenticated user like a product | `client` only; 403 otherwise, on semantic grounds rather than privilege | §5 `likes` |
| Q4 | Does the cart validate stock on add | No. Validation belongs to the order-creation service, inside the Reserve transaction; the cart only exposes `availableQuantity` | §5 `cart` |
| Q5 | Delivery history as a filter or its own path | `GET /v1/orders?deliveredBy=me`, enum-valued, `delivery_person` only | §5 `orders` |
| Q6 | Quick purchase as its own path or a variant of `POST /v1/orders` | Own path, `POST /v1/checkout/payment-link`, under the `payments` tag | §5 `payments` |
| Q7 | Manager endpoints over `payment_links` | None. Rows are created lazily and deactivated automatically | §5 `payments` |
| Q8 | Keep `validatePromoCode` | Keep. 200 with `valid: false` and a `reason` enum, not 409 | §5 `promo-codes` |

**Two of these are the ones a reviewer will push on**, so the reasoning is worth having ready rather than reconstructed:

- **Q4.** "The cart does not check stock" sounds like a missing validation. It is the opposite: the only check that means anything is the guarded `UPDATE` at Reserve, and any earlier check is advisory. Putting an advisory check behind a 409 would promise a hold the system never took.
- **Q8 against `createOrder`.** The same four promo conditions are a 200 in one place and four 409s in another. That is intentional — one endpoint is asked a question, the other is asked to do something — and it is the kind of thing that reads as sloppiness unless the spec says why.

---

## 7. Contract-versus-ERD mappings, stated once

Every place the API's shape deliberately differs from a column. A reviewer will ask about each of these, and an implementer who assumes a 1:1 mapping will get them wrong.

| ERD | Contract | Why |
|---|---|---|
| `skus.stock`, `skus.reserved_stock` | `Sku.availableQuantity` (derived); both raw values on `SkuAdmin` only | Inventory internals are not a client concern. |
| `product_images.s3_key` | `ProductImage.url` | `README.md` §2: the URL is built at response time so the bucket or CDN can change without a mass `UPDATE`. |
| `payments.currency` = `char(3)` lowercase (`usd`) | `Money.currency` uppercase ISO 4217 (`USD`) | Stripe's convention in the database, the standard's in the API. |
| `promo_codes.discount_type` + `discount_value` | discriminated `Discount` `oneOf` | One integer meaning two units forces every consumer to branch. |
| `orders.promo_code_id` | `OrderAdmin.promoCode.code`, joined | No snapshot by design; safe only while `code` is immutable, which the contract now enforces. |
| `order_items.product_name`, `unit_price`, `size`, `color` | returned verbatim as snapshots | Historical truth. **Never** re-resolved through `products` or `skus`. |
| `order_shipping_details` | `Order.shippingDetails`, nullable | No row exists until the payment webhook, so an unpaid order legitimately has `null`. |
| `order_status_history.changed_by` | `OrderStatusChange.changedBy`, nullable | Webhook transitions have no human actor. |
| `products.status` + `deleted_at` | `status` on `ProductAdmin` only; `deleted_at` invisible everywhere | Two hiding mechanisms with different audiences. |
| no `orders.delivery_person_id` | no assignment field, no assign endpoint | Deliberate per `README.md` §9. |
| `carts.id` | never appears in any path | The cart is always the caller's, which removes cross-user cart access as a class of bug. |

---

## 8. Execution phases

Each phase ends at a **stop point**: the agent reports what it wrote and waits for review before starting the next. Lint and bundle must pass at the end of every phase, not only at the end.

**Phase 0 — skeleton.** `openapi.yaml` (`openapi: 3.1.0`, `info`, `servers`, global `security`, the ten `tags` with descriptions, an empty-but-present `paths`), `components/security-schemes.yaml`, `components/schemas/common.yaml` (`Money`, `PaginationMeta`, `Problem`, `ValidationErrorDetail`), `components/responses.yaml` (all nine error responses), `components/parameters.yaml` (`LimitParam`, `OffsetParam`, the uuid path params). No domain schema, no path. ~200 lines.

**Phase 1 — the linter, before there is anything to lint.** `.spectral.yaml` extending `spectral:oas`, plus the house rules in §9. Add `docs/api/openapi.bundled.yaml` to `.gitignore`. Then run both commands against the Phase 0 skeleton and paste the real output:

```bash
npx @redocly/cli@latest bundle docs/api/openapi.yaml -o docs/api/openapi.bundled.yaml
```

This ordering is deliberate: a ruleset written after forty paths exist is a ruleset that gets weakened to make the existing files pass.

**Phase 2 — domain schemas, still no paths.** `CONVENTIONS.md`: model the domain before the endpoints. Order matters, because later files `$ref` earlier ones:

1. `catalog.yaml` — `Category`, `ProductImage`, `Sku`, `SkuAdmin`, `Product`, `ProductAdmin`
2. `user.yaml` — `User`
3. `auth.yaml` — `AuthSession` and the request bodies
4. `cart.yaml` — `CartItem`, `Cart`
5. `promo-code.yaml` — `Discount`, `PromoCode`, `PromoCodeValidation`
6. `order.yaml` — `OrderItem`, `OrderShippingDetails`, `OrderStatusChange`, `Order`, `OrderAdmin`
7. `payment.yaml` — `PaymentIntentSession`, `PaymentLinkCheckout`

Every enum is lifted from the ERD verbatim in value, converted to the JSON casing: `order_status` → `pending | paid | processing | shipped | delivered | cancelled`, and likewise `user_role`, `product_status`, `payment_method`, `payment_status`, `discount_type`. No invented values.

**Phase 3 — paths, one tag per commit**, in this order so every `$ref` target already exists: `auth`, `users`, `categories`, `products`, `skus`, `likes`, `cart`, `promo-codes`, `orders`, `payments`. Each operation gets `operationId`, `summary`, `tags`, its full response set per §3.3, and a `description` wherever §5 says something must be stated in prose.

**Phase 4 — examples.** `CONVENTIONS.md` treats examples as functional, not cosmetic: they feed Swagger UI, Prism mocks and contract tests. Every schema gets an example; `Money` examples use realistic minor units (`1999`, not `19.99` — a decimal example here is the single most likely thing to mislead an implementer); every error response gets a worked `Problem` example including the extension members from §3.4.

**Phase 5 — close out.** Final lint and bundle, a read-through against the §10 checklist, and entries appended to `../decisions.md`. One entry each, not one per bullet — `decisions.md` warns against a log padded with things the artifact already shows:

1. **The error catalog**, covering the RFC 9457 body, the 403-versus-404 rule, and the problem-type registry as the thing that makes a single 409 usable.
2. **`Money` as an object** rather than paired flat fields.
3. **Four order-transition endpoints** instead of `PATCH /status`, on the grounds that OpenAPI cannot express a role-dependent enum.
4. **`restockSku` as a delta**, and `stock` excluded from `PATCH /v1/skus/{skuId}`, because an absolute write is not expressible as a guarded transition.
5. **The discriminated `Discount`**, diverging deliberately from `discount_value`.
6. **Stock validation belongs to `createOrder`, not the cart** — with the reasoning from §6, since this is the decision most likely to be mistaken for an omission later.

Everything else in §6 is a detail the spec itself records and does not earn an entry. Append only — never edit an existing entry except to add a supersession marker.

---

## 9. Spectral ruleset

`.spectral.yaml` extends `spectral:oas` and adds the house rules. `decisions.md`: the point is not catching malformed YAML but enforcing what the challenge cares about.

| Rule | Severity | Enforces |
|---|---|---|
| `operation-operationId` (built-in) | error | every operation is generatable |
| `operation-operationId-unique` (built-in) | error | no duplicate method names |
| `operation-summary` | error | every operation has a summary |
| `operation-tags` | error | every operation is tagged |
| `error-response-is-problem` | error | every 4xx and 5xx `$ref`s a response from `responses.yaml` — no inline error schema, anywhere |
| `operation-has-500` | error | 500 declared on every operation |
| `operation-declares-401` | error | every non-`security: []` operation declares 401 |
| `no-inline-money` | warn | no property named `*price*`, `*total*`, `*amount*`, `*subtotal*` typed as `number`; must be `$ref Money` or a documented minor-unit `integer` |
| `uuid-format` | error | every property or parameter whose name ends in `Id` has `format: uuid` |
| `date-time-format` | error | every property ending in `At` has `format: date-time` |
| `schema-has-example` | warn | every schema carries an example (error until Phase 4, warn is the interim) |
| `request-body-no-additional-properties` | warn | request-body schemas set `additionalProperties: false`, matching `forbidNonWhitelisted` |
| `path-must-be-versioned` | error | every path starts `/v1/` |

The last one is worth having even though it looks trivial: `/v1` in the path is the one convention a single careless copy-paste breaks silently.

**Addendum, post-close-out.** `oas3-schema` (a built-in `spectral:oas` rule, not one of the house rules above) was disabled after Phase 3 — it false-positives on every externally-`$ref`'d path item or operation, which is this contract's entire modular structure (see `decisions.md`). That rule was the only thing checking the document against the OpenAPI schema itself: does a `oneOf` actually discriminate, does an example conform to its schema. With it off, `spectral lint` alone no longer makes that claim. `redocly lint` does, and is not optional: run `npm run lint:openapi`, which runs both.

---

## 10. Definition of done

The contract is finished when all of the following hold, each checked by running something rather than by reading:

1. `npm run lint:openapi` (Spectral + Redocly, see the Phase 3/9 addendum above): **zero errors** from both, and every remaining warning either explained here or resolved by adding the missing content it's pointing at — not left to a chat transcript.
2. Bundling succeeds and the bundled document loads in Swagger UI with no unresolved `$ref`.
3. All 49 operations from §5 present, each with a unique `operationId` matching §5 exactly.
4. Every public operation carries `security: []`, and the list of public operations is exactly: the five public `auth` operations, `listCategories`, `getCategory`, `listProducts`, `getProduct`, and `handleStripeWebhook`. Anything else public is a bug.
5. Zero inline error schemas: every 4xx/5xx resolves to `components/responses.yaml`.
6. **413 and 415 appear on `uploadProductImage` and nowhere else**, and no operation outside `createOrder` declares `insufficient-stock`.
7. Every monetary field is a `Money` `$ref` or a query parameter documented as minor units. **No `number`-typed money anywhere**, and no decimal in any example.
8. Every enum matches the ERD's values one-for-one, converted to JSON casing and nothing else.
9. `availableQuantity` appears on `Sku` and `CartItem`; `stock` and `reservedStock` appear on `SkuAdmin` only. A raw counter on a client-facing schema is a leak, not a convenience.
10. Every `required` list checked against §5 by hand — the one item on this list a linter cannot verify, and per `CONVENTIONS.md` the one that decides whether the contract is real.
11. `../decisions.md` has the six Phase 5 entries appended.

---

## 11. What this plan does not settle

Stated so a fresh agent does not treat silence as licence:

- **CASL ability definitions.** The contract says which role may call what; it does not define the abilities. That is Week 3, and per `CLAUDE.md` the abilities live with their feature, not in one global rules file.
- **Rate-limit numbers.** 429 is in the catalog and declared on the auth operations; the actual thresholds arrive with the throttler.
- **S3 upload mechanics.** The contract commits to multipart-through-the-API. Whether a presigned-URL flow replaces it is an implementation decision with contract consequences, and would be a breaking change.
- **The `low_stock_events.resolved_at` policy** and the **reset-token invalidation policy**. Both open per `README.md` §9, and neither has any contract surface.
- **The stale-pending sweep.** Required by `README.md` §8 for the Reserve/Release cycle to be complete, but it is a scheduled job with no endpoint.
- **Whether Spectral lands as a `devDependency`.** Still open in `decisions.md`; this plan runs it via `npx` either way.
