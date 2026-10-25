// Single source of truth for store policies: used by the policy pages AND the WhatsApp assistant.
export const POLICY = {
  returnWindowDays: 7,
  deliveryDaysMin: 3,
  deliveryDaysMax: 7,
  codAvailability: "Cash on Delivery is available on every order across India up to the store's COD limit.",
  codConfirmation: "Every COD order is confirmed with you on WhatsApp (or by phone) before it is packed.",
  cancellation: "You can cancel any order before it is packed. Once it is packed or shipped, please contact support.",
  returnsSummary: "Unworn items with tags can be returned within 7 days of delivery. Refunds for COD orders are sent by bank transfer after the return is received.",
} as const;
