// F1 — Stock planning (plan.md §6). Phase P1.
//
// Inventory first. A vendor's questions are, in order: what do I have, what's
// missing, what do I still have to make — and only then, what will it earn.
// The money columns are real but they sit below the stock ones, and margin is
// shown as unknown rather than guessed when a product has no cost.

import { useRef, useState, type ReactNode } from "react";
import { db, newId, softDelete } from "../../lib/dexie";
import {
  NO_VARIANT,
  emptyTemplateCSV,
  exportStockPlanCSV,
  importStockPlanCSV,
  mergeImportedPlanLines,
  type ImportResult,
} from "../../lib/csv";
import { downloadText, slugDate } from "../../lib/export";
import { toMakeQueue } from "../../lib/inventory";
import { formatInferred, formatIssue } from "../../lib/issues";
import { useInventory, useProducts, useStockPlan, useTierMap, tierOf } from "../../lib/hooks";
import { formatMXN, formatMXNCompact } from "../../lib/money";
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
import type { EventFair, InventoryLine, Product, StockPlan } from "../../core-data/types";

type PlanMode = "stock" | "packing" | "money";

export function PlanTab({ fair }: { fair: EventFair }): ReactNode {
  const t = useT();
  const products = useProducts();
  const plan = useStockPlan(fair.id);
  const inventory = useInventory(fair.id);
  const tiers = useTierMap();
  const [mode, setMode] = useState<PlanMode>("stock");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [toast, showToast] = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  async function ensurePlan(): Promise<StockPlan> {
    if (plan) return plan;
    const created: StockPlan = { id: newId("plan"), eventId: fair.id, lines: [] };
    await db.stockPlans.add(created);
    return created;
  }

  // Save a new OR edited product, then reconcile its plan lines: keep an existing
  // line for a variant that survives (its target/packed stay put), add a line for
  // a new variant, and drop a line for a variant that was removed.
  async function saveProduct(saved: Product, target: number): Promise<void> {
    await db.products.put(saved);
    const current = await ensurePlan();
    const existing = current.lines.filter((l) => l.productId === saved.id);
    const lines = saved.variants.map(
      (v) =>
        existing.find((l) => l.variant === v) ?? {
          productId: saved.id,
          variant: v,
          target,
          made: false,
          packed: 0,
        },
    );
    await db.stockPlans.update(current.id, {
      lines: [...current.lines.filter((l) => l.productId !== saved.id), ...lines],
    });
    setAdding(false);
    setEditing(null);
    showToast(saved.name);
  }

  async function deleteProduct(product: Product): Promise<void> {
    // softDelete drops a tombstone so the delete propagates through sync instead
    // of the product resurrecting from another device. Its plan lines go too.
    await softDelete("products", product.id);
    if (plan) {
      await db.stockPlans.update(plan.id, {
        lines: plan.lines.filter((l) => l.productId !== product.id),
      });
    }
    setEditing(null);
    showToast(product.name);
  }

  async function updateLine(
    productId: string,
    variant: string,
    patch: { target?: number; packed?: number; made?: boolean },
  ): Promise<void> {
    const current = await ensurePlan();
    await db.stockPlans.update(current.id, {
      lines: current.lines.map((l) =>
        l.productId === productId && l.variant === variant ? { ...l, ...patch } : l,
      ),
    });
  }

  async function setCurrentQty(productId: string, variant: string, qty: number): Promise<void> {
    const product = await db.products.get(productId);
    if (!product) return;
    await db.products.update(productId, {
      stockByVariant: { ...product.stockByVariant, [variant]: qty },
    });
  }

  async function onImport(file: File): Promise<void> {
    const result = importStockPlanCSV(await file.text());

    if (result.products.length === 0) {
      setReport(result);
      return;
    }

    await db.tiers.bulkPut(result.tiers);
    await db.products.bulkPut(result.products);
    const current = await ensurePlan();

    // Additive: a Forge-exported catalog carries goal_qty/made as 0/false, and a
    // re-import must not wipe fair targets set here. See mergeImportedPlanLines.
    const merged = mergeImportedPlanLines(current.lines, result.lines);
    await db.stockPlans.update(current.id, { lines: merged });
    setReport(result);
  }

  function onExport(): void {
    if (!inventory || !products) return;
    downloadText(
      `stock-plan-${slugDate()}.csv`,
      exportStockPlanCSV(inventory.lines, products, [...tiers.values()]),
      "text/csv",
    );
  }

  if (!inventory) return <p className="muted">{t("app.loading")}</p>;

  const queue = toMakeQueue(inventory);
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  return (
    <>
      <div className="card">
        <h2>{t("plan.title")}</h2>
        <div className="seg" style={{ marginBottom: 10 }}>
          {(["stock", "packing", "money"] as PlanMode[]).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(`plan.mode.${m}`)}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            {t("plan.import")}
          </button>
          <button
            className="btn sm"
            onClick={onExport}
            disabled={inventory.lines.length === 0}
          >
            {t("plan.export")}
          </button>
          <button
            className="btn sm"
            onClick={() => downloadText("plantilla.csv", emptyTemplateCSV(), "text/csv")}
          >
            {t("plan.template")}
          </button>
          <button className="btn sm" onClick={() => setAdding(true)}>
            {t("plan.addProduct")}
          </button>
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          {t(`plan.hint.${mode}`)}
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

      {inventory.lines.length === 0 ? (
        <EmptyState title={t("plan.empty")} hint={t("plan.emptyHint")} />
      ) : (
        <>
          <InventoryKpis inventory={inventory} />

          {mode === "stock" && queue.length > 0 ? (
            <div className="card">
              <h2>{t("plan.toMakeQueue")}</h2>
              {queue.slice(0, 8).map((line) => (
                <div className="restock-item" key={`${line.productId}:${line.variant}`}>
                  <span className="badge low">{t("plan.toMakeN", { n: line.toMake })}</span>
                  <span className="grow">
                    <strong>{line.productName}</strong>
                    {line.variant !== NO_VARIANT ? (
                      <span className="faint"> · {line.variant}</span>
                    ) : null}
                    <span className="faint">
                      {" "}
                      · {t("plan.haveOfTarget", { have: line.currentQty, target: line.target })}
                    </span>
                  </span>
                  {line.machine ? <span className="faint">{line.machine}</span> : null}
                </div>
              ))}
              {queue.length > 8 ? (
                <p className="faint" style={{ marginBottom: 0 }}>
                  {t("plan.andMore", { n: queue.length - 8 })}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="card">
            {inventory.lines.map((line) => {
              const tier = tierOf(tiers, line.tierId);
              return (
                <div className="plan-line" key={`${line.productId}:${line.variant}`}>
                  {mode === "packing" ? (
                    <button
                      className="pack-check"
                      aria-pressed={line.packed >= line.target && line.target > 0}
                      aria-label={line.productName}
                      onClick={() =>
                        void updateLine(line.productId, line.variant, {
                          packed: line.packed >= line.target ? 0 : line.target,
                        })
                      }
                    >
                      {line.packed >= line.target && line.target > 0 ? "✓" : "○"}
                    </button>
                  ) : (
                    <TierBadge tier={tier} />
                  )}

                  <button
                    type="button"
                    className="grow plan-line-edit"
                    aria-label={t("plan.editProduct")}
                    onClick={() => {
                      const p = productById.get(line.productId);
                      if (p) setEditing(p);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div className="name">
                      {line.sku ? <span className="faint">{line.sku} · </span> : null}
                      {line.productName}
                      {line.variant !== NO_VARIANT ? (
                        <span className="faint"> · {line.variant}</span>
                      ) : null}
                      {line.made ? (
                        <span className="badge-made" title={t("plan.madeHint")}>
                          {" "}
                          ✓
                        </span>
                      ) : null}
                    </div>
                    <LineSubtitle line={line} mode={mode} />
                  </button>

                  <Stepper
                    label={`${line.productName} ${t(`plan.stepper.${mode}`)}`}
                    value={
                      mode === "packing"
                        ? line.packed
                        : mode === "money"
                          ? line.target
                          : line.currentQty
                    }
                    onChange={(n) => {
                      if (mode === "packing") void updateLine(line.productId, line.variant, { packed: n });
                      else if (mode === "money") void updateLine(line.productId, line.variant, { target: n });
                      else void setCurrentQty(line.productId, line.variant, n);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      {report ? <ImportReport report={report} onClose={() => setReport(null)} /> : null}

      {adding || editing ? (
        <AddProductSheet
          product={editing}
          tierOptions={[...tiers.values()]}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={saveProduct}
          onDelete={deleteProduct}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

function LineSubtitle({ line, mode }: { line: InventoryLine; mode: PlanMode }): ReactNode {
  const t = useT();

  if (mode === "money") {
    return (
      <div className="faint">
        {formatMXNCompact(line.sellingPriceCents)} ·{" "}
        {line.marginCents === null ? (
          <span style={{ color: "var(--warn)" }}>{t("plan.noCost")}</span>
        ) : (
          <>
            {t("plan.margin")} {formatMXNCompact(line.marginCents)} (
            {line.marginPct?.toFixed(0)}%)
          </>
        )}{" "}
        · {t("plan.goalValue")} {formatMXNCompact(line.goalValueCents)}
      </div>
    );
  }

  if (mode === "packing") {
    return (
      <div className="faint">
        {t("plan.targetVsPacked", { packed: line.packed, target: line.target })}
        {line.sold > 0 ? ` · ${t("plan.soldN", { n: line.sold })}` : ""}
        {line.packed > 0 ? ` · ${t("venta.left", { n: line.remaining })}` : ""}
      </div>
    );
  }

  return (
    <div className="faint">
      {t("plan.haveOfTarget", { have: line.currentQty, target: line.target })}
      {line.toMake > 0 ? (
        <span style={{ color: "var(--warn)" }}> · {t("plan.toMakeN", { n: line.toMake })}</span>
      ) : (
        <span style={{ color: "var(--ok)" }}> · {t("plan.covered")}</span>
      )}
      {line.machine ? ` · ${line.machine}` : ""}
    </div>
  );
}

function InventoryKpis({
  inventory,
}: {
  inventory: NonNullable<ReturnType<typeof useInventory>>;
}): ReactNode {
  const t = useT();
  const hours =
    inventory.totalToMakeMinutes === null ? null : inventory.totalToMakeMinutes / 60;

  return (
    <div className="kpi-grid" style={{ marginBottom: 12 }}>
      <div className="kpi">
        <div className="k-label">{t("plan.kpiHave")}</div>
        <div className="k-value tabular">{inventory.totalCurrent}</div>
        <div className="faint">{t("plan.ofTarget", { n: inventory.totalTarget })}</div>
      </div>
      <div className="kpi">
        <div className="k-label">{t("plan.kpiToMake")}</div>
        <div className={`k-value tabular ${inventory.totalToMake > 0 ? "neg" : "pos"}`}>
          {inventory.totalToMake}
        </div>
        <div className="faint">
          {hours === null ? t("plan.noTimes") : t("plan.benchHours", { n: hours.toFixed(1) })}
        </div>
      </div>
      <div className="kpi hero">
        <div className="k-label">{t("plan.kpiGoalValue")}</div>
        <div className="k-value tabular">{formatMXN(inventory.goalValueCents)}</div>
      </div>
      <div className="kpi hero">
        <div className="k-label">{t("plan.kpiGoalProfit")}</div>
        {inventory.goalProfitCents === null ? (
          <>
            <div className="k-value tabular" style={{ color: "var(--warn)" }}>
              —
            </div>
            <div className="faint">
              {t("plan.missingCost", { n: inventory.missingCostCount })}
            </div>
          </>
        ) : (
          <div className="k-value tabular pos">{formatMXN(inventory.goalProfitCents)}</div>
        )}
      </div>
    </div>
  );
}

/** What the importer did, including anything it had to guess. */
function ImportReport({
  report,
  onClose,
}: {
  report: ImportResult;
  onClose: () => void;
}): ReactNode {
  const t = useT();

  return (
    <Sheet title={t("plan.importReport")} onClose={onClose}>
      <div className="stack">
        <div className="row between">
          <span>{t("plan.importedProducts")}</span>
          <strong>{report.products.length}</strong>
        </div>
        <div className="row between">
          <span>{t("plan.importedTiers")}</span>
          <strong>{report.tiers.length}</strong>
        </div>

        {report.tiers.length > 0 ? (
          <div className="row wrap" style={{ gap: 6 }}>
            {report.tiers.map((tier) => (
              <span key={tier.id} className="chip" style={{ color: tier.color }}>
                {tier.label}
              </span>
            ))}
          </div>
        ) : null}

        {report.inferred.length > 0 ? (
          <div className="card" style={{ margin: 0, borderColor: "var(--warn)" }}>
            <strong style={{ color: "var(--warn)" }}>{t("plan.inferred")}</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {report.inferred.map((line) => (
                <li key={line.index} className="faint">
                  {formatInferred(t, line)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {report.unknownColumns.length > 0 ? (
          <div className="faint">
            {t("plan.unknownColumns")}: {report.unknownColumns.join(", ")}
          </div>
        ) : null}

        {report.issues.length > 0 ? (
          <div className="card" style={{ margin: 0, borderColor: "var(--danger)" }}>
            <strong style={{ color: "var(--danger)" }}>
              {t("plan.importErrors", { count: report.issues.length })}
            </strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {report.issues.slice(0, 12).map((issue, i) => (
                <li key={i} className="faint">
                  {formatIssue(t, issue)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button className="btn primary block" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </Sheet>
  );
}

function AddProductSheet({
  product,
  tierOptions,
  onClose,
  onSave,
  onDelete,
}: {
  product: Product | null;
  tierOptions: { id: string; label: string }[];
  onClose: () => void;
  onSave: (product: Product, target: number) => Promise<void>;
  onDelete: (product: Product) => Promise<void>;
}): ReactNode {
  const t = useT();
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [tierId, setTierId] = useState(product?.tierId ?? tierOptions[0]?.id ?? "");
  const [newTierLabel, setNewTierLabel] = useState("");
  const [housePriceCents, setHousePriceCents] = useState<number | null>(
    product?.housePriceCents ?? null,
  );
  const [sellingPriceCents, setSellingPriceCents] = useState<number | null>(
    product?.sellingPriceCents ?? null,
  );
  const [variantsText, setVariantsText] = useState(
    (product?.variants ?? []).filter((v) => v !== NO_VARIANT).join(", "),
  );
  const [currentQty, setCurrentQty] = useState(0);
  const [target, setTarget] = useState(10);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (name.trim() === "") return setError(t("common.required"));
    if (sellingPriceCents === null || sellingPriceCents < 0) {
      return setError(t("common.invalidAmount"));
    }

    let finalTierId = tierId;
    if (newTierLabel.trim() !== "") {
      const { tierIdFromLabel } = await import("../../lib/csv");
      finalTierId = tierIdFromLabel(newTierLabel);
      const { config } = await import("../../config");
      const count = await db.tiers.count();
      await db.tiers.put({
        id: finalTierId,
        label: newTierLabel.trim(),
        sortOrder: count,
        color: config.tierPalette[count % config.tierPalette.length] ?? config.tierFallbackColor,
      });
    }
    if (finalTierId === "") return setError(t("plan.tierRequired"));

    const variants = variantsText
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    const list = variants.length > 0 ? variants : [NO_VARIANT];

    // Variant names become stockByVariant keys → Firestore field names on sync.
    // Firestore rejects names matching /^__.*__$/, so block them here.
    if (list.some((v) => /^__.*__$/.test(v))) return setError(t("common.invalidVariant"));

    // Keep per-variant stock: a surviving variant keeps its count, a new one
    // starts at the form's currentQty (0 when editing — set it per-line later).
    const stockByVariant = Object.fromEntries(
      list.map((v) => [v, product?.stockByVariant[v] ?? currentQty]),
    );

    // When editing, preserve everything the form doesn't touch — the cost
    // breakdown owned by Forge Log, costingRef, photoRef, machine, active, etc.
    const saved: Product = product
      ? {
          ...product,
          sku: sku.trim(),
          name: name.trim(),
          variants: list,
          tierId: finalTierId,
          housePriceCents: housePriceCents ?? sellingPriceCents,
          sellingPriceCents,
          stockByVariant,
        }
      : {
          id: newId("prod"),
          sku: sku.trim(),
          name: name.trim(),
          variants: list,
          tierId: finalTierId,
          cost: {
            materialCents: 0,
            machineCents: 0,
            laborCents: 0,
            consumableCents: 0,
            packagingCents: 0,
          },
          housePriceCents: housePriceCents ?? sellingPriceCents,
          sellingPriceCents,
          stockByVariant,
          active: true,
        };

    void onSave(saved, target);
  }

  return (
    <Sheet title={product ? t("plan.editProduct") : t("plan.addProduct")} onClose={onClose}>
      <div className="field-row">
        <div className="field" style={{ maxWidth: 110 }}>
          <label htmlFor="p-sku">{t("plan.sku")}</label>
          <input id="p-sku" type="text" value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p-name">{t("plan.productName")}</label>
          <input
            id="p-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="p-tier">{t("plan.tier")}</label>
        {tierOptions.length > 0 ? (
          <select id="p-tier" value={tierId} onChange={(e) => setTierId(e.target.value)}>
            {tierOptions.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.label}
              </option>
            ))}
          </select>
        ) : null}
        <input
          type="text"
          value={newTierLabel}
          placeholder={t("plan.newTier")}
          onChange={(e) => setNewTierLabel(e.target.value)}
          style={{ marginTop: 6 }}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label>{t("plan.housePrice")}</label>
          <MoneyInput
            valueCents={housePriceCents}
            onChange={setHousePriceCents}
            label={t("plan.housePrice")}
          />
        </div>
        <div className="field">
          <label>{t("plan.sellingPrice")}</label>
          <MoneyInput
            valueCents={sellingPriceCents}
            onChange={setSellingPriceCents}
            label={t("plan.sellingPrice")}
          />
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

      {!product ? (
        <div className="field-row">
          <div className="field">
            <label>{t("plan.currentQty")}</label>
            <Stepper value={currentQty} onChange={setCurrentQty} label={t("plan.currentQty")} />
          </div>
          <div className="field">
            <label>{t("plan.target")}</label>
            <Stepper value={target} onChange={setTarget} label={t("plan.target")} />
          </div>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        {product ? (
          <button
            className="btn grow danger"
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              void onDelete(product);
            }}
          >
            {confirmDelete ? t("plan.deleteConfirm") : t("common.delete")}
          </button>
        ) : null}
        <button className="btn grow primary" onClick={() => void submit()}>
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
