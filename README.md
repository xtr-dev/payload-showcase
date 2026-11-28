# payload-showcase

**Kiln & Co.** is a fictional ceramics studio by the sea. It sells seats in pottery workshops,
studio memberships and, in its shop, the pots themselves. Members get an account area. The site is a working demo of the
[xtr-dev](https://github.com/xtr-dev) plugins for [Payload CMS](https://payloadcms.com): each plugin
powers a real feature instead of a toy example.

Stack: Payload 3 · Next.js 16 (App Router) · SQLite · Lexical · Tailwind CSS v4 · Vitest · Playwright.

## Quick start

Requires Node `^22.23.5 || >=24.22.3` (see `.nvmrc`) and pnpm 11.

```sh
pnpm install
cp .env.example .env    # then set PAYLOAD_SECRET
pnpm dev                # http://localhost:3000, admin at /admin
```

On the first `pnpm dev`, the empty SQLite database (`kiln.db`) is seeded automatically. Run
`pnpm seed` at any time to reset it to the demo data. If a schema change makes the dev database
prompt or fail, delete `kiln.db*` (the database and its write-ahead log, `kiln.db-wal` and
`kiln.db-shm`) and run `pnpm seed`.

## Seeded logins (development only)

| Role   | Email             | Password      |
| ------ | ----------------- | ------------- |
| Admin  | `admin@kiln.test` | `kiln-admin`  |
| Member | `mara@kiln.test`  | `kiln-member` |
| Member | `jonas@kiln.test` | `kiln-member` |

Mara has an active membership and two bookings; Jonas has one. `pnpm seed` refuses to run when
`NODE_ENV=production`.

The shop needs no login: guests can check out too. Discount codes to try: `WELCOME10` (10% off),
`FREESHIP` (free shipping) and `STUDIO5` (€5 off from €40, once per signed-in member).

## How each plugin is showcased

| Plugin                                                                               | On the site                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@xtr-dev/payload-billing`](https://github.com/xtr-dev/payload-billing)             | Checkout for workshop bookings, memberships and shop orders (local test provider by default, Stripe/Mollie via env), payments, invoices and refunds.                                                                                                                                                                                                                                                       |
| [`@xtr-dev/payload-mailing`](https://github.com/xtr-dev/payload-mailing)             | Booking and shop order confirmations, a "your order has shipped" email for members and guests, reminder and welcome emails from templates, and a scheduled newsletter. Mail is captured and shown on `/mailbox`.                                                                                                                                                                                           |
| [`@xtr-dev/payload-notifications`](https://github.com/xtr-dev/payload-notifications) | An in-app inbox in the account area (bookings, shipped orders, studio news), channels members can opt out of and optional web push.                                                                                                                                                                                                                                                                        |
| [`@xtr-dev/payload-feature-flags`](https://github.com/xtr-dev/payload-feature-flags) | An A/B test on the homepage hero, gated gift cards and shop, a promo banner and a rollout of the new booking flow.                                                                                                                                                                                                                                                                                         |
| [`@xtr-dev/payload-automation`](https://github.com/xtr-dev/payload-automation)       | Code-defined workflows: booking paid → studio log + aftercare follow-up, a kiln-alert webhook that pages the technician (with retries) and broadcasts studio news, opening-hours changes, an admin-run digest, a scheduled 07:00 morning report, a low-stock warning when a shop order is paid and a custom step that releases unpaid orders every minute, with a run history that skips the idle minutes. |
| [`@xtr-dev/payload-ecommerce`](https://github.com/xtr-dev/payload-ecommerce)         | The studio shop at `/shop`: products with glazes and stock, categories, a cart for guests and members, discount codes, checkout and orders.                                                                                                                                                                                                                                                                |

The `/showcase` page explains each one.

## Scripts

| Command                                           | What it does                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm dev` / `pnpm build` / `pnpm start`          | Next.js dev server, production build, production server                                                |
| `pnpm seed`                                       | Reset the database to the demo data                                                                    |
| `pnpm lint` / `pnpm typecheck`                    | ESLint / `tsc --noEmit`                                                                                |
| `pnpm test:int`                                   | Vitest integration tests: boots Payload through the Local API on a temporary SQLite file per test file |
| `pnpm test:e2e`                                   | Playwright against a production build on a freshly seeded database in `.e2e/` (port 3100)              |
| `pnpm test`                                       | Both test suites                                                                                       |
| `pnpm generate:types` / `pnpm generate:importmap` | Regenerate `src/payload-types.ts` / the admin import map                                               |
| `pnpm generate:vapid`                             | Print a VAPID key pair for optional web push (paste into `.env`)                                       |

The first `pnpm test:e2e` builds the app; set `E2E_SKIP_BUILD=1` to reuse an existing build.
Run `pnpm exec playwright install chromium` once beforehand.

## Contributing

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the layout, the design system and the
per-plugin conventions. PR titles follow Conventional Commits.

## License

MIT
