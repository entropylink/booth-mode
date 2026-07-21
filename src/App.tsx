// App shell: Plan · Venta · Caja · Resumen (plan.md §7).
//
// The topbar carries the things that matter at a fair and nowhere else:
// connection state (this app is expected to run all day offline), battery
// (with an export prompt before the device dies), and the sunlight toggle.

import { useEffect, useState, type ReactNode } from "react";
import { config } from "./config";
import { db } from "./lib/dexie";
import { useActiveFairId, useBattery, useFair, useFairs, useOnline, useWakeLock } from "./lib/hooks";
import { toggleLang } from "./i18n";
import { FairSheet, PlanTab } from "./modules/plan/PlanTab";
import { VentaTab } from "./modules/venta/VentaTab";
import { CajaTab } from "./modules/caja/CajaTab";
import { ResumenTab } from "./modules/resumen/ResumenTab";
import { EmptyState, useLocalStorage, useT } from "./ui/common";
import { useSwipeNav } from "./ui/gestures";
import { SyncSheet } from "./ui/SyncSheet";
import type { EventFair } from "./core-data/types";

type Tab = "plan" | "venta" | "caja" | "resumen";
const TABS: Tab[] = ["plan", "venta", "caja", "resumen"];

export default function App(): ReactNode {
  const t = useT();
  const [tab, setTab] = useState<Tab>("venta");
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const [activeFairId, setActiveFairId] = useActiveFairId();
  const fairs = useFairs();
  const fair = useFair(activeFairId);
  const online = useOnline();
  const battery = useBattery();
  const [sun, setSun] = useLocalStorage("booth-mode.sun", false);
  const [editingFair, setEditingFair] = useState(false);
  const [showSync, setShowSync] = useState(false);

  // Screen stays awake while selling — nobody wants to wake a phone mid-queue.
  useWakeLock(tab === "venta");

  // Tab navigation, remembering direction so the new tab slides in the way the
  // finger moved. Used by both the tab bar and the swipe gesture.
  function go(next: Tab): void {
    setNavDir(TABS.indexOf(next) >= TABS.indexOf(tab) ? 1 : -1);
    setTab(next);
  }
  const swipe = useSwipeNav(
    (dir) => {
      const next = TABS.indexOf(tab) + dir;
      if (next >= 0 && next < TABS.length) go(TABS[next]);
    },
    Boolean(fair) && !editingFair && !showSync,
  );

  useEffect(() => {
    document.documentElement.dataset.sun = sun ? "on" : "off";
  }, [sun]);

  // First run, or the active fair was deleted: fall back to any existing fair.
  useEffect(() => {
    if (fairs && activeFairId === null && fairs.length > 0) setActiveFairId(fairs[0].id);
  }, [fairs, activeFairId, setActiveFairId]);

  async function saveFair(next: EventFair): Promise<void> {
    await db.fairs.put(next);
    setActiveFairId(next.id);
    setEditingFair(false);
  }

  const batteryLow =
    battery.level !== null && battery.level <= config.lowBatteryWarningPct && !battery.charging;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t("app.name")}</h1>
        <span className="fair-name">{fair ? fair.name : t("fair.none")}</span>

        <div className="topbar-actions">
          {!online ? <span className="chip offline">{t("app.offline")}</span> : null}
          {batteryLow ? (
            <span className="chip warn" title={t("app.batteryLow")}>
              {t("app.battery", { pct: Math.round(battery.level ?? 0) })}
            </span>
          ) : null}
          <button
            className="chip"
            aria-pressed={sun}
            aria-label={sun ? t("app.sunOn") : t("app.sunOff")}
            onClick={() => setSun(!sun)}
          >
            ☀ {t("app.sun")}
          </button>
          <button className="chip" onClick={() => setShowSync(true)} aria-label={t("sync.title")}>
            ⟳
          </button>
          <button className="chip" onClick={() => toggleLang()}>
            {t("app.lang")}
          </button>
        </div>
      </header>

      <main className="main" {...swipe}>
        {!fair ? (
          <div className="card">
            <EmptyState title={t("fair.none")} hint={t("fair.noneHint")} />
            <button className="btn primary block" onClick={() => setEditingFair(true)}>
              {t("fair.create")}
            </button>
            {fairs && fairs.length > 0 ? (
              <div className="stack" style={{ marginTop: 12 }}>
                {fairs.map((f) => (
                  <button key={f.id} className="btn block" onClick={() => setActiveFairId(f.id)}>
                    {f.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div key={tab} className="tab-view" data-dir={navDir === 1 ? "next" : "prev"}>
            {tab === "plan" ? <PlanTab fair={fair} /> : null}
            {tab === "venta" ? <VentaTab fair={fair} /> : null}
            {tab === "caja" ? <CajaTab fair={fair} /> : null}
            {tab === "resumen" ? <ResumenTab fair={fair} /> : null}

            {tab === "plan" ? (
              <div className="card">
                <div className="row between">
                  <div>
                    <div style={{ fontWeight: 700 }}>{fair.name}</div>
                    <div className="faint">
                      {fair.dates.join(", ")}
                      {fair.location ? ` · ${fair.location}` : ""}
                    </div>
                  </div>
                  <button className="btn sm" onClick={() => setEditingFair(true)}>
                    {t("fair.switch")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>

      <nav className="tabbar">
        {TABS.map((name) => (
          <button
            key={name}
            aria-current={tab === name ? "page" : undefined}
            onClick={() => go(name)}
          >
            {t(`tabs.${name}`)}
          </button>
        ))}
      </nav>

      {editingFair ? (
        <FairSheet
          fair={fair ?? null}
          onClose={() => setEditingFair(false)}
          onSave={saveFair}
        />
      ) : null}

      {showSync ? <SyncSheet onClose={() => setShowSync(false)} /> : null}
    </div>
  );
}
