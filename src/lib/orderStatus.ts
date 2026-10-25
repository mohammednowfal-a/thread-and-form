import type { OrderStatus } from "@prisma/client";

/** Documented order state machine (see docs/ORDER_STATES.md). */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "FAILED_DELIVERY"],
  FAILED_DELIVERY: ["SHIPPED", "RETURNED", "CANCELLED"],
  DELIVERED: ["RETURN_REQUESTED"],
  RETURN_REQUESTED: ["RETURNED", "DELIVERED"],
  CANCELLED: [],
  RETURNED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(public from: OrderStatus, public to: OrderStatus) {
    super(`Cannot move an order from ${from} to ${to}`);
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Statuses in which the customer (via WhatsApp) may still cancel. Anything later goes to support. */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ["PENDING_CONFIRMATION", "CONFIRMED"];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: "Pending confirmation",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return requested",
  RETURNED: "Returned",
  FAILED_DELIVERY: "Failed delivery",
};
