import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHead } from "@/components/admin";
import { SettingsForm } from "@/components/AdminForms";

export default async function Settings() {
  const s = await requireStaff("settings.manage");
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
  const r = (p: number) => (p / 100).toString();
  return <><PageHead title="Store settings" /><SettingsForm d={{ name: t.name, shipping: r(t.shippingFeePaise), freeThreshold: r(t.freeShippingThresholdPaise), codMax: r(t.codMaxTotalPaise), codFee: r(t.codFeePaise), expiryHours: t.confirmationExpiryHours, supportEmail: t.supportEmail ?? "", supportPhone: t.supportPhone ?? "", whatsappConfirmEnabled: t.whatsappConfirmEnabled }} /></>;
}
