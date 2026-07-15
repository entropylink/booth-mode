// CSV import for the pre-fair stock plan (plan.md §6 F1, P0 gate).
//
// Column names are matched loosely in EN and ES because the source is a real
// spreadsheet, not an export we control. Expected shape — one row per variant:
//
//   producto,tier,variante,precio,objetivo
//   Coasters,2,Roble,120,24
//   Coasters,2,Nogal,120,18
//   Llavero,1,,45,60
//
// A product with no variants uses a single blank variant, normalized to "—".

import { parseMXN } from "./money";
import type { Cents, Product, StockPlanLine, Tier } from "../core-data/types";

export const NO_VARIANT = "—";

export interface ImportRow {
  name: string;
  tier: Tier;
  variant: string;
  priceCents: Cents;
  target: number;
}

export interface ImportResult {
  products: Product[];
  lines: StockPlanLine[];
  errors: string[];
}

/** RFC4180-ish: handles quoted fields, escaped quotes, CRLF, trailing newline. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const HEADER_ALIASES: Record<keyof ImportRow, string[]> = {
  name: ["name", "product", "producto", "nombre", "articulo", "artículo"],
  tier: ["tier", "nivel", "categoria", "categoría"],
  variant: ["variant", "variante", "version", "versión", "modelo", "color"],
  priceCents: ["price", "precio", "pricemxn", "preciomxn", "unitprice", "preciounitario"],
  target: ["target", "objetivo", "meta", "qty", "cantidad", "planned", "planeado"],
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeHeader(h: string): string {
  return stripDiacritics(h.trim().toLowerCase()).replace(/[^a-z0-9]/g, "");
}

function mapHeaders(header: string[]): Partial<Record<keyof ImportRow, number>> {
  const map: Partial<Record<keyof ImportRow, number>> = {};
  header.forEach((raw, index) => {
    const norm = normalizeHeader(raw);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((a) => normalizeHeader(a) === norm)) {
        const key = field as keyof ImportRow;
        if (map[key] === undefined) map[key] = index;
      }
    }
  });
  return map;
}

function slugId(name: string): string {
  return (
    stripDiacritics(name.trim().toLowerCase())
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "producto"
  );
}

/**
 * Parse a stock-plan CSV into products + plan lines.
 *
 * Bad rows are collected in `errors` rather than thrown — a vendor importing 60
 * rows the night before a fair needs the other 59, not a stack trace.
 */
export function importStockPlanCSV(text: string): ImportResult {
  const rows = parseCSV(text);
  const errors: string[] = [];
  if (rows.length === 0) return { products: [], lines: [], errors: ["CSV vacío"] };

  const cols = mapHeaders(rows[0]);
  const missing = (["name", "tier", "priceCents", "target"] as const).filter(
    (k) => cols[k] === undefined,
  );
  if (missing.length > 0) {
    return {
      products: [],
      lines: [],
      errors: [`Faltan columnas: ${missing.join(", ")}`],
    };
  }

  const productsByName = new Map<string, Product>();
  const lines: StockPlanLine[] = [];

  rows.slice(1).forEach((cells, i) => {
    const rowNum = i + 2;
    const cell = (key: keyof ImportRow): string => {
      const index = cols[key];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };

    const name = cell("name");
    if (name === "") {
      errors.push(`Fila ${rowNum}: sin nombre`);
      return;
    }

    const tierNum = Number(cell("tier"));
    if (!Number.isInteger(tierNum) || tierNum < 1 || tierNum > 5) {
      errors.push(`Fila ${rowNum}: tier inválido "${cell("tier")}"`);
      return;
    }

    const priceCents = parseMXN(cell("priceCents"));
    if (priceCents === null || priceCents < 0) {
      errors.push(`Fila ${rowNum}: precio inválido "${cell("priceCents")}"`);
      return;
    }

    const target = Number(cell("target"));
    if (!Number.isInteger(target) || target < 0) {
      errors.push(`Fila ${rowNum}: objetivo inválido "${cell("target")}"`);
      return;
    }

    const variant = cell("variant") || NO_VARIANT;
    const id = slugId(name);

    let product = productsByName.get(id);
    if (!product) {
      product = {
        id,
        name,
        tier: tierNum as Tier,
        variants: [],
        priceCents,
        stockByVariant: {},
      };
      productsByName.set(id, product);
    }
    if (!product.variants.includes(variant)) product.variants.push(variant);
    product.stockByVariant[variant] = target;

    const duplicate = lines.some((l) => l.productId === id && l.variant === variant);
    if (duplicate) {
      errors.push(`Fila ${rowNum}: ${name} / ${variant} duplicado`);
      return;
    }

    lines.push({ productId: id, variant, target, packed: 0 });
  });

  return { products: [...productsByName.values()], lines, errors };
}

/** Export the plan back out — round-trips with importStockPlanCSV. */
export function exportStockPlanCSV(
  products: readonly Product[],
  lines: readonly StockPlanLine[],
): string {
  const productById = new Map(products.map((p) => [p.id, p]));
  const escape = (v: string): string =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

  const out = ["producto,tier,variante,precio,objetivo,empacado"];
  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) continue;
    out.push(
      [
        escape(product.name),
        String(product.tier),
        escape(line.variant === NO_VARIANT ? "" : line.variant),
        (product.priceCents / 100).toFixed(2),
        String(line.target),
        String(line.packed),
      ].join(","),
    );
  }
  return out.join("\n") + "\n";
}
