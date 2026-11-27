# Deploy Messaging Desk to Render Free and Neon

This setup runs the Next.js app on a Render Free web service and stores contacts, groups, templates, consent and message history in Neon PostgreSQL. It uses the existing React, TypeScript, Prisma 6 and Meta WhatsApp Cloud API stack. No Cloudflare tunnel or Windows PostgreSQL server is needed for the hosted app.

The deployment files are prepared locally. Following the steps below creates the actual cloud resources. A new Neon database starts empty; the deployment applies the schema but does not copy this computer's existing customer records.

## 1. Create the Neon database

1. Sign in at [Neon Console](https://console.neon.tech/), create a project named `magnet-ba-manager`, and choose the **Free** plan.
2. Use PostgreSQL **17** if offered, matching the local PostgreSQL major version. Choose an AWS region close to your Render service; the supplied Render Blueprint uses **Singapore**. If your Neon region differs, consider changing the Blueprint region before creating the Render service.
3. Open **Connect** for the database branch you want to use for testing. Copy both connection strings privately:
   - With **connection pooling enabled**, save the string for `DATABASE_URL`. Its host contains `-pooler`.
   - With **connection pooling disabled**, save the string for `DATABASE_URL_UNPOOLED`. It connects directly and is used for migrations.
4. Preserve the provided credentials and TLS parameters, including `sslmode=require`. Use both strings from the same branch, database and role. Copy only the URL, without a surrounding `psql` command or quotation marks.

These strings contain database passwords. Enter them in Render's private environment settings, never in source files, screenshots, tickets or chat. The app remains on Prisma 6; you do not need to upgrade to Prisma 7 or install the Neon driver adapter for this deployment.

## 2. Push the deployment files to GitHub

The current local Git remote is `https://github.com/mbigbazar26/Magnet_BA_Manager.git`. In VS Code, review the changes, commit them, then push to the branch you will deploy. Verify that `render.yaml`, `DEPLOY_RENDER_NEON.md`, `scripts/cloud.mjs` and `app/api/health/route.ts` appear on GitHub.

Do not include `.env`, `.local`, backups, `node_modules` or `.next` in the commit. The repository's `.gitignore` already excludes these. Publishing this repository does not transfer local database contents.

## 3. Create the Render service with the Blueprint

1. Sign in at [Render Dashboard](https://dashboard.render.com/).
2. Choose **New > Blueprint**, connect your GitHub account and select the repository and branch containing these changes. The `render.yaml` file is at the repository root. If your GitHub repository keeps the app in a subfolder, set the Blueprint path and service root directory to that app folder first.
3. Review the proposed service: `magnet-ba-manager`, **Node**, **Free**, **Singapore**. The Blueprint creates no Render database; Neon provides PostgreSQL separately.
4. Enter the private values when prompted:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string |
| `OPERATOR_PASSWORD` | A unique password of at least 12 characters; save it in your password manager |
| `META_ACCESS_TOKEN` | Your System User token with access to the intended WhatsApp account |
| `META_APP_SECRET` | The app secret from your Meta app's basic settings |

The Blueprint generates `SESSION_SECRET` and `META_VERIFY_TOKEN` privately and sets the following non-secret values:

| Variable | Default |
| --- | --- |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `LOCAL_POSTGRES` | `0` |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `META_GRAPH_VERSION` | `v25.0` |
| `META_PHONE_NUMBER_ID` | `1524500964085667` |
| `META_ACCOUNT_ID` | `1007794105719686` |

Confirm that the Meta IDs still match the business account and sender you want to use. `META_ACCOUNT_ID` is the WhatsApp Business Account / Messaging Account ID, not your Business Portfolio ID. Secrets entered with `sync: false` are prompted on the initial Blueprint creation; update them in the service's **Environment** settings afterward.

5. Create the service and watch the deployment logs. The build runs `npm ci --include=dev && npm run build`. Startup runs `npm run start:cloud`, validates configuration, applies existing Prisma migrations through the direct Neon connection, then starts Next.js on `0.0.0.0` using Render's `PORT`.
6. If migrations fail, the server does not start. Fix the connection or migration issue before retrying. Startup uses `prisma migrate deploy`, not `db push` or a database reset. Review future migration SQL before deploying it to a database with customer data.

The migration runs during startup so this flow does not depend on a paid pre-deploy command or Render shell access. Render supplies `RENDER_EXTERNAL_URL` automatically for HTTPS login redirects and secure session cookies. If you add a custom domain later, set `APP_ORIGIN` to its exact HTTPS origin, for example `https://desk.example.com`, and redeploy.

### Manual web service alternative

If you prefer **New > Web Service**, choose the same repository and configure:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Instance type | Free |
| Region | Singapore, or the closest available region to your Neon database |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm run start:cloud` |
| Health check path | `/api/health` |

Add every environment variable listed above yourself, including random `SESSION_SECRET` of at least 32 characters and `META_VERIFY_TOKEN`. Choose the Free instance explicitly; the dashboard may initially suggest a paid one.

## 4. Check the hosted desk

1. Open the actual HTTPS URL shown by Render, such as `https://<assigned-service-name>.onrender.com`. The final assigned name may differ from the example.
2. Sign in with the `OPERATOR_PASSWORD` you entered in Render. The hosted login does not use this computer's `.local/operator-password.txt`.
3. Open **Setup > Check connection**, then **Templates > Sync from Meta**. These actions do not send messages. Loading the desk also checks whether it can read its Neon tables.
4. Create one test contact with your own WhatsApp number and genuine opt-in. Send one approved template intentionally, then check the incoming reply after connecting the webhook below. Meta messaging charges remain separate from hosting.

`/api/health` returns `{"ok":true}` when the web server responds. It intentionally does not query Neon, so frequent platform health probes do not keep the free database awake. It is a liveness check, not confirmation of Meta access, database readiness or message delivery.

## 5. Switch Meta to the hosted webhook

1. Open the Render service's **Environment** settings and privately copy the generated `META_VERIFY_TOKEN`. This token belongs to the hosted app and can differ from the local verify token.
2. In the Meta developer app's WhatsApp webhook settings, enter:
   - **Callback URL:** `https://<your-actual-render-host>/api/webhook`
   - **Verify token:** the exact hosted `META_VERIFY_TOKEN` value.
3. Open the hosted desk first and wait for it to finish waking up. Then select **Verify and save** in Meta.
4. Subscribe to the **messages** webhook field and ensure this app is subscribed to the intended WhatsApp Business Account. Publishing the Meta app alone does not subscribe it to these events.
5. Reply to a test message from your phone. Check the hosted **Messages** view and Render logs. Delivery updates use the same subscription. The app verifies webhook signatures using `META_APP_SECRET`; keep it paired with the correct Meta app and token.

After this switch, events sent to that callback reach the hosted app's Neon database. They do not automatically appear in the separate local database. The local relay on port 3001 and the temporary Cloudflare URL are unnecessary for this hosted callback.

## 6. Existing data and backups

For initial tests, start with an empty Neon database and sync templates from Meta. Contacts, consent records and old message history are not reconstructed by template sync.

To move existing customer data later, first back up the current local database, pause local writes, then plan a PostgreSQL export/import or a verified data copy into the chosen Neon database. Use a separate Neon branch or database for a migration rehearsal and compare row counts, consent flags and message IDs before changing the live webhook. Do not restore a full local dump over an already-populated cloud database without reconciling both sets of records. The existing `scripts/migrate-utf8.mjs` handles the earlier local encoding conversion; it is not a Neon migration tool.

Keep the local backup private and retain it until the hosted data has been verified. Neon retention and restore features depend on its current plan; verify those settings before relying on cloud backups.

## Testing limits and the later production step

- Render Free sleeps after 15 minutes without inbound traffic and can take about a minute to wake. A webhook request during wake-up can time out or be delayed; webhook verification is easier while the desk is awake. Free hosting is for this testing stage.
- Render's filesystem is temporary. The app stores its records in Neon and uploads template images to Meta; do not put customer records, backups or secrets in the service's local filesystem.
- Free plans have usage limits. Review Render's included hours, bandwidth and build usage, and Neon's storage and compute usage in their dashboards. Hosting may fit the free allowances, but WhatsApp API messaging is billed separately by Meta.
- The current group send loops through recipients inside a web request. For daily campaigns to 1,000-2,000 customers, add durable campaign jobs, controlled sending, recoverable progress and retry handling before using that volume. A sleeping free web service cannot act as a dependable background worker.
- This version uses one shared operator password. Use a strong unique password for testing. Multiple staff accounts and login abuse controls are further work before a wider production rollout.

The upgrade path keeps Next.js, Prisma and PostgreSQL: move the Render service to always-on compute, add a durable sending queue and worker, then increase Neon capacity as needed. You do not need to rewrite the app to take those steps.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Build cannot find Next.js, TypeScript or Prisma | Use the exact build command with `npm ci --include=dev`; confirm `package-lock.json` is committed. |
| `Missing cloud environment variables` | Add the named variables in Render Environment and redeploy. No secret values should appear in this error. |
| Migration cannot connect | Confirm direct and pooled URLs belong to the same branch, preserve TLS settings, and check that Neon is active and within plan limits. |
| Migration lock or timeout | Confirm `DATABASE_URL_UNPOOLED` is the direct connection, and check for another deployment applying migrations. Do not delete migration records to work around it. |
| Login redirects to localhost or gives Forbidden | Use the HTTPS Render URL; check `APP_ORIGIN` if set. It must match the URL you use to sign in. |
| Desk is empty | A new Neon database is empty. Sync templates and add test contacts; migrate old customer data separately. |
| Webhook verification fails | Wake the hosted desk, verify the exact `/api/webhook` URL and the hosted verify token, then inspect Render logs. |
| Replies do not appear | Verify `messages` subscription, correct WABA/app pairing, matching app secret and that the callback points to this hosted service. |

## Validation commands

From the project folder after installing dependencies:

```powershell
npm.cmd run test:cloud
npm.cmd run build
```

The tests check migration sequencing, direct versus pooled connections, failure handling, public login origins and session secret rotation without connecting to Meta or Neon. A local build validates compilation; the first Render deploy is still required to verify the Linux runtime and real Neon credentials.

## References

- [Render Next.js deployment](https://render.com/docs/deploy-nextjs-app)
- [Render Blueprint reference](https://render.com/docs/blueprint-spec)
- [Render Free service limits](https://render.com/docs/free)
- [Neon connection guide for Prisma](https://neon.com/docs/guides/prisma) (the current guide covers Prisma 7; this app retains Prisma 6)
- [Neon plans](https://neon.com/docs/introduction/plans)
