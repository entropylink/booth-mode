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

  pricing: {
    /**
     * Fair price as a multiple of the house price. The source spreadsheet used
     * exactly 1.25 on all 60 rows. Only applied when selling_price is missing
     * on import — an explicit price always wins.
     */
    fairMarkup: 1.25,
    /** Round a computed fair price up to a whole peso. */
    roundToWholePeso: true,
  },

  /** Restock list: flag a variant at or below this many units (plan.md §6 F4). */
  restockThresholdDefault: 3,

  /** Low-battery "export now" warning threshold (plan.md §12). */
  lowBatteryWarningPct: 30,

  /**
   * Colors handed to tiers in sort order as they are discovered on import.
   * Tiers are data, not an enum — see core-data/types.ts.
   */
  tierPalette: ["#d9a441", "#5eb0e5", "#57c98a", "#e08641", "#d9628f", "#9b8cd9"],
  tierFallbackColor: "#8b93a3",
};

export type Config = typeof config;
