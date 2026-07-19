// Core data schema (plan.md §5). Duplicated locally with Forge Log's
// core-data/types.ts until these apps share a real package — keep the Tier,
// Product, Costing and StockPlan shapes in sync by hand until then.
//
// All money fields are integer CENTAVOS (see src/lib/money.ts).

export type Cents = number;

// ---------------------------------------------------------------------------
// Tier
// ---------------------------------------------------------------------------

/**
 * A merchandising tier — a hypothesis about how a product will sell, which
 * decides how deep to stock it ("Flagship – go deep", "Hero – exhibition").
 *
 * plan.md §5 modelled this as tier(1-5), but the real tiers are named strategy
 * roles, not price bands, and they get revised as real sales data comes in.
 * They are therefore data, not an enum: Forge Log owns editing them, Booth Mode
 * reads them, and the sales figures Booth Mode produces are what justifies
 * moving a product between them.
 */
export interface Tier {
  id: string;
  label: string;
  sortOrder: number;
  color: string;
  notes?: string;
  /** LWW sync clock (ISO8601). Stamped by the Dexie write hooks — see sync/. */
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Product — SHARED with Forge Log. Keep this shape identical across repos.
// ---------------------------------------------------------------------------

/** Per-unit cost breakdown. Mirrors Forge Log's Costing line types (its §5). */
export interface UnitCost {
  materialCents: Cents;
  machineCents: Cents;
  laborCents: Cents;
  consumableCents: Cents;
  packagingCents: Cents;
}

export interface Product {
  id: string;
  /** The vendor's own catalog number. Stable across re-imports. */
  sku: string;
  name: string;
  variants: string[];
  tierId: string;
  /** Production method — joins to Forge Log's machine catalog. */
  machine?: string;
  photoRef?: string;

  cost: UnitCost;
  /** The vendor's standard/direct price. */
  housePriceCents: Cents;
  /** What is actually charged at the fair. */
  sellingPriceCents: Cents;

  /** Workshop stock on hand, per variant. Forge Log's side of the fence. */
  stockByVariant: Record<string, number>;
  /** Minutes to make one, for "can I close the gap before Saturday?". */
  productionMinutes?: number;
  restockThreshold?: number;
  active: boolean;
  notes?: string;
  costingRef?: string;
  /** LWW sync clock (ISO8601). Stamped by the Dexie write hooks — see sync/. */
  updatedAt?: string;
}

export const EMPTY_COST: UnitCost = {
  materialCents: 0,
  machineCents: 0,
  laborCents: 0,
  consumableCents: 0,
  packagingCents: 0,
};

// ---------------------------------------------------------------------------
// Fair / plan
// ---------------------------------------------------------------------------

export interface EventFair {
  id: string;
  name: string;
  dates: string[];
  boothFeeCents: Cents;
  location?: string;
  floatStartCents?: Cents;
  status: "planned" | "active" | "closed";
  /** LWW sync clock (ISO8601). Stamped by the Dexie write hooks — see sync/. */
  updatedAt?: string;
}

export interface StockPlanLine {
  productId: string;
  variant: string;
  /** Ideal quantity to bring. */
  target: number;
  /**
   * Production finished for this line — the vendor's call that they are done
   * making it, which is not the same as target being met. Their sheet marked
   * this "ya" on items they'd stopped at 16 of a goal of 30.
   */
  made: boolean;
  /** What actually went in the box. */
  packed: number;
}

export interface StockPlan {
  id: string;
  eventId: string;
  lines: StockPlanLine[];
  /** LWW sync clock (ISO8601). Stamped by the Dexie write hooks — see sync/. */
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export type Discount =
  | { kind: "pct"; pct: number }
  | { kind: "abs"; cents: Cents };

export interface SaleItem {
  productId: string;
  variant: string;
  qty: number;
  unitPriceCents: Cents;
  discount?: Discount;
}

export type PayType = "efectivo" | "tarjeta" | "transferencia";
export type ExpenseCategory = "booth" | "food" | "transport" | "material" | "other";
export type FloatKind = "start" | "end";

/** Denomination -> count. Keys are centavo denominations as strings. */
export type DenominationCounts = Record<string, number>;

// ---------------------------------------------------------------------------
// Event log (plan.md §4). Append-only: nothing here is ever mutated or deleted.
// ---------------------------------------------------------------------------

interface BaseEvent {
  id: string;
  eventId: string;
  ts: string;
}

export interface SaleRecorded extends BaseEvent {
  type: "saleRecorded";
  items: SaleItem[];
  payType: PayType;
  cashGivenCents?: Cents;
  changeDueCents?: Cents;
}

/** Compensating event — the original SaleRecorded stays in the log untouched. */
export interface SaleVoided extends BaseEvent {
  type: "saleVoided";
  targetId: string;
  reason?: string;
}

export interface ExpenseAdded extends BaseEvent {
  type: "expenseAdded";
  concept: string;
  amountCents: Cents;
  category: ExpenseCategory;
  /** Cash taken out of the box — required for the F3 expected-vs-counted delta. */
  paidFromBox: boolean;
}

export interface ExpenseVoided extends BaseEvent {
  type: "expenseVoided";
  targetId: string;
}

export interface FloatCounted extends BaseEvent {
  type: "floatCounted";
  kind: FloatKind;
  denominations: DenominationCounts;
  totalCents: Cents;
}

export type BoothEvent =
  | SaleRecorded
  | SaleVoided
  | ExpenseAdded
  | ExpenseVoided
  | FloatCounted;

export type BoothEventType = BoothEvent["type"];

// ---------------------------------------------------------------------------
// Derived views — never stored, always recomputed.
// ---------------------------------------------------------------------------

export interface RestockEntry {
  productId: string;
  productName: string;
  variant: string;
  tierId: string;
  remaining: number;
  sold: number;
  soldOut: boolean;
  /** margin × velocity (plan.md §6 F4). */
  score: number;
}

export interface ProductTally {
  productId: string;
  productName: string;
  tierId: string;
  qty: number;
  grossCents: Cents;
  /** Real profit once cost is known; null when the product has no cost entered. */
  profitCents: Cents | null;
}

export interface DaySummary {
  grossCents: Cents;
  byPayType: Record<PayType, Cents>;
  byProduct: ProductTally[];
  byTier: Record<string, Cents>;
  expensesCents: Cents;
  boothFeeCents: Cents;
  netCents: Cents;
  /** Gross − cost of goods sold. Null when any sold product lacks a cost. */
  grossProfitCents: Cents | null;
  cogsCents: Cents | null;
  unitsSold: number;
  unitsPacked: number;
  sellThroughPct: number;
  cashExpectedCents: Cents;
  cashCountedCents: Cents | null;
  cashDeltaCents: Cents | null;
  restockList: RestockEntry[];
  saleCount: number;
  voidCount: number;
}

// ---------------------------------------------------------------------------
// Inventory (the vendor's first question, before any money question)
// ---------------------------------------------------------------------------

/** One row of the stock picture, per product::variant. */
export interface InventoryLine {
  productId: string;
  sku: string;
  productName: string;
  variant: string;
  tierId: string;
  machine?: string;

  /** In the workshop. */
  currentQty: number;
  /** Ideal for this fair. */
  target: number;
  /** Production declared finished. */
  made: boolean;
  /** In the box. */
  packed: number;
  /** Sold today, derived from the event log. */
  sold: number;
  /** On the table right now: packed − sold. */
  remaining: number;
  /** Still to build to hit target: max(0, target − currentQty). */
  toMake: number;
  /** Minutes of bench time implied by toMake, when production time is known. */
  toMakeMinutes: number | null;

  unitCostCents: Cents;
  sellingPriceCents: Cents;
  /** selling − cost. Null when no cost has been entered. */
  marginCents: Cents | null;
  marginPct: number | null;
  goalValueCents: Cents;
  goalProfitCents: Cents | null;
}

export interface InventorySummary {
  lines: InventoryLine[];
  totalCurrent: number;
  totalTarget: number;
  totalPacked: number;
  totalToMake: number;
  totalToMakeMinutes: number | null;
  goalValueCents: Cents;
  goalProfitCents: Cents | null;
  /** Products with no cost entered — margin is unknowable until these are filled. */
  missingCostCount: number;
}
