import { env } from "../env";

export function waConfig() {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = env("WHATSAPP_ACCESS_TOKEN");
  return {
    phoneNumberId,
    businessAccountId: env("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    accessToken,
    verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
    appSecret: env("WHATSAPP_APP_SECRET"),
    apiVersion: env("WHATSAPP_API_VERSION", "v21.0"),
    templates: {
      codConfirm: env("WHATSAPP_TEMPLATE_COD_CONFIRM", "cod_order_confirmation"),
      orderStatus: env("WHATSAPP_TEMPLATE_ORDER_STATUS", "order_status_update"),
      language: env("WHATSAPP_TEMPLATE_LANGUAGE", "en"),
    },
    /** True only when we can actually call the Cloud API. */
    configured: Boolean(phoneNumberId && accessToken),
  };
}

export const SERVICE_WINDOW_MS = 24 * 3600_000;
export function withinServiceWindow(lastInboundAt: Date | null | undefined): boolean {
  return !!lastInboundAt && Date.now() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}
