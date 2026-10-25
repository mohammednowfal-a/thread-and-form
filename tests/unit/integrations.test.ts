import { describe, expect, it } from "vitest";
import { mapCourierStatus } from "@/lib/integrations/shipping";
import { priceToPaise } from "@/lib/integrations/shopify";

describe("courier status mapping", () => {
  it.each([["Delivered", "DELIVERED"], ["DELIVERED", "DELIVERED"], ["Out for delivery", "SHIPPED"], ["In Transit", "SHIPPED"], ["Picked up", "SHIPPED"], ["Undelivered - customer unavailable", "FAILED_DELIVERY"], ["NDR raised", "FAILED_DELIVERY"], ["Not Delivered", "FAILED_DELIVERY"], ["Label created", null], ["", null]])(
    "%s -> %s", (raw, expected) => expect(mapCourierStatus(raw)).toBe(expected));
});
describe("Shopify price parsing is exact", () => {
  it.each([["999.00", 99900], ["1299.50", 129950], ["0.05", 5], ["10", 1000], ["19.9", 1990], ["4999.999", 499999]])("%s -> %i paise", (s, n) => expect(priceToPaise(s)).toBe(n));
});
