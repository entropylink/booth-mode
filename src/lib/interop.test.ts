// The contract with Forge Log.
//
// forge-log-catalog-export.csv is a real file produced by Forge Log's
// exportCatalogCSV (../forge-log/src/lib/csv.ts) from the vendor's catalog. It
// is committed here, unedited, so this suite fails the moment the two apps stop
// agreeing on the template — which is the whole point of core-data/template.ts
// being duplicated byte-for-byte between the repos.
//
// Regenerate it from the forge-log repo if the template legitimately changes,
// and expect to change it in both places.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportStockPlanCSV, importStockPlanCSV } from "./csv";
import { buildInventory } from "./inventory";
import { deriveDay } from "./derive";
import { totalUnitCost } from "./money";
import { TEMPLATE_HEADER } from "../core-data/template";
import type { StockPlan } from "../core-data/types";

const FORGE_EXPORT = readFileSync(
  fileURLToPath(new URL("./__fixtures__/forge-log-catalog-export.csv", import.meta.url)),
  "utf8",
);

/**
 * A row Forge Log's costing module actually produced, captured from its UI:
 * LEATHER KEYCHAIN costed at $64.25 (4% of a $450 leather sheet, 6 min laser,
 * 8 min labour, 30 min setup over a batch of 12, rivet + ring, packaging).
 */
const FORGE_COSTED = readFileSync(
  fileURLToPath(new URL("./__fixtures__/forge-log-costed-export.csv", import.meta.url)),
  "utf8",
);

describe("Booth Mode reads what Forge Log writes", () => {
  const result = importStockPlanCSV(FORGE_EXPORT);

  it("uses the identical header", () => {
    expect(FORGE_EXPORT.split("\n")[0]).toBe(TEMPLATE_HEADER.join(","));
  });

  it("imports the whole catalog with no errors and nothing guessed", () => {
    expect(result.errors).toEqual([]);
    expect(result.unknownColumns).toEqual([]);
    // Forge Log labels its columns, so nothing needs sniffing.
    expect(result.inferred).toEqual([]);
    expect(result.products).toHaveLength(61);
  });

  it("carries the tiers across intact, ids and labels both", () => {
    expect(result.tiers.map((t) => t.id)).toEqual([
      "flagship",
      "impulse",
      "mid",
      "hero",
      "off-theme",
    ]);
    expect(result.tiers.map((t) => t.label)).toEqual([
      "Flagship – go deep",
      "Impulse – deep",
      "Mid – moderate",
      "Hero – exhibition",
      "Off-theme – minimal",
    ]);
  });

  it("keeps SKUs stable, so a product is the same product in both apps", () => {
    const separador = result.products.find((p) => p.sku === "53");
    expect(separador).toMatchObject({ id: "sku-53", name: "SEPARADOR M2" });
  });

  it("receives the cost breakdown Forge Log captured", () => {
    const separador = result.products.find((p) => p.sku === "53");
    expect(separador?.cost).toEqual({
      materialCents: 1200,
      machineCents: 300,
      laborCents: 2000,
      consumableCents: 100,
      packagingCents: 400,
    });
    expect(totalUnitCost(separador!.cost)).toBe(4000);
    expect(separador?.productionMinutes).toBe(8);
    expect(separador?.machine).toBe("laser");
  });

  it("computes margin from Forge Log's costs", () => {
    const plan: StockPlan = {
      id: "p",
      eventId: "f",
      // The vendor sets targets in Booth Mode; Forge Log sent goal_qty 0.
      lines: result.lines.map((l) => ({ ...l, target: l.productId === "sku-53" ? 30 : 0 })),
    };
    const inventory = buildInventory(result.products, plan, []);
    const separador = inventory.lines.find((l) => l.sku === "53");

    expect(separador).toMatchObject({
      unitCostCents: 4000,
      sellingPriceCents: 7500,
      marginCents: 3500, // $75 − $40
      goalValueCents: 225000, // 30 × $75
      goalProfitCents: 105000, // 30 × $35
    });
    expect(separador?.marginPct).toBeCloseTo(46.67, 1);
  });

  it("carries workshop stock into current_qty", () => {
    const plan: StockPlan = { id: "p", eventId: "f", lines: result.lines };
    const inventory = buildInventory(result.products, plan, []);
    expect(inventory.lines.find((l) => l.sku === "53")?.currentQty).toBe(32);
    expect(inventory.totalCurrent).toBeGreaterThan(0);
  });

  it("leaves the fair columns for Booth Mode to fill in", () => {
    // Forge Log has no fair, so it sends no targets. Booth Mode owns these.
    expect(result.lines.every((l) => l.target === 0)).toBe(true);
    expect(result.lines.every((l) => l.packed === 0)).toBe(true);
    expect(result.lines.every((l) => l.made === false)).toBe(true);
  });

  it("still withholds the profit total, because most products lack costs", () => {
    const plan: StockPlan = { id: "p", eventId: "f", lines: result.lines };
    const inventory = buildInventory(result.products, plan, []);
    expect(inventory.goalProfitCents).toBeNull();
    expect(inventory.missingCostCount).toBe(59); // 61 minus the 2 that are costed
  });

  it("turns Forge Log's costing into a real profit figure", () => {
    // The point of the whole suite: Booth Mode's "—" becomes a number the
    // moment Forge Log has costed the product.
    const costed = importStockPlanCSV(FORGE_COSTED);
    expect(costed.errors).toEqual([]);

    const product = costed.products[0];
    expect(product).toMatchObject({ sku: "79", name: "LEATHER KEYCHAIN", machine: "laser" });
    expect(product.cost).toEqual({
      materialCents: 1800,
      machineCents: 1200,
      // Setup time folded into labour: the template has no setup column, and
      // inventing one would fork the format (see forge-log's costing.ts).
      laborCents: 2625,
      consumableCents: 600,
      packagingCents: 200,
    });
    expect(totalUnitCost(product.cost)).toBe(6425);

    const plan: StockPlan = {
      id: "p",
      eventId: "f",
      lines: costed.lines.map((l) => ({ ...l, target: 12, packed: 12 })),
    };
    const inventory = buildInventory(costed.products, plan, []);
    const line = inventory.lines[0];

    // Recomputed here, not read from the file's derived columns.
    expect(line.marginCents).toBe(12375); // $188 − $64.25
    expect(line.marginPct).toBeCloseTo(65.8, 1);
    expect(line.goalProfitCents).toBe(148500); // 12 × $123.75
    expect(inventory.goalProfitCents).toBe(148500);
    expect(inventory.missingCostCount).toBe(0);
  });

  it("computes gross profit from Forge Log's costs after a sale", () => {
    const costed = importStockPlanCSV(FORGE_COSTED);
    const plan: StockPlan = {
      id: "p",
      eventId: "f",
      lines: costed.lines.map((l) => ({ ...l, target: 12, packed: 12 })),
    };
    const fair = {
      id: "f",
      name: "Feria",
      dates: ["2026-07-15"],
      boothFeeCents: 0,
      status: "active" as const,
    };
    const sale = {
      type: "saleRecorded" as const,
      id: "s1",
      eventId: "f",
      ts: "2026-07-15T10:00:00.000Z",
      items: [{ productId: costed.products[0].id, variant: "—", qty: 3, unitPriceCents: 18800 }],
      payType: "efectivo" as const,
    };

    const summary = deriveDay([sale], { fair, products: costed.products, plan });
    expect(summary.grossCents).toBe(56400); // 3 × $188
    expect(summary.cogsCents).toBe(19275); // 3 × $64.25
    expect(summary.grossProfitCents).toBe(37125); // 3 × $123.75
    expect(summary.byProduct[0].profitCents).toBe(37125);
  });

  it("survives a Forge Log → Booth Mode → Forge Log round-trip", () => {
    const plan: StockPlan = { id: "p", eventId: "f", lines: result.lines };
    const inventory = buildInventory(result.products, plan, []);

    // Booth Mode's exporter must produce something Booth Mode itself re-reads
    // identically — the same guarantee Forge Log's own round-trip test makes.
    const back = importStockPlanCSV(
      exportStockPlanCSV(inventory.lines, result.products, result.tiers),
    );

    expect(back.errors).toEqual([]);
    expect(back.products).toEqual(result.products);
    expect(back.tiers).toEqual(result.tiers);
    expect(back.lines).toEqual(result.lines);
  });
});
