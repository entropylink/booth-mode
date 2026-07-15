// F4 — Expenses + Day summary (plan.md §6). Phase P3.
//
// Everything here reads from useDaySummary, which folds the event log. The
// restock list is the reason this screen exists: it is what gets acted on at
// 8am tomorrow.

import { useState, type ReactNode } from "react";
import { voidedIds } from "../../lib/derive";
import { addExpense, voidExpense } from "../../lib/events";
import { daySummaryCSV, daySummaryMarkdown, downloadText, slugDate } from "../../lib/export";
import { useDaySummary, useEvents } from "../../lib/hooks";
import { formatMXN } from "../../lib/money";
import {
  Money,
  MoneyInput,
  Sheet,
  TierBadge,
  Toast,
  tierColor,
  useT,
  useToast,
} from "../../ui/common";
import type { EventFair, ExpenseCategory } from "../../core-data/types";

const CATEGORIES: ExpenseCategory[] = ["booth", "food", "transport", "material", "other"];

export function ResumenTab({ fair }: { fair: EventFair }): ReactNode {
  const t = useT();
  const summary = useDaySummary(fair.id);
  const [addingExpense, setAddingExpense] = useState(false);
  const [toast, showToast] = useToast();

  if (!summary) return <p className="muted">{t("app.loading")}</p>;

  const maxTier = Math.max(1, ...Object.values(summary.byTier));

  return (
    <>
      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <div className="kpi hero">
          <div className="k-label">{t("resumen.gross")}</div>
          <div className="k-value tabular">{formatMXN(summary.grossCents)}</div>
        </div>
        <div className="kpi hero">
          <div className="k-label">{t("resumen.net")}</div>
          <div className={`k-value tabular ${summary.netCents < 0 ? "neg" : "pos"}`}>
            {formatMXN(summary.netCents)}
          </div>
        </div>
        <div className="kpi">
          <div className="k-label">{t("resumen.sellThrough")}</div>
          <div className="k-value tabular">{summary.sellThroughPct.toFixed(1)}%</div>
          <div className="faint">
            {t("resumen.sellThroughDetail", {
              sold: summary.unitsSold,
              packed: summary.unitsPacked,
            })}
          </div>
        </div>
        <div className="kpi">
          <div className="k-label">{t("resumen.sales", { count: summary.saleCount })}</div>
          <div className="k-value tabular">{summary.saleCount}</div>
          <div className="faint">{t("resumen.voids", { count: summary.voidCount })}</div>
        </div>
      </div>

      <div className="card">
        <h2>{t("resumen.byPayType")}</h2>
        <table className="data">
          <tbody>
            {Object.entries(summary.byPayType).map(([pay, cents]) => (
              <tr key={pay}>
                <td>{t(`venta.pay.${pay}`)}</td>
                <td className="num">
                  <Money cents={cents} />
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>{t("resumen.gross")}</strong>
              </td>
              <td className="num">
                <strong>{formatMXN(summary.grossCents)}</strong>
              </td>
            </tr>
            <tr>
              <td className="muted">{t("resumen.boothFee")}</td>
              <td className="num muted">−{formatMXN(summary.boothFeeCents)}</td>
            </tr>
            <tr>
              <td className="muted">{t("resumen.expenses")}</td>
              <td className="num muted">−{formatMXN(summary.expensesCents)}</td>
            </tr>
            <tr>
              <td>
                <strong>{t("resumen.net")}</strong>
              </td>
              <td className="num">
                <strong style={{ color: summary.netCents < 0 ? "var(--danger)" : "var(--ok)" }}>
                  {formatMXN(summary.netCents)}
                </strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>{t("resumen.byProduct")}</h2>
        {summary.byProduct.length === 0 ? (
          <p className="muted">{t("resumen.noSales")}</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t("plan.productName")}</th>
                <th className="num">{t("resumen.units")}</th>
                <th className="num">{t("resumen.gross")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.byProduct.map((p) => (
                <tr key={p.productId}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <TierBadge tier={p.tier} />
                      {p.productName}
                    </span>
                  </td>
                  <td className="num">{p.qty}</td>
                  <td className="num">
                    <Money cents={p.grossCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="faint" style={{ marginBottom: 0 }}>
          {t("resumen.marginNote")}
        </p>
      </div>

      {Object.keys(summary.byTier).length > 0 ? (
        <div className="card">
          <h2>{t("resumen.byTier")}</h2>
          <div className="stack">
            {Object.entries(summary.byTier)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([tier, cents]) => (
                <div key={tier}>
                  <div className="row between">
                    <span className="faint">T{tier}</span>
                    <Money cents={cents} />
                  </div>
                  <div className="bar">
                    <span
                      style={{
                        width: `${(cents / maxTier) * 100}%`,
                        background: tierColor(Number(tier)),
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>{t("resumen.restock")}</h2>
        {summary.restockList.length === 0 ? (
          <p className="muted">{t("resumen.restockEmpty")}</p>
        ) : (
          summary.restockList.map((r) => (
            <div className="restock-item" key={`${r.productId}:${r.variant}`}>
              <span className={`badge ${r.soldOut ? "out" : "low"}`}>
                {r.soldOut
                  ? t("resumen.restockSoldOut")
                  : t("resumen.restockLeft", { n: r.remaining })}
              </span>
              <span className="grow">
                <strong>{r.productName}</strong>
                <span className="faint"> · {r.variant}</span>
              </span>
              <span className="faint">{t("resumen.restockSold", { n: r.sold })}</span>
            </div>
          ))
        )}
      </div>

      <ExpenseList fair={fair} onAdd={() => setAddingExpense(true)} />

      <div className="card">
        <h2>{t("resumen.title")}</h2>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn grow"
            onClick={() =>
              downloadText(
                `resumen-${slugDate()}.md`,
                daySummaryMarkdown(summary, fair),
                "text/markdown",
              )
            }
          >
            {t("resumen.exportMd")}
          </button>
          <button
            className="btn grow"
            onClick={() =>
              downloadText(
                `resumen-${slugDate()}.csv`,
                daySummaryCSV(summary, fair),
                "text/csv",
              )
            }
          >
            {t("resumen.exportCsv")}
          </button>
        </div>
      </div>

      {addingExpense ? (
        <AddExpenseSheet
          onClose={() => setAddingExpense(false)}
          onSave={async (input) => {
            await addExpense({ eventId: fair.id, ...input });
            setAddingExpense(false);
            showToast(input.concept);
          }}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

function ExpenseList({ fair, onAdd }: { fair: EventFair; onAdd: () => void }): ReactNode {
  const t = useT();
  const events = useEvents(fair.id);
  const all = events ?? [];
  const voided = voidedIds(all);
  const expenses = all
    .filter((e) => e.type === "expenseAdded")
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{t("resumen.expensesTitle")}</h2>
        <button className="btn sm" onClick={onAdd}>
          {t("resumen.addExpense")}
        </button>
      </div>

      {expenses.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {t("resumen.noExpenses")}
        </p>
      ) : (
        expenses.map((e) => {
          if (e.type !== "expenseAdded") return null;
          const isVoided = voided.has(e.id);
          return (
            <div className={`sale-row ${isVoided ? "voided" : ""}`} key={e.id}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{e.concept}</div>
                <div className="faint">
                  {t(`resumen.cat.${e.category}`)}
                  {e.paidFromBox ? ` · ${t("resumen.fromBox")}` : ""}
                </div>
              </div>
              <Money cents={e.amountCents} className="sr-amount" />
              {!isVoided ? (
                <button
                  className="btn sm ghost danger"
                  aria-label={t("common.delete")}
                  onClick={() => void voidExpense(fair.id, e.id)}
                >
                  ✕
                </button>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function AddExpenseSheet({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: {
    concept: string;
    amountCents: number;
    category: ExpenseCategory;
    paidFromBox: boolean;
  }) => Promise<void>;
}): ReactNode {
  const t = useT();
  const [concept, setConcept] = useState("");
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [category, setCategory] = useState<ExpenseCategory>("other");
  const [paidFromBox, setPaidFromBox] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    if (concept.trim() === "") return setError(t("common.required"));
    if (amountCents === null || amountCents <= 0) return setError(t("common.invalidAmount"));
    void onSave({ concept: concept.trim(), amountCents, category, paidFromBox });
  }

  return (
    <Sheet title={t("resumen.addExpense")} onClose={onClose}>
      <div className="field">
        <label htmlFor="e-concept">{t("resumen.concept")}</label>
        <input
          id="e-concept"
          type="text"
          value={concept}
          placeholder={t("resumen.conceptPlaceholder")}
          onChange={(e) => setConcept(e.target.value)}
          autoFocus
        />
      </div>

      <div className="field">
        <label>{t("resumen.amount")}</label>
        <MoneyInput valueCents={amountCents} onChange={setAmountCents} label={t("resumen.amount")} />
      </div>

      <div className="field">
        <label htmlFor="e-cat">{t("resumen.category")}</label>
        <select
          id="e-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`resumen.cat.${c}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{t("resumen.fromBox")}</label>
        <div className="seg">
          <button type="button" aria-pressed={paidFromBox} onClick={() => setPaidFromBox(true)}>
            {t("common.yes")}
          </button>
          <button type="button" aria-pressed={!paidFromBox} onClick={() => setPaidFromBox(false)}>
            {t("common.no")}
          </button>
        </div>
        <span className="faint">{t("resumen.fromBoxHint")}</span>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button className="btn grow primary" onClick={submit}>
          {t("common.save")}
        </button>
      </div>
    </Sheet>
  );
}
