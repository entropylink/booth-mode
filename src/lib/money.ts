// Money engine (plan.md §10: "money/change/derivation logic pure functions —
// UI never sums"). Every amount is integer centavos. Nothing here touches
// floats except through roundHalfUp, and nothing here touches React.

import { config } from "../config";
import type { Cents, DenominationCounts, UnitCost } from "../core-data/types";

const { minorPerMajor, symbol } = config.currency;

/** The one place the cost lines are added up. */
export function totalUnitCost(cost: UnitCost): Cents {
  return (
    cost.materialCents +
    cost.machineCents +
    cost.laborCents +
    cost.consumableCents +
    cost.packagingCents
  );
}

/** Retail rounding: half away from zero. Math.round is half-up for positives. */
export function roundHalfUp(n: number): Cents {
  return Math.round(n);
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * "$1,250.50". Hand-rolled rather than Intl so output is identical across
 * Node/browser ICU builds — fixtures compare exact strings.
 */
export function formatMXN(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const major = Math.floor(abs / minorPerMajor);
  const minor = abs % minorPerMajor;
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const minorStr = String(minor).padStart(String(minorPerMajor - 1).length, "0");
  return `${negative ? "-" : ""}${symbol}${grouped}.${minorStr}`;
}

/** Compact form for tile prices: "$250" when whole, "$249.50" otherwise. */
export function formatMXNCompact(cents: Cents): string {
  return cents % minorPerMajor === 0
    ? formatMXN(cents).replace(/\.00$/, "")
    : formatMXN(cents);
}

/**
 * Parse user input ("1,250.5", "$249", "89.10") to centavos.
 * Returns null on anything malformed — callers must handle it.
 */
export function parseMXN(input: string): Cents | null {
  const s = input.trim().replace(/[$,\s]/g, "");
  if (s === "" || s === "." || s === "-" || s === "-.") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(s)) return null;

  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [intPart = "", fracPart = ""] = body.split(".");
  if (intPart === "" && fracPart === "") return null;

  const major = intPart === "" ? 0 : Number(intPart);
  const minor = Number((fracPart + "00").slice(0, 2));
  const cents = major * minorPerMajor + minor;
  return negative ? -cents : cents;
}

/** Gross for one cart line, discount applied. Never negative. */
export function lineTotal(
  unitPriceCents: Cents,
  qty: number,
  discount?: { kind: "pct"; pct: number } | { kind: "abs"; cents: Cents },
): Cents {
  const gross = unitPriceCents * qty;
  if (!discount) return Math.max(0, gross);
  if (discount.kind === "pct") {
    const pct = Math.min(100, Math.max(0, discount.pct));
    return Math.max(0, roundHalfUp((gross * (100 - pct)) / 100));
  }
  return Math.max(0, gross - discount.cents);
}

/** Positive = owed to customer. Negative = customer still owes (short tender). */
export function changeDue(totalCents: Cents, cashGivenCents: Cents): Cents {
  return cashGivenCents - totalCents;
}

export interface BreakdownLine {
  denomCents: Cents;
  count: number;
}

export interface Breakdown {
  lines: BreakdownLine[];
  /**
   * What the drawer physically cannot make (e.g. $0.10 of change — the
   * smallest MXN denomination is $0.50). Surfaced rather than silently dropped.
   */
  remainderCents: Cents;
}

/**
 * Suggested change breakdown, largest denomination first.
 *
 * Greedy is provably optimal here: MXN is a 1-2-5 series (50, 100, 200, 500,
 * 1000, 2000, 5000, 10000, 20000, 50000, 100000 centavos), which is canonical.
 */
export function changeBreakdown(
  cents: Cents,
  denominations: readonly Cents[] = config.denominationsCents,
): Breakdown {
  if (cents <= 0) return { lines: [], remainderCents: Math.max(0, cents) };

  const lines: BreakdownLine[] = [];
  let remaining = cents;
  for (const denom of denominations) {
    const count = Math.floor(remaining / denom);
    if (count > 0) {
      lines.push({ denomCents: denom, count });
      remaining -= count * denom;
    }
  }
  return { lines, remainderCents: remaining };
}

/** Total of a denomination grid (float count). Keys are centavo denominations. */
export function countTotal(denominations: DenominationCounts): Cents {
  let total = 0;
  for (const [denom, count] of Object.entries(denominations)) {
    const d = Number(denom);
    if (!Number.isFinite(d) || !Number.isFinite(count)) continue;
    total += d * Math.max(0, Math.floor(count));
  }
  return total;
}

/** Smallest tender >= total using available denominations (the "exact-ish" hint). */
export function suggestedTender(totalCents: Cents): Cents {
  if (totalCents <= 0) return 0;
  const denoms = [...config.denominationsCents].sort((a, b) => a - b);
  for (const d of denoms) if (d >= totalCents) return d;
  return Math.ceil(totalCents / 10000) * 10000;
}
