// In-memory LocalStore + SyncTransport for tests — SHARED with Forge Log.
//
// The whole point of the engine's interfaces is that the sync flow can be
// exercised end-to-end with no Firebase and no IndexedDB. A test wires two
// InMemoryStore "devices" to one InMemoryTransport "cloud" and asserts they
// converge — which is exactly the plan's cross-app acceptance criterion, minus
// the network.

import type { EventRecord, LocalStore, SyncTransport } from "./engine";
import type { Syncable, Tombstone } from "./merge";

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class InMemoryStore implements LocalStore {
  records = new Map<string, Map<string, Syncable>>();
  tombstones = new Map<string, Map<string, Tombstone>>();
  events = new Map<string, Map<string, EventRecord>>();

  private recs(name: string): Map<string, Syncable> {
    let m = this.records.get(name);
    if (!m) this.records.set(name, (m = new Map()));
    return m;
  }
  private tombs(name: string): Map<string, Tombstone> {
    let m = this.tombstones.get(name);
    if (!m) this.tombstones.set(name, (m = new Map()));
    return m;
  }
  private evs(name: string): Map<string, EventRecord> {
    let m = this.events.get(name);
    if (!m) this.events.set(name, (m = new Map()));
    return m;
  }

  // seeding helpers for tests
  seedRecord(name: string, r: Syncable): void {
    this.recs(name).set(r.id, clone(r));
  }
  seedEvent(name: string, e: EventRecord): void {
    this.evs(name).set(e.id, clone(e));
  }
  softDelete(name: string, id: string, deletedAt: string): void {
    this.recs(name).delete(id);
    this.tombs(name).set(id, { id, deletedAt });
  }

  async getRecords(name: string): Promise<Syncable[]> {
    return [...this.recs(name).values()].map(clone);
  }
  async getTombstones(name: string): Promise<Tombstone[]> {
    return [...this.tombs(name).values()].map(clone);
  }
  async applyRecords(name: string, records: Syncable[]): Promise<void> {
    for (const r of records) this.recs(name).set(r.id, clone(r));
  }
  async deleteRecords(name: string, ids: string[]): Promise<void> {
    for (const id of ids) this.recs(name).delete(id);
  }
  async addTombstones(name: string, tombs: Tombstone[]): Promise<void> {
    for (const t of tombs) this.tombs(name).set(t.id, clone(t));
  }
  async getEvents(name: string): Promise<EventRecord[]> {
    return [...this.evs(name).values()].map(clone);
  }
  async applyEvents(name: string, events: EventRecord[]): Promise<void> {
    for (const e of events) this.evs(name).set(e.id, clone(e));
  }
}

/** A shared "cloud" both device stores sync against. */
export class InMemoryTransport implements SyncTransport {
  records = new Map<string, Map<string, Syncable>>();
  tombstones = new Map<string, Map<string, Tombstone>>();
  events = new Map<string, Map<string, EventRecord>>();

  private recs(name: string): Map<string, Syncable> {
    let m = this.records.get(name);
    if (!m) this.records.set(name, (m = new Map()));
    return m;
  }
  private tombs(name: string): Map<string, Tombstone> {
    let m = this.tombstones.get(name);
    if (!m) this.tombstones.set(name, (m = new Map()));
    return m;
  }
  private evs(name: string): Map<string, EventRecord> {
    let m = this.events.get(name);
    if (!m) this.events.set(name, (m = new Map()));
    return m;
  }

  async getRecords(name: string): Promise<Syncable[]> {
    return [...this.recs(name).values()].map(clone);
  }
  async getTombstones(name: string): Promise<Tombstone[]> {
    return [...this.tombs(name).values()].map(clone);
  }
  async putRecords(name: string, records: Syncable[]): Promise<void> {
    for (const r of records) this.recs(name).set(r.id, clone(r));
  }
  async putTombstones(name: string, tombs: Tombstone[]): Promise<void> {
    for (const t of tombs) {
      this.tombs(name).set(t.id, clone(t));
      // a delete removes the live doc on the cloud too
      this.recs(name).delete(t.id);
    }
  }
  async getEvents(name: string): Promise<EventRecord[]> {
    return [...this.evs(name).values()].map(clone);
  }
  async putEvents(name: string, events: EventRecord[]): Promise<void> {
    for (const e of events) this.evs(name).set(e.id, clone(e));
  }
}
