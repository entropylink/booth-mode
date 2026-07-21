// The sync merge core — SHARED byte-for-byte with Forge Log
// (../forge-log/src/sync/merge.ts). Pure: no Firebase, no Dexie, no React.
//
// This is where the suite's money integrity lives, so it is a pure function
// with exhaustive tests rather than logic tangled into a network callback.
//
// Two merge strategies, exactly as the plans specify (booth §4, forge §4):
//
//   DEFINITIONS  (Product, Tier, Machine, Material, Setting, Costing, Recipe,
//                 EventFair, StockPlan) are mutable records. Last-write-wins by
//                 `updatedAt`. Deletes propagate as tombstones, so deleting on
//                 one device does not resurrect from another.
//
//   EVENTS  (Booth Mode's append-only money log) are immutable. Merge is a
//           union by id — there is no such thing as a conflict, which is the
//           entire reason the money log is an event log. A voided sale is
//           itself an event, so it unions like any other.
//
// The direction of the flow is: pull remote, merge against local, then both
// (a) write the remote-wins changes into the local store and (b) push the
// local-wins changes up. This function computes those deltas; it does not
// perform them (that is the engine's job, over a transport).

export interface Syncable {
  id: string;
  /** ISO8601. The clock for last-write-wins. */
  updatedAt: string;
}

export interface Tombstone {
  id: string;
  /** ISO8601. A record is deleted iff a tombstone's deletedAt is newer than
   *  the record's updatedAt. */
  deletedAt: string;
}

export interface MergeInput<T extends Syncable> {
  local: readonly T[];
  remote: readonly T[];
  localTombstones: readonly Tombstone[];
  remoteTombstones: readonly Tombstone[];
}

export interface MergeResult<T extends Syncable> {
  /** The reconciled live records, after deletes. The truth both sides converge to. */
  resolved: T[];
  /** Ids that are deleted in the merged world. */
  deletedIds: string[];

  // Deltas the engine applies:
  /** Records to write into the LOCAL store (remote was newer, or remote-only). */
  applyLocal: T[];
  /** Ids to delete from the LOCAL store (a tombstone newer than local record won). */
  deleteLocal: string[];
  /** Tombstones the LOCAL store should record so it stays self-consistent
   *  (a remote-originated delete the local side hasn't tombstoned yet). */
  applyTombstones: Tombstone[];
  /** Records to push to the REMOTE (local was newer, or local-only). */
  pushRemote: T[];
  /** Tombstones to push to the REMOTE (local delete the remote hasn't seen). */
  pushTombstones: Tombstone[];
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(it.id, it);
  return m;
}

/** Latest tombstone per id (a record could be deleted, re-created, re-deleted). */
function latestTombstones(
  a: readonly Tombstone[],
  b: readonly Tombstone[],
): Map<string, Tombstone> {
  const m = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const cur = m.get(t.id);
    if (!cur || t.deletedAt > cur.deletedAt) m.set(t.id, t);
  }
  return m;
}

/**
 * Order-insensitive canonical JSON: object keys sorted recursively, arrays kept
 * in order, and undefined-valued keys dropped exactly as JSON.stringify does.
 *
 * Firestore returns a document's fields — and every nested map's keys — in
 * lexicographic order, NOT the client's insertion order. So a record and its own
 * Firestore round-trip are byte-different under raw JSON.stringify purely because
 * of key order (a Product's `cost` map goes up as {materialCents,…} and comes
 * back as {consumableCents,…}). Reconciling by this canonical form makes the
 * round-trip compare EQUAL, so a converged record is not re-pushed on every
 * single sync pass forever.
 */
function canon(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  const t = typeof value;
  if (t === "function" || t === "symbol") return undefined; // dropped, as JSON does
  if (t !== "object") return JSON.stringify(value); // string | number (NaN/∞→null) | boolean
  if (Array.isArray(value)) return `[${value.map((v) => canon(v) ?? "null").join(",")}]`;
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).sort()) {
    const sv = canon(obj[k]);
    if (sv !== undefined) parts.push(`${JSON.stringify(k)}:${sv}`);
  }
  return `{${parts.join(",")}}`;
}

/** Canonical form of a whole record (always an object → always a string). */
function stableStringify(value: unknown): string {
  return canon(value) ?? "null";
}

/**
 * Which of two records wins. Newer `updatedAt` wins. On an exact tie (same
 * millisecond on two devices), the greater canonical JSON wins — an arbitrary
 * but *deterministic* rule, so both devices independently pick the same winner
 * and still converge. Ties are vanishingly rare and, being a tie, the two values
 * are equally valid.
 */
function pickNewer<T extends Syncable>(a: T, b: T): T {
  if (a.updatedAt > b.updatedAt) return a;
  if (b.updatedAt > a.updatedAt) return b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

export function mergeRecords<T extends Syncable>(input: MergeInput<T>): MergeResult<T> {
  const local = byId(input.local);
  const remote = byId(input.remote);
  const tombs = latestTombstones(input.localTombstones, input.remoteTombstones);
  const localTombIds = new Set(input.localTombstones.map((t) => t.id));
  const remoteTombIds = new Set(input.remoteTombstones.map((t) => t.id));

  const result: MergeResult<T> = {
    resolved: [],
    deletedIds: [],
    applyLocal: [],
    deleteLocal: [],
    applyTombstones: [],
    pushRemote: [],
    pushTombstones: [],
  };

  const ids = new Set<string>([...local.keys(), ...remote.keys(), ...tombs.keys()]);

  for (const id of ids) {
    const l = local.get(id);
    const r = remote.get(id);
    const tomb = tombs.get(id);

    // The surviving record (ignoring deletes for a moment).
    const winner = l && r ? pickNewer(l, r) : (l ?? r);

    // A tombstone deletes the record only if it is newer than the record that
    // would otherwise survive. A re-created record newer than its tombstone lives.
    const deleted = winner ? !!tomb && tomb.deletedAt > winner.updatedAt : !!tomb;

    if (deleted && tomb) {
      result.deletedIds.push(id);
      // Local still has the record but the delete happened remotely → delete locally.
      if (l) result.deleteLocal.push(id);
      // Local hasn't tombstoned this yet → record it locally to stay consistent.
      if (!localTombIds.has(id)) result.applyTombstones.push(tomb);
      // Remote hasn't seen this delete → push the tombstone.
      if (!remoteTombIds.has(id)) result.pushTombstones.push(tomb);
      continue;
    }

    if (!winner) continue; // only tombstones with no surviving record — nothing live

    result.resolved.push(winner);

    // Reconcile by VALUE, not reference: only write/push when the winning value
    // actually differs from what that side already holds. Comparing references
    // would push identical records forever (getRecords hands back fresh copies),
    // and sync would never converge.
    const winnerJson = stableStringify(winner);
    if (winnerJson !== (l ? stableStringify(l) : null)) result.applyLocal.push(winner);
    if (winnerJson !== (r ? stableStringify(r) : null)) result.pushRemote.push(winner);
  }

  return result;
}

// --- event log --------------------------------------------------------------

export interface EventMergeResult<E extends { id: string }> {
  /** The unioned log. */
  merged: E[];
  /** Events the LOCAL store is missing. */
  applyLocal: E[];
  /** Events the REMOTE is missing. */
  pushRemote: E[];
}

/**
 * Union two append-only event logs by id. Events are immutable, so the same id
 * always means the same event; there is nothing to reconcile, only to fill in.
 * Order is not assumed — derivations sort by ts (see lib/derive.ts) — so the
 * merged log is returned sorted by (ts, id) for stable output.
 */
export function mergeEvents<E extends { id: string; ts: string }>(
  local: readonly E[],
  remote: readonly E[],
): EventMergeResult<E> {
  const localIds = new Set(local.map((e) => e.id));
  const remoteIds = new Set(remote.map((e) => e.id));

  const applyLocal = remote.filter((e) => !localIds.has(e.id));
  const pushRemote = local.filter((e) => !remoteIds.has(e.id));

  const merged = [...local, ...applyLocal].sort((a, b) =>
    a.ts === b.ts ? (a.id < b.id ? -1 : 1) : a.ts < b.ts ? -1 : 1,
  );

  return { merged, applyLocal, pushRemote };
}
