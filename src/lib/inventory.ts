// Inventory derivations — the stock picture, derived from products + plan +
// the event log. Pure; no storage, no React.
//
// This is the app's centre of gravity: a vendor asks "what do I have, what's
// missing, what do I still have to make" long before they ask about margin.
// Money answers hang off these lines rather than the other way round.

import { soldByVariant, variantKey } from "./derive";
import { totalUnitCost } from "./money";
import type {
  BoothEvent,
  Cents,
  InventoryLine,
  InventorySummary,
  Product,
  StockPlan,
} from "../core-data/types";

/** selling − cost, or null when no cost has been entered for the product. */
export function unitMargin(product: Product): Cents | null {
  const cost = totalUnitCost(product.cost);
  if (cost === 0) return null;
  return product.sellingPriceCents - cost;
}

/** Margin as a percentage of the selling price. Null when cost is unknown. */
export function marginPct(product: Product): number | null {
  const margin = unitMargin(product);
  if (margin === null || product.sellingPriceCents === 0) return null;
  return (margin / product.sellingPriceCents) * 100;
}

export function buildInventory(
  products: readonly Product[],
  plan: StockPlan | null,
  events: readonly BoothEvent[],
): InventorySummary {
  const sold = soldByVariant(events);
  const productById = new Map(products.map((p) => [p.id, p]));
  const lines: InventoryLine[] = [];

  for (const planLine of plan?.lines ?? []) {
    const product = productById.get(planLine.productId);
    if (!product) continue;

    const key = variantKey(planLine.productId, planLine.variant);
    const qtySold = sold.get(key) ?? 0;
    const currentQty = product.stockByVariant[planLine.variant] ?? 0;
    const unitCostCents = totalUnitCost(product.cost);
    const margin = unitMargin(product);

    // What still has to be built to hit the target. Never negative: having 40
    // of a target of 30 means nothing to make, not −10.
    const toMake = Math.max(0, planLine.target - currentQty);

    lines.push({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      variant: planLine.variant,
      tierId: product.tierId,
      machine: product.machine,
      currentQty,
      target: planLine.target,
      made: planLine.made,
      packed: planLine.packed,
      sold: qtySold,
      remaining: planLine.packed - qtySold,
      toMake,
      toMakeMinutes:
        product.productionMinutes === undefined ? null : toMake * product.productionMinutes,
      unitCostCents,
      sellingPriceCents: product.sellingPriceCents,
      marginCents: margin,
      marginPct: marginPct(product),
      goalValueCents: planLine.target * product.sellingPriceCents,
      goalProfitCents: margin === null ? null : planLine.target * margin,
    });
  }

  let totalCurrent = 0;
  let totalTarget = 0;
  let totalPacked = 0;
  let totalToMake = 0;
  let totalToMakeMinutes = 0;
  let anyMinutesUnknown = false;
  let goalValueCents = 0;
  let goalProfitCents = 0;
  let missingCostCount = 0;
  let anyCostMissing = false;

  for (const line of lines) {
    totalCurrent += line.currentQty;
    totalTarget += line.target;
    totalPacked += line.packed;
    totalToMake += line.toMake;
    goalValueCents += line.goalValueCents;

    if (line.toMakeMinutes === null) {
      if (line.toMake > 0) anyMinutesUnknown = true;
    } else {
      totalToMakeMinutes += line.toMakeMinutes;
    }

    if (line.goalProfitCents === null) {
      missingCostCount++;
      anyCostMissing = true;
    } else {
      goalProfitCents += line.goalProfitCents;
    }
  }

  return {
    lines,
    totalCurrent,
    totalTarget,
    totalPacked,
    totalToMake,
    // Refuse to report a bench-time total that silently omits unknown items.
    totalToMakeMinutes: anyMinutesUnknown ? null : totalToMakeMinutes,
    goalValueCents,
    // Same rule for money: a partial profit total is worse than none.
    goalProfitCents: anyCostMissing ? null : goalProfitCents,
    missingCostCount,
  };
}

/** What to build next: biggest gap first, weighted by margin when it is known. */
export function toMakeQueue(summary: InventorySummary): InventoryLine[] {
  return summary.lines
    .filter((l) => l.toMake > 0 && !l.made)
    .sort((a, b) => {
      const aScore = (a.marginCents ?? 0) * a.toMake;
      const bScore = (b.marginCents ?? 0) * b.toMake;
      return bScore - aScore || b.toMake - a.toMake || a.productName.localeCompare(b.productName);
    });
}
