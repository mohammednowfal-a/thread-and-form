# Order states, confirmation and inventory

## Order status transitions (enforced in `src/lib/orderStatus.ts` and inside database transactions)

| From | Allowed next |
|---|---|
| PENDING_CONFIRMATION | CONFIRMED, CANCELLED |
| CONFIRMED | PROCESSING, CANCELLED |
| PROCESSING | PACKED, CANCELLED |
| PACKED | SHIPPED, CANCELLED |
| SHIPPED | DELIVERED, FAILED_DELIVERY |
| FAILED_DELIVERY | SHIPPED, RETURNED, CANCELLED |
| DELIVERED | RETURN_REQUESTED |
| RETURN_REQUESTED | RETURNED, DELIVERED (return rejected) |
| CANCELLED, RETURNED | none (terminal) |

Anything else is rejected with `InvalidTransitionError`. A customer (WhatsApp or website) can only cancel in
`PENDING_CONFIRMATION` or `CONFIRMED`; later cancellations go to support.

## Three separate things (never conflated)

1. **Order status**: where the order is in fulfilment (table above).
2. **Confirmation status** (`Order.confirmationStatus`): what the *customer* has said: `AWAITING`, `CONFIRMED`,
   `CANCEL_REQUESTED`, `CANCELLED`, `MANUAL_REVIEW` (send failed, customer opted out, no consent, or stock lost: call them), `NOT_REQUIRED`.
3. **Message delivery status** (`WhatsAppMessage.status`): what *Meta* told us: `QUEUED` → `SENT` → `DELIVERED` → `READ`, or `FAILED`.
   "Submitted to the API" is `SENT`; only a provider status event moves it to `DELIVERED`. A delivered or read message never confirms an order.

Only an explicit customer action changes confirmation: a Confirm/Cancel button tap tied to one order reference, or a short unambiguous
reply when exactly one order is waiting. Everything else triggers a clarifying question.

## Inventory policy

* **Reserve** at order placement: `UPDATE InventoryRecord SET reserved = reserved + q WHERE onHand - reserved >= q` (atomic; zero rows = out of stock).
* **Release** on cancel or expiry (unconfirmed orders are cancelled after `confirmationExpiryHours`, default 48).
* **Consume** when the order moves to `SHIPPED` (`onHand -= q, reserved -= q`).
* Database CHECK constraints guarantee `0 <= reserved <= onHand` even if application code is wrong.
* Variants are locked in sorted order to avoid deadlocks. Order creation, stock reservation, status history and the WhatsApp outbox job commit in one transaction.
