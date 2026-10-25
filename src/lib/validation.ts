import { z } from "zod";
import { normalizePhone } from "./phone";

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/\d/, "Include at least one number");

const clean = (max: number) => z.string().trim().min(1, "Required").max(max);

export const checkoutSchema = z.object({
  name: clean(80),
  phone: z.string().trim().transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: "custom", message: "Enter a valid mobile number" });
    return p ?? "";
  }),
  email: z.string().trim().max(120).email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)),
  line1: clean(120),
  line2: z.string().trim().max(120).optional(),
  city: clean(60),
  state: clean(60),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code"),
  whatsappConsent: z.boolean(),
  idempotencyKey: z.string().min(16).max(80),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const registerSchema = z.object({
  name: clean(80),
  email: z.string().trim().toLowerCase().email().max(120),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(128),
});

export const trackSchema = z.object({
  ref: z.string().trim().toUpperCase().regex(/^TF-[A-Z0-9]{6}$/, "Order references look like TF-AB12CD"),
  phone: z.string().trim().min(8),
});

export const productInputSchema = z.object({
  name: clean(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and dashes only").max(80),
  sku: clean(40),
  categoryId: z.string().min(1),
  description: clean(2000),
  material: z.string().trim().max(200).default(""),
  fit: z.string().trim().max(200).default(""),
  pricePaise: z.number().int().min(0).max(100_000_00),
  comparePricePaise: z.number().int().min(0).max(100_000_00).nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
});
