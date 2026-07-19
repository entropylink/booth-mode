// The Firestore transport — SHARED byte-for-byte with Forge Log
// (../forge-log/src/sync/firestore.ts). Implements the SyncTransport interface
// the (fully tested) engine drives. It is deliberately thin: no merge logic
// lives here, only CRUD, so the untested-against-live-Firebase surface is as
// small as possible.
//
// Layout under one account's uid (security rules restrict everything to the
// owner — see docs/firebase-setup.md):
//
//   users/{uid}/{collection}/{id}        record or event doc
//   users/{uid}/__tomb_{collection}/{id} tombstone { id, deletedAt }
//
// Records and events are both just documents keyed by id; the engine knows
// which collections are event logs and merges them by union.

import {
  collection,
  getDocs,
  writeBatch,
  doc,
  type Firestore,
} from "firebase/firestore";
import type { EventRecord, SyncTransport } from "./engine";
import type { Syncable, Tombstone } from "./merge";

/** Firestore caps a batch at 500 writes; stay under it. */
const BATCH = 450;

async function readAll<T>(db: Firestore, path: string): Promise<T[]> {
  const snap = await getDocs(collection(db, path));
  return snap.docs.map((d) => d.data() as T);
}

async function writeAll(
  db: Firestore,
  path: string,
  items: { id: string }[],
  del?: string[],
): Promise<void> {
  const all = [
    ...items.map((it) => ({ kind: "set" as const, it })),
    ...(del ?? []).map((id) => ({ kind: "del" as const, id })),
  ];
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = writeBatch(db);
    for (const op of all.slice(i, i + BATCH)) {
      if (op.kind === "set") batch.set(doc(db, path, op.it.id), op.it);
      else batch.delete(doc(db, path, op.id));
    }
    await batch.commit();
  }
}

export function firestoreTransport(db: Firestore, uid: string): SyncTransport {
  const base = `users/${uid}`;
  const recPath = (name: string) => `${base}/${name}`;
  const tombPath = (name: string) => `${base}/__tomb_${name}`;

  return {
    getRecords: (name) => readAll<Syncable>(db, recPath(name)),
    getTombstones: (name) => readAll<Tombstone>(db, tombPath(name)),
    getEvents: (name) => readAll<EventRecord>(db, recPath(name)),

    putRecords: (name, records) => writeAll(db, recPath(name), records as { id: string }[]),
    putEvents: (name, events) => writeAll(db, recPath(name), events as { id: string }[]),

    // A tombstone records the delete AND removes the live doc, so a pull no
    // longer returns the deleted record.
    async putTombstones(name, tombs) {
      await writeAll(db, tombPath(name), tombs as { id: string }[]);
      await writeAll(db, recPath(name), [], tombs.map((t) => t.id));
    },
  };
}
