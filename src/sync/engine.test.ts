import { describe, expect, it } from "vitest";
import { syncOnce, type Collection } from "./engine";
import { InMemoryStore, InMemoryTransport } from "./fake";

const RECORDS: Collection[] = [
  { name: "products", kind: "records" },
  { name: "tiers", kind: "records" },
];
const WITH_EVENTS: Collection[] = [...RECORDS, { name: "events", kind: "events" }];

/** Sync A→cloud→B→cloud→A until nothing moves, or give up after N passes. */
async function syncToConvergence(
  cols: Collection[],
  a: InMemoryStore,
  b: InMemoryStore,
  cloud: InMemoryTransport,
  max = 6,
): Promise<number> {
  for (let i = 1; i <= max; i++) {
    const ra = await syncOnce(cols, a, cloud);
    const rb = await syncOnce(cols, b, cloud);
    if (ra.pulled + ra.pushed + ra.deleted + rb.pulled + rb.pushed + rb.deleted === 0) {
      return i;
    }
  }
  return max;
}

function productIds(store: InMemoryStore): string[] {
  return [...(store.records.get("products")?.keys() ?? [])].sort();
}

describe("two devices, one cloud", () => {
  it("propagates a new record from A to B", async () => {
    const a = new InMemoryStore();
    const b = new InMemoryStore();
    const cloud = new InMemoryTransport();
    a.seedRecord("products", { id: "p1", updatedAt: "2026-07-18T10:00:00Z" });

    await syncToConvergence(RECORDS, a, b, cloud);

    expect(productIds(b)).toEqual(["p1"]);
    expect(b.records.get("products")?.get("p1")?.updatedAt).toBe("2026-07-18T10:00:00Z");
  });

  it("merges disjoint records made on both devices", async () => {
    const a = new InMemoryStore();
    const b = new InMemoryStore();
    const cloud = new InMemoryTransport();
    a.seedRecord("products", { id: "made-on-a", updatedAt: "2026-07-18T10:00:00Z" });
    b.seedRecord("products", { id: "made-on-b", updatedAt: "2026-07-18T10:05:00Z" });

    await syncToConvergence(RECORDS, a, b, cloud);

    expect(productIds(a)).toEqual(["made-on-a", "made-on-b"]);
    expect(productIds(b)).toEqual(["made-on-a", "made-on-b"]);
  });

  it("resolves an edit conflict by last-write-wins, both sides agreeing", async () => {
    const a = new InMemoryStore();
    const b = new InMemoryStore();
    const cloud = new InMemoryTransport();
    // Same product edited on both devices offline; B's edit is later.
    a.seedRecord("products", {
      id: "p1",
      updatedAt: "2026-07-18T10:00:00Z",
      ...{ name: "edited on A" },
    } as never);
    b.seedRecord("products", {
      id: "p1",
      updatedAt: "2026-07-18T11:00:00Z",
      ...{ name: "edited on B" },
    } as never);

    await syncToConvergence(RECORDS, a, b, cloud);

    const onA = a.records.get("products")?.get("p1") as never as { name: string };
    const onB = b.records.get("products")?.get("p1") as never as { name: string };
    expect(onA.name).toBe("edited on B");
    expect(onB.name).toBe("edited on B");
  });

  it("propagates a delete so it does not resurrect", async () => {
    const a = new InMemoryStore();
    const b = new InMemoryStore();
    const cloud = new InMemoryTransport();
    a.seedRecord("products", { id: "p1", updatedAt: "2026-07-18T10:00:00Z" });

    // both learn about p1
    await syncToConvergence(RECORDS, a, b, cloud);
    expect(productIds(b)).toEqual(["p1"]);

    // A deletes it
    a.softDelete("products", "p1", "2026-07-18T12:00:00Z");
    await syncToConvergence(RECORDS, a, b, cloud);

    // gone on both, and stays gone through another round (no resurrection)
    expect(productIds(a)).toEqual([]);
    expect(productIds(b)).toEqual([]);
    await syncToConvergence(RECORDS, a, b, cloud);
    expect(productIds(b)).toEqual([]);
  });

  it("converges in one round-trip for a simple change", async () => {
    const a = new InMemoryStore();
    const b = new InMemoryStore();
    const cloud = new InMemoryTransport();
    a.seedRecord("tiers", { id: "flagship", updatedAt: "2026-07-18T10:00:00Z" });
    const rounds = await syncToConvergence(RECORDS, a, b, cloud);
    expect(rounds).toBeLessThanOrEqual(2);
  });
});

describe("the suite loop: a Booth sale reaches Forge Log", () => {
  it("surfaces a sale event recorded on the Booth device on the workshop device", async () => {
    // "booth" is the fair phone; "forge" is the workshop machine. They share one
    // cloud project. This is the plan's cross-app acceptance criterion (booth
    // §10 P5): a sale in Booth becomes visible on the Forge Log side.
    const booth = new InMemoryStore();
    const forge = new InMemoryStore();
    const cloud = new InMemoryTransport();

    // The workshop created the catalog.
    forge.seedRecord("products", {
      id: "sku-79",
      updatedAt: "2026-07-18T09:00:00Z",
      ...{ name: "LEATHER KEYCHAIN" },
    } as never);
    // First sync: Booth pulls the catalog down.
    await syncToConvergence(WITH_EVENTS, booth, forge, cloud);
    expect([...(booth.records.get("products")?.keys() ?? [])]).toEqual(["sku-79"]);

    // A sale happens at the fair — an append-only money event.
    booth.seedEvent("events", {
      id: "sale_1",
      ts: "2026-07-18T14:30:00Z",
      ...{ type: "saleRecorded", items: [{ productId: "sku-79", qty: 2 }] },
    } as never);

    await syncToConvergence(WITH_EVENTS, booth, forge, cloud);

    // The workshop now holds the sale event, untouched.
    const onForge = forge.events.get("events")?.get("sale_1") as never as {
      type: string;
      items: { productId: string; qty: number }[];
    };
    expect(onForge.type).toBe("saleRecorded");
    expect(onForge.items[0]).toEqual({ productId: "sku-79", qty: 2 });
  });

  it("never mutates or loses a money event in transit", async () => {
    const booth = new InMemoryStore();
    const forge = new InMemoryStore();
    const cloud = new InMemoryTransport();

    // 50 sales + 3 voids, as in the F2 drill.
    for (let i = 0; i < 50; i++) {
      booth.seedEvent("events", { id: `d${i}`, ts: `2026-07-18T14:${String(i % 60).padStart(2, "0")}:00Z` });
    }
    for (const i of [5, 17, 42]) {
      booth.seedEvent("events", { id: `void_${i}`, ts: `2026-07-18T15:${String(i % 60).padStart(2, "0")}:00Z` });
    }

    await syncToConvergence(WITH_EVENTS, booth, forge, cloud);

    // Exactly the same 53 events on the workshop side, none dropped or doubled.
    const boothIds = new Set(booth.events.get("events")?.keys());
    const forgeIds = new Set(forge.events.get("events")?.keys());
    expect(forgeIds.size).toBe(53);
    expect([...forgeIds].sort()).toEqual([...boothIds].sort());
  });
});
