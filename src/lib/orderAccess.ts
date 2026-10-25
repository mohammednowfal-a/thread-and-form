import { hashToken } from "./auth";
import { safeEqual } from "./crypto";

/** Unguessable, stateless access token for a guest's order page (HMAC of the order id). */
export const orderToken = (orderId: string) => hashToken(`order-access:${orderId}`).slice(0, 32);
export const verifyOrderToken = (orderId: string, token: string | undefined) => !!token && safeEqual(token, orderToken(orderId));
