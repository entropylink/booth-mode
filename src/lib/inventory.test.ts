import { describe, expect, it } from "vitest";
import { buildInventory, marginPct, toMakeQueue, unitMargin } from "./inventory";
import { totalUnitCost } from "./money";
import { EMPTY_COST, type BoothEvent, type Product, type StockPlan } from "../core-data/types";

function product(over: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sku: over.id,
    tierId: "mid",
    variants: ["—"],
    cost: EMPTY_COST,
    housePriceCents: 0,
    sellingPriceCents: 0,
    stockByVariant: {},
    active: true,
    ...over,
  } as Product;
}

const COSTED = product({
  id: "sep",
  name: "SEPARADOR M2",
  // $12 + $3 + $20 + $1 + $4 = $40 cost, sold at $75.
  cost: {
    materialCents: 1200,
    machineCents: 300,
    laborCents: 2000,
    consumableCents: 100,
    packagingCents: 400,
  },
  housePriceCents: 6000,
  sellingPriceCents: 7500,
  stockByVariant: { "—": 32 },
  productionMinutes: 8,
});

const UNCOSTED = product({
  id: "pocion",
  name: "POCIÓN 1",
  housePriceCents: 15000,
  sellingPriceCents: 18800,
  stockByVariant: { "—": 0 },
});

describe("totalUnitCost", () => {
  it("adds every cost line", () => {
    expect(totalUnitCost(COSTED.cost)).toBe(4000);
    expect(totalUnitCost(EMPTY_COST)).toBe(0);
  });
});

describe("unitMargin / marginPct", () => {
  it("computes margin against the price actually charged", () => {
    expect(unitMargin(COSTED)).toBe(3500); // $75 − $40
    expect(marginPct(COSTED)).toBeCloseTo(46.67, 1);
  });

  it("returns null rather than a fake 100% when no cost is captured", () => {
    // The trap: cost 0 would make margin look like the whole selling price.
    expect(unitMargin(UNCOSTED)).toBeNull();
    expect(marginPct(UNCOSTED)).toBeNull();
  });

  it("reports a negative margin when a product sells below cost", () => {
    const losing = product({
      id: "bad",
      name: "Vendido bajo costo",
      cost: { ...EMPTY_COST, materialCents: 10000 },
      sellingPriceCents: 7500,
    });
    expect(unitMargin(losing)).toBe(-2500);
    expect(marginPct(losing)).toBeCloseTo(-33.3, 1);
  });
});

describe("buildInventory", () => {
  const plan: StockPlan = {
    id: "p",
    eventId: "f",
    lines: [
      { productId: "sep", variant: "—", target: 30, made: true, packed: 30 },
      { productId: "pocion", variant: "—", target: 18, made: false, packed: 0 },
    ],
  };

  const sale: BoothEvent = {
    type: "saleRecorded",
    id: "s1",
    eventId: "f",
    ts: "2026-07-15T10:00:00.000Z",
    items: [{ productId: "sep", variant: "—", qty: 4, unitPriceCents: 7500 }],
    payType: "efectivo",
  };

  const inventory = buildInventory([COSTED, UNCOSTED], plan, [sale]);

  it("never reports a negative to-make when stock exceeds the target", () => {
    // 32 in the workshop against a target of 30.
    expect(inventory.lines[0]).toMatchObject({ currentQty: 32, target: 30, toMake: 0 });
  });

  it("computes the gap for something not made yet", () => {
    expect(inventory.lines[1]).toMatchObject({ currentQty: 0, target: 18, toMake: 18 });
  });

  it("derives what is left on the table from the event log", () => {
    expect(inventory.lines[0]).toMatchObject({ packed: 30, sold: 4, remaining: 26 });
  });

  it("computes goal value and profit per line", () => {
    expect(inventory.lines[0]).toMatchObject({
      unitCostCents: 4000,
      marginCents: 3500,
      goalValueCents: 225000, // 30 × $75
      goalProfitCents: 105000, // 30 × $35
    });
  });

  it("leaves profit null for an uncosted line but still values the goal", () => {
    expect(inventory.lines[1]).toMatchObject({
      goalValueCents: 338400, // 18 × $188
      goalProfitCents: null,
      marginCents: null,
    });
  });

  it("withholds the profit total when any line lacks a cost", () => {
    // The dangerous alternative — summing only the costed lines — would report
    // $1,050 of profit while silently ignoring 18 units.
    expect(inventory.goalProfitCents).toBeNull();
    expect(inventory.missingCostCount).toBe(1);
  });

  it("still totals goal revenue, which needs no cost", () => {
    expect(inventory.goalValueCents).toBe(225000 + 338400);
  });

  it("reports the profit total once every cost is known", () => {
    const costedPocion = product({
      ...UNCOSTED,
      cost: { ...EMPTY_COST, materialCents: 8000 },
    });
    const complete = buildInventory([COSTED, costedPocion], plan, [sale]);
    expect(complete.missingCostCount).toBe(0);
    // 30 × $35 + 18 × ($188 − $80)
    expect(complete.goalProfitCents).toBe(105000 + 18 * 10800);
  });

  it("withholds bench time when a product to make has no production time", () => {
    // POCIÓN has 18 to make and no minutes: a total would understate the work.
    expect(inventory.totalToMakeMinutes).toBeNull();
  });

  it("totals bench time once every pending product has a time", () => {
    const timed = product({ ...UNCOSTED, productionMinutes: 5 });
    const complete = buildInventory([COSTED, timed], plan, []);
    expect(complete.totalToMakeMinutes).toBe(18 * 5); // SEPARADOR has nothing to make
  });

  it("ignores unknown minutes on lines with nothing left to make", () => {
    const noTime = product({ ...COSTED, productionMinutes: undefined });
    const complete = buildInventory(
      [noTime],
      { id: "p", eventId: "f", lines: [plan.lines[0]] },
      [],
    );
    expect(complete.totalToMake).toBe(0);
    expect(complete.totalToMakeMinutes).toBe(0);
  });

  it("totals the stock picture", () => {
    expect(inventory).toMatchObject({
      totalCurrent: 32,
      totalTarget: 48,
      totalPacked: 30,
      totalToMake: 18,
    });
  });
});

describe("toMakeQueue", () => {
  it("skips lines the vendor has declared finished", () => {
    const plan: StockPlan = {
      id: "p",
      eventId: "f",
      lines: [
        // 16 of 30, but production is done — their real "ya" case.
        { productId: "sep", variant: "—", target: 30, made: true, packed: 0 },
        { productId: "pocion", variant: "—", target: 18, made: false, packed: 0 },
      ],
    };
    const short = product({ ...COSTED, stockByVariant: { "—": 16 } });
    const queue = toMakeQueue(buildInventory([short, UNCOSTED], plan, []));

    expect(queue.map((l) => l.productName)).toEqual(["POCIÓN 1"]);
  });

  it("ranks by margin × units when margins are known", () => {
    const cheap = product({
      id: "a",
      name: "Barato",
      cost: { ...EMPTY_COST, materialCents: 1000 },
      sellingPriceCents: 2000, // $10 margin
    });
    const rich = product({
      id: "b",
      name: "Caro",
      cost: { ...EMPTY_COST, materialCents: 10000 },
      sellingPriceCents: 40000, // $300 margin
    });
    const plan: StockPlan = {
      id: "p",
      eventId: "f",
      lines: [
        { productId: "a", variant: "—", target: 50, made: false, packed: 0 }, // 50 × $10 = $500
        { productId: "b", variant: "—", target: 5, made: false, packed: 0 }, // 5 × $300 = $1,500
      ],
    };
    const queue = toMakeQueue(buildInventory([cheap, rich], plan, []));
    expect(queue.map((l) => l.productName)).toEqual(["Caro", "Barato"]);
  });
});
