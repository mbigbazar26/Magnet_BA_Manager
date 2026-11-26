# BigBazar Messaging Desk

The desk is a local web application for managing WhatsApp contacts, submitting text templates, and sending approved template messages. It connects to Meta's WhatsApp Cloud API from your computer. Your computer must be connected to the internet for Meta operations.

## Quick start

Open `E:\WindowsDevWorkspace\Magnet_BA_Manager` in File Explorer and double-click `Start Desk.cmd`. Keep the window open while using the desk. Visit http://127.0.0.1:3000 and sign in using the password stored in `.local/operator-password.txt` in the project folder. To stop the desk, double-click `Stop Desk.cmd`; you can also press Ctrl+C in the Start Desk window.

Double-click `Connect Meta.cmd` to enter the System User access token. The input is hidden. Press Enter at either prompt to keep its existing value. The app secret is needed to validate incoming webhooks. Restart the desk after changing credentials, then choose **Setup > Check connection**.

## Using the desk

1. Open **Contacts** and add a person's name and phone number with its country code, for example `+919876543210`. Record consent only when the person has opted in. You can edit a contact to update or withdraw consent.
2. Open **Templates** and select **Sync from Meta** to retrieve templates for the configured Messaging Account. To create a template, supply its lowercase name, language code, category and body. Numbered body fields such as `{{1}}` need example values during submission.
3. Meta reviews new templates. Select **Sync from Meta** again to refresh their status. A pending or rejected template cannot be sent from the desk.
4. Under **Compose**, choose an opted-in contact and an approved supported template. Fill each numbered field, review the recipient and message preview, and confirm the send. Meta may charge for eligible messages.
5. Open **Messages** to inspect recent outgoing and incoming messages. The desk shows the most recent 250 messages. A webhook is required for delivery updates and incoming messages.

The current version sends body-only text templates, including numbered positional fields. Templates with headers, buttons, media or other components may sync but cannot be sent from the desk. Each send is to one contact. Scheduling, bulk campaigns and automatic order triggers are future work.

## Message and template statuses

**Pending** means the template has been submitted and awaits Meta's review. **Approved** makes a supported template selectable for sending. **Rejected** requires attention in WhatsApp Manager. **Unavailable** means a previous local template was not present in the latest completed sync.

For sent messages, **submitting** means a request is in progress, and **accepted** means Meta returned a message ID. Delivery is confirmed by later webhook updates such as **sent**, **delivered**, **read**, or **failed**. **Unknown** means the request outcome could not be confirmed. Check with the recipient or available delivery events before retrying an unknown send to avoid duplicates.

## Configuration and security

The local `.env` file contains the database URL, operator password, session secret, Meta IDs, access token, app secret and webhook verify token. It is ignored by Git. Never share its contents or commit it. `Connect Meta.cmd` updates the token and app secret without displaying them. The initial configuration contains this business's number ID and Messaging Account ID. The application reads these settings at startup.

The web server listens on `127.0.0.1:3000` and the bundled PostgreSQL server on `127.0.0.1:55432`. The operator password is stored in `.local/operator-password.txt`. Protect access to this folder because it also contains local customer and message data. The generated PostgreSQL data directory is `.local/postgres`. The project uses Next.js, React, TypeScript, Prisma and PostgreSQL.

## Troubleshooting

- **PostgreSQL lock file or port already in use** — another copy may be running. Stop the existing desk from its terminal before starting another. Do not delete `postmaster.pid` while PostgreSQL is running.
- **Stop Desk.cmd says the running copy is an older version** — press Ctrl+C once in the Start Desk terminal, wait for PostgreSQL to stop, and start the desk again. Subsequent runs can be stopped with `Stop Desk.cmd`.
- **Unexpected character in META_ACCESS_TOKEN** — run `Connect Meta.cmd` again and paste the token alone. The stars on screen hide the input. When it says `Saved`, restart the desk.
- **Meta connection fails** — check the token is current, the System User has the appropriate app and WhatsApp permissions, and the configured IDs refer to the intended account. Do not paste the token into chat.
- **A template remains pending** — Meta controls review. Sync again later and inspect the template in WhatsApp Manager if it is rejected.
- **A message remains accepted** — check webhook setup and the `messages` subscription. API acceptance is not delivery confirmation. Meta billing and recipient eligibility also affect delivery.
- **Login password unavailable** — find `.local/operator-password.txt`. It is generated on initial setup and should be treated as a secret.

## Project commands

Run these from the project folder in PowerShell:

```powershell
npm.cmd run setup              # update Meta credentials
npm.cmd run local              # start local PostgreSQL and the desk
npm.cmd run local -- --rebuild # rebuild after source changes and start
npm.cmd run relay              # start the webhook-only relay on port 3001
npm.cmd run db:deploy          # apply database migrations
```

Use one local desk instance at a time. PostgreSQL is embedded locally because Docker was unavailable on the original machine. The same application and database schema can later be deployed with managed PostgreSQL. A cloud deployment needs its own authentication, network and secret-management review before public use.

The local desk sends approved WhatsApp templates from +91 77366 85977. It stores contacts, consent, templates, and message history in PostgreSQL on this computer. The stack is Next.js, React, TypeScript, Prisma, PostgreSQL, and the Meta WhatsApp Cloud API.

## Start on Windows

Use Node.js 22 or newer. The current machine already has Node.js.

1. Double-click **Start Desk.cmd**. Keep its terminal open. The launcher installs dependencies on first run if needed, starts the bundled PostgreSQL server, and applies the database migrations. It does not require Docker.
2. Open http://127.0.0.1:3000 and sign in with the password in `.local/operator-password.txt` inside the app folder.
3. Double-click **Connect Meta.cmd**. Enter the System User access token privately. Enter the Meta App Secret from the developer app's basic settings if you want to receive webhooks. The app stores these in the ignored `.env` file.
4. Restart the desk and use **Setup → Check connection**. Then open **Templates → Sync from Meta**. The phone and Messaging Account IDs are filled in for Mancherikalam BigBazar.
5. Add a contact with their country code and record their WhatsApp consent. Create and submit a template if there isn't an approved one. Once approved, choose it under **Compose**, enter any numbered text values, and review the preview before sending.

The dashboard supports templates with a text body and optional numbered fields such as `{{1}}`. Meta bills eligible sends separately. An accepted send stays in history until a delivery event arrives. Existing local data lives under `.local/postgres`. Keep that directory and `.env` on this computer. Back up the database with PostgreSQL tools before moving to a different machine.

## Connect replies and delivery updates

1. Run `npm.cmd run relay` in a second terminal. Point your HTTPS tunnel at `http://127.0.0.1:3001`. The relay forwards only the webhook route.
2. In your Meta developer app's WhatsApp webhook settings, use `https://<your-tunnel-host>/api/webhook` as the callback URL and the value of `META_VERIFY_TOKEN` in `.env` as the verify token.
3. Subscribe the app to the `messages` field and confirm the app is subscribed to the production Messaging Account. Keep the desk, relay, and tunnel running. If your public URL changes, update Meta's callback URL.
4. **Messages** will show incoming text, delivery updates, and Meta's failure reasons. Incoming STOP or UNSUBSCRIBE updates the corresponding contact's consent.

## Develop or move to cloud hosting later

Run `npm.cmd run local -- --rebuild` after changing source files. The future cloud setup can use the same app and Prisma migrations with a managed PostgreSQL database. Configure `.env.example` values as server secrets, apply `npm run db:deploy`, and point Meta to the hosted server's HTTPS webhook. Review operator access and hosting network settings before exposing the dashboard to the internet.
