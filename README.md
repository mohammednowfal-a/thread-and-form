# THREAD & FORM

A premium fashion storefront **and** a multi-tenant operations platform for Cash on Delivery (COD) businesses, with an AI-assisted WhatsApp assistant that confirms COD orders.

**Journey:** browse → pick size/colour → cart → COD checkout → WhatsApp confirmation request → customer taps *Confirm* or *Cancel* → the right order is updated → staff fulfil it in the admin.

Stack: Next.js 15 (App Router) · TypeScript (strict) · React 19 · Tailwind CSS · PostgreSQL · Prisma 6 · Zod · Vitest · Playwright.

## What is verified, and what is not

| Area | Status |
|---|---|
| Production build, type-check, lint | Run and passing (see `docs/` and the final report) |
| 148 automated tests (unit + PostgreSQL-backed integration + server-action journeys) | Run and passing |
| Oversell protection under concurrency, idempotency, state machine, tenant isolation, role enforcement | Covered by tests that run against a real PostgreSQL |
| WhatsApp, webhook signature, confirm/cancel, retries, dedupe, opt-out | Tested with a **mocked** Meta API and signed fake webhooks |
| **Live** WhatsApp send/receive, Shiprocket, Delhivery, Shopify, email, AI provider | **Not tested** (needs your credentials). Reported as "Not connected" until configured |
| Real-browser tests and mobile/desktop visual checks | **Not run** (Playwright specs included in `tests/e2e`); run them yourself |
| Deployment | **Not deployed.** `render.yaml` and a guide are included |

Details and limitations: [`docs/SECURITY_AND_LIMITATIONS.md`](docs/SECURITY_AND_LIMITATIONS.md).

## Run it locally

Prerequisites: Node 20.11+ (22 recommended), PostgreSQL 14+.

```bash
cp .env.example .env            # then edit: DATABASE_URL, SESSION_SECRET (openssl rand -hex 32), JOBS_SECRET
createdb threadform
npm ci
npx prisma migrate deploy       # applies the versioned SQL migrations
npm run db:seed:demo            # DEMO data only: 12 products + a demo owner (password printed once, or set DEMO_OWNER_PASSWORD)
npm run dev                     # http://localhost:3000   (admin: /admin/login)
npm run worker                  # in a second terminal: sends queued WhatsApp/email jobs, retries, expires unconfirmed orders
```

Without WhatsApp credentials the app still works: new COD orders are flagged **manual review** (call the customer), and the admin says "Not connected".
To test the WhatsApp flow locally see [`docs/WHATSAPP_SETUP.md`](docs/WHATSAPP_SETUP.md) (includes a signed webhook simulator).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Develop / production build / run production build |
| `npm run typecheck` / `lint` | `tsc --noEmit` / ESLint (zero warnings allowed) |
| `npm test` | All unit + integration tests (uses a throwaway DB `threadform_test`, see below) |
| `npm run test:unit` / `test:integration` | Subsets |
| `npm run test:e2e` | Playwright (needs `npx playwright install chromium` and a seeded DB) |
| `npm run db:migrate:deploy` | Apply migrations (safe, non-destructive) |
| `npm run db:seed:demo` | Demo data (refuses in production unless `ALLOW_DEMO_SEED=true`) |
| `npm run bootstrap:owner -- --email …` | Create the first owner of a tenant (production-safe, one-time) |
| `npm run worker` | Background job worker |

**Tests need PostgreSQL.** They default to `postgresql://tf:tf_dev_pw@localhost:5432/threadform_test`; override with `TEST_DATABASE_URL`. The test run **drops and recreates the `public` schema of that database**, so never point it at real data.

## Structure

```
prisma/            schema.prisma, versioned migrations, demo seed + catalog.json
scripts/           bootstrap-owner, generate-assets (SVG product art), simulate-whatsapp
src/lib/           business logic: orders, inventory, money, jobs (outbox), auth, permissions, cart, catalog
src/lib/whatsapp/  client, signature, parser, intent classifier, chatbot, webhook processing
src/lib/integrations/  email, shipping (manual/Shiprocket/Delhivery), Shopify
src/app/(shop)/    storefront pages + server actions
src/app/admin/     operations console + server actions (every action checks permissions server-side)
src/app/api/       webhooks (WhatsApp, shipping), jobs trigger, health
src/worker/        long-running worker
tests/             unit, integration (real DB), e2e (Playwright)
docs/              ORDER_STATES, WHATSAPP_SETUP, DEPLOYMENT, SECURITY_AND_LIMITATIONS
```

## Key design decisions
* **Money** is integer paise end to end. **The server prices every order**; browser totals are ignored.
* **Inventory** is reserved at order placement with an atomic conditional update, released on cancel/expiry, consumed on shipment; DB CHECK constraints are a safety net (`docs/ORDER_STATES.md`).
* **Outbox**: the order and its WhatsApp job commit in one transaction; the worker retries with backoff; dead jobs and failed webhook events are replayable from the admin.
* **Confirmation ≠ delivery**: order status, customer-confirmation status and message-delivery status are three separate fields.
* **Multi-tenant**: all tenant data is scoped by `tenantId`, derived from verified membership; tenant-scoped unique keys.
* **Roles**: Owner, Administrator, Operations manager, Fulfilment, Support, Analyst (`src/lib/permissions.ts`).

## Environment variables
See `.env.example` for every variable with comments. Required: `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `STOREFRONT_TENANT_SLUG`, `JOBS_SECRET`.
Optional integrations (WhatsApp, email, shipping, Shopify, AI) default to "Not connected".

## Deployment
See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and `render.yaml` (web + worker + PostgreSQL), including production owner bootstrap and backup/recovery.
