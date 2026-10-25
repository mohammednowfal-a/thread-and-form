# WhatsApp setup (Meta WhatsApp Business Platform, Cloud API)

You need a **WhatsApp Business Platform** account. A personal WhatsApp or the WhatsApp Business *app* is not an API account.

## 1. Meta side
1. Create a Meta developer app (type: Business) and add the **WhatsApp** product. Create/attach a WhatsApp Business Account and add a phone number.
2. Generate a **permanent access token** (System User in Business Settings with `whatsapp_business_messaging` + `whatsapp_business_management`).
3. Note: **Phone number ID**, **WhatsApp Business Account ID**, and the app's **App Secret**.
4. Create and get approved two **Utility templates** (exact text is also shown in Admin → Integrations):
   * `cod_order_confirmation` (en): `Hi! Thank you for shopping with THREAD & FORM. Order: {{1}}. Items: {{2}}. COD amount: {{3}}. Please confirm that you want to purchase this and pay the amount on delivery.`
     with two **quick-reply buttons**: `Confirm Order`, `Cancel Order`. (The app sends the button payloads `TF_CONFIRM:<ref>` / `TF_CANCEL:<ref>`.)
   * `order_status_update` (en): `THREAD & FORM order {{1}}: {{2}}`
5. Webhook: callback URL `https://YOUR_DOMAIN/api/webhooks/whatsapp`, verify token = your `WHATSAPP_VERIFY_TOKEN`. Subscribe to the **messages** field.

## 2. Environment variables
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_API_VERSION`,
`WHATSAPP_TEMPLATE_COD_CONFIRM`, `WHATSAPP_TEMPLATE_ORDER_STATUS`, `WHATSAPP_TEMPLATE_LANGUAGE`. Set them on **both** the web service and the worker. Never commit them.
Without them the app reports "Not connected" and flags new COD orders for manual (phone) confirmation. It never pretends a message was sent.

## 3. Rules the app follows
* **Consent**: the confirmation is only sent if the customer ticked the WhatsApp consent box at checkout. Otherwise the order goes to manual review.
* **Opt-out**: the customer can reply `STOP`; replies stop, waiting orders go to manual review. `START` re-enables.
* **24-hour window**: inside the window we send an interactive-button message with full order details; outside it we send the approved template.
* **Signature**: every POST is verified with `X-Hub-Signature-256` using the app secret. In production an unconfigured secret makes the endpoint refuse traffic (503).
* **Idempotency**: each webhook event id is stored once; duplicate deliveries are no-ops. Failed events appear in Admin → WhatsApp and can be replayed safely.

## 4. Test locally without Meta
```bash
npm run dev
node scripts/simulate-whatsapp.mjs 919876543210 "Yes, I confirm"          # signed text message
node scripts/simulate-whatsapp.mjs 919876543210 --button TF_CONFIRM:TF-ABC234
```
The phone number must equal the number used at checkout (normalised, e.g. `919876543210`). Place a COD order first, tick the consent box, then run a worker tick
(`npm run worker`, or `curl -X POST -H "Authorization: Bearer $JOBS_SECRET" localhost:3000/api/jobs/run`). Without Meta credentials the confirmation request is marked FAILED (NOT_CONFIGURED) and the order shows "manual review"; you can still simulate the customer's reply.

## 5. Test with the real API from your laptop
Expose your dev server with a secure tunnel (e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`), set the tunnel URL as the webhook callback and as `APP_URL`,
use Meta's test phone number and add your own number as an allowed recipient, then place an order using that number.
