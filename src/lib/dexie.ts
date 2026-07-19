// Local-first Dexie (IndexedDB) store (plan.md §4).
//
// `events` is the append-only log and the only money-bearing table: sales,
// voids, expenses and float counts are appended, never updated or deleted.
// Stock and totals are NOT stored — they are derived (see lib/derive.ts and
// lib/inventory.ts). Tiers, products, fairs and stock plans are ordinary
// mutable definition records.

import Dexie, { type Table } from "dexie";
import type { BoothEvent, EventFair, Product, StockPlan, Tier } from "../core-data/types";

/** A soft-delete marker, so a delete propagates through sync (see sync/merge.ts). */
export interface TombRow {
  collection: string;
  id: string;
  deletedAt: string;
}

/**
 * Set true by the sync engine while it applies REMOTE records, so the write
 * hooks below preserve the remote `updatedAt` instead of stamping "now" — which
 * would defeat last-write-wins. User writes run with this false and get stamped.
 */
let applyingSync = false;
export function setApplyingSync(v: boolean): void {
  applyingSync = v;
}

const nowIso = (): string => new Date().toISOString();

/** Tables whose rows carry a `updatedAt` LWW clock and sync as definitions. */
const SYNC_RECORD_TABLES = ["products", "tiers", "fairs", "stockPlans"] as const;

export class BoothModeDB extends Dexie {
  tiers!: Table<Tier, string>;
  products!: Table<Product, string>;
  fairs!: Table<EventFair, string>;
  stockPlans!: Table<StockPlan, string>;
  events!: Table<BoothEvent, string>;
  tombstones!: Table<TombRow, [string, string]>;

  constructor() {
    super("booth-mode");
    this.version(1).stores({
      products: "id, tier",
      fairs: "id, status",
      stockPlans: "id, eventId",
      events: "id, eventId, ts, type, [eventId+ts]",
    });

    // v2: tiers became data rather than a 1-5 enum, and products gained a SKU,
    // a cost breakdown and house/selling prices. No upgrade path is written
    // because v1 never shipped to a device; if that changes, this needs one.
    this.version(2).stores({
      tiers: "id, sortOrder",
      products: "id, sku, tierId, active",
      fairs: "id, status",
      stockPlans: "id, eventId",
      events: "id, eventId, ts, type, [eventId+ts]",
    });

    // v3: sync. A tombstones table for propagating deletes; write hooks stamp
    // updatedAt on definition rows. Additive — existing tables carry forward.
    this.version(3).stores({
      tombstones: "[collection+id], collection",
    });

    for (const name of SYNC_RECORD_TABLES) {
      const table = this.table(name);
      table.hook("creating", (_pk, obj: { updatedAt?: string }) => {
        if (!applyingSync && !obj.updatedAt) obj.updatedAt = nowIso();
      });
      table.hook("updating", (_mods, _pk, _obj) => {
        // User edit → bump the clock. Sync-applied write → leave it as-is.
        return applyingSync ? undefined : { updatedAt: nowIso() };
      });
    }
  }
}

export const db = new BoothModeDB();

/**
 * Delete a definition record AND drop a tombstone, so the delete survives sync
 * instead of the record resurrecting from another device. Use this everywhere a
 * synced record is deleted.
 */
export async function softDelete(collection: string, id: string): Promise<void> {
  await db.transaction("rw", db.table(collection), db.tombstones, async () => {
    await db.table(collection).delete(id);
    await db.tombstones.put({ collection, id, deletedAt: nowIso() });
  });
}

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
