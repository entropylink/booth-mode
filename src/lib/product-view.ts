// Search / filter / sort for the plan's product list. Pure and offline: a booth
// has dozens of products, not millions, so a scan is instant and legible.
//
// Kept in step with Forge Log's src/lib/product-view.ts — same option shape and
// the shared sort keys (name, price, margin, tier) behave identically. Booth
// adds stock/to-make sorts (a fair question); Forge adds a cost sort.

import { stripDiacritics } from "../core-data/template";
import type { InventoryLine } from "../core-data/types";

export const SORT_KEYS = ["name", "price", "margin", "stock", "tomake", "tier"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface ViewOptions {
  /** Free text matched against product name, SKU and variant. */
  query: string;
  /** Restrict to one tier; "" means all tiers. */
  tierId: string;
  sort: SortKey;
}

const norm = (s: string): string => stripDiacritics(s.toLowerCase()).replace(/\s+/g, " ").trim();

/** null (unknown margin) sorts to the bottom of a high→low sort. */
const forDesc = (n: number | null): number => (n === null ? -Infinity : n);

export function viewLines(
  lines: readonly InventoryLine[],
  opts: ViewOptions,
  /** Tier display order, so a "by tier" sort groups tiers as the user arranged them. */
  tierRank: (tierId: string) => number,
): InventoryLine[] {
  const q = norm(opts.query);
  const filtered = lines.filter((l) => {
    if (opts.tierId !== "" && l.tierId !== opts.tierId) return false;
    if (q !== "" && !norm(`${l.productName} ${l.sku} ${l.variant}`).includes(q)) return false;
    return true;
  });

  const byName = (a: InventoryLine, b: InventoryLine): number =>
    a.productName.localeCompare(b.productName) || a.variant.localeCompare(b.variant);

  const cmp: Record<SortKey, (a: InventoryLine, b: InventoryLine) => number> = {
    name: byName,
    price: (a, b) => b.sellingPriceCents - a.sellingPriceCents || byName(a, b),
    margin: (a, b) => forDesc(b.marginCents) - forDesc(a.marginCents) || byName(a, b),
    stock: (a, b) => a.currentQty - b.currentQty || byName(a, b),
    tomake: (a, b) => b.toMake - a.toMake || byName(a, b),
    tier: (a, b) => tierRank(a.tierId) - tierRank(b.tierId) || byName(a, b),
  };

  return [...filtered].sort(cmp[opts.sort]);
}
