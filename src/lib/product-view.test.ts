import { describe, expect, it } from "vitest";
import { viewLines, type ViewOptions } from "./product-view";
import type { InventoryLine } from "../core-data/types";

const NO_VARIANT = "—";

function line(over: Partial<InventoryLine>): InventoryLine {
  return {
    productId: over.productId ?? "p",
    sku: "",
    productName: "Item",
    variant: NO_VARIANT,
    tierId: "t1",
    currentQty: 0,
    target: 0,
    made: false,
    packed: 0,
    sold: 0,
    remaining: 0,
    toMake: 0,
    toMakeMinutes: null,
    unitCostCents: 0,
    sellingPriceCents: 0,
    marginCents: null,
    marginPct: null,
    goalValueCents: 0,
    goalProfitCents: null,
    ...over,
  };
}

const opts = (o: Partial<ViewOptions>): ViewOptions => ({
  query: "",
  tierId: "",
  sort: "name",
  ...o,
});

// Tiers ranked t1 < t2 for the "by tier" sort.
const rank = (id: string): number => (id === "t1" ? 0 : id === "t2" ? 1 : 99);

describe("viewLines — search", () => {
  const lines = [
    line({ productId: "a", productName: "Separador Roble", sku: "SKU9" }),
    line({ productId: "b", productName: "Poción Azul", sku: "PZ1" }),
  ];

  it("matches on name, case- and accent-insensitively", () => {
    expect(viewLines(lines, opts({ query: "pocion" }), rank).map((l) => l.productId)).toEqual(["b"]);
    expect(viewLines(lines, opts({ query: "SEPARADOR" }), rank).map((l) => l.productId)).toEqual(["a"]);
  });

  it("matches on sku and variant", () => {
    expect(viewLines(lines, opts({ query: "sku9" }), rank).map((l) => l.productId)).toEqual(["a"]);
    const v = [line({ productId: "c", productName: "X", variant: "Nogal" })];
    expect(viewLines(v, opts({ query: "nogal" }), rank)).toHaveLength(1);
  });

  it("an empty query keeps everything", () => {
    expect(viewLines(lines, opts({}), rank)).toHaveLength(2);
  });
});

describe("viewLines — filter by tier", () => {
  it("keeps only the chosen tier", () => {
    const lines = [line({ productId: "a", tierId: "t1" }), line({ productId: "b", tierId: "t2" })];
    expect(viewLines(lines, opts({ tierId: "t2" }), rank).map((l) => l.productId)).toEqual(["b"]);
  });
});

describe("viewLines — sort", () => {
  const lines = [
    line({ productId: "mid", productName: "B", sellingPriceCents: 5000, marginCents: 100, currentQty: 5, toMake: 2, tierId: "t2" }),
    line({ productId: "lo", productName: "C", sellingPriceCents: 2500, marginCents: null, currentQty: 1, toMake: 9, tierId: "t1" }),
    line({ productId: "hi", productName: "A", sellingPriceCents: 9000, marginCents: 400, currentQty: 9, toMake: 0, tierId: "t2" }),
  ];

  it("name A→Z", () => {
    expect(viewLines(lines, opts({ sort: "name" }), rank).map((l) => l.productName)).toEqual(["A", "B", "C"]);
  });
  it("price high→low", () => {
    expect(viewLines(lines, opts({ sort: "price" }), rank).map((l) => l.productId)).toEqual(["hi", "mid", "lo"]);
  });
  it("margin high→low, unknown last", () => {
    expect(viewLines(lines, opts({ sort: "margin" }), rank).map((l) => l.productId)).toEqual(["hi", "mid", "lo"]);
  });
  it("stock low→high (restock priority)", () => {
    expect(viewLines(lines, opts({ sort: "stock" }), rank).map((l) => l.productId)).toEqual(["lo", "mid", "hi"]);
  });
  it("to-make high→low", () => {
    expect(viewLines(lines, opts({ sort: "tomake" }), rank).map((l) => l.productId)).toEqual(["lo", "mid", "hi"]);
  });
  it("by tier, then name", () => {
    // t1 (lo) first, then t2 grouped and name-sorted (A=hi before B=mid).
    expect(viewLines(lines, opts({ sort: "tier" }), rank).map((l) => l.productId)).toEqual(["lo", "hi", "mid"]);
  });
});
