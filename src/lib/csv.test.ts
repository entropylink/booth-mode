import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NO_VARIANT,
  emptyTemplateCSV,
  exportStockPlanCSV,
  fairPriceFromHouse,
  importStockPlanCSV,
  parseCSV,
  tierIdFromLabel,
} from "./csv";
import { buildInventory } from "./inventory";
import { TEMPLATE_HEADER } from "../core-data/template";
import type { StockPlan } from "../core-data/types";

const REAL_CSV = readFileSync(
  fileURLToPath(new URL("./__fixtures__/feria-stock-plan.csv", import.meta.url)),
  "utf8",
);

describe("parseCSV", () => {
  it("handles quotes, escaped quotes, and CRLF", () => {
    expect(parseCSV("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCSV('name,note\n"Tabla, grande","dice ""hola"""')).toEqual([
      ["name", "note"],
      ["Tabla, grande", 'dice "hola"'],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCSV("a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("tierIdFromLabel", () => {
  it("takes the head of a 'Name – strategy' label", () => {
    expect(tierIdFromLabel("Flagship – go deep")).toBe("flagship");
    expect(tierIdFromLabel("Impulse – deep")).toBe("impulse");
    expect(tierIdFromLabel("Mid – moderate")).toBe("mid");
    expect(tierIdFromLabel("Hero – exhibition")).toBe("hero");
  });

  it("keeps an internal hyphen that is part of the name", () => {
    // "Off-theme" must not be split on its own hyphen.
    expect(tierIdFromLabel("Off-theme – minimal")).toBe("off-theme");
  });

  it("survives a label with no strategy suffix", () => {
    expect(tierIdFromLabel("Flagship")).toBe("flagship");
  });
});

describe("fairPriceFromHouse", () => {
  it("applies the 1.25 markup and rounds to a whole peso", () => {
    expect(fairPriceFromHouse(6000)).toBe(7500); // $60 → $75
    expect(fairPriceFromHouse(25000)).toBe(31300); // $250 → $312.50 → $313
    expect(fairPriceFromHouse(1000)).toBe(1300); // $10 → $12.50 → $13
    expect(fairPriceFromHouse(300)).toBe(400); // $3 → $3.75 → $4
    expect(fairPriceFromHouse(600000)).toBe(750000); // $6,000 → $7,500
  });
});

// --- the real spreadsheet (plan.md §6 F1 / P0 gate) -------------------------

describe("importing the real feria stock plan", () => {
  const result = importStockPlanCSV(REAL_CSV);

  it("imports every product row without errors", () => {
    expect(result.errors).toEqual([]);
    // 63 lines: 1 header + 61 products + 1 TOTAL row.
    expect(result.products).toHaveLength(61);
    expect(result.lines).toHaveLength(61);
  });

  it("skips the spreadsheet's own TOTAL row", () => {
    expect(result.products.some((p) => /^total$/i.test(p.name))).toBe(false);
  });

  it("recovers the five named tiers in first-seen order", () => {
    expect(result.tiers.map((t) => t.label)).toEqual([
      "Flagship – go deep",
      "Impulse – deep",
      "Mid – moderate",
      "Hero – exhibition",
      "Off-theme – minimal",
    ]);
    expect(result.tiers.map((t) => t.id)).toEqual([
      "flagship",
      "impulse",
      "mid",
      "hero",
      "off-theme",
    ]);
    expect(result.tiers.every((t) => /^#[0-9a-f]{6}$/i.test(t.color))).toBe(true);
  });

  it("infers the two unlabelled columns and says so", () => {
    expect(result.inferred).toHaveLength(2);
    expect(result.inferred[0]).toContain('"made"');
    expect(result.inferred[0]).toContain("ya");
    expect(result.inferred[1]).toContain('"machine"');
    expect(result.inferred[1]).toContain("laser");
  });

  it("does not report the derived GOAL VALUE column as unknown", () => {
    expect(result.unknownColumns).toEqual([]);
  });

  it("keeps the vendor's SKU as the product identity", () => {
    const separador = result.products.find((p) => p.name === "SEPARADOR M2");
    expect(separador).toMatchObject({ sku: "53", id: "sku-53", tierId: "flagship" });
  });

  it("reads prices with thousands separators", () => {
    const armadura = result.products.find((p) => p.name === "ARMADURA 2");
    expect(armadura).toMatchObject({
      housePriceCents: 600000, // "6,000"
      sellingPriceCents: 750000, // "7,500"
    });
  });

  it("treats a blank CURRENT QTY as zero, not as missing", () => {
    const pocion2 = result.products.find((p) => p.name === "POCIÓN 2");
    expect(pocion2?.stockByVariant[NO_VARIANT]).toBe(0);
  });

  it("reads the 'ya' flag as made, independently of hitting the goal", () => {
    const byName = (name: string) => {
      const product = result.products.find((p) => p.name === name);
      return result.lines.find((l) => l.productId === product?.id);
    };
    // 16 of a goal of 30, but the vendor called production done.
    expect(byName("SEPARADOR S2")).toMatchObject({ target: 30, made: true });
    // 47 of 47 but unmarked — their known omission, imported as written.
    expect(byName("MISTERY SCROLL")).toMatchObject({ target: 47, made: false });
    expect(byName("POCIÓN 2")).toMatchObject({ target: 10, made: false });
  });

  it("reads the production method that joins to Forge Log", () => {
    const machines = new Map(result.products.map((p) => [p.name, p.machine]));
    expect(machines.get("DICE TOWER")).toBe("laser");
    expect(machines.get("PUPPET")).toBe("cameo");
    expect(machines.get("HACHA")).toBe("craft");
    expect(machines.get("SEPARADOR M2")).toBeUndefined();
  });

  it("carries no cost yet — the sheet has none, and margin must stay unknown", () => {
    expect(result.products.every((p) => p.cost.materialCents === 0)).toBe(true);
  });

  it("defaults every imported product to active", () => {
    expect(result.products.every((p) => p.active)).toBe(true);
  });
});

describe("the real plan's inventory maths", () => {
  const result = importStockPlanCSV(REAL_CSV);
  const plan: StockPlan = { id: "p", eventId: "f", lines: result.lines };
  const inventory = buildInventory(result.products, plan, []);

  it("reproduces the spreadsheet's 729-unit goal", () => {
    expect(inventory.totalTarget).toBe(729);
  });

  it("computes what is still to be made", () => {
    // Only positive gaps count: 40 in stock against a goal of 30 is 0 to make.
    const separadorM1 = inventory.lines.find((l) => l.productName === "SEPARADOR M1");
    expect(separadorM1).toMatchObject({ currentQty: 40, target: 30, toMake: 0 });

    const pocion1 = inventory.lines.find((l) => l.productName === "POCIÓN 1");
    expect(pocion1).toMatchObject({ currentQty: 0, target: 18, toMake: 18 });
  });

  it("withholds profit entirely while any cost is missing", () => {
    expect(inventory.goalProfitCents).toBeNull();
    expect(inventory.missingCostCount).toBe(61);
  });

  it("still reports goal revenue, which needs no cost", () => {
    // Every line: target × selling price, from the price actually charged.
    const expected = inventory.lines.reduce(
      (sum, l) => sum + l.target * l.sellingPriceCents,
      0,
    );
    expect(inventory.goalValueCents).toBe(expected);
    expect(inventory.goalValueCents).toBeGreaterThan(0);
  });
});

// --- round-trip -------------------------------------------------------------

describe("canonical template round-trip", () => {
  it("exports the canonical header", () => {
    expect(emptyTemplateCSV().trim()).toBe(TEMPLATE_HEADER.join(","));
    expect(TEMPLATE_HEADER[0]).toBe("sku");
  });

  it("survives the real sheet → export → import unchanged", () => {
    const first = importStockPlanCSV(REAL_CSV);
    const plan: StockPlan = { id: "p", eventId: "f", lines: first.lines };
    const inventory = buildInventory(first.products, plan, []);

    const exported = exportStockPlanCSV(inventory.lines, first.products, first.tiers);
    const second = importStockPlanCSV(exported);

    expect(second.errors).toEqual([]);
    expect(second.unknownColumns).toEqual([]);
    expect(second.products).toEqual(first.products);
    expect(second.lines).toEqual(first.lines);
    expect(second.tiers).toEqual(first.tiers);
  });

  it("round-trips names containing commas and quotes", () => {
    const first = importStockPlanCSV(
      [
        "sku,product,variant,tier,house_price,current_qty,goal_qty",
        '1,"Tabla, grande",Roble,Mid – moderate,249.50,3,12',
        '2,"Dice ""Hero""",,Hero – exhibition,800,1,2',
      ].join("\n"),
    );
    expect(first.errors).toEqual([]);

    const plan: StockPlan = { id: "p", eventId: "f", lines: first.lines };
    const inventory = buildInventory(first.products, plan, []);
    const second = importStockPlanCSV(
      exportStockPlanCSV(inventory.lines, first.products, first.tiers),
    );

    expect(second.products.map((p) => p.name)).toEqual(['Tabla, grande', 'Dice "Hero"']);
    expect(second.products).toEqual(first.products);
  });
});

// --- the canonical template with costs --------------------------------------

describe("importing the canonical template", () => {
  const csv = [
    TEMPLATE_HEADER.join(","),
    // sku,product,variant,tier,machine,mat,mach,labor,cons,pack,house,selling,cur,goal,made,packed,mins,thresh,active,notes,<derived...>
    "53,SEPARADOR M2,Roble,Flagship – go deep,laser,12,3,20,1,4,60,75,32,30,yes,10,8,5,yes,,40.00,35.00,46.7,0,2250.00,1050.00",
  ].join("\n");

  const result = importStockPlanCSV(csv);

  it("reads the full cost breakdown", () => {
    expect(result.errors).toEqual([]);
    expect(result.products[0].cost).toEqual({
      materialCents: 1200,
      machineCents: 300,
      laborCents: 2000,
      consumableCents: 100,
      packagingCents: 400,
    });
  });

  it("reads production time and per-product threshold", () => {
    expect(result.products[0]).toMatchObject({ productionMinutes: 8, restockThreshold: 5 });
  });

  it("ignores the derived columns rather than trusting them", () => {
    const plan: StockPlan = { id: "p", eventId: "f", lines: result.lines };
    const inventory = buildInventory(result.products, plan, []);
    const line = inventory.lines[0];

    // Recomputed from the inputs: 12+3+20+1+4 = $40 cost, $75 − $40 = $35.
    expect(line.unitCostCents).toBe(4000);
    expect(line.marginCents).toBe(3500);
    expect(line.marginPct).toBeCloseTo(46.67, 1);
    // The file claimed goal_profit 1050.00; recomputed it is 30 × $35 = $1,050.
    expect(line.goalProfitCents).toBe(105000);
  });

  it("recomputes derived columns even when the file's are wrong", () => {
    const lying = [
      TEMPLATE_HEADER.join(","),
      "53,SEPARADOR M2,,Flagship – go deep,,12,3,20,1,4,60,75,32,30,yes,10,,,yes,,999.00,999.00,99.9,999,999999.00,999999.00",
    ].join("\n");
    const parsed = importStockPlanCSV(lying);
    const plan: StockPlan = { id: "p", eventId: "f", lines: parsed.lines };
    const inventory = buildInventory(parsed.products, plan, []);

    expect(inventory.lines[0].unitCostCents).toBe(4000);
    expect(inventory.goalValueCents).toBe(225000); // 30 × $75, not the claimed nonsense
  });
});

// --- tolerance --------------------------------------------------------------

describe("importer tolerance", () => {
  it("accepts English, Spanish, and accented headers", () => {
    const result = importStockPlanCSV(
      "Artículo,Nivel,Precio Venta,Existencia,Meta\nPieza,Hero – exhibition,1200,2,3",
    );
    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({ name: "Pieza", sellingPriceCents: 120000 });
    expect(result.lines[0]).toMatchObject({ target: 3 });
  });

  it("derives the fair price when only a house price is given", () => {
    const result = importStockPlanCSV("product,house_price,goal_qty\nVELA,200,5");
    expect(result.products[0]).toMatchObject({
      housePriceCents: 20000,
      sellingPriceCents: 25000, // 200 × 1.25
    });
  });

  it("keeps good rows and reports bad ones", () => {
    const result = importStockPlanCSV(
      [
        "sku,product,tier,house_price,current_qty,goal_qty",
        "1,Bueno,Mid – moderate,120,2,24",
        "2,PrecioMalo,Mid – moderate,abc,2,24",
        "3,ExistenciaMala,Mid – moderate,120,x,24",
        "4,ObjetivoMalo,Mid – moderate,120,2,-4",
        "1,SkuRobado,Mid – moderate,120,2,24",
      ].join("\n"),
    );

    expect(result.products).toHaveLength(1);
    expect(result.lines).toHaveLength(1);
    expect(result.errors).toEqual([
      'Fila 3: precio casa inválido "abc"',
      'Fila 4: existencia inválida "x"',
      'Fila 5: objetivo inválido "-4"',
      'Fila 6: SKU 1 usado por "Bueno" y "SkuRobado"',
    ]);
  });

  it("reports unknown columns rather than hiding them", () => {
    const result = importStockPlanCSV("product,goal_qty,selling_price,peso_gramos\nX,1,10,500");
    expect(result.unknownColumns).toEqual(["peso_gramos"]);
    expect(result.products).toHaveLength(1);
  });

  it("refuses a file with no product column", () => {
    const result = importStockPlanCSV("foo,bar\n1,2");
    expect(result.products).toEqual([]);
    expect(result.errors[0]).toContain("Falta la columna de producto");
  });

  it("handles an empty file", () => {
    expect(importStockPlanCSV("").errors).toEqual(["CSV vacío"]);
  });

  it("groups variants of one SKU into a single product", () => {
    const result = importStockPlanCSV(
      [
        "sku,product,variant,selling_price,current_qty,goal_qty",
        "10,Coasters,Roble,120,5,12",
        "10,Coasters,Nogal,120,3,8",
      ].join("\n"),
    );
    expect(result.products).toHaveLength(1);
    expect(result.products[0].variants).toEqual(["Roble", "Nogal"]);
    expect(result.products[0].stockByVariant).toEqual({ Roble: 5, Nogal: 3 });
    expect(result.lines).toHaveLength(2);
  });
});
