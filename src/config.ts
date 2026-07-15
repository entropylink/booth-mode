// Config-only tuning values (plan.md §10 cheap-model notes) — no logic here.
// Money everywhere in this app is integer CENTAVOS. Never floats, never pesos.

export const config = {
  currency: {
    code: "MXN",
    symbol: "$",
    /** Smallest unit per major unit. Kept abstract for future markets (plan.md §8). */
    minorPerMajor: 100,
  },

  /**
   * Current MXN circulation, in centavos, descending (plan.md §5 FloatCount).
   * Greedy change-making is optimal for this 1-2-5 series — see money.ts.
   */
  denominationsCents: [
    100000, // $1000
    50000, //  $500
    20000, //  $200
    10000, //  $100
    5000, //   $50
    2000, //   $20
    1000, //   $10
    500, //    $5
    200, //    $2
    100, //    $1
    50, //     $0.50
  ] as const,

  /** Quick-tender buttons in Venta, in centavos (plan.md §6 F2). */
  quickTenderCents: [20000, 50000, 100000] as const,

  /** Quick discount percentages offered in the cart (plan.md §6 F2). */
  quickDiscountPcts: [10, 20] as const,

  /** Restock list: flag a variant at or below this many units (plan.md §6 F4). */
  restockThresholdDefault: 3,

  /** Low-battery "export now" warning threshold (plan.md §12). */
  lowBatteryWarningPct: 30,

  /** Tier edge colors for product tiles (plan.md §6 F2). Distinct in sun and shade. */
  tierColors: {
    1: "#5eb0e5",
    2: "#57c98a",
    3: "#b89857",
    4: "#e08641",
    5: "#d9628f",
  } as Record<number, string>,
};

export type Config = typeof config;
