/*
 * Browser journeys (run with `npm run test:e2e` after `npx playwright install chromium`).
 * Requires a seeded database (npm run db:seed:demo) and DATABASE_URL pointing at it.
 * Runs on both a desktop and a mobile (Pixel 7) project, see playwright.config.ts.
 *
 * NOTE: these specs were written but NOT executed in the environment that produced this project
 * (browser downloads were blocked). Treat them as unverified until you run them.
 */
import { expect, test } from "@playwright/test";
import pg from "pg";

const DB = process.env.DATABASE_URL?.replace(/\?schema=.*$/, "") ?? "postgresql://tf:tf_dev_pw@localhost:5432/threadform";

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows as T[]; } finally { await c.end(); }
}

const PAGES = ["/", "/shop", "/product/premium-cotton-t-shirt", "/cart", "/track", "/login", "/admin/login"];

test.describe("responsive layout", () => {
  for (const path of PAGES) {
    test(`no horizontal scroll on ${path}`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test("browse, search, pick variant, add to cart, check out with COD, verify in database", async ({ page }) => {
  await page.goto("/shop");
  await page.getByLabel("Category").selectOption("t-shirts");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("heading", { name: "Premium Cotton T-Shirt" }).first()).toBeVisible();

  await page.goto("/search?q=linen");
  await expect(page.getByText("Linen Camp Shirt").first()).toBeVisible();

  await page.goto("/product/premium-cotton-t-shirt");
  await page.getByText("White", { exact: true }).first().click({ force: true });
  await page.getByLabel("L", { exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await page.getByRole("link", { name: "Checkout" }).click();

  await page.getByLabel("Full name").fill("E2E Tester");
  await page.getByLabel("Mobile number").fill("9876501234");
  await page.getByLabel("Address line 1").fill("1 Test Street");
  await page.getByLabel("City").fill("Chennai");
  await page.getByLabel("State").fill("Tamil Nadu");
  await page.getByLabel("PIN code").fill("600001");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Place order/ }).click();

  await expect(page.getByText(/Order reference/)).toBeVisible();
  const ref = (await page.locator("strong.font-mono").first().textContent())?.trim() ?? "";
  expect(ref).toMatch(/^TF-[A-Z0-9]{6}$/);

  const [order] = await sql<{ id: string; status: string; totalPaise: number }>(`SELECT id, status, "totalPaise" FROM "Order" WHERE "publicRef" = $1`, [ref]);
  expect(order?.status).toBe("PENDING_CONFIRMATION");
  const jobs = await sql(`SELECT 1 FROM "Job" WHERE type = 'WA_COD_CONFIRM' AND payload->>'orderId' = $1`, [order!.id]);
  expect(jobs).toHaveLength(1);
});

test("admin area redirects unauthenticated visitors", async ({ page }) => {
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("order pages are not reachable without proof of ownership", async ({ page }) => {
  const res = await page.goto("/order/TF-AAAAAA");
  expect(res?.status()).toBe(404);
});
