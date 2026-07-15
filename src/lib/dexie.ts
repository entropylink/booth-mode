// Local-first Dexie (IndexedDB) store (plan.md §4).
//
// `events` is the append-only log and the only money-bearing table: sales,
// voids, expenses and float counts are appended, never updated or deleted.
// Stock and totals are NOT stored — they are derived (see lib/derive.ts).
// Products, fairs and stock plans are ordinary mutable definition records.

import Dexie, { type Table } from "dexie";
import type { BoothEvent, EventFair, Product, StockPlan } from "../core-data/types";

export class BoothModeDB extends Dexie {
  products!: Table<Product, string>;
  fairs!: Table<EventFair, string>;
  stockPlans!: Table<StockPlan, string>;
  events!: Table<BoothEvent, string>;

  constructor() {
    super("booth-mode");
    this.version(1).stores({
      products: "id, tier",
      fairs: "id, status",
      stockPlans: "id, eventId",
      events: "id, eventId, ts, type, [eventId+ts]",
    });
  }
}

export const db = new BoothModeDB();

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
