// All money is integer paise (minor units). Never use floating point for amounts.

export function formatMoney(paise: number, currency = "INR"): string {
  if (!Number.isInteger(paise)) throw new Error("Money must be an integer number of minor units");
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  const grouped = new Intl.NumberFormat("en-IN").format(major);
  return `${sign}${symbol}${grouped}${minor === 0 ? "" : "." + String(minor).padStart(2, "0")}`;
}

export interface PricingConfig {
  shippingFeePaise: number;
  freeShippingThresholdPaise: number;
  codFeePaise: number;
}

export interface Totals {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  taxPaise: number;
  codFeePaise: number;
  totalPaise: number;
}

export function computeTotals(
  lines: { unitPricePaise: number; quantity: number }[],
  cfg: PricingConfig,
  discountPaise = 0,
): Totals {
  let subtotal = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.unitPricePaise) || l.unitPricePaise < 0) throw new Error("Invalid unit price");
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error("Invalid quantity");
    subtotal += l.unitPricePaise * l.quantity;
  }
  const discount = Math.min(Math.max(0, Math.trunc(discountPaise)), subtotal);
  const afterDiscount = subtotal - discount;
  const shipping = lines.length === 0 || afterDiscount >= cfg.freeShippingThresholdPaise ? 0 : cfg.shippingFeePaise;
  const taxPaise = 0; // prices are tax-inclusive (GST included in listed price)
  const total = afterDiscount + shipping + cfg.codFeePaise + taxPaise;
  return {
    subtotalPaise: subtotal,
    discountPaise: discount,
    shippingPaise: shipping,
    taxPaise,
    codFeePaise: cfg.codFeePaise,
    totalPaise: total,
  };
}
