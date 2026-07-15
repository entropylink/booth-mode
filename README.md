# Booth Mode

Craft-fair day-of app: tiered stock planning, glove-friendly tap-to-sell, MXN
cash handling with change calculator, restock alerts, end-of-day P&L per
product.

Full spec: [plan.md](./plan.md)

## Status — v1 (P0–P3) built, fully offline

| Phase | Deliverable | State |
|---|---|---|
| P0 | Scaffold, event-log engine, i18n, CSV import | done |
| P1 | Products/stock + stock planning (F1) | done |
| P2 | Sale mode + cash/change engine (F2) | done |
| P3 | Float counts, expenses, day summary, exports (F3/F4) | done |
| P4 | Store builds + standalone license unlock | not started |
| P5 | Forge Log sync, restock alerts, multi-day carryover | blocked on Forge Log sync layer |

Everything works with no network. There is no Firebase dependency in v1 — sync
is a v1.5 concern (plan.md §3).

## Run

```bash
npm install
npm run dev      # vite dev server
npm test         # vitest — money, derivations, CSV
npm run build    # tsc -b && vite build
```

## Architecture

**The event log is the source of truth.** `db.events` is append-only: sales,
voids, expenses and float counts are appended and never mutated or deleted.
Stock levels and every money total are *derivations* over that log
(`src/lib/derive.ts`), not stored counters. Cancelling a sale appends a
compensating `saleVoided` event; the original stays put.

This is what makes airplane-mode-all-day the designed path rather than an edge
case, and it's why two devices on one booth (v2) will merge without conflict.

- `src/lib/money.ts` — all money is **integer centavos**, never floats. Change
  making, formatting, parsing, denomination breakdown.
- `src/lib/inventory.ts` — the stock picture: have, target, made, packed, sold,
  to-make, margin. The app's centre of gravity.
- `src/lib/derive.ts` — every money total on screen. UI never sums money.
- `src/config.ts` — denominations, markup, thresholds, tier palette.
- `src/core-data/types.ts` — schema. The `Tier`/`UnitCost`/`Product` block is
  **shared with Forge Log** and duplicated by hand until these apps share a real
  package.
- `src/core-data/template.ts` — the shared CSV contract, byte-identical to
  Forge Log's copy. See [docs/stock-template.md](docs/stock-template.md).

### The suite loop

Forge Log (workshop) owns costs, production times, machines, tiers and workshop
stock. Booth Mode (fair) owns targets, packing, sales and cash. They exchange
one CSV; `src/lib/interop.test.ts` imports a real file emitted by Forge Log and
fails if the two ever drift apart.

Tiers are **hypotheses about what will sell**, not fixed price bands — which is
why they're editable named data rather than a 1–5 enum. Booth Mode's sales
figures are what tells you a tier was wrong.

### Unknown beats wrong

Cost 0 means "not captured", not "free". Margin, profit and bench-time totals are
withheld and shown as `—` rather than computed from partial data — a profit total
that silently skips uncosted products is a lie in your own favour.

## Notable decisions

- **Sunlight mode** (`☀ Sol` in the topbar) swaps the Entropy space-dark shell
  for a high-contrast light palette (16.6:1). A dark UI is unreadable in direct
  sun — the screen can't out-emit it — and plan.md §7 requires sunlight
  legibility. Dark stays the default and the house look.
- **Fonts are not loaded from a CDN.** Cinzel carries house identity in headers
  with a system fallback; all numerals use a system sans with tabular figures.
  A fair has no signal, and money is read at arm's length.
- **Booth fee is not an expense.** It lives on the fair record and is shown as
  its own line in the summary, so logging a booth expense can't double-count it.
- **Expenses carry `paidFromBox`**, which plan.md §5 omits but §6 F3 requires —
  the cash reconciliation is wrong without it.

## Known gaps

- **No production times or costs in the real data yet.** The importer reads both,
  and the app shows `—` for profit and bench hours until they're filled in.
- Restock ranks by `margin × velocity` per plan.md §6 F4. Products without a cost
  fall back to revenue velocity.
- No Playwright drill yet; the F2 accept criteria's 50-sale/3-void drill is
  covered as a unit test over the pure derivation (`src/lib/derive.test.ts`),
  not yet through a browser.
- Tier editing lives in Forge Log (not built). Booth Mode creates tiers on import
  and when adding a product, but has no tier manager.
- `src/lib/__fixtures__/feria-stock-plan.csv` is the vendor's real catalog with
  real prices — it is a test fixture and this repo is private.
