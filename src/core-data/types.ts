// Core data schema (plan.md §5). Duplicated locally with Forge Log's
// core-data/types.ts until these apps share a real package — keep the
// `Product` shape in sync by hand until then.

// SHARED with Forge Log — keep this shape identical across both repos.
export interface Product {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4 | 5;
  variants: string[];
  photoRef?: string;
  priceMXN: number;
  costingRef?: string;
  stockByVariant: Record<string, number>;
}

export interface EventFair {
  id: string;
  name: string;
  dates: string[];
  boothFeeMXN: number;
  location?: string;
  floatStartMXN?: number;
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

export interface SaleItem {
  productId: string;
  variant: string;
  qty: number;
  unitPrice: number;
  discount?: number;
}

// Append-only event log entry — never mutated, only appended (plan.md §4).
export interface SaleEvent {
  ts: string;
  items: SaleItem[];
  payType: "efectivo" | "tarjeta" | "transferencia";
  cashGiven?: number;
  changeDue?: number;
}

export interface Expense {
  ts: string;
  concept: string;
  amountMXN: number;
  category: "booth" | "food" | "transport" | "material" | "other";
}

export interface FloatCount {
  ts: string;
  kind: "start" | "end";
  denominations: Record<string, number>;
  total: number;
}

// Derived — never stored as source of truth, always computed from the event log.
export interface DaySummary {
  gross: number;
  byPayType: Record<string, number>;
  byProduct: Record<string, number>;
  byTier: Record<string, number>;
  expenses: number;
  net: number;
  sellThroughPct: number;
  cashExpectedVsCountedDelta: number;
  restockList: string[];
}
