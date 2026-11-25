# payload-showcase

**Kiln & Co.** is a fictional ceramics studio by the sea. It sells seats in pottery workshops and
studio memberships, and members get an account area. The site is a working demo of the
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
prompt or fail, delete `kiln.db` and run `pnpm seed`.

## Seeded logins (development only)

| Role   | Email             | Password      |
| ------ | ----------------- | ------------- |
| Admin  | `admin@kiln.test` | `kiln-admin`  |
| Member | `mara@kiln.test`  | `kiln-member` |
| Member | `jonas@kiln.test` | `kiln-member` |

Mara has an active membership and two bookings; Jonas has one. `pnpm seed` refuses to run when
`NODE_ENV=production`.

## How each plugin is showcased

| Plugin                                                                               | On the site                                                                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`@xtr-dev/payload-billing`](https://github.com/xtr-dev/payload-billing)             | Checkout for workshop bookings and memberships (local test provider by default, Stripe/Mollie via env), payments, invoices and refunds. |
| [`@xtr-dev/payload-mailing`](https://github.com/xtr-dev/payload-mailing)             | Booking confirmation, reminder and welcome emails from templates, and a scheduled newsletter. Mail is captured and shown on `/mailbox`. |
| [`@xtr-dev/payload-notifications`](https://github.com/xtr-dev/payload-notifications) | An in-app inbox in the account area, studio-news channels and optional web push.                                                        |
| [`@xtr-dev/payload-feature-flags`](https://github.com/xtr-dev/payload-feature-flags) | An A/B test on the homepage hero, gated gift cards and a rollout of the new booking flow.                                               |
| [`@xtr-dev/payload-automation`](https://github.com/xtr-dev/payload-automation)       | Workflows such as "booking paid → confirmation email + notification", plus a webhook-triggered workflow.                                |

The `/showcase` page explains each one. The plugins are being wired in one at a time; until then
their spots show a placeholder.

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
