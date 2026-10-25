import type { Order, OrderItem } from "@prisma/client";
import { env } from "../env";

export type ProviderId = "manual" | "shiprocket" | "delhivery";
export interface ShipmentResult { trackingNumber: string; labelUrl?: string }
type OrderFull = Order & { items: OrderItem[] };
type Addr = { fullName: string; line1: string; line2?: string; city: string; state: string; pincode: string };

export class NotConnectedError extends Error {
  constructor(provider: string) { super(`${provider} is not connected. Add its credentials in the environment.`); }
}

export const PROVIDERS: { id: ProviderId; name: string; configured: () => boolean; note: string }[] = [
  { id: "manual", name: "Manual courier entry", configured: () => true, note: "Type in a real tracking number issued by any courier. Always available." },
  { id: "shiprocket", name: "Shiprocket", configured: () => Boolean(env("SHIPROCKET_EMAIL") && env("SHIPROCKET_PASSWORD")), note: "Implemented against Shiprocket's public API docs. NOT verified against a live account." },
  { id: "delhivery", name: "Delhivery", configured: () => Boolean(env("DELHIVERY_API_TOKEN")), note: "Implemented against Delhivery's public API docs. NOT verified against a live account." },
];

const rupees = (paise: number) => (paise / 100).toFixed(2); // display string for provider payloads only

async function shiprocket(order: OrderFull): Promise<ShipmentResult> {
  if (!env("SHIPROCKET_EMAIL") || !env("SHIPROCKET_PASSWORD")) throw new NotConnectedError("Shiprocket");
  const base = "https://apiv2.shiprocket.in/v1/external";
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: env("SHIPROCKET_EMAIL"), password: env("SHIPROCKET_PASSWORD") }), signal: AbortSignal.timeout(15000) });
  const { token } = (await login.json()) as { token?: string };
  if (!login.ok || !token) throw new Error("Shiprocket login failed");
  const a = order.shippingAddress as Addr;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const created = await fetch(`${base}/orders/create/adhoc`, {
    method: "POST", headers, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      order_id: order.publicRef, order_date: order.createdAt.toISOString().slice(0, 16).replace("T", " "), pickup_location: env("SHIPROCKET_PICKUP_LOCATION", "Primary"),
      billing_customer_name: a.fullName, billing_last_name: "", billing_address: a.line1, billing_address_2: a.line2 ?? "", billing_city: a.city, billing_pincode: a.pincode, billing_state: a.state,
      billing_country: "India", billing_email: order.contactEmail ?? "", billing_phone: order.contactPhone.slice(-10), shipping_is_billing: true,
      order_items: order.items.map((i) => ({ name: i.nameSnapshot, sku: i.skuSnapshot, units: i.quantity, selling_price: rupees(i.unitPricePaise) })),
      payment_method: "COD", sub_total: rupees(order.totalPaise), length: 30, breadth: 25, height: 5, weight: 0.5,
    }),
  });
  const c = (await created.json()) as { shipment_id?: number };
  if (!created.ok || !c.shipment_id) throw new Error("Shiprocket order creation failed");
  const awb = await fetch(`${base}/courier/assign/awb`, { method: "POST", headers, body: JSON.stringify({ shipment_id: c.shipment_id }), signal: AbortSignal.timeout(20000) });
  const j = (await awb.json()) as { response?: { data?: { awb_code?: string } } };
  const code = j.response?.data?.awb_code;
  if (!awb.ok || !code) throw new Error("Shiprocket could not assign a courier/AWB");
  return { trackingNumber: code };
}

async function delhivery(order: OrderFull): Promise<ShipmentResult> {
  if (!env("DELHIVERY_API_TOKEN")) throw new NotConnectedError("Delhivery");
  const a = order.shippingAddress as Addr;
  const data = {
    shipments: [{ name: a.fullName, add: `${a.line1} ${a.line2 ?? ""}`.trim(), pin: a.pincode, city: a.city, state: a.state, country: "India", phone: order.contactPhone.slice(-10), order: order.publicRef, payment_mode: "COD", cod_amount: rupees(order.totalPaise), total_amount: rupees(order.totalPaise), products_desc: order.items.map((i) => i.nameSnapshot).join(", ").slice(0, 200), quantity: String(order.items.reduce((n, i) => n + i.quantity, 0)) }],
    pickup_location: { name: env("DELHIVERY_PICKUP_NAME", "Primary") },
  };
  const res = await fetch("https://track.delhivery.com/api/cmu/create.json", {
    method: "POST", headers: { Authorization: `Token ${env("DELHIVERY_API_TOKEN")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: `format=json&data=${encodeURIComponent(JSON.stringify(data))}`, signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json()) as { packages?: { waybill?: string }[] };
  const waybill = j.packages?.[0]?.waybill;
  if (!res.ok || !waybill) throw new Error("Delhivery did not return a waybill");
  return { trackingNumber: waybill };
}

export async function createProviderShipment(provider: Exclude<ProviderId, "manual">, order: OrderFull): Promise<ShipmentResult> {
  return provider === "shiprocket" ? shiprocket(order) : delhivery(order);
}

/** Maps a courier's free-text status to the next order status, or null if it carries no order change. */
export function mapCourierStatus(raw: string): "SHIPPED" | "DELIVERED" | "FAILED_DELIVERY" | null {
  const s = raw.toLowerCase();
  if (/(undeliver|failed|ndr|not delivered|attempt)/.test(s) && !/(^|\s)delivered(\s|$)/.test(s.replace("not delivered", ""))) return "FAILED_DELIVERY";
  if (/\bdelivered\b/.test(s)) return "DELIVERED";
  if (/(picked|in transit|out for delivery|shipped|dispatch)/.test(s)) return "SHIPPED";
  return null;
}
