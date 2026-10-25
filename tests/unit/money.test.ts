import { describe, expect, it } from "vitest";
import { computeTotals, formatMoney } from "@/lib/money";

const cfg = { shippingFeePaise: 9900, freeShippingThresholdPaise: 199900, codFeePaise: 0 };

describe("money", () => {
  it("formats paise as rupees without floating point", () => {
    expect(formatMoney(99900)).toBe("₹999");
    expect(formatMoney(129950)).toBe("₹1,299.50");
    expect(formatMoney(5)).toBe("₹0.05");
    expect(formatMoney(12345600)).toBe("₹1,23,456");
  });
  it("rejects non-integer amounts", () => {
    expect(() => formatMoney(10.5)).toThrow();
  });
  it("adds shipping below the free threshold", () => {
    const t = computeTotals([{ unitPricePaise: 99900, quantity: 1 }], cfg);
    expect(t).toMatchObject({ subtotalPaise: 99900, shippingPaise: 9900, totalPaise: 109800 });
  });
  it("waives shipping at the threshold", () => {
    const t = computeTotals([{ unitPricePaise: 99950, quantity: 2 }], cfg);
    expect(t.shippingPaise).toBe(0);
    expect(t.totalPaise).toBe(199900);
  });
  it("adds COD fee and caps discount at subtotal", () => {
    const t = computeTotals([{ unitPricePaise: 10000, quantity: 1 }], { ...cfg, codFeePaise: 4000 }, 999999);
    expect(t.discountPaise).toBe(10000);
    expect(t.totalPaise).toBe(9900 + 4000);
  });
  it("rejects negative or zero quantities and negative prices", () => {
    expect(() => computeTotals([{ unitPricePaise: 100, quantity: 0 }], cfg)).toThrow();
    expect(() => computeTotals([{ unitPricePaise: 100, quantity: -2 }], cfg)).toThrow();
    expect(() => computeTotals([{ unitPricePaise: -100, quantity: 1 }], cfg)).toThrow();
  });
  it("is exact for amounts that break floating point", () => {
    const t = computeTotals([{ unitPricePaise: 1, quantity: 3 }, { unitPricePaise: 2, quantity: 1 }], { ...cfg, shippingFeePaise: 0 });
    expect(t.totalPaise).toBe(5);
  });
});
