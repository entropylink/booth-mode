// Live bindings from the event log to the UI. Components read derived state
// through these hooks and never compute money themselves (plan.md §10).

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./dexie";
import { deriveDay } from "./derive";
import type { BoothEvent, DaySummary, EventFair, Product, StockPlan } from "../core-data/types";

const ACTIVE_FAIR_KEY = "booth-mode.activeFairId";

export function useActiveFairId(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() =>
    typeof localStorage === "undefined" ? null : localStorage.getItem(ACTIVE_FAIR_KEY),
  );

  const set = useCallback((next: string | null) => {
    setId(next);
    if (next === null) localStorage.removeItem(ACTIVE_FAIR_KEY);
    else localStorage.setItem(ACTIVE_FAIR_KEY, next);
  }, []);

  return [id, set];
}

export function useFairs(): EventFair[] | undefined {
  return useLiveQuery(() => db.fairs.toArray(), []);
}

export function useFair(fairId: string | null): EventFair | undefined {
  return useLiveQuery(async () => {
    if (!fairId) return undefined;
    return db.fairs.get(fairId);
  }, [fairId]);
}

export function useProducts(): Product[] | undefined {
  return useLiveQuery(() => db.products.toArray(), []);
}

export function useStockPlan(fairId: string | null): StockPlan | undefined {
  return useLiveQuery(async () => {
    if (!fairId) return undefined;
    return db.stockPlans.where("eventId").equals(fairId).first();
  }, [fairId]);
}

export function useEvents(fairId: string | null): BoothEvent[] | undefined {
  return useLiveQuery(async (): Promise<BoothEvent[]> => {
    if (!fairId) return [];
    return db.events.where("eventId").equals(fairId).sortBy("ts");
  }, [fairId]);
}

/** The whole day, recomputed from the log on every change. */
export function useDaySummary(fairId: string | null): DaySummary | null {
  const fair = useFair(fairId);
  const products = useProducts();
  const plan = useStockPlan(fairId);
  const events = useEvents(fairId);

  if (!fair || !products || !events) return null;
  return deriveDay(events, { fair, products, plan: plan ?? null });
}

/** Battery level for the low-battery export warning (plan.md §12). */
export function useBattery(): { level: number | null; charging: boolean } {
  const [state, setState] = useState<{ level: number | null; charging: boolean }>({
    level: null,
    charging: false,
  });

  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (t: string, fn: () => void) => void;
        removeEventListener: (t: string, fn: () => void) => void;
      }>;
    };
    if (!nav.getBattery) return;

    let battery: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;
    const update = (): void => {
      if (battery) setState({ level: battery.level * 100, charging: battery.charging });
    };

    nav.getBattery().then((b) => {
      battery = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    });

    return () => {
      battery?.removeEventListener("levelchange", update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, []);

  return state;
}

/** Keep the screen awake during a fair day (plan.md §7: sleep disabled). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    if (!nav.wakeLock) return;

    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const acquire = async (): Promise<void> => {
      try {
        const s = await nav.wakeLock!.request("screen");
        if (cancelled) await s.release();
        else sentinel = s;
      } catch {
        // Denied or unsupported — the app works fine without it.
      }
    };

    void acquire();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
    };
  }, [active]);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = (): void => setOnline(true);
    const off = (): void => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
