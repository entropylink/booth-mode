// The sync engine — SHARED byte-for-byte with Forge Log
// (../forge-log/src/sync/engine.ts). Orchestrates one sync pass over the merge
// core, against two abstractions: a LocalStore (Dexie, in practice) and a
// SyncTransport (Firestore, in practice). Both are interfaces so the whole flow
// is testable against in-memory fakes with no Firebase.
//
// The flow per collection: pull remote → merge against local → write the
// remote-wins changes locally → push the local-wins changes up. Order matters
// only in that we never push before we have merged, so we never clobber a
// newer remote value with a stale local one.

import {
  mergeEvents,
  mergeRecords,
  type Syncable,
  type Tombstone,
} from "./merge";

export type CollectionKind = "records" | "events";

export interface Collection {
  /** Firestore subcollection / Dexie table name. */
  name: string;
  kind: CollectionKind;
}

export interface EventRecord {
  id: string;
  ts: string;
}

/** The device's own store. Dexie implements this in lib/sync-store.ts. */
export interface LocalStore {
  getRecords(name: string): Promise<Syncable[]>;
  getTombstones(name: string): Promise<Tombstone[]>;
  applyRecords(name: string, records: Syncable[]): Promise<void>;
  deleteRecords(name: string, ids: string[]): Promise<void>;
  addTombstones(name: string, tombs: Tombstone[]): Promise<void>;
  getEvents(name: string): Promise<EventRecord[]>;
  applyEvents(name: string, events: EventRecord[]): Promise<void>;
}

/** The remote. Firestore implements this in sync/firestore.ts. */
export interface SyncTransport {
  getRecords(name: string): Promise<Syncable[]>;
  getTombstones(name: string): Promise<Tombstone[]>;
  putRecords(name: string, records: Syncable[]): Promise<void>;
  putTombstones(name: string, tombs: Tombstone[]): Promise<void>;
  getEvents(name: string): Promise<EventRecord[]>;
  putEvents(name: string, events: EventRecord[]): Promise<void>;
}

export interface CollectionReport {
  name: string;
  pulled: number;
  pushed: number;
  deleted: number;
}

export interface SyncReport {
  collections: CollectionReport[];
  pulled: number;
  pushed: number;
  deleted: number;
}

async function syncRecordCollection(
  name: string,
  store: LocalStore,
  transport: SyncTransport,
): Promise<CollectionReport> {
  const [local, remote, localTombstones, remoteTombstones] = await Promise.all([
    store.getRecords(name),
    transport.getRecords(name),
    store.getTombstones(name),
    transport.getTombstones(name),
  ]);

  const m = mergeRecords({ local, remote, localTombstones, remoteTombstones });

  // Apply the remote-wins changes locally first.
  if (m.applyLocal.length) await store.applyRecords(name, m.applyLocal);
  if (m.deleteLocal.length) await store.deleteRecords(name, m.deleteLocal);
  if (m.applyTombstones.length) await store.addTombstones(name, m.applyTombstones);

  // Then push the local-wins changes up.
  if (m.pushRemote.length) await transport.putRecords(name, m.pushRemote);
  if (m.pushTombstones.length) await transport.putTombstones(name, m.pushTombstones);

  return {
    name,
    pulled: m.applyLocal.length,
    pushed: m.pushRemote.length,
    deleted: m.deleteLocal.length,
  };
}

async function syncEventCollection(
  name: string,
  store: LocalStore,
  transport: SyncTransport,
): Promise<CollectionReport> {
  const [local, remote] = await Promise.all([
    store.getEvents(name),
    transport.getEvents(name),
  ]);

  const m = mergeEvents(local, remote);

  if (m.applyLocal.length) await store.applyEvents(name, m.applyLocal);
  if (m.pushRemote.length) await transport.putEvents(name, m.pushRemote);

  return { name, pulled: m.applyLocal.length, pushed: m.pushRemote.length, deleted: 0 };
}

/**
 * One full sync pass. Collections are synced in sequence so a failure part-way
 * leaves earlier collections already converged rather than half-applying one.
 */
export async function syncOnce(
  collections: readonly Collection[],
  store: LocalStore,
  transport: SyncTransport,
): Promise<SyncReport> {
  const reports: CollectionReport[] = [];
  for (const col of collections) {
    reports.push(
      col.kind === "records"
        ? await syncRecordCollection(col.name, store, transport)
        : await syncEventCollection(col.name, store, transport),
    );
  }
  return {
    collections: reports,
    pulled: reports.reduce((n, r) => n + r.pulled, 0),
    pushed: reports.reduce((n, r) => n + r.pushed, 0),
    deleted: reports.reduce((n, r) => n + r.deleted, 0),
  };
}
