// THE CANONICAL STOCK TEMPLATE — shared verbatim with Forge Log.
//
// This file is duplicated byte-for-byte in ../forge-log/src/core-data/template.ts.
// It is the contract between the two apps: Forge Log emits this file, Booth Mode
// reads it, and vice versa. Change it in one repo and you MUST change the other,
// or the two stop understanding each other.
//
// It owns the FILE FORMAT and nothing else — parsing text into TemplateRow and
// writing TemplateRow back out. Each app maps TemplateRow to its own model
// (Booth Mode has fairs and stock plans; Forge Log has machines and costings),
// which is why that mapping lives in each app's lib/csv.ts instead of here.
//
// Deliberately dependency-free, including on app config: a format module that
// imports app settings is a format that drifts between apps.
//
// Two kinds of column:
//
//   INPUT    round-trips. Read on import, written on export.
//   DERIVED  written for humans opening the file in Excel, and IGNORED on
//            import — always recomputed.
//
// Why derived columns are never trusted: the source spreadsheet displayed
// SELLING PRICE rounded (313) but computed GOAL VALUE from the unrounded 312.5,
// so its own columns disagreed by $219 across the sheet. Recomputing from the
// price actually charged is what stops that class of drift.

export const TEMPLATE_VERSION = "1";

/** Centavos per peso. The format itself specifies two decimal places. */
const MINOR_PER_MAJOR = 100;

/** Columns that round-trip. Order here is the order written on export. */
export const INPUT_COLUMNS = [
  "sku",
  "product",
  "variant",
  "tier",
  "machine",
  "cost_material",
  "cost_machine",
  "cost_labor",
  "cost_consumable",
  "cost_packaging",
  "house_price",
  "selling_price",
  "current_qty",
  "goal_qty",
  "made",
  "packed_qty",
  "production_minutes",
  "restock_threshold",
  "active",
  "notes",
] as const;

/** Computed on export, ignored on import. Never a source of truth. */
export const DERIVED_COLUMNS = [
  "unit_cost",
  "margin_unit",
  "margin_pct",
  "to_make",
  "goal_value",
  "goal_profit",
] as const;

export type InputColumn = (typeof INPUT_COLUMNS)[number];
export type DerivedColumn = (typeof DERIVED_COLUMNS)[number];

export const TEMPLATE_HEADER: readonly string[] = [...INPUT_COLUMNS, ...DERIVED_COLUMNS];

/** One parsed row. Money is integer centavos; null means "not given". */
export interface TemplateRow {
  rowNum: number;
  sku: string;
  product: string;
  variant: string;
  tier: string;
  machine: string;
  costMaterialCents: number;
  costMachineCents: number;
  costLaborCents: number;
  costConsumableCents: number;
  costPackagingCents: number;
  housePriceCents: number | null;
  sellingPriceCents: number | null;
  currentQty: number;
  goalQty: number;
  made: boolean;
  packedQty: number;
  productionMinutes: number | null;
  restockThreshold: number | null;
  active: boolean;
  notes: string;
}

/** What an exporter must supply. Derived values are computed by the caller. */
export interface TemplateOutRow extends Omit<TemplateRow, "rowNum"> {
  unitCostCents: number;
  marginUnitCents: number | null;
  marginPct: number | null;
  toMake: number;
  goalValueCents: number;
  goalProfitCents: number | null;
}

export interface ParseResult {
  rows: TemplateRow[];
  errors: string[];
  /** Unlabelled columns recovered by sniffing, so the user can sanity-check. */
  inferred: string[];
  /** Headers we did not recognise. Ignored, but surfaced rather than hidden. */
  unknownColumns: string[];
}

/**
 * Accepted spellings per column. Matched after lowercasing, stripping accents
 * and removing every non-alphanumeric character — so "GOAL QTY", "goal_qty" and
 * "Goal  Qty" all collapse to "goalqty".
 */
export const HEADER_ALIASES: Record<InputColumn, readonly string[]> = {
  sku: ["sku", "#", "no", "num", "numero", "number", "id", "codigo", "clave"],
  product: ["product", "producto", "name", "nombre", "articulo", "item", "descripcion"],
  variant: ["variant", "variante", "version", "modelo", "color", "medida", "size", "talla"],
  tier: ["tier", "nivel", "categoria", "category", "clase", "grupo", "segmento"],
  machine: ["machine", "maquina", "method", "metodo", "proceso", "process", "tool", "herramienta", "produccion"],
  cost_material: ["cost_material", "costmaterial", "material", "materialcost", "costomaterial", "costomateriales"],
  cost_machine: ["cost_machine", "costmachine", "machinecost", "costomaquina", "costomaquinaria", "machinetime"],
  cost_labor: ["cost_labor", "costlabor", "labor", "laborcost", "costomanodeobra", "manodeobra", "trabajo"],
  cost_consumable: ["cost_consumable", "costconsumable", "consumable", "consumables", "consumible", "consumibles"],
  cost_packaging: ["cost_packaging", "costpackaging", "packaging", "empaque", "embalaje", "costoempaque"],
  house_price: ["house_price", "houseprice", "house", "preciocasa", "preciobase", "baseprice", "base", "preciohouse"],
  selling_price: ["selling_price", "sellingprice", "selling", "price", "precio", "precioventa", "retail", "pvp", "preciopublico"],
  current_qty: ["current_qty", "currentqty", "current", "currentquantity", "existencia", "existencias", "actual", "cantidadactual", "stock", "inventario", "enstock", "hay"],
  goal_qty: ["goal_qty", "goalqty", "goal", "goalquantity", "objetivo", "meta", "target", "cantidadobjetivo", "planeado"],
  made: ["made", "ya", "hecho", "hechos", "listo", "listos", "done", "ready", "terminado", "completado"],
  packed_qty: ["packed_qty", "packedqty", "packed", "empacado", "empacadas", "empacados", "encaja"],
  production_minutes: ["production_minutes", "productionminutes", "minutes", "minutos", "tiempo", "time", "minutosproduccion", "tiempoproduccion"],
  restock_threshold: ["restock_threshold", "restockthreshold", "threshold", "umbral", "minimo", "min", "reorderpoint"],
  active: ["active", "activo", "activa", "enabled", "vigente"],
  notes: ["notes", "notas", "nota", "comentarios", "comments", "observaciones"],
};

/**
 * Derived headers are recognised so a re-imported export doesn't report them as
 * unknown columns — they're matched, then deliberately dropped.
 */
export const DERIVED_ALIASES: Record<DerivedColumn, readonly string[]> = {
  unit_cost: ["unit_cost", "unitcost", "costo", "costounitario", "cost", "costototal"],
  margin_unit: ["margin_unit", "marginunit", "margin", "margen", "utilidad", "ganancia"],
  margin_pct: ["margin_pct", "marginpct", "margenpct", "marginpercent", "porcentajemargen"],
  to_make: ["to_make", "tomake", "faltan", "porhacer", "pendiente", "pendientes", "falta"],
  goal_value: ["goal_value", "goalvalue", "goalvalueselling", "valorobjetivo", "valormeta", "ingresoobjetivo"],
  goal_profit: ["goal_profit", "goalprofit", "utilidadobjetivo", "gananciaobjetivo", "profit"],
};

/**
 * Words meaning "yes" in the `made` column. The source sheet used the bare
 * Spanish "ya", which is why this list exists at all.
 */
export const MADE_TRUE_WORDS: readonly string[] = [
  "ya",
  "si",
  "yes",
  "x",
  "true",
  "1",
  "listo",
  "hecho",
  "done",
  "ready",
  "ok",
  "v",
];

/**
 * Known production methods. Doubles as the value-sniffing vocabulary for
 * unlabelled columns and as the join key to Forge Log's machine catalog.
 */
export const MACHINE_WORDS: readonly string[] = [
  "laser",
  "cameo",
  "craft",
  "vinyl",
  "vinilo",
  "resin",
  "resina",
  "3d",
  "print",
  "impresion",
  "sublimacion",
  "sublimation",
  "cnc",
  "torno",
  "mano",
  "hand",
  "costura",
  "sewing",
  "cuero",
  "leather",
];

// --- primitives -------------------------------------------------------------

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeHeaderKey(raw: string): string {
  return stripDiacritics(raw.trim().toLowerCase()).replace(/[^a-z0-9#]/g, "");
}

/** Rows whose product name is a spreadsheet totals line, not a product. */
export function isTotalsRow(name: string): boolean {
  return /^(total|totales|totals|suma|sum|grand\s*total)$/i.test(name.trim());
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

export function escapeCSV(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** "1,250.50" / "$60" / "6,000" -> centavos. null when malformed. */
export function parseMoneyCents(input: string): number | null {
  const s = input.trim().replace(/[$,\s]/g, "");
  if (s === "" || s === "." || s === "-" || s === "-.") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(s)) return null;

  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [intPart = "", fracPart = ""] = body.split(".");
  if (intPart === "" && fracPart === "") return null;

  const major = intPart === "" ? 0 : Number(intPart);
  const minor = Number((fracPart + "00").slice(0, 2));
  const cents = major * MINOR_PER_MAJOR + minor;
  return negative ? -cents : cents;
}

export function formatMoneyPlain(cents: number): string {
  return (cents / MINOR_PER_MAJOR).toFixed(2);
}

function parseIntCell(raw: string): number | null {
  const s = raw.trim().replace(/[,\s]/g, "");
  if (s === "") return 0;
  if (!/^-?\d+$/.test(s)) return null;
  return Number(s);
}

export function parseMadeCell(raw: string): boolean {
  const s = stripDiacritics(raw.trim().toLowerCase());
  return s !== "" && MADE_TRUE_WORDS.includes(s);
}

function parseBoolCell(raw: string, fallback: boolean): boolean {
  const s = stripDiacritics(raw.trim().toLowerCase());
  if (s === "") return fallback;
  if (["no", "false", "0", "inactivo", "inactiva"].includes(s)) return false;
  return MADE_TRUE_WORDS.includes(s) || s === "activo" || s === "activa";
}

export function looksLikeMachine(raw: string): boolean {
  const s = stripDiacritics(raw.trim().toLowerCase());
  return s !== "" && MACHINE_WORDS.some((w) => s === w || s.includes(w));
}

function uniquePreview(values: string[]): string {
  const unique = [...new Set(values.map((v) => v.toLowerCase()))];
  return unique.slice(0, 4).join(", ") + (unique.length > 4 ? "…" : "");
}

// --- header mapping ---------------------------------------------------------

interface ColumnMap {
  cols: Partial<Record<InputColumn, number>>;
  inferred: string[];
  unknownColumns: string[];
}

function mapHeaders(header: string[], body: string[][]): ColumnMap {
  const cols: Partial<Record<InputColumn, number>> = {};
  const inferred: string[] = [];
  const unknownColumns: string[] = [];
  const unnamed: number[] = [];

  header.forEach((raw, index) => {
    const key = normalizeHeaderKey(raw);
    if (key === "") {
      unnamed.push(index);
      return;
    }

    for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [
      InputColumn,
      readonly string[],
    ][]) {
      if (aliases.some((a) => normalizeHeaderKey(a) === key)) {
        if (cols[column] === undefined) cols[column] = index;
        return;
      }
    }

    for (const aliases of Object.values(DERIVED_ALIASES)) {
      if (aliases.some((a) => normalizeHeaderKey(a) === key)) return;
    }

    unknownColumns.push(raw.trim());
  });

  // Recover unlabelled columns by what they contain. The source spreadsheet
  // kept its "ya" flag and its laser/cameo/craft method in two headerless
  // columns; guessing is reported so it can be checked rather than trusted.
  for (const index of unnamed) {
    const values = body.map((r) => (r[index] ?? "").trim()).filter((v) => v !== "");
    if (values.length === 0) continue;

    if (cols.made === undefined && values.every((v) => parseMadeCell(v))) {
      cols.made = index;
      inferred.push(
        `Columna ${index + 1} sin encabezado → "made" (valores: ${uniquePreview(values)})`,
      );
      continue;
    }

    if (cols.machine === undefined && values.every((v) => looksLikeMachine(v))) {
      cols.machine = index;
      inferred.push(
        `Columna ${index + 1} sin encabezado → "machine" (valores: ${uniquePreview(values)})`,
      );
      continue;
    }

    unknownColumns.push(`(columna ${index + 1} sin encabezado)`);
  }

  return { cols, inferred, unknownColumns };
}

// --- parse ------------------------------------------------------------------

/**
 * Text -> TemplateRow[]. Bad rows are collected, not thrown: a vendor importing
 * 60 rows the night before a fair needs the other 59, not a stack trace.
 */
export function parseTemplateCSV(text: string): ParseResult {
  const rows = parseCSV(text);
  if (rows.length === 0) {
    return { rows: [], errors: ["CSV vacío"], inferred: [], unknownColumns: [] };
  }

  const { cols, inferred, unknownColumns } = mapHeaders(rows[0], rows.slice(1));
  if (cols.product === undefined) {
    return {
      rows: [],
      errors: ["Falta la columna de producto"],
      inferred,
      unknownColumns,
    };
  }

  const errors: string[] = [];
  const out: TemplateRow[] = [];

  rows.slice(1).forEach((cells, i) => {
    const rowNum = i + 2;
    const cell = (key: InputColumn): string => {
      const index = cols[key];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };

    const product = cell("product");
    if (product === "") return; // blank spacer row
    if (isTotalsRow(product)) return; // the spreadsheet's own TOTAL line

    // Each label carries its own adjective: Spanish agreement is gendered and
    // plural, so a generic `${label} inválido` produces "existencia inválido".
    const money = (key: InputColumn, complaint: string): number | null | "bad" => {
      const raw = cell(key);
      if (raw === "") return null;
      const parsed = parseMoneyCents(raw);
      if (parsed === null || parsed < 0) {
        errors.push(`Fila ${rowNum}: ${complaint} "${raw}"`);
        return "bad";
      }
      return parsed;
    };

    const house = money("house_price", "precio casa inválido");
    if (house === "bad") return;
    const selling = money("selling_price", "precio venta inválido");
    if (selling === "bad") return;

    const costCells: [InputColumn, string][] = [
      ["cost_material", "costo material inválido"],
      ["cost_machine", "costo máquina inválido"],
      ["cost_labor", "costo mano de obra inválido"],
      ["cost_consumable", "costo consumible inválido"],
      ["cost_packaging", "costo empaque inválido"],
    ];
    const costs: number[] = [];
    for (const [key, complaint] of costCells) {
      const value = money(key, complaint);
      if (value === "bad") return;
      costs.push(value ?? 0);
    }

    const int = (key: InputColumn, complaint: string): number | null | "bad" => {
      const raw = cell(key);
      const parsed = parseIntCell(raw);
      if (parsed === null || parsed < 0) {
        errors.push(`Fila ${rowNum}: ${complaint} "${raw}"`);
        return "bad";
      }
      return raw === "" ? null : parsed;
    };

    const currentQty = int("current_qty", "existencia inválida");
    if (currentQty === "bad") return;
    const goalQty = int("goal_qty", "objetivo inválido");
    if (goalQty === "bad") return;
    const packedQty = int("packed_qty", "empacado inválido");
    if (packedQty === "bad") return;
    const minutes = int("production_minutes", "minutos inválidos");
    if (minutes === "bad") return;
    const threshold = int("restock_threshold", "umbral inválido");
    if (threshold === "bad") return;

    out.push({
      rowNum,
      sku: cell("sku"),
      product,
      variant: cell("variant"),
      tier: cell("tier"),
      machine: cell("machine"),
      costMaterialCents: costs[0],
      costMachineCents: costs[1],
      costLaborCents: costs[2],
      costConsumableCents: costs[3],
      costPackagingCents: costs[4],
      housePriceCents: house,
      sellingPriceCents: selling,
      currentQty: currentQty ?? 0,
      goalQty: goalQty ?? 0,
      made: parseMadeCell(cell("made")),
      packedQty: packedQty ?? 0,
      productionMinutes: minutes,
      restockThreshold: threshold,
      active: parseBoolCell(cell("active"), true),
      notes: cell("notes"),
    });
  });

  return { rows: out, errors, inferred, unknownColumns };
}

// --- serialize --------------------------------------------------------------

/** TemplateRow[] -> the canonical file. The only writer, for both apps. */
export function serializeTemplateCSV(rows: readonly TemplateOutRow[]): string {
  const out: string[] = [TEMPLATE_HEADER.join(",")];

  for (const r of rows) {
    out.push(
      [
        escapeCSV(r.sku),
        escapeCSV(r.product),
        escapeCSV(r.variant),
        escapeCSV(r.tier),
        escapeCSV(r.machine),
        formatMoneyPlain(r.costMaterialCents),
        formatMoneyPlain(r.costMachineCents),
        formatMoneyPlain(r.costLaborCents),
        formatMoneyPlain(r.costConsumableCents),
        formatMoneyPlain(r.costPackagingCents),
        r.housePriceCents === null ? "" : formatMoneyPlain(r.housePriceCents),
        r.sellingPriceCents === null ? "" : formatMoneyPlain(r.sellingPriceCents),
        String(r.currentQty),
        String(r.goalQty),
        r.made ? "yes" : "",
        String(r.packedQty),
        r.productionMinutes === null ? "" : String(r.productionMinutes),
        r.restockThreshold === null ? "" : String(r.restockThreshold),
        r.active ? "yes" : "no",
        escapeCSV(r.notes),
        // derived — recomputed on import, present for humans
        formatMoneyPlain(r.unitCostCents),
        r.marginUnitCents === null ? "" : formatMoneyPlain(r.marginUnitCents),
        r.marginPct === null ? "" : r.marginPct.toFixed(1),
        String(r.toMake),
        formatMoneyPlain(r.goalValueCents),
        r.goalProfitCents === null ? "" : formatMoneyPlain(r.goalProfitCents),
      ].join(","),
    );
  }

  return out.join("\n") + "\n";
}

/** Blank template with headers only — the file both apps agree on. */
export function emptyTemplateCSV(): string {
  return TEMPLATE_HEADER.join(",") + "\n";
}
