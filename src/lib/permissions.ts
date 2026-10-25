import type { RoleKey } from "@prisma/client";

export const PERMISSIONS = [
  "dashboard.view",
  "analytics.view",
  "products.read",
  "products.write",
  "inventory.write",
  "orders.read",
  "orders.update",
  "orders.fulfil",
  "orders.cancel",
  "customers.read",
  "whatsapp.read",
  "whatsapp.manage",
  "returns.manage",
  "integrations.manage",
  "team.manage",
  "audit.read",
  "settings.manage",
  "jobs.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  OWNER: ALL,
  ADMIN: [], // assigned below: everything except team management
  OPS_MANAGER: [
    "dashboard.view", "analytics.view", "products.read", "products.write", "inventory.write",
    "orders.read", "orders.update", "orders.fulfil", "orders.cancel", "customers.read",
    "whatsapp.read", "whatsapp.manage", "returns.manage", "audit.read", "jobs.manage",
  ],
  FULFILLMENT: ["dashboard.view", "products.read", "orders.read", "orders.fulfil", "inventory.write"],
  SUPPORT: [
    "dashboard.view", "products.read", "orders.read", "orders.update", "orders.cancel",
    "customers.read", "whatsapp.read", "whatsapp.manage", "returns.manage",
  ],
  ANALYST: ["dashboard.view", "analytics.view", "products.read", "orders.read", "customers.read", "whatsapp.read"],
};

// Only an OWNER may manage the team; ADMIN gets everything else.
ROLE_PERMISSIONS.ADMIN = ALL.filter((p) => p !== "team.manage");

export function can(role: RoleKey, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
  }
}

export function assertCan(role: RoleKey, permission: Permission) {
  if (!can(role, permission)) throw new ForbiddenError();
}

export const ROLE_LABEL: Record<RoleKey, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  OPS_MANAGER: "Operations manager",
  FULFILLMENT: "Fulfilment staff",
  SUPPORT: "Customer support",
  ANALYST: "Read-only analyst",
};
