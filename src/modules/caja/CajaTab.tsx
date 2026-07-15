// F3 — Cash & float (plan.md §6). Phase P3.
//
// Denomination grid in, expected-vs-counted delta out. The expected figure is
// derived from the event log (float + cash sales − cash expenses paid from the
// box), never from a running tally kept alongside it.

import { useState, type ReactNode } from "react";
import { config } from "../../config";
import { cashExpected, cashCounted } from "../../lib/derive";
import { recordFloatCount } from "../../lib/events";
import { useEvents } from "../../lib/hooks";
import { countTotal, formatMXN, formatMXNCompact } from "../../lib/money";
import { Toast, useT, useToast } from "../../ui/common";
import type { DenominationCounts, EventFair, FloatKind } from "../../core-data/types";

export function CajaTab({ fair }: { fair: EventFair }): ReactNode {
  const t = useT();
  const events = useEvents(fair.id);
  const [toast, showToast] = useToast();

  if (!events) return <p className="muted">{t("app.loading")}</p>;

  const startCount = events.find((e) => e.type === "floatCounted" && e.kind === "start");
  const expected = cashExpected(events, fair);
  const counted = cashCounted(events);
  const delta = counted === null ? null : counted - expected;

  return (
    <>
      <div className="card">
        <h2>{t("caja.expected")}</h2>
        <div className="row between">
          <span className="muted">{t("caja.expected")}</span>
          <strong className="tabular">{formatMXN(expected)}</strong>
        </div>
        <div className="row between">
          <span className="muted">{t("caja.counted")}</span>
          <strong className="tabular">
            {counted === null ? t("caja.noEndCount") : formatMXN(counted)}
          </strong>
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          {t("caja.explain")}
        </p>
      </div>

      {delta !== null ? (
        <div className={`delta-hero ${delta === 0 ? "ok" : "bad"}`} style={{ marginBottom: 12 }}>
          <div className="label faint">{t("caja.delta")}</div>
          <div className="amount tabular">{formatMXN(delta)}</div>
          <div className="faint">
            {delta === 0
              ? t("caja.deltaOk")
              : delta < 0
                ? t("caja.deltaShort")
                : t("caja.deltaOver")}
          </div>
        </div>
      ) : null}

      <CountCard
        kind="start"
        title={t("caja.countStart")}
        savedCents={
          startCount && startCount.type === "floatCounted" ? startCount.totalCents : null
        }
        onSave={async (denominations, totalCents) => {
          await recordFloatCount({ eventId: fair.id, kind: "start", denominations, totalCents });
          showToast(t("caja.startSaved"));
        }}
      />

      <CountCard
        kind="end"
        title={t("caja.countEnd")}
        savedCents={counted}
        onSave={async (denominations, totalCents) => {
          await recordFloatCount({ eventId: fair.id, kind: "end", denominations, totalCents });
          showToast(t("caja.endSaved"));
        }}
      />

      <Toast message={toast} />
    </>
  );
}

function CountCard({
  kind,
  title,
  savedCents,
  onSave,
}: {
  kind: FloatKind;
  title: string;
  savedCents: number | null;
  onSave: (d: DenominationCounts, totalCents: number) => Promise<void>;
}): ReactNode {
  const t = useT();
  const [counts, setCounts] = useState<DenominationCounts>({});
  const [open, setOpen] = useState(false);

  // Single source of truth for the total: never stored separately from the grid.
  const total = countTotal(counts);

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: open ? 10 : 0 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted tabular">
            {savedCents === null
              ? kind === "start"
                ? t("caja.noStartCount")
                : t("caja.noEndCount")
              : formatMXN(savedCents)}
          </span>
          <button className="btn sm" onClick={() => setOpen(!open)}>
            {open ? t("common.close") : t("caja.saveCount")}
          </button>
        </div>
      </div>

      {open ? (
        <>
          {config.denominationsCents.map((denom) => {
            const n = counts[String(denom)] ?? 0;
            return (
              <div className="denom-row" key={denom}>
                <span className="denom tabular">{formatMXNCompact(denom)}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={n === 0 ? "" : n}
                  placeholder="0"
                  aria-label={formatMXNCompact(denom)}
                  onChange={(e) => {
                    const parsed = Number(e.target.value.replace(/[^0-9]/g, ""));
                    setCounts({
                      ...counts,
                      [String(denom)]: Number.isFinite(parsed) ? parsed : 0,
                    });
                  }}
                />
                <span className="sub tabular">{n > 0 ? formatMXN(denom * n) : "—"}</span>
              </div>
            );
          })}

          <div className="row between" style={{ margin: "12px 0" }}>
            <strong>{t("caja.total")}</strong>
            <strong className="tabular" style={{ fontSize: "1.4rem", color: "var(--gold)" }}>
              {formatMXN(total)}
            </strong>
          </div>

          <button
            className="btn primary block"
            disabled={total === 0}
            onClick={() => {
              void onSave(counts, total);
              setCounts({});
              setOpen(false);
            }}
          >
            {t("caja.saveCount")}
          </button>
        </>
      ) : null}
    </div>
  );
}
