// Core data schema (plan.md §5). Duplicated locally with Forge Log's
// core-data/types.ts until these apps share a real package — keep the
// `Product` shape in sync by hand until then.
//
// All money fields are integer CENTAVOS (see src/lib/money.ts).

export type Cents = number;
export type Tier = 1 | 2 | 3 | 4 | 5;

// SHARED with Forge Log — keep this shape identical across both repos.
export interface Product {
  id: string;
  name: string;
  tier: Tier;
  variants: string[];
  photoRef?: string;
  priceCents: Cents;
  costingRef?: string;
  stockByVariant: Record<string, number>;
}

export interface EventFair {
  id: string;
  name: string;
  dates: string[];
  boothFeeCents: Cents;
  location?: string;
  floatStartCents?: Cents;
  status: "planned" | "active" | "closed";
}

export interface StockPlanLine {
  productId: string;
  variant: string;
  target: number;
  packed: number;
}

export interface StockPlan {
  id: string;
  eventId: string;
  lines: StockPlanLine[];
}

/**
 * Discount on a cart line. The plan's schema says `discount?`; modelling it as
 * a tagged union keeps the *intent* (−10%) in the log so totals stay derivable
 * rather than baking in a precomputed number we can never re-check.
 */
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
// Stock and every total are derivations over this log (see src/lib/derive.ts).
// ---------------------------------------------------------------------------

interface BaseEvent {
  id: string;
  eventId: string; // the EventFair this belongs to
  ts: string; // ISO8601
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
// Derived views — never stored, always recomputed from the log.
// ---------------------------------------------------------------------------

export interface RestockEntry {
  productId: string;
  productName: string;
  variant: string;
  tier: Tier;
  remaining: number;
  sold: number;
  soldOut: boolean;
  /** margin × velocity (plan.md §6 F4); price stands in for margin until v1.5 costing. */
  score: number;
}

export interface ProductTally {
  productId: string;
  productName: string;
  tier: Tier;
  qty: number;
  grossCents: Cents;
}

export interface DaySummary {
  grossCents: Cents;
  byPayType: Record<PayType, Cents>;
  byProduct: ProductTally[];
  byTier: Record<string, Cents>;
  expensesCents: Cents;
  boothFeeCents: Cents;
  netCents: Cents;
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
