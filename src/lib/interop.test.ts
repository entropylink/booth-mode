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
import { totalUnitCost } from "./money";
import { TEMPLATE_HEADER } from "../core-data/template";
import type { StockPlan } from "../core-data/types";

const FORGE_EXPORT = readFileSync(
  fileURLToPath(new URL("./__fixtures__/forge-log-catalog-export.csv", import.meta.url)),
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
