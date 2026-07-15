import { describe, expect, it } from "vitest";
import { config } from "../config";
import {
  changeBreakdown,
  changeDue,
  countTotal,
  formatMXN,
  formatMXNCompact,
  lineTotal,
  parseMXN,
  suggestedTender,
  sumCents,
} from "./money";

const DENOMS = config.denominationsCents;
const SMALLEST = 50; // $0.50 — every MXN denomination is a multiple of this.

describe("formatMXN", () => {
  it("formats pesos and centavos with grouping", () => {
    expect(formatMXN(0)).toBe("$0.00");
    expect(formatMXN(50)).toBe("$0.50");
    expect(formatMXN(5)).toBe("$0.05");
    expect(formatMXN(12000)).toBe("$120.00");
    expect(formatMXN(125050)).toBe("$1,250.50");
    expect(formatMXN(100000000)).toBe("$1,000,000.00");
    expect(formatMXN(-4460)).toBe("-$44.60");
  });

  it("drops .00 only in compact form", () => {
    expect(formatMXNCompact(25000)).toBe("$250");
    expect(formatMXNCompact(24950)).toBe("$249.50");
    expect(formatMXN(25000)).toBe("$250.00");
  });
});

describe("parseMXN", () => {
  it("parses the shapes a vendor actually types", () => {
    expect(parseMXN("120")).toBe(12000);
    expect(parseMXN("$120")).toBe(12000);
    expect(parseMXN("1,250.50")).toBe(125050);
    expect(parseMXN("$1,250.50")).toBe(125050);
    expect(parseMXN("0.5")).toBe(50); // half a peso, not five centavos
    expect(parseMXN("0.05")).toBe(5);
    expect(parseMXN(" 89.10 ")).toBe(8910);
    expect(parseMXN("-20")).toBe(-2000);
  });

  it("rejects malformed input instead of guessing", () => {
    expect(parseMXN("")).toBeNull();
    expect(parseMXN("abc")).toBeNull();
    expect(parseMXN("1.234")).toBeNull(); // more precision than centavos
    expect(parseMXN("1.2.3")).toBeNull();
    expect(parseMXN(".")).toBeNull();
    expect(parseMXN("-")).toBeNull();
  });

  it("round-trips with formatMXN", () => {
    for (let cents = 0; cents <= 200000; cents += 137) {
      expect(parseMXN(formatMXN(cents))).toBe(cents);
    }
  });
});

describe("lineTotal", () => {
  it("multiplies without discount", () => {
    expect(lineTotal(12000, 1)).toBe(12000);
    expect(lineTotal(12000, 3)).toBe(36000);
    expect(lineTotal(4500, 0)).toBe(0);
  });

  it("applies percent discounts (hand-computed)", () => {
    expect(lineTotal(24900, 1, { kind: "pct", pct: 10 })).toBe(22410); // $249 → $224.10
    expect(lineTotal(4500, 3, { kind: "pct", pct: 10 })).toBe(12150); // 3×$45 → $121.50
    expect(lineTotal(12000, 2, { kind: "pct", pct: 20 })).toBe(19200); // 2×$120 → $192
    expect(lineTotal(10000, 1, { kind: "pct", pct: 0 })).toBe(10000);
    expect(lineTotal(10000, 1, { kind: "pct", pct: 100 })).toBe(0);
  });

  it("rounds half-up at the centavo", () => {
    expect(lineTotal(50, 1, { kind: "pct", pct: 1 })).toBe(50); // 49.5 → 50
    expect(lineTotal(3333, 1, { kind: "pct", pct: 10 })).toBe(3000); // 2999.7 → 3000
    expect(lineTotal(333, 1, { kind: "pct", pct: 10 })).toBe(300); // 299.7 → 300
  });

  it("applies absolute discounts and never goes negative", () => {
    expect(lineTotal(24000, 1, { kind: "abs", cents: 5000 })).toBe(19000);
    expect(lineTotal(10000, 1, { kind: "abs", cents: 99999 })).toBe(0);
    expect(lineTotal(10000, 1, { kind: "pct", pct: 150 })).toBe(0);
  });
});

describe("changeDue", () => {
  it("is positive when change is owed and negative when tender is short", () => {
    expect(changeDue(12000, 20000)).toBe(8000);
    expect(changeDue(12000, 12000)).toBe(0);
    expect(changeDue(12000, 10000)).toBe(-2000);
  });
});

/**
 * Brute-force minimal-coin count. Independent of the greedy implementation, so
 * agreement between the two is real evidence rather than a restated assumption.
 */
function minCoinsDP(amountCents: number): number {
  const units = amountCents / SMALLEST;
  const denomUnits = DENOMS.map((d) => d / SMALLEST);
  const best = new Array<number>(units + 1).fill(Infinity);
  best[0] = 0;
  for (let i = 1; i <= units; i++) {
    for (const d of denomUnits) {
      if (d <= i && best[i - d] + 1 < best[i]) best[i] = best[i - d] + 1;
    }
  }
  return best[units];
}

describe("changeBreakdown", () => {
  it("breaks down a typical fair transaction", () => {
    expect(changeBreakdown(8000)).toEqual({
      lines: [{ denomCents: 5000, count: 1 }, { denomCents: 2000, count: 1 }, { denomCents: 1000, count: 1 }],
      remainderCents: 0,
    });
  });

  it("returns nothing for zero or negative change", () => {
    expect(changeBreakdown(0)).toEqual({ lines: [], remainderCents: 0 });
    expect(changeBreakdown(-500)).toEqual({ lines: [], remainderCents: 0 });
  });

  it("reports what the drawer physically cannot make", () => {
    // $0.10 of change: no MXN denomination is smaller than $0.50.
    expect(changeBreakdown(10)).toEqual({ lines: [], remainderCents: 10 });
    // $44.60 → $20×2 + $2×2 + $0.50, leaving $0.10 unmakeable.
    expect(changeBreakdown(4460)).toEqual({
      lines: [
        { denomCents: 2000, count: 2 },
        { denomCents: 200, count: 2 },
        { denomCents: 50, count: 1 },
      ],
      remainderCents: 10,
    });
  });

  it("hits every denomination path", () => {
    for (const denom of DENOMS) {
      const { lines, remainderCents } = changeBreakdown(denom);
      expect(remainderCents).toBe(0);
      expect(lines).toEqual([{ denomCents: denom, count: 1 }]);
    }
    // One of each, all at once.
    const all = sumCents([...DENOMS]);
    const { lines, remainderCents } = changeBreakdown(all);
    expect(remainderCents).toBe(0);
    expect(lines.every((l) => l.count === 1)).toBe(true);
    expect(lines).toHaveLength(DENOMS.length);
  });

  it("always sums back to the input", () => {
    for (let cents = 0; cents <= 250000; cents += 7) {
      const { lines, remainderCents } = changeBreakdown(cents);
      const total = sumCents(lines.map((l) => l.denomCents * l.count));
      expect(total + remainderCents).toBe(cents);
      expect(remainderCents).toBe(cents % SMALLEST);
    }
  });

  it("is optimal — greedy matches brute force for every makeable amount", () => {
    for (let cents = 0; cents <= 200000; cents += SMALLEST) {
      const { lines, remainderCents } = changeBreakdown(cents);
      const greedyCount = lines.reduce((n, l) => n + l.count, 0);
      expect(remainderCents).toBe(0);
      expect(greedyCount).toBe(minCoinsDP(cents));
    }
  });
});

describe("countTotal", () => {
  it("totals a denomination grid", () => {
    expect(countTotal({})).toBe(0);
    expect(countTotal({ "100000": 1, "50000": 2, "50": 3 })).toBe(200150);
    // A full starting float: 10×$100 + 20×$50 + 20×$20 + 10×$10 = $2,500
    expect(countTotal({ "10000": 10, "5000": 20, "2000": 20, "1000": 10 })).toBe(250000);
  });

  it("ignores junk and never counts negatives", () => {
    expect(countTotal({ "1000": -5 })).toBe(0);
    expect(countTotal({ abc: 3 })).toBe(0);
    expect(countTotal({ "1000": 2.7 })).toBe(2000);
  });
});

describe("suggestedTender", () => {
  it("suggests the smallest note that covers the total", () => {
    expect(suggestedTender(12000)).toBe(20000);
    expect(suggestedTender(20000)).toBe(20000);
    expect(suggestedTender(20001)).toBe(50000);
    expect(suggestedTender(0)).toBe(0);
  });
});
