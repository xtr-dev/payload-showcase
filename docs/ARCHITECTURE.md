# Architecture

## Layout

```
src/
  payload.config.ts          collections, globals, plugins, onInit (auto-seed)
  access/                    shared access helpers (isAdmin, adminOrSelf, publishedOrAdmin, ...)
  collections/               Users, Media, Workshops, Sessions, Bookings, MembershipPlans
  globals/                   Home (homepage content, incl. hero variant B), SiteSettings
  plugins/                   one file per xtr-dev plugin, see below
  seed/                      core.ts (site data), <plugin>.ts, data.ts (logins, content), art.ts (SVG art)
  lib/                       payload client, auth, formatting, flags.ts, checkout.ts, shop.ts
  styles/tokens.css          design tokens (single source of truth)
  components/ui/             Button, Card, Badge, Field, Alert, Container, SectionHeading, MediaImage
  components/{layout,workshops,booking,membership,auth,shop}/
  app/(frontend)/            the public site and account area
  app/(payload)/             Payload admin and API (generated; don't edit)
tests/
  helpers/                   payload.ts (Local API on temp SQLite), e2e.ts (sign-in helpers)
  int/*.int.spec.ts          Vitest
  e2e/*.e2e.spec.ts          Playwright
```

## Data model

- **users**: auth. `role` is `admin` or `member`; only admins can set it, so self-registration
  always yields a member. Membership fields (`membershipPlan`, `membershipStatus`,
  `membershipRenewsAt`) are admin/server-only. Only admins can open `/admin`.
- **workshops**: drafts enabled. The public reads published ones only. `price` is in cents (EUR).
- **sessions**: a workshop plus `startsAt`; `seatsLeft` defaults to the workshop capacity. The
  public can read sessions of published workshops.
- **bookings**: `member`, `session`, `workshop` (copied), `status`
  (`pending | paid | cancelled | refunded`), `amount` (cents, copied from the workshop),
  `currency`, `reference` (`KC-…`). Members create bookings for themselves only; hooks force the
  member, price and `pending` status, block full, past and duplicate bookings, and keep
  `seatsLeft` in sync (pending/paid hold a seat). Members read only their own; updates are
  admin-only, so plugins change status with `overrideAccess` (the default for the Local API).
- **membership-plans**: public read.
- **products**, **categories**, **carts**, **coupons**, **orders**: added by payload-ecommerce (see
  "Shop" below). Amounts are integer cents including 21% VAT, like everywhere else on the site.
- Globals: **home**, **site-settings**.

There are no migrations. The schema is pushed in development/test (`pnpm seed`, `pnpm dev`, Vitest).
E2E and CI seed the database in development mode first, then run `next start` against it.

## Per-plugin extension points

Each plugin has its own files, so the five phase-2 integrations can be built in parallel without
editing the same file. **Only edit the files for your plugin.** If you need a change in a shared
file, keep it minimal and mention it in your PR.

| Plugin        | Config                         | Seed                        | Tests                                                            | Showcase                                           | Site touchpoints (owned)                                                                                                 |
| ------------- | ------------------------------ | --------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| billing       | `src/plugins/billing.ts`       | `src/seed/billing.ts`       | `tests/int/billing.int.spec.ts`, `tests/e2e/billing.e2e.spec.ts` | `src/app/(frontend)/showcase/sections/Billing.tsx` | `src/lib/checkout.ts`, `src/components/billing/*`, `checkout/return`, `account/invoices`, `account/sections/Billing.tsx` |
| mailing       | `src/plugins/mailing.ts`       | `src/seed/mailing.ts`       | `tests/{int,e2e}/mailing.*`                                      | `…/sections/Mailing.tsx`                           | `src/app/(frontend)/account/sections/settings/Newsletter.tsx`                                                            |
| notifications | `src/plugins/notifications.ts` | `src/seed/notifications.ts` | `tests/{int,e2e}/notifications.*`                                | `…/sections/Notifications.tsx`                     | `account/sections/Notifications.tsx`, `account/sections/settings/Push.tsx`, `src/components/layout/NotificationBell.tsx` |
| feature-flags | `src/plugins/featureFlags.ts`  | `src/seed/featureFlags.ts`  | `tests/{int,e2e}/featureFlags.*`                                 | `…/sections/FeatureFlags.tsx`                      | `src/lib/flags.ts`, `src/components/booking/BookingFlowV2.tsx`                                                           |
| automation    | `src/plugins/automation.ts`    | `src/seed/automation.ts`    | `tests/{int,e2e}/automation.*`                                   | `…/sections/Automation.tsx`                        | (workflows live in the seed)                                                                                             |
| ecommerce     | `src/plugins/ecommerce.ts`     | `src/seed/ecommerce.ts`     | `tests/{int,e2e}/ecommerce.*`                                    | `…/sections/Ecommerce.tsx`                         | `src/lib/shop.ts`, `src/components/shop/*`, `src/app/(frontend)/shop/*`, `account/sections/Orders.tsx`                   |

### Conventions

- **Config.** `src/plugins/<plugin>.ts` exports a `Plugin[]`. `src/plugins/index.ts` spreads them
  in this order: billing, mailing, notifications, featureFlags, ecommerce, automation (automation is
  last so its triggers can target the others' collections; ecommerce comes after the plugins whose
  collections it adds an `order` relationship to). Don't edit `payload.config.ts`. Anything that
  isn't a collection (an email adapter, `jobs`, endpoints) can be set from a plugin, which is just
  `(config) => config`. When adding to `config.jobs`, merge rather than overwrite, since mailing and
  automation may both need jobs.
- **Site collections.** Don't edit `src/collections/*`. Add fields or hooks from your plugin file
  with `addFields(slug, fields)` / `extendCollection(slug, fn)` from `src/plugins/utils.ts`, e.g.
  billing adds a `payment` relationship to `bookings`.
- **Env.** Read your env vars in your plugin file, with safe defaults so the app, tests and CI run
  with none set (local test provider, captured mail, no push). Document them in `.env.example`.
- **Stable seams.** `src/lib/flags.ts` (`isEnabled`, `getVariant`) and `src/lib/checkout.ts`
  (`beginBookingCheckout`, `beginMembershipCheckout`) are already called by the pages. Implement
  them; keep their signatures. The shop's equivalent is `src/lib/shop.ts`.
- **Seed.** `seed<Plugin>(payload, ctx, { reset })` runs after the core seed and gets the seeded
  users, workshops, sessions, bookings and plans in `ctx`. It must work on an empty database and
  clear its own collections when `reset` is true.
- **Showcase.** Replace the `PluginPlaceholder` in your section with a live demo and set
  `status="live"`. Keep the `ShowcaseSection` frame.
- **Tests.** Replace the `it.todo` / `test.fixme` stubs. Integration tests use `getTestPayload()`
  and `seed()`; e2e tests run against the seeded production build (use `tests/helpers/e2e.ts`).
  CI must stay green with no secrets.
- **Generated files.** `src/payload-types.ts` and `src/app/(payload)/admin/importMap.js` will
  conflict between branches. Resolve by taking either side and rerunning `pnpm generate:types`
  and `pnpm generate:importmap`. Resolve `pnpm-lock.yaml` conflicts with `pnpm install`.

## Frontend

- Server components fetch through `getPayloadClient()` with `overrideAccess: false` (and `user`
  where relevant), so pages obey the same access rules as the REST API.
- `getCurrentUser()` / `requireUser(returnTo)` in `src/lib/auth.ts` read the `payload-token`
  cookie. Login, registration and logout use Payload's REST endpoints from client forms.
- Booking: `/workshops/[slug]` → `/book/[sessionId]` → `reserveSeat` server action creates a
  pending booking → `beginBookingCheckout()` → redirect to the payment page.
- Membership: `/membership/join/[plan]` → `joinMembership` → `beginMembershipCheckout()`.
- Checkout (billing): `beginBookingCheckout()` / `beginMembershipCheckout()` create an open
  invoice and a payment, then redirect to the provider (the test provider by default). The
  provider returns the visitor to `/checkout/return?t={returnToken}`; a payments `afterChange`
  hook marks the booking paid (or activates the membership) and, on a full refund, refunded.
- Every frontend route is dynamic (`force-dynamic` in the layout).

## Shop

The shop is @xtr-dev/payload-ecommerce plus `src/lib/shop.ts`, which holds everything the
storefront does. Its server actions (`src/components/shop/actions.ts`) and pages are thin.

- **Flags.** `shop` gates every route under `/shop` and the nav link (404 while off).
  `shop-free-shipping-banner` shows the promo banner on `/shop`.
- **Catalogue.** `/shop` and `/shop/[slug]` read products with `overrideAccess: false`, so only
  `active` ones appear. Stock badges come from the plugin's `checkInventory`; a variant (glaze) with
  its own `inventory` is counted on its own.
- **Cart.** The plugin's helpers bypass access control, because a guest cart belongs to nobody the
  API can identify. So the cart is always the one stored under the visitor's httpOnly `kiln_vid`
  cookie (set by `src/proxy.ts`): no action or page accepts a cart id. Product ids from the browser
  are read with the public access rule, quantities are whole numbers from 1 to 10 per line, and
  prices and totals are always worked out on the server.
- **Totals.** Prices include VAT, so no `calculateTax` hook is set and an order's `tax` is 0; pages
  show "incl. 21% VAT". Shipping is the site's: €6.95, free from €75 (`shippingFor`). A coupon code
  is previewed with the plugin's `validateCoupon` (`quoteCart`) and applied by the plugin when the
  order is created. A once-per-customer code is only accepted from a signed-in member.
- **Checkout.** `/shop/checkout` → `placeOrder`: validates the address (and a guest's email), sets
  the cart's `user` to the signed-in member or nobody, and calls `createOrderFromCart`, which
  prices the lines, applies the coupon and takes the stock. `beginOrderCheckout` then creates an
  open invoice and a payment with an `order` relationship and sends the visitor to the provider.
  Invoice lines cannot be negative, so a discounted order is invoiced as one goods line.
- **Payment sync.** `syncOrder` (a payments `afterChange` hook in `src/plugins/ecommerce.ts`) maps
  the payment to the order: succeeded → `processing` / `paid`; failed or cancelled → `cancelled`;
  fully refunded → `refunded`. The plugin restocks and gives the coupon use back on cancel and
  refund. Admins refund from the order's sidebar (`POST /api/orders/:id/refund`).
- **Order page.** `/shop/orders/[orderNumber]` is where the provider returns the customer. It is
  shown to the holder of the order's token (`?t=`, an HMAC of the order number under the Payload
  secret; this is how a guest gets back to their order, and the link in the confirmation email
  carries it), to the signed-in member who placed the order and to admins. Everyone else gets a 404. Orders are never readable by number or id alone, and guest orders not through the API at all.
- **Tie-ins.** An orders `afterChange` hook sends the `order-confirmation` email when an order
  becomes paid. When it ships, the hook sends the `order-shipped` email (to the order's
  `customerEmail`, so guests get it too) and notifies the member on the `orders` channel. Each goes
  out once per order.
  Two workflows in `src/seed/automation.ts` use the shop: "Shop order paid" (studio log, low-stock
  warning to the admin) and "Release unpaid orders" (every 15 minutes, a custom step that cancels
  orders left unpaid for 30 minutes so their stock goes back on sale).

## Design system

- Tokens live in `src/styles/tokens.css` (Tailwind v4 `@theme`): surfaces `paper`, `bisque`,
  `sand`, `line`; text `ink`, `ink-soft`; brand `clay` (terracotta, primary), `glaze` (celadon,
  secondary), `ochre` (decorative only), `cobalt` (focus); status colours; `rounded-card`,
  `rounded-pill`, `shadow-card`, `shadow-lift`. Contrast ratios are noted in the file.
- Type: Fraunces (display, `font-display`) with Instrument Sans (body, `font-sans`), via next/font.
- Motifs: kiln-door arch image frames (`.arch`), the ochre hand-drawn underline (`.squiggle`),
  paper grain (`.grain`), wavy footer edge.
- Use the components in `src/components/ui` rather than restyling. Every interactive element gets
  the global `:focus-visible` ring; use semantic landmarks (`Card as="section"` with a heading).
