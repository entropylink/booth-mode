// Config-only tuning values (plan.md §10 cheap-model notes) — no logic here.

export const config = {
  currency: {
    primary: "MXN",
  },
  denominations: [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5],
  lowBatteryWarningPct: 30,
};
