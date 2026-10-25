import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { assertTransition, canTransition, CUSTOMER_CANCELLABLE, InvalidTransitionError, TRANSITIONS } from "@/lib/orderStatus";

describe("order state machine", () => {
  it("allows the happy path", () => {
    const path: OrderStatus[] = ["PENDING_CONFIRMATION", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it("rejects skipping steps and going backwards", () => {
    expect(canTransition("PENDING_CONFIRMATION", "SHIPPED")).toBe(false);
    expect(canTransition("CONFIRMED", "DELIVERED")).toBe(false);
    expect(canTransition("DELIVERED", "CONFIRMED")).toBe(false);
  });
  it("cannot cancel once shipped or delivered", () => {
    expect(canTransition("SHIPPED", "CANCELLED")).toBe(false);
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
    expect(() => assertTransition("SHIPPED", "CANCELLED")).toThrow(InvalidTransitionError);
  });
  it("terminal states have no exits", () => {
    expect(TRANSITIONS.CANCELLED).toEqual([]);
    expect(TRANSITIONS.RETURNED).toEqual([]);
  });
  it("customers can only cancel before packing", () => {
    expect(CUSTOMER_CANCELLABLE).toEqual(["PENDING_CONFIRMATION", "CONFIRMED"]);
  });
  it("failed delivery can be retried or returned", () => {
    expect(canTransition("FAILED_DELIVERY", "SHIPPED")).toBe(true);
    expect(canTransition("FAILED_DELIVERY", "RETURNED")).toBe(true);
  });
});
