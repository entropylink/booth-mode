// Local-first Dexie (IndexedDB) store (plan.md §4). Sales/expenses/float
// counts are append-only event tables; stock and totals are derivations.

import Dexie, { type Table } from "dexie";
import type {
  Product,
  EventFair,
  StockPlan,
  SaleEvent,
  Expense,
  FloatCount,
} from "../core-data/types";

export class BoothModeDB extends Dexie {
  products!: Table<Product, string>;
  events!: Table<EventFair, string>;
  stockPlans!: Table<StockPlan, string>;
  sales!: Table<SaleEvent, string>;
  expenses!: Table<Expense, string>;
  floatCounts!: Table<FloatCount, string>;

  constructor() {
    super("booth-mode");
    this.version(1).stores({
      products: "id",
      events: "id",
      stockPlans: "id, eventId",
      sales: "++id, ts",
      expenses: "++id, ts",
      floatCounts: "++id, ts",
    });
  }
}

export const db = new BoothModeDB();
