import { describe, expect, it } from "vitest";
import { NO_VARIANT, exportStockPlanCSV, importStockPlanCSV, parseCSV } from "./csv";

describe("parseCSV", () => {
  it("handles quotes, escaped quotes, and CRLF", () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([
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

describe("importStockPlanCSV", () => {
  const csv = [
    "producto,tier,variante,precio,objetivo",
    "Coasters,2,Roble,120,24",
    "Coasters,2,Nogal,120,18",
    "Llavero,1,,45,60",
  ].join("\n");

  it("imports products and plan lines", () => {
    const result = importStockPlanCSV(csv);
    expect(result.errors).toEqual([]);

    expect(result.products).toEqual([
      {
        id: "coasters",
        name: "Coasters",
        tier: 2,
        variants: ["Roble", "Nogal"],
        priceCents: 12000,
        stockByVariant: { Roble: 24, Nogal: 18 },
      },
      {
        id: "llavero",
        name: "Llavero",
        tier: 1,
        variants: [NO_VARIANT],
        priceCents: 4500,
        stockByVariant: { [NO_VARIANT]: 60 },
      },
    ]);

    expect(result.lines).toEqual([
      { productId: "coasters", variant: "Roble", target: 24, packed: 0 },
      { productId: "coasters", variant: "Nogal", target: 18, packed: 0 },
      { productId: "llavero", variant: NO_VARIANT, target: 60, packed: 0 },
    ]);
  });

  it("accepts English headers and decimal prices", () => {
    const result = importStockPlanCSV(
      "name,tier,variant,price,target\nBoard,3,Small,249.50,10",
    );
    expect(result.errors).toEqual([]);
    expect(result.products[0].priceCents).toBe(24950);
  });

  it("accepts accented and oddly-cased headers", () => {
    const result = importStockPlanCSV(
      "Artículo,Nivel,Versión,Precio MXN,Meta\nPieza,5,Única,1200,3",
    );
    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({ name: "Pieza", tier: 5, priceCents: 120000 });
    expect(result.lines[0]).toMatchObject({ variant: "Única", target: 3 });
  });

  it("slugs accented names into clean ids", () => {
    const result = importStockPlanCSV("producto,tier,precio,objetivo\nPiñata Café,2,80,5");
    expect(result.products[0].id).toBe("pinata-cafe");
  });

  it("keeps the good rows and reports the bad ones", () => {
    const result = importStockPlanCSV(
      [
        "producto,tier,variante,precio,objetivo",
        "Bueno,2,Roble,120,24",
        "SinTier,,Roble,120,24",
        "TierMalo,9,Roble,120,24",
        ",2,Roble,120,24",
        "PrecioMalo,2,Roble,abc,24",
        "ObjetivoMalo,2,Roble,120,-4",
        "Bueno,2,Roble,120,10",
      ].join("\n"),
    );

    expect(result.lines).toHaveLength(1);
    expect(result.products).toHaveLength(1);
    expect(result.errors).toEqual([
      'Fila 3: tier inválido ""',
      'Fila 4: tier inválido "9"',
      "Fila 5: sin nombre",
      'Fila 6: precio inválido "abc"',
      'Fila 7: objetivo inválido "-4"',
      "Fila 8: Bueno / Roble duplicado",
    ]);
  });

  it("reports missing columns instead of importing garbage", () => {
    const result = importStockPlanCSV("foo,bar\n1,2");
    expect(result.products).toEqual([]);
    expect(result.errors[0]).toContain("Faltan columnas");
  });

  it("handles an empty file", () => {
    expect(importStockPlanCSV("").errors).toEqual(["CSV vacío"]);
  });
});

describe("stock plan CSV round-trip", () => {
  it("survives export → import unchanged", () => {
    const original = importStockPlanCSV(
      [
        "producto,tier,variante,precio,objetivo",
        '"Tabla, grande",3,Roble,249.50,12',
        '"Tabla, grande",3,Nogal,249.50,8',
        "Llavero,1,,45,60",
      ].join("\n"),
    );
    expect(original.errors).toEqual([]);

    const reimported = importStockPlanCSV(
      exportStockPlanCSV(original.products, original.lines),
    );

    expect(reimported.errors).toEqual([]);
    expect(reimported.products).toEqual(original.products);
    expect(reimported.lines).toEqual(original.lines);
  });
});
