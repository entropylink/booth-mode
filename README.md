# Booth Mode

Craft-fair day-of app: tiered stock planning, glove-friendly tap-to-sell, MXN
cash handling with change calculator, restock alerts, end-of-day P&L per
product.

Full spec: [plan.md](./plan.md)

Shares product/inventory schema with the sibling app **Forge Log**
(`../forge-log`) — see plan.md §5 for the shared `Product` shape. This repo
is currently standalone (not a monorepo package) — schema is duplicated
locally in `src/core-data/types.ts` until sync is built (v1.5, plan.md §4/§10).

## Stack

Vite + React + TypeScript, Capacitor (iOS/Android), Dexie (local-first,
event-log style), i18next (ES default, EN complete).

## Status

Skeleton only — no features implemented yet. See plan.md §10 for build phases.
