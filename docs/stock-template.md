# The stock template

The single CSV both **Booth Mode** and **Forge Log** read and write. It is
defined in `src/core-data/template.ts`, duplicated byte-for-byte in
`../forge-log/src/core-data/template.ts`.

Change it in one repo and you must change it in the other. `src/lib/interop.test.ts`
fails if they drift.

## Columns

### Input — these round-trip

| Column | Meaning | Owner |
|---|---|---|
| `sku` | Your catalog number. The stable identity across both apps and re-imports. | you |
| `product` | Product name. | you |
| `variant` | Blank when the product has no variants. One row per variant. | you |
| `tier` | Full tier label, e.g. `Flagship – go deep`. Free text — new tiers just work. | you |
| `machine` | Production method: `laser`, `cameo`, `craft`… Joins to Forge Log's machine catalog. | Forge Log |
| `cost_material` | Per-unit material cost. | Forge Log |
| `cost_machine` | Per-unit machine time cost. | Forge Log |
| `cost_labor` | Per-unit labour cost. | Forge Log |
| `cost_consumable` | Per-unit consumables. | Forge Log |
| `cost_packaging` | Per-unit packaging. | Forge Log |
| `house_price` | Your standard/direct price. | you |
| `selling_price` | What you actually charge at the fair. If blank, computed as `house_price × 1.25` rounded to a whole peso. | you |
| `current_qty` | Units in the workshop. | Forge Log |
| `goal_qty` | Target to bring to a fair. | Booth Mode |
| `made` | Production finished for this line. `yes`/`ya`/`x`/blank. **Not** the same as hitting the goal. | Booth Mode |
| `packed_qty` | Units actually in the box. | Booth Mode |
| `production_minutes` | Minutes to make one. Enables "can I build the gap before Saturday?". | Forge Log |
| `restock_threshold` | Flag this product at or below this many units. Falls back to the app default. | you |
| `active` | `yes`/`no`. Discontinued products stay in the file. | you |
| `notes` | Free text. | you |

### Derived — written for humans, ignored on import

`unit_cost`, `margin_unit`, `margin_pct`, `to_make`, `goal_value`, `goal_profit`.

These exist so the file is readable in Excel. **Both apps recompute them on
import and never trust the file's values.** If you edit `goal_value` by hand it
will be silently overwritten — edit the inputs instead.

Why: the original spreadsheet displayed `SELLING PRICE` rounded (313) but
computed `GOAL VALUE` from the unrounded 312.5. Its own columns disagreed, and
the totals row under-reported by **$219** across 729 units. Recomputing from the
price actually charged is what stops that.

## Rules

- **Money** is written with two decimals (`75.00`). Thousands separators are
  accepted on import (`"6,000"`) but never written.
- **Blank quantity** means zero.
- **Cost 0 means "not captured", not "free".** Margin and profit are reported as
  *unknown* rather than as 100%. A total that silently skips uncosted products is
  worse than no total, so both apps withhold the profit total entirely until
  every product has a cost.
- **A `TOTAL` row is skipped** on import.
- **One row per product::variant.** Rows sharing a `sku` are one product.

## Who fills in what

Forge Log is the workshop: it owns costs, production times, machines, tiers and
`current_qty`. It exports `goal_qty`/`packed_qty`/`made` as empty, because it has
no fair to have an opinion about. Booth Mode owns those three.

So the loop is: Forge Log exports the catalog → Booth Mode imports it, sets
targets, packs, sells → sales data says which tiers were wrong → you revise the
tiers in Forge Log.

## Migrating a legacy sheet

The importer is deliberately forgiving, because real spreadsheets are not clean:

- Headers in English or Spanish, any case, accented or not (`Artículo`, `GOAL QTY`,
  `existencia`).
- **Unlabelled columns are recovered by sniffing their values** and reported in
  the import summary — never applied silently. The original sheet kept its `ya`
  flag and its `laser`/`cameo`/`craft` method in two columns with empty headers.
- Bad rows are collected and listed; the good rows still import.
- Unrecognised columns are listed rather than dropped in silence.

Check the import summary. If it guessed, it says so.
