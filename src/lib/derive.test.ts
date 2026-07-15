import { describe, expect, it } from "vitest";
import {
  cashExpected,
  deriveDay,
  liveSales,
  remainingByVariant,
  saleTotal,
  soldByVariant,
  variantKey,
} from "./derive";
import { lineTotal, sumCents } from "./money";
import type {
  BoothEvent,
  EventFair,
  PayType,
  Product,
  SaleItem,
  SaleRecorded,
  StockPlan,
} from "../core-data/types";

// --- fixture builders -------------------------------------------------------

let seq = 0;
const ts = (n: number): string => new Date(Date.UTC(2026, 6, 15, 9, 0, n)).toISOString();

function sale(
  items: SaleItem[],
  payType: PayType,
  opts: { id?: string; cashGivenCents?: number; changeDueCents?: number } = {},
): SaleRecorded {
  return {
    type: "saleRecorded",
    id: opts.id ?? `sale${++seq}`,
    eventId: "fair1",
    ts: ts(++seq),
    items,
    payType,
    cashGivenCents: opts.cashGivenCents,
    changeDueCents: opts.changeDueCents,
  };
}

const item = (
  productId: string,
  variant: string,
  qty: number,
  unitPriceCents: number,
  discount?: SaleItem["discount"],
): SaleItem => ({ productId, variant, qty, unitPriceCents, discount });

const FAIR: EventFair = {
  id: "fair1",
  name: "Feria de Prueba",
  dates: ["2026-07-15"],
  boothFeeCents: 80000, // $800
  status: "active",
};

const PRODUCTS: Product[] = [
  {
    id: "coasters",
    name: "Coasters",
    tier: 2,
    variants: ["Roble", "Nogal"],
    priceCents: 12000, // $120
    stockByVariant: {},
  },
  {
    id: "llavero",
    name: "Llavero",
    tier: 1,
    variants: ["—"],
    priceCents: 4500, // $45
    stockByVariant: {},
  },
];

const PLAN: StockPlan = {
  id: "plan1",
  eventId: "fair1",
  lines: [
    { productId: "coasters", variant: "Roble", target: 12, packed: 10 },
    { productId: "coasters", variant: "Nogal", target: 8, packed: 3 },
    { productId: "llavero", variant: "—", target: 20, packed: 20 },
  ],
};

// --- golden day -------------------------------------------------------------

/**
 * A small day whose every figure is hand-computed in the comments below, so the
 * assertions are checkable by reading rather than by trusting the code.
 *
 *   float start   $600.00   (5×$100 + 5×$20)
 *   sale A  2×Coasters Roble @$120   = $240.00  efectivo (paid w/ $500, $260 change)
 *   sale B  1×Llavero @$45           =  $45.00  efectivo (exact)
 *   sale C  3×Coasters Nogal @$120 −10% = $324.00  tarjeta   (36000 × 0.9)
 *   sale D  1×Coasters Roble @$120   = $120.00  efectivo  → VOIDED
 *   expense $150.00 comida, from the box
 *   expense  $60.00 transporte, not from the box
 *   end count $730.00 (7×$100 + 3×$10)
 *
 *   gross    = 240 + 45 + 324            = $609.00
 *   efectivo = 240 + 45                  = $285.00
 *   expenses = 150 + 60                  = $210.00
 *   net      = 609 − 210 − 800 (stand)   = −$401.00
 *   cash exp = 600 + 285 − 150           = $735.00
 *   delta    = 730 − 735                 = −$5.00
 */
function goldenEvents(): BoothEvent[] {
  return [
    {
      type: "floatCounted",
      id: "f1",
      eventId: "fair1",
      ts: ts(1),
      kind: "start",
      denominations: { "10000": 5, "2000": 5 },
      totalCents: 60000,
    },
    sale([item("coasters", "Roble", 2, 12000)], "efectivo", {
      id: "A",
      cashGivenCents: 50000,
      changeDueCents: 26000,
    }),
    sale([item("llavero", "—", 1, 4500)], "efectivo", {
      id: "B",
      cashGivenCents: 4500,
      changeDueCents: 0,
    }),
    sale([item("coasters", "Nogal", 3, 12000, { kind: "pct", pct: 10 })], "tarjeta", {
      id: "C",
    }),
    sale([item("coasters", "Roble", 1, 12000)], "efectivo", { id: "D" }),
    {
      type: "saleVoided",
      id: "v1",
      eventId: "fair1",
      ts: ts(60),
      targetId: "D",
      reason: "cliente se arrepintió",
    },
    {
      type: "expenseAdded",
      id: "e1",
      eventId: "fair1",
      ts: ts(61),
      concept: "Comida",
      amountCents: 15000,
      category: "food",
      paidFromBox: true,
    },
    {
      type: "expenseAdded",
      id: "e2",
      eventId: "fair1",
      ts: ts(62),
      concept: "Gasolina",
      amountCents: 6000,
      category: "transport",
      paidFromBox: false,
    },
    {
      type: "floatCounted",
      id: "f2",
      eventId: "fair1",
      ts: ts(63),
      kind: "end",
      denominations: { "10000": 7, "1000": 3 },
      totalCents: 73000,
    },
  ];
}

const ctx = { fair: FAIR, products: PRODUCTS, plan: PLAN };

describe("deriveDay — golden day", () => {
  const summary = deriveDay(goldenEvents(), ctx);

  it("excludes voided sales from every total", () => {
    expect(summary.saleCount).toBe(3);
    expect(summary.voidCount).toBe(1);
    expect(summary.grossCents).toBe(60900); // $609.00, not $729.00
  });

  it("splits by pay type", () => {
    expect(summary.byPayType).toEqual({
      efectivo: 28500,
      tarjeta: 32400,
      transferencia: 0,
    });
    expect(sumCents(Object.values(summary.byPayType))).toBe(summary.grossCents);
  });

  it("computes net after expenses and the booth fee", () => {
    expect(summary.expensesCents).toBe(21000);
    expect(summary.boothFeeCents).toBe(80000);
    expect(summary.netCents).toBe(-40100); // a losing fair, and it says so
  });

  it("reconciles the cash box including expenses paid from it", () => {
    expect(summary.cashExpectedCents).toBe(73500);
    expect(summary.cashCountedCents).toBe(73000);
    expect(summary.cashDeltaCents).toBe(-500); // $5 short
  });

  it("tallies by product and tier", () => {
    expect(summary.byProduct).toEqual([
      { productId: "coasters", productName: "Coasters", tier: 2, qty: 5, grossCents: 56400 },
      { productId: "llavero", productName: "Llavero", tier: 1, qty: 1, grossCents: 4500 },
    ]);
    expect(summary.byTier).toEqual({ "1": 4500, "2": 56400 });
  });

  it("measures sell-through against what was packed, not stocked", () => {
    expect(summary.unitsSold).toBe(6);
    expect(summary.unitsPacked).toBe(33); // 10 + 3 + 20
    expect(summary.sellThroughPct).toBeCloseTo(18.1818, 3);
  });

  it("lists only the sold-out variant for restock", () => {
    expect(summary.restockList).toEqual([
      {
        productId: "coasters",
        productName: "Coasters",
        variant: "Nogal",
        tier: 2,
        remaining: 0,
        sold: 3,
        soldOut: true,
        score: 36000,
      },
    ]);
  });

  it("derives remaining stock as packed minus sold", () => {
    const remaining = remainingByVariant(goldenEvents(), PLAN);
    expect(remaining.get(variantKey("coasters", "Roble"))).toBe(8); // 10 − 2, void restored 1
    expect(remaining.get(variantKey("coasters", "Nogal"))).toBe(0);
    expect(remaining.get(variantKey("llavero", "—"))).toBe(19);
  });
});

describe("deriveDay — empty day", () => {
  it("returns zeroes rather than NaN when nothing has happened", () => {
    const summary = deriveDay([], { fair: FAIR, products: PRODUCTS, plan: null });
    expect(summary.grossCents).toBe(0);
    expect(summary.netCents).toBe(-80000); // still owe the booth fee
    expect(summary.sellThroughPct).toBe(0);
    expect(summary.cashCountedCents).toBeNull();
    expect(summary.cashDeltaCents).toBeNull();
    expect(summary.restockList).toEqual([]);
  });
});

describe("cashExpected", () => {
  it("falls back to the fair's declared float when there is no start count", () => {
    const fairWithFloat = { ...FAIR, floatStartCents: 100000 };
    const events = [sale([item("llavero", "—", 1, 4500)], "efectivo", { id: "x" })];
    expect(cashExpected(events, fairWithFloat)).toBe(104500);
  });

  it("ignores card and transfer sales", () => {
    const events = [
      sale([item("coasters", "Roble", 1, 12000)], "tarjeta", { id: "t" }),
      sale([item("coasters", "Roble", 1, 12000)], "transferencia", { id: "r" }),
    ];
    expect(cashExpected(events, FAIR)).toBe(0);
  });

  it("does not deduct expenses that were not paid from the box", () => {
    const base: BoothEvent[] = [sale([item("llavero", "—", 2, 4500)], "efectivo", { id: "s" })];
    const notFromBox: BoothEvent = {
      type: "expenseAdded",
      id: "e",
      eventId: "fair1",
      ts: ts(90),
      concept: "Tarjeta",
      amountCents: 5000,
      category: "other",
      paidFromBox: false,
    };
    expect(cashExpected([...base, notFromBox], FAIR)).toBe(9000);
    expect(cashExpected([...base, { ...notFromBox, paidFromBox: true }], FAIR)).toBe(4000);
  });

  it("restores cash when an expense is voided", () => {
    const events: BoothEvent[] = [
      sale([item("llavero", "—", 2, 4500)], "efectivo", { id: "s" }),
      {
        type: "expenseAdded",
        id: "e",
        eventId: "fair1",
        ts: ts(91),
        concept: "Error",
        amountCents: 5000,
        category: "other",
        paidFromBox: true,
      },
      { type: "expenseVoided", id: "ev", eventId: "fair1", ts: ts(92), targetId: "e" },
    ];
    expect(cashExpected(events, FAIR)).toBe(9000);
  });
});

// --- the fair-day drill (plan.md §6 F2 accept) ------------------------------

const DRILL_PRODUCTS: Product[] = [
  { id: "p1", name: "Llavero", tier: 1, variants: ["—"], priceCents: 4500, stockByVariant: {} },
  { id: "p2", name: "Coasters", tier: 2, variants: ["—"], priceCents: 12000, stockByVariant: {} },
  { id: "p3", name: "Tabla", tier: 3, variants: ["—"], priceCents: 25000, stockByVariant: {} },
  { id: "p4", name: "Cuadro", tier: 4, variants: ["—"], priceCents: 48000, stockByVariant: {} },
  { id: "p5", name: "Pieza", tier: 5, variants: ["—"], priceCents: 120000, stockByVariant: {} },
];

const VOIDED_INDEXES = [5, 17, 42];
const PAY_CYCLE: PayType[] = ["efectivo", "efectivo", "efectivo", "tarjeta", "transferencia"];

/** 50 mixed sales, 3 voided, every 7th discounted 10%. */
function drillEvents(): BoothEvent[] {
  const events: BoothEvent[] = [
    {
      type: "floatCounted",
      id: "float-start",
      eventId: "fair1",
      ts: ts(0),
      kind: "start",
      denominations: { "10000": 10, "5000": 20, "2000": 20, "1000": 10 },
      totalCents: 250000, // $2,500 — matches the denominations above
    },
  ];

  for (let i = 0; i < 50; i++) {
    const product = DRILL_PRODUCTS[i % 5];
    const qty = (i % 3) + 1;
    const discount = i % 7 === 0 ? ({ kind: "pct", pct: 10 } as const) : undefined;
    events.push({
      type: "saleRecorded",
      id: `d${i}`,
      eventId: "fair1",
      ts: ts(100 + i),
      items: [item(product.id, "—", qty, product.priceCents, discount)],
      payType: PAY_CYCLE[i % 5],
    });
  }

  for (const i of VOIDED_INDEXES) {
    events.push({
      type: "saleVoided",
      id: `dv${i}`,
      eventId: "fair1",
      ts: ts(200 + i),
      targetId: `d${i}`,
    });
  }

  return events;
}

describe("fair-day drill — 50 sales, 3 voids, discounts", () => {
  const events = drillEvents();
  const drillPlan: StockPlan = {
    id: "plan2",
    eventId: "fair1",
    lines: DRILL_PRODUCTS.map((p) => ({
      productId: p.id,
      variant: "—",
      target: 40,
      packed: 40,
    })),
  };
  const drillCtx = { fair: FAIR, products: DRILL_PRODUCTS, plan: drillPlan };
  const summary = deriveDay(events, drillCtx);

  /**
   * Expected totals, recomputed here by a deliberately naive loop rather than
   * by calling deriveDay — a second path to the same number.
   */
  function expectedGross(): number {
    let total = 0;
    for (let i = 0; i < 50; i++) {
      if (VOIDED_INDEXES.includes(i)) continue;
      const product = DRILL_PRODUCTS[i % 5];
      const qty = (i % 3) + 1;
      const gross = product.priceCents * qty;
      total += i % 7 === 0 ? Math.round((gross * 90) / 100) : gross;
    }
    return total;
  }

  it("counts 47 live sales out of 50", () => {
    expect(summary.saleCount).toBe(47);
    expect(summary.voidCount).toBe(3);
    expect(liveSales(events)).toHaveLength(47);
  });

  it("matches the independently computed gross exactly", () => {
    expect(summary.grossCents).toBe(expectedGross());
  });

  it("splits by pay type without losing a centavo", () => {
    expect(sumCents(Object.values(summary.byPayType))).toBe(summary.grossCents);
  });

  it("keeps per-product and per-tier tallies consistent with the gross", () => {
    expect(sumCents(summary.byProduct.map((p) => p.grossCents))).toBe(summary.grossCents);
    expect(sumCents(Object.values(summary.byTier))).toBe(summary.grossCents);
    expect(summary.byProduct.reduce((n, p) => n + p.qty, 0)).toBe(summary.unitsSold);
  });

  it("reconciles the cash box against the float", () => {
    const cashSales = sumCents(
      liveSales(events)
        .filter((s) => s.payType === "efectivo")
        .map(saleTotal),
    );
    expect(summary.cashExpectedCents).toBe(250000 + cashSales);
  });

  it("never counts a voided sale's units against stock", () => {
    const sold = soldByVariant(events);
    for (const i of VOIDED_INDEXES) {
      const product = DRILL_PRODUCTS[i % 5];
      const liveQty = liveSales(events)
        .filter((s) => s.items[0].productId === product.id)
        .reduce((n, s) => n + s.items[0].qty, 0);
      expect(sold.get(variantKey(product.id, "—"))).toBe(liveQty);
    }
  });

  it("is order-independent — shuffling the log changes nothing", () => {
    const shuffled = [...events].sort((a, b) => a.id.localeCompare(b.id));
    const other = deriveDay(shuffled, drillCtx);
    expect(other.grossCents).toBe(summary.grossCents);
    expect(other.cashExpectedCents).toBe(summary.cashExpectedCents);
    expect(other.unitsSold).toBe(summary.unitsSold);
  });

  it("is idempotent — deriving twice gives the same answer", () => {
    expect(deriveDay(events, drillCtx)).toEqual(summary);
  });
});

describe("saleTotal", () => {
  it("sums a multi-line cart with mixed discounts", () => {
    const s = sale(
      [
        item("p1", "—", 2, 4500),
        item("p2", "—", 1, 12000, { kind: "pct", pct: 10 }),
        item("p3", "—", 1, 25000, { kind: "abs", cents: 5000 }),
      ],
      "efectivo",
    );
    // 9000 + 10800 + 20000
    expect(saleTotal(s)).toBe(39800);
    expect(saleTotal(s)).toBe(
      sumCents(s.items.map((i) => lineTotal(i.unitPriceCents, i.qty, i.discount))),
    );
  });
});
