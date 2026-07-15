// F1 — Stock planning (plan.md §6). Phase P1.
//
// Two modes on the same data: planning (set targets) and packing (check off
// what actually went in the box). Target-vs-packed is the report that matters
// at load-out, so it's on screen in both modes.

import { useRef, useState, type ReactNode } from "react";
import { db, newId } from "../../lib/dexie";
import { NO_VARIANT, exportStockPlanCSV, importStockPlanCSV } from "../../lib/csv";
import { downloadText, slugDate } from "../../lib/export";
import { remainingByVariant, variantKey } from "../../lib/derive";
import { useEvents, useProducts, useStockPlan } from "../../lib/hooks";
import { formatMXNCompact } from "../../lib/money";
import {
  EmptyState,
  MoneyInput,
  Sheet,
  Stepper,
  TierBadge,
  Toast,
  useT,
  useToast,
} from "../../ui/common";
import type { EventFair, Product, StockPlan, Tier } from "../../core-data/types";

export function PlanTab({ fair }: { fair: EventFair }): ReactNode {
  const t = useT();
  const products = useProducts();
  const plan = useStockPlan(fair.id);
  const events = useEvents(fair.id);
  const [packing, setPacking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toast, showToast] = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const lines = plan?.lines ?? [];
  const remaining = remainingByVariant(events ?? [], plan ?? null);

  async function ensurePlan(): Promise<StockPlan> {
    if (plan) return plan;
    const created: StockPlan = { id: newId("plan"), eventId: fair.id, lines: [] };
    await db.stockPlans.add(created);
    return created;
  }

  async function updateLine(
    productId: string,
    variant: string,
    patch: { target?: number; packed?: number },
  ): Promise<void> {
    const current = await ensurePlan();
    const next = current.lines.map((l) =>
      l.productId === productId && l.variant === variant ? { ...l, ...patch } : l,
    );
    await db.stockPlans.update(current.id, { lines: next });
  }

  async function removeProduct(product: Product): Promise<void> {
    if (!confirm(t("plan.removeConfirm", { name: product.name }))) return;
    const current = await ensurePlan();
    await db.stockPlans.update(current.id, {
      lines: current.lines.filter((l) => l.productId !== product.id),
    });
    await db.products.delete(product.id);
  }

  async function packAll(): Promise<void> {
    const current = await ensurePlan();
    await db.stockPlans.update(current.id, {
      lines: current.lines.map((l) => ({ ...l, packed: l.target })),
    });
  }

  async function onImport(file: File): Promise<void> {
    const text = await file.text();
    const result = importStockPlanCSV(text);

    if (result.products.length === 0) {
      showToast(result.errors[0] ?? t("plan.importErrors", { count: 0 }));
      return;
    }

    await db.products.bulkPut(result.products);
    const current = await ensurePlan();

    // Merge: imported targets win, existing packed counts survive a re-import.
    const merged = [...current.lines];
    for (const line of result.lines) {
      const i = merged.findIndex(
        (l) => l.productId === line.productId && l.variant === line.variant,
      );
      if (i >= 0) merged[i] = { ...merged[i], target: line.target };
      else merged.push(line);
    }
    await db.stockPlans.update(current.id, { lines: merged });

    showToast(
      result.errors.length > 0
        ? t("plan.importErrors", { count: result.errors.length })
        : t("plan.imported", {
            products: result.products.length,
            lines: result.lines.length,
          }),
    );
  }

  function onExport(): void {
    downloadText(
      `plan-${slugDate()}.csv`,
      exportStockPlanCSV(products ?? [], lines),
      "text/csv",
    );
  }

  const totals = lines.reduce(
    (acc, l) => ({ target: acc.target + l.target, packed: acc.packed + l.packed }),
    { target: 0, packed: 0 },
  );

  return (
    <>
      <div className="card">
        <h2>{t("plan.title")}</h2>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            {t("plan.import")}
          </button>
          <button className="btn sm" onClick={onExport} disabled={lines.length === 0}>
            {t("plan.export")}
          </button>
          <button className="btn sm" onClick={() => setAdding(true)}>
            {t("plan.addProduct")}
          </button>
          <button
            className="btn sm"
            aria-pressed={packing}
            onClick={() => setPacking(!packing)}
            style={packing ? { borderColor: "var(--gold)", color: "var(--gold)" } : undefined}
          >
            {t("plan.packing")}
          </button>
          {packing && lines.length > 0 ? (
            <button className="btn sm" onClick={() => void packAll()}>
              {t("plan.packAll")}
            </button>
          ) : null}
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          {packing ? t("plan.packingHint") : t("plan.importHint")}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImport(file);
            e.target.value = "";
          }}
        />
      </div>

      {lines.length === 0 ? (
        <EmptyState title={t("plan.empty")} hint={t("plan.emptyHint")} />
      ) : (
        <div className="card">
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="faint">
              {t("plan.totals", {
                products: new Set(lines.map((l) => l.productId)).size,
                target: totals.target,
                packed: totals.packed,
              })}
            </span>
          </div>

          {lines.map((line) => {
            const product = productById.get(line.productId);
            if (!product) return null;
            const left = remaining.get(variantKey(line.productId, line.variant));

            return (
              <div className="plan-line" key={`${line.productId}:${line.variant}`}>
                {packing ? (
                  <button
                    className="pack-check"
                    aria-pressed={line.packed >= line.target && line.target > 0}
                    aria-label={product.name}
                    onClick={() =>
                      void updateLine(line.productId, line.variant, {
                        packed: line.packed >= line.target ? 0 : line.target,
                      })
                    }
                  >
                    {line.packed >= line.target && line.target > 0 ? "✓" : "○"}
                  </button>
                ) : (
                  <TierBadge tier={product.tier} />
                )}

                <div className="grow">
                  <div className="name">
                    {product.name}
                    {line.variant !== NO_VARIANT ? (
                      <span className="faint"> · {line.variant}</span>
                    ) : null}
                  </div>
                  <div className="faint">
                    {formatMXNCompact(product.priceCents)} ·{" "}
                    {t("plan.targetVsPacked", { packed: line.packed, target: line.target })}
                    {left !== undefined && left !== line.packed ? (
                      <> · {t("venta.left", { n: left })}</>
                    ) : null}
                  </div>
                </div>

                <Stepper
                  label={`${product.name} ${packing ? t("plan.packed") : t("plan.target")}`}
                  value={packing ? line.packed : line.target}
                  onChange={(n) =>
                    void updateLine(
                      line.productId,
                      line.variant,
                      packing ? { packed: n } : { target: n },
                    )
                  }
                />

                {!packing ? (
                  <button
                    className="btn sm ghost danger"
                    aria-label={t("plan.remove")}
                    onClick={() => void removeProduct(product)}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <AddProductSheet
          onClose={() => setAdding(false)}
          onSave={async (product, targets) => {
            await db.products.put(product);
            const current = await ensurePlan();
            const newLines = product.variants.map((v) => ({
              productId: product.id,
              variant: v,
              target: targets[v] ?? 0,
              packed: 0,
            }));
            await db.stockPlans.update(current.id, {
              lines: [
                ...current.lines.filter((l) => l.productId !== product.id),
                ...newLines,
              ],
            });
            setAdding(false);
            showToast(product.name);
          }}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

function AddProductSheet({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (product: Product, targets: Record<string, number>) => Promise<void>;
}): ReactNode {
  const t = useT();
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>(1);
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const [variantsText, setVariantsText] = useState("");
  const [target, setTarget] = useState(10);
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    if (name.trim() === "") return setError(t("common.required"));
    if (priceCents === null || priceCents < 0) return setError(t("common.invalidAmount"));

    const variants = variantsText
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    const list = variants.length > 0 ? variants : [NO_VARIANT];

    const product: Product = {
      id: newId("prod"),
      name: name.trim(),
      tier,
      variants: list,
      priceCents,
      stockByVariant: Object.fromEntries(list.map((v) => [v, target])),
    };
    void onSave(product, Object.fromEntries(list.map((v) => [v, target])));
  }

  return (
    <Sheet title={t("plan.addProduct")} onClose={onClose}>
      <div className="field">
        <label htmlFor="p-name">{t("plan.productName")}</label>
        <input id="p-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="p-tier">{t("plan.tier")}</label>
          <select
            id="p-tier"
            value={tier}
            onChange={(e) => setTier(Number(e.target.value) as Tier)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                T{n}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-price">{t("plan.price")}</label>
          <MoneyInput valueCents={priceCents} onChange={setPriceCents} label={t("plan.price")} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="p-variants">{t("plan.variants")}</label>
        <input
          id="p-variants"
          type="text"
          value={variantsText}
          onChange={(e) => setVariantsText(e.target.value)}
          placeholder="Roble, Nogal"
        />
        <span className="faint">{t("plan.variantsHint")}</span>
      </div>

      <div className="field">
        <label>{t("plan.target")}</label>
        <Stepper value={target} onChange={setTarget} label={t("plan.target")} />
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

/** Exported for the fair editor in App — kept here so Plan owns fair shape. */
export function FairSheet({
  fair,
  onClose,
  onSave,
}: {
  fair: EventFair | null;
  onClose: () => void;
  onSave: (fair: EventFair) => Promise<void>;
}): ReactNode {
  const t = useT();
  const [name, setName] = useState(fair?.name ?? "");
  const [date, setDate] = useState(fair?.dates[0] ?? slugDate());
  const [location, setLocation] = useState(fair?.location ?? "");
  const [boothFeeCents, setBoothFeeCents] = useState<number | null>(fair?.boothFeeCents ?? 0);
  const [floatStartCents, setFloatStartCents] = useState<number | null>(
    fair?.floatStartCents ?? 0,
  );
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    if (name.trim() === "") return setError(t("common.required"));
    void onSave({
      id: fair?.id ?? newId("fair"),
      name: name.trim(),
      dates: [date],
      location: location.trim() || undefined,
      boothFeeCents: boothFeeCents ?? 0,
      floatStartCents: floatStartCents ?? 0,
      status: fair?.status ?? "active",
    });
  }

  return (
    <Sheet title={fair ? t("fair.switch") : t("fair.create")} onClose={onClose}>
      <div className="field">
        <label htmlFor="f-name">{t("fair.name")}</label>
        <input
          id="f-name"
          type="text"
          value={name}
          placeholder={t("fair.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="f-date">{t("fair.date")}</label>
          <input id="f-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-loc">{t("fair.location")}</label>
          <input
            id="f-loc"
            type="text"
            value={location}
            placeholder={t("fair.locationPlaceholder")}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>{t("fair.boothFee")}</label>
          <MoneyInput
            valueCents={boothFeeCents}
            onChange={setBoothFeeCents}
            label={t("fair.boothFee")}
          />
        </div>
        <div className="field">
          <label>{t("fair.floatStart")}</label>
          <MoneyInput
            valueCents={floatStartCents}
            onChange={setFloatStartCents}
            label={t("fair.floatStart")}
          />
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button className="btn grow primary" onClick={submit}>
          {t("fair.save")}
        </button>
      </div>
    </Sheet>
  );
}
