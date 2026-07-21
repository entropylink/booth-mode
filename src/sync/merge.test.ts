import { describe, expect, it } from "vitest";
import { mergeEvents, mergeRecords, type Syncable, type Tombstone } from "./merge";

interface Doc extends Syncable {
  name: string;
}

const doc = (id: string, updatedAt: string, name: string): Doc => ({ id, updatedAt, name });
const tomb = (id: string, deletedAt: string): Tombstone => ({ id, deletedAt });

const empty = { local: [], remote: [], localTombstones: [], remoteTombstones: [] };

describe("mergeRecords — last-write-wins", () => {
  it("keeps the newer of two edits to the same record", () => {
    const r = mergeRecords<Doc>({
      ...empty,
      local: [doc("a", "2026-07-18T10:00:00Z", "old")],
      remote: [doc("a", "2026-07-18T12:00:00Z", "new")],
    });
    expect(r.resolved).toEqual([doc("a", "2026-07-18T12:00:00Z", "new")]);
    // remote was newer → write it locally, push nothing.
    expect(r.applyLocal).toEqual([doc("a", "2026-07-18T12:00:00Z", "new")]);
    expect(r.pushRemote).toEqual([]);
  });

  it("pushes the local edit up when local is newer", () => {
    const r = mergeRecords<Doc>({
      ...empty,
      local: [doc("a", "2026-07-18T12:00:00Z", "new")],
      remote: [doc("a", "2026-07-18T10:00:00Z", "old")],
    });
    expect(r.resolved[0].name).toBe("new");
    expect(r.applyLocal).toEqual([]);
    expect(r.pushRemote).toEqual([doc("a", "2026-07-18T12:00:00Z", "new")]);
  });

  it("carries a remote-only record down and a local-only record up", () => {
    const r = mergeRecords<Doc>({
      ...empty,
      local: [doc("local", "2026-07-18T10:00:00Z", "L")],
      remote: [doc("remote", "2026-07-18T10:00:00Z", "R")],
    });
    expect(r.resolved.map((d) => d.id).sort()).toEqual(["local", "remote"]);
    expect(r.applyLocal).toEqual([doc("remote", "2026-07-18T10:00:00Z", "R")]);
    expect(r.pushRemote).toEqual([doc("local", "2026-07-18T10:00:00Z", "L")]);
  });

  it("does nothing when the two sides already agree", () => {
    const same = doc("a", "2026-07-18T10:00:00Z", "same");
    const r = mergeRecords<Doc>({ ...empty, local: [same], remote: [same] });
    expect(r.applyLocal).toEqual([]);
    expect(r.pushRemote).toEqual([]);
    expect(r.resolved).toEqual([same]);
  });

  it("breaks an exact-timestamp tie deterministically", () => {
    const t = "2026-07-18T10:00:00Z";
    const a = mergeRecords<Doc>({ ...empty, local: [doc("x", t, "aaa")], remote: [doc("x", t, "bbb")] });
    const b = mergeRecords<Doc>({ ...empty, local: [doc("x", t, "bbb")], remote: [doc("x", t, "aaa")] });
    // Same winner regardless of which side is "local" → both devices converge.
    expect(a.resolved[0].name).toBe(b.resolved[0].name);
    expect(a.resolved[0].name).toBe("bbb"); // greater JSON wins
  });
});

describe("mergeRecords — deletes via tombstones", () => {
  it("deletes locally when the record was deleted remotely", () => {
    const r = mergeRecords<Doc>({
      ...empty,
      local: [doc("a", "2026-07-18T10:00:00Z", "here")],
      remoteTombstones: [tomb("a", "2026-07-18T12:00:00Z")],
    });
    expect(r.resolved).toEqual([]);
    expect(r.deletedIds).toEqual(["a"]);
    expect(r.deleteLocal).toEqual(["a"]);
    // local records the tombstone it just learned about, so it stays consistent
    expect(r.applyTombstones).toEqual([tomb("a", "2026-07-18T12:00:00Z")]);
  });

  it("pushes a local delete the remote has not seen", () => {
    const r = mergeRecords<Doc>({
      ...empty,
      remote: [doc("a", "2026-07-18T10:00:00Z", "here")],
      localTombstones: [tomb("a", "2026-07-18T12:00:00Z")],
    });
    expect(r.resolved).toEqual([]);
    expect(r.pushTombstones).toEqual([tomb("a", "2026-07-18T12:00:00Z")]);
    // remote still has the record but it is deleted; the engine deletes remote
    // by pushing the tombstone. Nothing to delete locally (already gone).
    expect(r.deleteLocal).toEqual([]);
  });

  it("lets a re-created record newer than its tombstone live", () => {
    // Deleted at 10:00, then re-created at 12:00 → the record survives.
    const r = mergeRecords<Doc>({
      ...empty,
      local: [doc("a", "2026-07-18T12:00:00Z", "reborn")],
      remoteTombstones: [tomb("a", "2026-07-18T10:00:00Z")],
    });
    expect(r.resolved).toEqual([doc("a", "2026-07-18T12:00:00Z", "reborn")]);
    expect(r.deletedIds).toEqual([]);
  });

  it("keeps a record deleted when the tombstone is newer than the re-create", () => {
    const r = mergeRecords<Doc>({
      ...empty,
      local: [doc("a", "2026-07-18T10:00:00Z", "stale")],
      remoteTombstones: [tomb("a", "2026-07-18T12:00:00Z")],
    });
    expect(r.deletedIds).toEqual(["a"]);
    expect(r.resolved).toEqual([]);
  });

  it("takes the latest of competing tombstones", () => {
    const r = mergeRecords<Doc>({
      ...empty,
      local: [doc("a", "2026-07-18T09:00:00Z", "x")],
      localTombstones: [tomb("a", "2026-07-18T10:00:00Z")],
      remoteTombstones: [tomb("a", "2026-07-18T11:00:00Z")],
    });
    // Both sides deleted it, but local still holds the stale record row, so it
    // is removed locally. Neither side needs a tombstone pushed (both have one).
    expect(r.deletedIds).toEqual(["a"]);
    expect(r.deleteLocal).toEqual(["a"]);
    expect(r.pushTombstones).toEqual([]);
  });
});

describe("mergeRecords — a realistic three-way", () => {
  it("converges a mixed batch", () => {
    const r = mergeRecords<Doc>({
      local: [
        doc("keep-local", "2026-07-18T12:00:00Z", "local wins"),
        doc("keep-remote", "2026-07-18T10:00:00Z", "local loses"),
        doc("only-local", "2026-07-18T10:00:00Z", "L"),
        doc("del-remote", "2026-07-18T09:00:00Z", "doomed"),
      ],
      remote: [
        doc("keep-local", "2026-07-18T10:00:00Z", "remote loses"),
        doc("keep-remote", "2026-07-18T12:00:00Z", "remote wins"),
        doc("only-remote", "2026-07-18T10:00:00Z", "R"),
        doc("del-remote", "2026-07-18T09:00:00Z", "doomed"),
      ],
      localTombstones: [],
      remoteTombstones: [tomb("del-remote", "2026-07-18T13:00:00Z")],
    });

    const resolvedById = Object.fromEntries(r.resolved.map((d) => [d.id, d.name]));
    expect(resolvedById).toEqual({
      "keep-local": "local wins",
      "keep-remote": "remote wins",
      "only-local": "L",
      "only-remote": "R",
    });
    expect(r.deletedIds).toEqual(["del-remote"]);
    expect(r.pushRemote.map((d) => d.id).sort()).toEqual(["keep-local", "only-local"]);
    expect(r.applyLocal.map((d) => d.id).sort()).toEqual(["keep-remote", "only-remote"]);
    expect(r.deleteLocal).toEqual(["del-remote"]);
  });

  it("is idempotent — a second merge of the converged state is a no-op", () => {
    const first = mergeRecords<Doc>({
      ...empty,
      local: [doc("a", "2026-07-18T10:00:00Z", "L")],
      remote: [doc("b", "2026-07-18T10:00:00Z", "R")],
    });
    // Apply first's deltas to both sides, then merge again.
    const local = [...first.resolved];
    const remote = [...first.resolved];
    const second = mergeRecords<Doc>({ ...empty, local, remote });
    expect(second.applyLocal).toEqual([]);
    expect(second.pushRemote).toEqual([]);
    expect(second.deleteLocal).toEqual([]);
  });
});

describe("mergeRecords — canonical, order-insensitive reconciliation", () => {
  // Firestore returns a document's fields and every nested map's keys in
  // lexicographic order, not the client's insertion order. Reconciliation must
  // see a record and its own reordered round-trip as EQUAL, or every sync pass
  // re-pushes every product forever (unbounded write churn, never converges).
  const rec = (o: Record<string, unknown>): Doc => o as unknown as Doc;
  const t = "2026-07-18T10:00:00Z";

  it("treats a key-reordered round-trip as already-converged (no push, no apply)", () => {
    const local = rec({
      id: "p1",
      updatedAt: t,
      name: "widget",
      cost: { materialCents: 10, machineCents: 5, laborCents: 0 },
    });
    // Same content, keys sorted as Firestore hands them back — top level and nested.
    const remoteRoundTrip = rec({
      cost: { laborCents: 0, machineCents: 5, materialCents: 10 },
      id: "p1",
      name: "widget",
      updatedAt: t,
    });
    const r = mergeRecords<Doc>({ ...empty, local: [local], remote: [remoteRoundTrip] });
    expect(r.applyLocal).toEqual([]);
    expect(r.pushRemote).toEqual([]);
  });

  it("still detects a genuine content change under reordered keys", () => {
    const local = rec({ id: "p1", updatedAt: t, cost: { materialCents: 10 } });
    const remote = rec({ cost: { materialCents: 99 }, id: "p1", updatedAt: t });
    const r = mergeRecords<Doc>({ ...empty, local: [local], remote: [remote] });
    // Equal timestamps but different content → not treated as already-equal.
    expect(r.applyLocal.length + r.pushRemote.length).toBeGreaterThan(0);
  });

  it("ties break identically whatever the key order on each side", () => {
    const a = mergeRecords<Doc>({
      ...empty,
      local: [rec({ id: "x", updatedAt: t, a: 1, b: 2 })],
      remote: [rec({ b: 2, a: 1, id: "x", updatedAt: t })],
    });
    // Byte-equal after canonicalization → converged, no churn either direction.
    expect(a.applyLocal).toEqual([]);
    expect(a.pushRemote).toEqual([]);
  });
});

describe("mergeEvents — append-only union", () => {
  const ev = (id: string, ts: string) => ({ id, ts, kind: "sale" });

  it("fills each side with the events it is missing", () => {
    const r = mergeEvents(
      [ev("s1", "2026-07-18T10:00:00Z"), ev("s2", "2026-07-18T11:00:00Z")],
      [ev("s2", "2026-07-18T11:00:00Z"), ev("s3", "2026-07-18T12:00:00Z")],
    );
    expect(r.applyLocal).toEqual([ev("s3", "2026-07-18T12:00:00Z")]);
    expect(r.pushRemote).toEqual([ev("s1", "2026-07-18T10:00:00Z")]);
    expect(r.merged.map((e) => e.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("returns the union sorted by (ts, id) regardless of input order", () => {
    const r = mergeEvents(
      [ev("b", "2026-07-18T12:00:00Z"), ev("a", "2026-07-18T10:00:00Z")],
      [ev("c", "2026-07-18T10:00:00Z")],
    );
    // a and c share a ts; id breaks the tie.
    expect(r.merged.map((e) => e.id)).toEqual(["a", "c", "b"]);
  });

  it("never double-counts an event both sides already have", () => {
    const shared = ev("s1", "2026-07-18T10:00:00Z");
    const r = mergeEvents([shared], [shared]);
    expect(r.applyLocal).toEqual([]);
    expect(r.pushRemote).toEqual([]);
    expect(r.merged).toEqual([shared]);
  });

  it("is idempotent", () => {
    const a = [ev("s1", "2026-07-18T10:00:00Z")];
    const b = [ev("s2", "2026-07-18T11:00:00Z")];
    const once = mergeEvents(a, b);
    const twice = mergeEvents(once.merged, once.merged);
    expect(twice.applyLocal).toEqual([]);
    expect(twice.pushRemote).toEqual([]);
  });
});
