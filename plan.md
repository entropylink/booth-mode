# Booth Mode — plan.md

> **Craft-fair day-of app**: tiered stock planning, glove-friendly tap-to-sell, MXN cash handling with change calculator, restock alerts, end-of-day P&L per product. **Shares its product/inventory data with Forge Log** — costing flows in, sales flow back.
>
> Status: **built — v1 (P0–P3), 2026-07-14/15** · Source: Fable 5 planning session 2026-07-12 · Score 14/20 (rank #8)
> Suggested vault path: `domains/products/apps/booth-mode/plan.md`
>
> **Estado real (2026-07-18):**
> - P0–P3 built (2026-07-14/15); 108 unit tests green.
> - Not a PWA yet — the app does not load without the dev server (gap #1 for fair-day use).
> - No Playwright tests yet (unit only); the F2 fair-day drill is still pending.
> - Tiers are implemented as named data, not 1–5 (decision documented in code).
> - Photo tiles, orientation lock, and low-battery auto-export not implemented yet.
> - P4 (store builds/license) and P5 (sync/alerts) not started; `runs/` unused.

---

## 1. Decisions locked

- **Cash-first MXN**: denominations, float counts, change calculator are core, not add-ons.
- **Shared inventory with Forge Log** — same Firebase project, same `Product` schema from `packages/core-data` (see forge-log-plan.md §4–5). Booth Mode is a sibling app in the monorepo, not a Forge Log tab: fair-day UX demands its own dedicated, distraction-free app.
- Priced from day 1: **included in the Forge Log subscription** (suite value) + standalone one-time offline edition. Bilingual EN/ES, **ES default** (Mexican fair context).

## 2. Problem & user

Fair vendors track sales on paper or memory, guess restocks, and discover which products actually earn only after the season. Square does payments; nothing does **fair-specific stock intelligence**: plan by tier, sell fast at the table, know at 2pm what to restock for tomorrow, and see per-product P&L including booth costs.

User: makers/artisans vending fairs and markets. Francis is user #1 (Entropy stock across five product tiers; his existing planning spreadsheet is the feature seed and the migration fixture).

## 3. Scope

**v1:** products/stock (shared schema), pre-fair stock plan by tier, sale mode (tap-to-sell + cash flow), expenses, day summary — **fully offline**.
**v1.5:** Firebase sync with Forge Log (costing → margins in P&L; sales → stock decrement visible in workshop), restock alerts, multi-day events with day-over-day carryover.
**v2:** multi-vendor split booths (shared table, separate tallies), historical analytics across events ("what to make for December").
**Out:** card payment processing (record a "tarjeta/transfer" sale type; the terminal is someone else's product), invoicing/CFDI, customer data capture, online store.

## 4. Architecture & stack

- **Monorepo sibling of Forge Log**: `apps/booth-mode` consuming `packages/core-data` (Product, Costing types, sync engine) + `packages/ui`. Vite + React + TS + Capacitor.
- **Offline-existential**: fairs = no signal. Dexie local store; **sales are an append-only event log** (saleRecorded, saleVoided, expenseAdded, floatCounted…) — stock and totals are derivations; sync (v1.5) merges event logs, so airplane-mode all day then sync at the hotel is the designed path, not an edge case.
- Conflict rule with Forge Log: stock **decrements are events**, stock *targets/definitions* are LWW from Forge Log side. Two devices selling the same booth (v2) already works under event-log semantics.

## 5. Data model

```
Product      ← shared (forge-log core-data): id, name, tier(1-5), variants[],
               photoRef, priceMXN, costingRef?, stockByVariant{}
EventFair    id, name, dates[], boothFeeMXN, location, floatStartMXN?, status
StockPlan    id, eventId, lines[{productId, variant, target, packed}]      (plan vs packed)
SaleEvent    append-only: {ts, items[{productId, variant, qty, unitPrice, discount?}],
               payType(efectivo|tarjeta|transferencia), cashGiven?, changeDue?}
Expense      {ts, concept, amountMXN, category(booth|food|transport|material|other)}
FloatCount   {ts, kind(start|end), denominations{1000:n,500:n,200:n,100:n,50:n,20:n,
               10:n,5:n,2:n,1:n,0.5:n}, total}
DaySummary   derived: gross, byPayType, byProduct/tier, expenses, net, sellThrough%,
               cashExpected vs counted delta, restockList
```

## 6. Feature spec

### F1 — Stock planning (pre-fair)
Per event: pick products, set target qty per variant guided by tier heuristics + (v1.5) last-event sell-through; packing checklist mode (target vs packed with big checkboxes for load-out). Import path from his existing spreadsheet (CSV) = migration fixture. **Accept:** his real five-tier plan round-trips from CSV; packed-vs-target report correct.

### F2 — Sale mode (the table UI)
Product grid (photo tiles, tier-color edge), tap → variant if needed → qty stepper → cart; **cash flow**: total big, quick-tender buttons (exact, $200, $500, custom) → **change due huge on screen**; discount/bundle quick-actions (–10%, 2×, custom); sale types: efectivo/tarjeta/transferencia. Undo = compensating void event (hold-to-confirm). Entire flow ≤4 taps for a simple cash sale. **Accept:** Playwright drill: 50 mixed sales incl. 3 voids + discounts, airplane mode throughout → derived totals exactly match fixture; change math exhaustive unit tests (peso denominations incl. 50¢).

### F3 — Cash & float
Start-of-day float count (denomination grid) → end-of-day count → expected-vs-counted delta computed from event log. **Accept:** delta correct across fixtures with mixed pay types and cash expenses paid from the box.

### F4 — Expenses + Day summary
Quick expense entry; end-of-day: gross/net, by pay type, by product and tier, sell-through %, margin per product when Costing present (v1.5 sync), **restock list for tomorrow** (sold-out + below-threshold, sorted by margin×velocity). Export day summary as md/CSV (→ weekly-digest skill input). **Accept:** summary fixtures exact; restock ordering matches rule.

### F5 — Restock alerts (v1.5, needs sync)
Threshold per product; when online, FCM ping to the "taller" device ("Coasters T2: quedan 3"). Degrades silently offline (alerts queue). **Accept:** emulator test: threshold cross → exactly one notification.

## 7. Screens/UX

Tabs: **Plan · Venta · Caja · Resumen**. Venta mode: kiosk-like, sunlight-legible high contrast, oversized targets (operated standing, distracted, possibly gloved), orientation lock, sleep disabled, battery indicator prominent. Every money action = optimistic UI on the event log (never blocks on anything).

## 8. i18n & house style

**es-MX default**, EN complete. Entropy tokens; per-app accent: market gold. Peso formatting everywhere ($1,250.50); denomination set = current MXN circulation, defined in config (currency abstraction kept for future markets).

## 9. Pricing

- **Included with Forge Log sub** (headline suite value; drives Forge Log conversion).
- **Standalone Booth Mode Offline: one-time $19 USD / $349 MXN** — full v1 features, no sync/alerts (those require the Forge Log account). Clean upsell path.

## 10. Build phases

| Phase | Deliverable | Gate |
|---|---|---|
| P0 | App scaffold on core-data, event-log engine reuse, i18n, CSV import of his real stock plan | fixture import green |
| P1 | Products/stock + Stock planning | F1 accept |
| P2 | Sale mode + cash/change engine | F2 drill + change-math suite |
| P3 | Float counts + expenses + day summary + exports | F3/F4 fixtures |
| P4 | Store builds + standalone license unlock | fresh-device restore e2e |
| P5 (v1.5) | Sync with Forge Log + restock alerts + multi-day carryover | cross-app sync fixture: sale in Booth → stock visible in Forge Log |

Dependency note: P0–P4 need only `core-data` schemas (buildable **before** Forge Log ships, sharing the package); P5 needs Forge Log's sync layer live. Sequencing option: Booth Mode v1 standalone can actually ship first as the suite's beachhead — decide at Forge Log P2.

Cheap-model notes: money/change/derivation logic pure functions (`money.ts`, `derive.ts`) — UI never sums; denominations/thresholds in config; run logs `runs/booth-mode/`.

## 11. QA discipline

Change-calculator: exhaustive unit fixtures (every denomination path). Full fair-day Playwright drill offline per release. First real fair = **shadow mode** (paper tally parallel), deltas → fixtures (same ritual as Lot Runner — these two share the money-integrity pattern).

## 12. Risks & mitigations

- **Device dies mid-fair** → event log autosaved per action; periodic archive-export prompt; low-battery warning at 30% with "export now" shortcut; paper-fallback sheet printable from Plan.
- **Sync conflicts with workshop edits** → events-vs-LWW split (§4) makes conflicts structurally impossible for money; product-definition edits during a live fair are soft-locked with warning.
- **Scope pull toward POS/payments** → Out-list contractual; "tarjeta" is a recorded type, never a processed one.
- **Suite coupling risk** (Forge Log slips → Booth blocked) → mitigated by dependency note above; core-data is the only shared surface.

## 13. Success metrics

Next real Entropy fair runs fully in-app: zero paper, cash delta ≤ $20 MXN, restock list actually used next morning; standalone edition sells 30 copies in 2 fairs seasons; Booth→Forge Log sub conversion measurable ≥15%.

## 14. Open questions

- Bundle/kit products (gift packs of tier items) as first-class SKUs — before or after v1?
- Sell-through heuristics: per-tier defaults from his spreadsheet history — extract at P1.
- Shared-booth (two vendors) demand at his local fairs — ask before scoping v2.
