// Maps the canonical stock template (core-data/template.ts) to and from Booth
// Mode's model: Tier, Product and StockPlanLine.
//
// The file format itself lives in template.ts and is shared byte-for-byte with
// Forge Log. This file is only the adapter — everything here is about *this*
// app's shape, which is why it is not shared.

import { config } from "../config";
import {
  emptyTemplateCSV,
  parseTemplateCSV,
  serializeTemplateCSV,
  stripDiacritics,
  TEMPLATE_HEADER,
  type InferredColumn,
  type TemplateIssue,
  type TemplateOutRow,
} from "../core-data/template";
import {
  EMPTY_COST,
  type Cents,
  type InventoryLine,
  type Product,
  type StockPlanLine,
  type Tier,
  type UnitCost,
} from "../core-data/types";

export const NO_VARIANT = "—";

export interface ImportResult {
  tiers: Tier[];
  products: Product[];
  lines: StockPlanLine[];
  /** Structured so each app can phrase them in its own language. */
  issues: TemplateIssue[];
  inferred: InferredColumn[];
  unknownColumns: string[];
}

export function slugId(name: string): string {
  return (
    stripDiacritics(name.trim().toLowerCase())
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

/**
 * "Flagship – go deep" -> "flagship". Splits only on a dash *surrounded by
 * spaces*, so "Off-theme – minimal" keeps its hyphen and becomes "off-theme".
 */
export function tierIdFromLabel(label: string): string {
  const head = label.split(/\s+[–—-]\s+/)[0] ?? label;
  return slugId(head);
}

/** The fair price implied by a house price, when none was given explicitly. */
export function fairPriceFromHouse(housePriceCents: Cents): Cents {
  const raw = housePriceCents * config.pricing.fairMarkup;
  return config.pricing.roundToWholePeso
    ? Math.round(raw / config.currency.minorPerMajor) * config.currency.minorPerMajor
    : Math.round(raw);
}

/**
 * Merge imported plan lines into the current plan, ADDITIVELY. A catalog
 * exported from Forge Log carries goal_qty/made as 0/false (Forge has no fair),
 * so re-importing it must never wipe fair targets set here in Booth Mode. An
 * existing line is therefore only updated by a REAL imported value: a positive
 * target replaces the target, a true `made` sets made — 0/false mean "no
 * opinion, keep what's here". New lines are appended as-is. `packed` always
 * survives (it is never part of an imported line).
 */
export function mergeImportedPlanLines(
  existing: readonly StockPlanLine[],
  imported: readonly StockPlanLine[],
): StockPlanLine[] {
  const merged = [...existing];
  for (const line of imported) {
    const i = merged.findIndex(
      (l) => l.productId === line.productId && l.variant === line.variant,
    );
    if (i >= 0) {
      merged[i] = {
        ...merged[i],
        target: line.target > 0 ? line.target : merged[i].target,
        made: line.made || merged[i].made,
      };
    } else {
      merged.push(line);
    }
  }
  return merged;
}

export function importStockPlanCSV(text: string): ImportResult {
  const parsed = parseTemplateCSV(text);
  const issues = [...parsed.issues];

  const tiersById = new Map<string, Tier>();
  const productsById = new Map<string, Product>();
  const lines: StockPlanLine[] = [];
  const seenSku = new Map<string, string>();

  for (const row of parsed.rows) {
    // --- tier
    let tierId = "sin-tier";
    if (row.tier !== "") {
      tierId = tierIdFromLabel(row.tier);
      const existing = tiersById.get(tierId);
      // Two different labels collapsing to one id — keep them apart.
      if (existing && existing.label !== row.tier) tierId = slugId(row.tier);
      if (!tiersById.has(tierId)) {
        tiersById.set(tierId, {
          id: tierId,
          label: row.tier,
          sortOrder: tiersById.size,
          color:
            config.tierPalette[tiersById.size % config.tierPalette.length] ??
            config.tierFallbackColor,
        });
      }
    }

    // --- price
    let sellingPriceCents = row.sellingPriceCents;
    if (sellingPriceCents === null && row.housePriceCents !== null) {
      sellingPriceCents = fairPriceFromHouse(row.housePriceCents);
    }
    if (sellingPriceCents === null) {
      issues.push({ kind: "bad-value", row: row.rowNum, column: "selling_price", value: "" });
      continue;
    }

    const cost: UnitCost = {
      materialCents: row.costMaterialCents,
      machineCents: row.costMachineCents,
      laborCents: row.costLaborCents,
      consumableCents: row.costConsumableCents,
      packagingCents: row.costPackagingCents,
    };

    // --- identity
    const id = row.sku !== "" ? `sku-${slugId(row.sku)}` : slugId(row.product);
    if (row.sku !== "") {
      const claimedBy = seenSku.get(row.sku);
      if (claimedBy !== undefined && claimedBy !== row.product) {
        issues.push({ kind: "bad-value", row: row.rowNum, column: "sku", value: row.sku });
        continue;
      }
      seenSku.set(row.sku, row.product);
    }

    const variant = row.variant || NO_VARIANT;

    // A variant name becomes a KEY of stockByVariant, i.e. a Firestore field name
    // on sync. Firestore rejects field names matching /^__.*__$/, and one such
    // name silently aborts the entire sync pass. Reject it at import instead.
    if (/^__.*__$/.test(variant)) {
      issues.push({ kind: "bad-value", row: row.rowNum, column: "variant", value: variant });
      continue;
    }

    let product = productsById.get(id);
    if (!product) {
      product = {
        id,
        sku: row.sku,
        name: row.product,
        variants: [],
        tierId,
        machine: row.machine || undefined,
        cost,
        housePriceCents: row.housePriceCents ?? sellingPriceCents,
        sellingPriceCents,
        stockByVariant: {},
        productionMinutes: row.productionMinutes ?? undefined,
        restockThreshold: row.restockThreshold ?? undefined,
        active: row.active,
        notes: row.notes || undefined,
      };
      productsById.set(id, product);
    }

    if (lines.some((l) => l.productId === id && l.variant === variant)) {
      issues.push({ kind: "bad-value", row: row.rowNum, column: "variant", value: variant });
      continue;
    }

    if (!product.variants.includes(variant)) product.variants.push(variant);
    product.stockByVariant[variant] = row.currentQty;

    lines.push({
      productId: id,
      variant,
      target: row.goalQty,
      made: row.made,
      packed: row.packedQty,
    });
  }

  return {
    tiers: [...tiersById.values()],
    products: [...productsById.values()],
    lines,
    issues,
    inferred: parsed.inferred,
    unknownColumns: parsed.unknownColumns,
  };
}

/**
 * Write the canonical template from the live inventory picture. Derived columns
 * are filled from lib/inventory's figures, not re-derived here.
 */
export function exportStockPlanCSV(
  inventory: readonly InventoryLine[],
  products: readonly Product[],
  tiers: readonly Tier[],
): string {
  const productById = new Map(products.map((p) => [p.id, p]));
  const tierById = new Map(tiers.map((t) => [t.id, t]));

  const rows: TemplateOutRow[] = [];
  for (const line of inventory) {
    const product = productById.get(line.productId);
    if (!product) continue;

    rows.push({
      sku: product.sku,
      product: product.name,
      variant: line.variant === NO_VARIANT ? "" : line.variant,
      tier: tierById.get(product.tierId)?.label ?? "",
      machine: product.machine ?? "",
      costMaterialCents: product.cost.materialCents,
      costMachineCents: product.cost.machineCents,
      costLaborCents: product.cost.laborCents,
      costConsumableCents: product.cost.consumableCents,
      costPackagingCents: product.cost.packagingCents,
      housePriceCents: product.housePriceCents,
      sellingPriceCents: product.sellingPriceCents,
      currentQty: line.currentQty,
      goalQty: line.target,
      made: line.made,
      packedQty: line.packed,
      productionMinutes: product.productionMinutes ?? null,
      restockThreshold: product.restockThreshold ?? null,
      active: product.active,
      notes: product.notes ?? "",
      unitCostCents: line.unitCostCents,
      marginUnitCents: line.marginCents,
      marginPct: line.marginPct,
      toMake: line.toMake,
      goalValueCents: line.goalValueCents,
      goalProfitCents: line.goalProfitCents,
    });
  }

  return serializeTemplateCSV(rows);
}

export { EMPTY_COST, TEMPLATE_HEADER, emptyTemplateCSV };
export { parseCSV } from "../core-data/template";
