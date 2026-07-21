// The fair-day drill: the app must boot and take a sale with no network, and the
// money must survive a reload — because at a fair the phone is offline and gets
// closed and reopened all day. Unit tests cover the derivations; this covers the
// real PWA (service-worker precache + IndexedDB durability).
import { test, expect, type Page } from "@playwright/test";

async function seedFairAndProduct(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const q = indexedDB.open("booth-mode");
      q.onsuccess = () => res(q.result);
    });
    const put = (store: string, value: unknown): Promise<void> =>
      new Promise((res) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value);
        tx.oncomplete = () => res();
      });
    const now = new Date().toISOString();
    const cost = {
      materialCents: 0,
      machineCents: 0,
      laborCents: 0,
      consumableCents: 0,
      packagingCents: 0,
    };
    await put("tiers", { id: "t1", label: "Flagship", sortOrder: 0, color: "#5eb0e5", updatedAt: now });
    await put("products", {
      id: "p1",
      sku: "S1",
      name: "Widget",
      variants: ["—"],
      tierId: "t1",
      cost,
      housePriceCents: 5000,
      sellingPriceCents: 5000,
      stockByVariant: { "—": 10 },
      active: true,
      updatedAt: now,
    });
    await put("fairs", {
      id: "f1",
      name: "Feria",
      dates: ["2026-10-12"],
      boothFeeCents: 0,
      floatStartCents: 0,
      status: "active",
      updatedAt: now,
    });
    await put("stockPlans", {
      id: "sp1",
      eventId: "f1",
      lines: [{ productId: "p1", variant: "—", target: 10, made: false, packed: 10 }],
      updatedAt: now,
    });
    db.close();
  });
}

// Load once so the service worker installs + precaches, then seed and settle.
async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker?.ready);
  await seedFairAndProduct(page);
  await page.reload();
  await expect(page.getByText("Widget")).toBeVisible();
}

test("boots from cache and shows seeded data with the network cut", async ({ page, context }) => {
  await boot(page);
  await context.setOffline(true);
  await page.reload(); // must come from the SW precache, not the network
  await expect(page.getByText("Widget")).toBeVisible();
});

test("takes a cash sale offline and it survives a reload", async ({ page, context }) => {
  await boot(page);
  await context.setOffline(true);

  // Tap the product tile → charge → pay exact cash.
  await page.locator("button.tile:not([disabled])").first().click();
  await page.locator(".cart-bar button.huge").click();
  await page.locator(".tender-grid button.primary").first().click();

  // The sale shows in the recent-sales list...
  await expect(page.locator(".sale-row")).toHaveCount(1);

  // ...and is still there after a reload (still offline) — it was persisted.
  await page.reload();
  await expect(page.locator(".sale-row")).toHaveCount(1);
});
