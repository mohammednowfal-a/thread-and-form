# Deployment (Render)

`render.yaml` defines: a PostgreSQL database, the **web** service, and a **worker** service (durable job processing). Review plans and regions first.

1. Push this repo to GitHub/GitLab. In Render: **New → Blueprint**, pick the repo. Fill the `sync: false` variables (`APP_URL`, WhatsApp, email, AI).
   `SESSION_SECRET` and `JOBS_SECRET` are generated for the web service; **copy `SESSION_SECRET` to the worker too**.
2. The web service start command runs `npx prisma migrate deploy` (applies pending versioned migrations only; it never resets or drops anything) and then starts Next.js.
3. Create the first owner **once** (Render shell on the web service):
   ```bash
   BOOTSTRAP_OWNER_PASSWORD='choose-a-long-password' npm run bootstrap:owner -- \
     --email you@yourbrand.com --name "Your Name" --tenant-slug thread-and-form --tenant-name "THREAD & FORM"
   ```
   It refuses to run if the tenant already has an owner. There is no default admin account. Then add catalogue data through Admin → Products
   (or run the demo seed in a **staging** environment only: `ALLOW_DEMO_SEED=true npm run db:seed:demo`; the seed is blocked in production otherwise).
4. Configure WhatsApp (see `WHATSAPP_SETUP.md`), set the webhook URL, and place a real test order.
5. Health check: `GET /api/health` (checks the database).

## Verify the migrations match the Prisma schema (recommended before first deploy)
The SQL in `prisma/migrations/` was generated from `schema.prisma` by a script because the build sandbox could not download Prisma's schema engine. Confirm there is no drift:
```bash
createdb threadform_shadow
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://USER:PASS@HOST:5432/threadform_shadow" --exit-code
```
Exit code `0` means identical. If it prints differences, create a follow-up migration with `npx prisma migrate dev --name fix_drift` locally and commit it. Never edit an already-applied migration in production.

## Backups and recovery
* Enable Render's automated Postgres backups (paid plans) and/or run `pg_dump -Fc "$DATABASE_URL" > backup-$(date +%F).dump` on a schedule to storage outside Render.
* Restore into a **new** database: `pg_restore --no-owner -d "$NEW_DATABASE_URL" backup.dump`, point `DATABASE_URL` at it, redeploy.
* Test a restore before you need one. Orders, inventory, and the job outbox are all in this one database, so one backup captures everything.
* Rotate secrets by changing the env var and redeploying both services. Rotating `SESSION_SECRET` signs every user out.

## Operational notes
* Worker down? New orders still save; WhatsApp requests wait in the `Job` table and go out when the worker returns. Alternatively call `POST /api/jobs/run` from a scheduler with `Authorization: Bearer $JOBS_SECRET`.
* Dead jobs and failed webhook events are listed in Admin → WhatsApp with a safe Replay button.
* Never run `prisma migrate reset` or `prisma db push --force-reset` against production.
