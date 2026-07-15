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
- `src/lib/derive.ts` — every total on screen. UI components never sum money.
- `src/config.ts` — denominations, thresholds, tier colors. Config-only tuning.
- `src/core-data/types.ts` — schema. The `Product` shape is **shared with Forge
  Log** (`../forge-log`) and duplicated by hand until these apps share a real
  package; keep the two in sync when either changes.

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

- The CSV importer's column format is a best guess at Francis's real
  spreadsheet (tolerant of EN/ES headers, see `src/lib/csv.ts`). Point it at the
  real file and adjust.
- Restock ranking is `margin × velocity` per plan.md §6 F4, but real margin needs
  Forge Log costing (v1.5). Until then unit price stands in for margin, so it
  ranks by revenue velocity.
- No Playwright drill yet; the F2 accept criteria's 50-sale/3-void drill is
  covered as a unit test over the pure derivation
  (`src/lib/derive.test.ts`), not yet through a browser.
