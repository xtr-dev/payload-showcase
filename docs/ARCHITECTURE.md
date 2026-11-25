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
  lib/                       payload client, auth, formatting, flags.ts, checkout.ts
  styles/tokens.css          design tokens (single source of truth)
  components/ui/             Button, Card, Badge, Field, Alert, Container, SectionHeading, MediaImage
  components/{layout,workshops,booking,membership,auth}/
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
- Globals: **home**, **site-settings**.

There are no migrations. The schema is pushed in development/test (`pnpm seed`, `pnpm dev`, Vitest).
E2E and CI seed the database in development mode first, then run `next start` against it.

## Per-plugin extension points

Each plugin has its own files, so the five phase-2 integrations can be built in parallel without
editing the same file. **Only edit the files for your plugin.** If you need a change in a shared
file, keep it minimal and mention it in your PR.

| Plugin        | Config                         | Seed                        | Tests                                                            | Showcase                                           | Site touchpoints (owned)                                                                                                 |
| ------------- | ------------------------------ | --------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| billing       | `src/plugins/billing.ts`       | `src/seed/billing.ts`       | `tests/int/billing.int.spec.ts`, `tests/e2e/billing.e2e.spec.ts` | `src/app/(frontend)/showcase/sections/Billing.tsx` | `src/lib/checkout.ts`                                                                                                    |
| mailing       | `src/plugins/mailing.ts`       | `src/seed/mailing.ts`       | `tests/{int,e2e}/mailing.*`                                      | `…/sections/Mailing.tsx`                           | `src/app/(frontend)/account/sections/settings/Newsletter.tsx`                                                            |
| notifications | `src/plugins/notifications.ts` | `src/seed/notifications.ts` | `tests/{int,e2e}/notifications.*`                                | `…/sections/Notifications.tsx`                     | `account/sections/Notifications.tsx`, `account/sections/settings/Push.tsx`, `src/components/layout/NotificationBell.tsx` |
| feature-flags | `src/plugins/featureFlags.ts`  | `src/seed/featureFlags.ts`  | `tests/{int,e2e}/featureFlags.*`                                 | `…/sections/FeatureFlags.tsx`                      | `src/lib/flags.ts`, `src/components/booking/BookingFlowV2.tsx`                                                           |
| automation    | `src/plugins/automation.ts`    | `src/seed/automation.ts`    | `tests/{int,e2e}/automation.*`                                   | `…/sections/Automation.tsx`                        | (workflows live in the seed)                                                                                             |

### Conventions

- **Config.** `src/plugins/<plugin>.ts` exports a `Plugin[]`. `src/plugins/index.ts` spreads them
  in this order: billing, mailing, notifications, featureFlags, automation (automation is last so
  its triggers can target the others' collections). Don't edit `payload.config.ts`. Anything that
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
  them; keep their signatures.
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
  pending booking → `beginBookingCheckout()` → redirect (today `/account?booked=…`).
- Membership: `/membership/join/[plan]` → `joinMembership` → `beginMembershipCheckout()`.
- Every frontend route is dynamic (`force-dynamic` in the layout).

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
