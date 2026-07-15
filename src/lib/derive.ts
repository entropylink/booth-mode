// Derivations over the append-only event log (plan.md §4).
//
// Nothing in this file reads or writes storage, and no UI component may sum
// money itself — everything that appears as a total on screen comes from here.
// Voids are compensating events: a voided sale stays in the log but is excluded
// from every derivation.

import { config } from "../config";
import { lineTotal, sumCents } from "./money";
import type {
  BoothEvent,
  Cents,
  DaySummary,
  EventFair,
  PayType,
  Product,
  ProductTally,
  RestockEntry,
  SaleRecorded,
  StockPlan,
  Tier,
} from "../core-data/types";

export interface DeriveContext {
  fair: EventFair;
  products: Product[];
  plan: StockPlan | null;
}

const PAY_TYPES: PayType[] = ["efectivo", "tarjeta", "transferencia"];

export function variantKey(productId: string, variant: string): string {
  return `${productId}::${variant}`;
}

function byTs(a: BoothEvent, b: BoothEvent): number {
  if (a.ts === b.ts) return a.id < b.id ? -1 : 1;
  return a.ts < b.ts ? -1 : 1;
}

/** Ids of sales/expenses cancelled by a later compensating event. */
export function voidedIds(events: readonly BoothEvent[]): Set<string> {
  const voided = new Set<string>();
  for (const e of events) {
    if (e.type === "saleVoided" || e.type === "expenseVoided") voided.add(e.targetId);
  }
  return voided;
}

/** Sales that actually count: recorded, not later voided, in chronological order. */
export function liveSales(events: readonly BoothEvent[]): SaleRecorded[] {
  const voided = voidedIds(events);
  return events
    .filter((e): e is SaleRecorded => e.type === "saleRecorded" && !voided.has(e.id))
    .sort(byTs);
}

/** Total for one sale, discounts applied. */
export function saleTotal(sale: SaleRecorded): Cents {
  return sumCents(
    sale.items.map((item) => lineTotal(item.unitPriceCents, item.qty, item.discount)),
  );
}

/** Units sold per product::variant, net of voids. */
export function soldByVariant(events: readonly BoothEvent[]): Map<string, number> {
  const sold = new Map<string, number>();
  for (const sale of liveSales(events)) {
    for (const item of sale.items) {
      const key = variantKey(item.productId, item.variant);
      sold.set(key, (sold.get(key) ?? 0) + item.qty);
    }
  }
  return sold;
}

/**
 * Stock remaining per product::variant during the fair.
 *
 * What is on the table is what was *packed*, not the workshop's stock figure —
 * so remaining = packed − sold (plan.md §4: decrements are events).
 */
export function remainingByVariant(
  events: readonly BoothEvent[],
  plan: StockPlan | null,
): Map<string, number> {
  const sold = soldByVariant(events);
  const remaining = new Map<string, number>();
  for (const line of plan?.lines ?? []) {
    const key = variantKey(line.productId, line.variant);
    remaining.set(key, line.packed - (sold.get(key) ?? 0));
  }
  return remaining;
}

/** Cash actually in the box: float + cash sales − cash expenses paid from it. */
export function cashExpected(events: readonly BoothEvent[], fair: EventFair): Cents {
  const startCount = [...events]
    .sort(byTs)
    .find((e) => e.type === "floatCounted" && e.kind === "start");

  const floatStart =
    startCount && startCount.type === "floatCounted"
      ? startCount.totalCents
      : (fair.floatStartCents ?? 0);

  const cashIn = sumCents(
    liveSales(events)
      .filter((s) => s.payType === "efectivo")
      .map(saleTotal),
  );

  const voided = voidedIds(events);
  const cashOut = sumCents(
    events
      .filter(
        (e) => e.type === "expenseAdded" && e.paidFromBox && !voided.has(e.id),
      )
      .map((e) => (e.type === "expenseAdded" ? e.amountCents : 0)),
  );

  return floatStart + cashIn - cashOut;
}

/** The most recent end-of-day count, or null if the box hasn't been counted. */
export function cashCounted(events: readonly BoothEvent[]): Cents | null {
  const endCounts = [...events]
    .filter((e) => e.type === "floatCounted" && e.kind === "end")
    .sort(byTs);
  const last = endCounts[endCounts.length - 1];
  return last && last.type === "floatCounted" ? last.totalCents : null;
}

/**
 * Restock list for tomorrow: sold out or at/below threshold, ranked by
 * margin × velocity (plan.md §6 F4).
 *
 * Real margin needs Costing, which arrives with Forge Log sync in v1.5. Until
 * then unit price stands in for margin, so this ranks by revenue velocity.
 */
export function restockList(
  events: readonly BoothEvent[],
  ctx: DeriveContext,
  threshold = config.restockThresholdDefault,
): RestockEntry[] {
  const sold = soldByVariant(events);
  const remaining = remainingByVariant(events, ctx.plan);
  const productById = new Map(ctx.products.map((p) => [p.id, p]));

  const entries: RestockEntry[] = [];
  for (const line of ctx.plan?.lines ?? []) {
    const product = productById.get(line.productId);
    if (!product) continue;

    const key = variantKey(line.productId, line.variant);
    const left = remaining.get(key) ?? 0;
    if (left > threshold) continue;

    const qtySold = sold.get(key) ?? 0;
    entries.push({
      productId: line.productId,
      productName: product.name,
      variant: line.variant,
      tier: product.tier,
      remaining: left,
      sold: qtySold,
      soldOut: left <= 0,
      score: product.priceCents * qtySold,
    });
  }

  return entries.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.soldOut) - Number(a.soldOut) ||
      a.productName.localeCompare(b.productName),
  );
}

/** The whole day, derived. This is the only source of the numbers on screen. */
export function deriveDay(
  events: readonly BoothEvent[],
  ctx: DeriveContext,
  threshold = config.restockThresholdDefault,
): DaySummary {
  const sales = liveSales(events);
  const voided = voidedIds(events);
  const productById = new Map(ctx.products.map((p) => [p.id, p]));

  const byPayType = Object.fromEntries(PAY_TYPES.map((p) => [p, 0])) as Record<
    PayType,
    Cents
  >;
  const byTier: Record<string, Cents> = {};
  const tallies = new Map<string, ProductTally>();

  let grossCents = 0;
  let unitsSold = 0;

  for (const sale of sales) {
    const total = saleTotal(sale);
    grossCents += total;
    byPayType[sale.payType] += total;

    for (const item of sale.items) {
      const product = productById.get(item.productId);
      const tier: Tier = product?.tier ?? 1;
      const itemTotal = lineTotal(item.unitPriceCents, item.qty, item.discount);

      unitsSold += item.qty;
      byTier[tier] = (byTier[tier] ?? 0) + itemTotal;

      const existing = tallies.get(item.productId);
      if (existing) {
        existing.qty += item.qty;
        existing.grossCents += itemTotal;
      } else {
        tallies.set(item.productId, {
          productId: item.productId,
          productName: product?.name ?? item.productId,
          tier,
          qty: item.qty,
          grossCents: itemTotal,
        });
      }
    }
  }

  const expensesCents = sumCents(
    events
      .filter((e) => e.type === "expenseAdded" && !voided.has(e.id))
      .map((e) => (e.type === "expenseAdded" ? e.amountCents : 0)),
  );

  const unitsPacked = (ctx.plan?.lines ?? []).reduce((sum, l) => sum + l.packed, 0);
  const counted = cashCounted(events);
  const expected = cashExpected(events, ctx.fair);
  const boothFeeCents = ctx.fair.boothFeeCents ?? 0;

  return {
    grossCents,
    byPayType,
    byProduct: [...tallies.values()].sort((a, b) => b.grossCents - a.grossCents),
    byTier,
    expensesCents,
    boothFeeCents,
    netCents: grossCents - expensesCents - boothFeeCents,
    unitsSold,
    unitsPacked,
    sellThroughPct: unitsPacked === 0 ? 0 : (unitsSold / unitsPacked) * 100,
    cashExpectedCents: expected,
    cashCountedCents: counted,
    cashDeltaCents: counted === null ? null : counted - expected,
    restockList: restockList(events, ctx, threshold),
    saleCount: sales.length,
    voidCount: events.filter((e) => e.type === "saleVoided").length,
  };
}
