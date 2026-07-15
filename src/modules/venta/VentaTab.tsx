// F2 — Sale mode, the table UI (plan.md §6). Phase P2.
//
// Tap budget for a simple cash sale, which the plan caps at 4:
//   1 tap product tile → 2 tap "Cobrar" → 3 tap "Exacto"  = sale recorded.
// A tendered sale costs one more: … → 3 tap "$500" → 4 tap "Listo".
//
// Every total on this screen comes from lib/money + lib/derive. This file does
// not add up money itself.

import { useMemo, useState, type ReactNode } from "react";
import { config } from "../../config";
import { NO_VARIANT } from "../../lib/csv";
import { remainingByVariant, saleTotal, variantKey, voidedIds } from "../../lib/derive";
import { recordSale, voidSale } from "../../lib/events";
import { useEvents, useProducts, useStockPlan } from "../../lib/hooks";
import {
  changeBreakdown,
  changeDue,
  formatMXN,
  formatMXNCompact,
  lineTotal,
  sumCents,
} from "../../lib/money";
import {
  EmptyState,
  HoldButton,
  Money,
  MoneyInput,
  Sheet,
  Stepper,
  TierBadge,
  Toast,
  tierColor,
  useLocalStorage,
  useT,
  useToast,
} from "../../ui/common";
import type {
  Discount,
  EventFair,
  PayType,
  Product,
  SaleItem,
} from "../../core-data/types";

const PAY_TYPES: PayType[] = ["efectivo", "tarjeta", "transferencia"];

interface CartLine extends SaleItem {
  key: string;
}

export function VentaTab({ fair }: { fair: EventFair }): ReactNode {
  const t = useT();
  const products = useProducts();
  const plan = useStockPlan(fair.id);
  const events = useEvents(fair.id);

  // Survives a reload mid-sale; committed to the log only on confirm.
  const [cart, setCart] = useLocalStorage<CartLine[]>(`booth-mode.cart.${fair.id}`, []);
  const [variantFor, setVariantFor] = useState<Product | null>(null);
  const [charging, setCharging] = useState(false);
  const [toast, showToast] = useToast();

  const productById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  );
  const remaining = useMemo(
    () => remainingByVariant(events ?? [], plan ?? null),
    [events, plan],
  );

  const totalCents = sumCents(
    cart.map((l) => lineTotal(l.unitPriceCents, l.qty, l.discount)),
  );

  /** Units already in the cart, so the tile can't oversell what's on the table. */
  function inCart(productId: string, variant: string): number {
    return cart
      .filter((l) => l.productId === productId && l.variant === variant)
      .reduce((n, l) => n + l.qty, 0);
  }

  function availableFor(productId: string, variant: string): number {
    const left = remaining.get(variantKey(productId, variant)) ?? 0;
    return left - inCart(productId, variant);
  }

  function addToCart(product: Product, variant: string): void {
    const key = `${product.id}::${variant}`;
    setCart(
      cart.some((l) => l.key === key)
        ? cart.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
        : [
            ...cart,
            {
              key,
              productId: product.id,
              variant,
              qty: 1,
              unitPriceCents: product.priceCents,
            },
          ],
    );
  }

  function onTileTap(product: Product): void {
    const packedVariants = product.variants.filter((v) =>
      remaining.has(variantKey(product.id, v)),
    );
    if (packedVariants.length === 1) addToCart(product, packedVariants[0]);
    else setVariantFor(product);
  }

  function setLine(key: string, patch: Partial<CartLine>): void {
    setCart(
      cart
        .map((l) => (l.key === key ? { ...l, ...patch } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function commit(payType: PayType, cashGivenCents?: number): Promise<void> {
    const items: SaleItem[] = cart.map(({ key: _key, ...item }) => item);
    const change =
      cashGivenCents === undefined ? undefined : changeDue(totalCents, cashGivenCents);

    await recordSale({
      eventId: fair.id,
      items,
      payType,
      cashGivenCents,
      changeDueCents: change,
    });

    setCart([]);
    setCharging(false);
    showToast(t("venta.sold", { amount: formatMXN(totalCents) }));
  }

  const tiles = useMemo(() => {
    const lines = plan?.lines ?? [];
    const ids = [...new Set(lines.map((l) => l.productId))];
    return ids
      .map((id) => productById.get(id))
      .filter((p): p is Product => p !== undefined);
  }, [plan, productById]);

  if (!products || !events) return <p className="muted">{t("app.loading")}</p>;

  if (tiles.length === 0) {
    return <EmptyState title={t("venta.noProducts")} hint={t("venta.noProductsHint")} />;
  }

  return (
    <>
      <div className="sale-grid">
        {tiles.map((product) => {
          const variants = product.variants.filter((v) =>
            remaining.has(variantKey(product.id, v)),
          );
          const left = variants.reduce((n, v) => n + availableFor(product.id, v), 0);
          const lowThreshold = config.restockThresholdDefault;

          return (
            <button
              key={product.id}
              className="tile"
              style={{ ["--tier" as string]: tierColor(product.tier) }}
              disabled={left <= 0}
              onClick={() => onTileTap(product)}
            >
              <span className="row between">
                <span className="tile-name">{product.name}</span>
                <TierBadge tier={product.tier} />
              </span>
              <span className="tile-price">{formatMXNCompact(product.priceCents)}</span>
              <span
                className={`tile-left ${left <= 0 ? "out" : left <= lowThreshold ? "low" : ""}`}
              >
                {left <= 0 ? t("venta.soldOut") : t("venta.left", { n: left })}
              </span>
            </button>
          );
        })}
      </div>

      <RecentSales fair={fair} />

      {cart.length > 0 ? (
        <div className="cart-bar">
          {cart.map((line) => {
            const product = productById.get(line.productId);
            const lineCents = lineTotal(line.unitPriceCents, line.qty, line.discount);
            return (
              <div className="cart-line" key={line.key}>
                <span
                  className="tier-dot"
                  style={{ background: tierColor(product?.tier ?? 1) }}
                />
                <span className="grow">
                  <span className="cl-name">{product?.name ?? line.productId}</span>
                  <span className="cl-sub">
                    {line.variant !== NO_VARIANT ? `${line.variant} · ` : ""}
                    {formatMXNCompact(line.unitPriceCents)}
                    {line.discount
                      ? ` · ${
                          line.discount.kind === "pct"
                            ? t("venta.discountPct", { pct: line.discount.pct })
                            : `−${formatMXNCompact(line.discount.cents)}`
                        }`
                      : ""}
                  </span>
                </span>
                <Stepper
                  label={product?.name}
                  value={line.qty}
                  min={0}
                  max={line.qty + availableFor(line.productId, line.variant)}
                  onChange={(n) => setLine(line.key, { qty: n })}
                />
                <Money cents={lineCents} className="tabular" />
              </div>
            );
          })}

          <div className="row between" style={{ margin: "10px 0" }}>
            <button className="btn sm ghost" onClick={() => setCart([])}>
              {t("venta.clear")}
            </button>
            <span className="cart-total tabular">{formatMXN(totalCents)}</span>
          </div>

          <button className="btn primary block huge" onClick={() => setCharging(true)}>
            {t("venta.charge", { amount: formatMXN(totalCents) })}
          </button>
        </div>
      ) : null}

      {variantFor ? (
        <Sheet title={variantFor.name} onClose={() => setVariantFor(null)}>
          <div className="stack">
            {variantFor.variants
              .filter((v) => remaining.has(variantKey(variantFor.id, v)))
              .map((v) => {
                const left = availableFor(variantFor.id, v);
                return (
                  <button
                    key={v}
                    className="btn block"
                    disabled={left <= 0}
                    onClick={() => {
                      addToCart(variantFor, v);
                      setVariantFor(null);
                    }}
                  >
                    <span className="row between">
                      <span>{v}</span>
                      <span className="faint">
                        {left <= 0 ? t("venta.soldOut") : t("venta.left", { n: left })}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        </Sheet>
      ) : null}

      {charging ? (
        <ChargeSheet
          totalCents={totalCents}
          onClose={() => setCharging(false)}
          onCommit={commit}
          onDiscount={(discount) =>
            setCart(cart.map((l) => ({ ...l, discount: discount ?? undefined })))
          }
          hasDiscount={cart.some((l) => l.discount !== undefined)}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

/**
 * Tender + change. The change figure is the whole point of this screen: it is
 * read across a table, in sun, by someone counting bills with their other hand.
 */
function ChargeSheet({
  totalCents,
  onClose,
  onCommit,
  onDiscount,
  hasDiscount,
}: {
  totalCents: number;
  onClose: () => void;
  onCommit: (payType: PayType, cashGivenCents?: number) => Promise<void>;
  onDiscount: (d: Discount | null) => void;
  hasDiscount: boolean;
}): ReactNode {
  const t = useT();
  const [payType, setPayType] = useState<PayType>("efectivo");
  const [tenderCents, setTenderCents] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const change = tenderCents === null ? null : changeDue(totalCents, tenderCents);
  const breakdown = change !== null && change > 0 ? changeBreakdown(change) : null;
  const short = change !== null && change < 0;

  return (
    <Sheet title={t("venta.charge", { amount: formatMXN(totalCents) })} onClose={onClose}>
      <div className="field">
        <label>{t("venta.payType")}</label>
        <div className="seg">
          {PAY_TYPES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={payType === p}
              onClick={() => {
                setPayType(p);
                setTenderCents(null);
              }}
            >
              {t(`venta.pay.${p}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>{t("venta.discount")}</label>
        <div className="seg">
          <button
            type="button"
            aria-pressed={!hasDiscount}
            onClick={() => onDiscount(null)}
          >
            {t("venta.discountOff")}
          </button>
          {config.quickDiscountPcts.map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => onDiscount({ kind: "pct", pct })}
            >
              {t("venta.discountPct", { pct })}
            </button>
          ))}
        </div>
      </div>

      {payType !== "efectivo" ? (
        <button className="btn primary block huge" onClick={() => void onCommit(payType)}>
          {t("venta.confirm")}
        </button>
      ) : (
        <>
          {change === null ? (
            <div className="field">
              <label>{t("venta.tender")}</label>
              <div className="tender-grid">
                <button
                  className="btn primary huge"
                  onClick={() => void onCommit("efectivo", totalCents)}
                >
                  {t("venta.exact")}
                </button>
                {config.quickTenderCents
                  .filter((c) => c > totalCents)
                  .map((c) => (
                    <button key={c} className="btn huge" onClick={() => setTenderCents(c)}>
                      {formatMXNCompact(c)}
                    </button>
                  ))}
                <button className="btn huge" onClick={() => setCustomOpen(true)}>
                  {t("venta.other")}
                </button>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className={`change-hero ${short ? "short" : ""}`}>
                <div className="label">
                  {short ? t("venta.changeShort", { amount: "" }).trim() : t("venta.changeDue")}
                </div>
                <div className="amount tabular">{formatMXN(Math.abs(change))}</div>
                {breakdown && breakdown.lines.length > 0 ? (
                  <div className="breakdown">
                    {t("venta.giveBack")}:{" "}
                    {breakdown.lines
                      .map((l) => `${l.count}×${formatMXNCompact(l.denomCents)}`)
                      .join(" + ")}
                    {breakdown.remainderCents > 0 ? (
                      <>
                        {" "}
                        <span style={{ color: "var(--warn)" }}>
                          (
                          {t("venta.changeUnmakeable", {
                            amount: formatMXN(breakdown.remainderCents),
                          })}
                          )
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="faint" style={{ textAlign: "center" }}>
                {t("venta.tender")}: {formatMXN(tenderCents ?? 0)}
              </div>

              <div className="row" style={{ gap: 8 }}>
                <button className="btn grow ghost" onClick={() => setTenderCents(null)}>
                  {t("venta.back")}
                </button>
                <button
                  className="btn grow primary huge"
                  disabled={short}
                  onClick={() => void onCommit("efectivo", tenderCents ?? 0)}
                >
                  {t("venta.confirm")}
                </button>
              </div>
            </div>
          )}

          {customOpen ? (
            <CustomTender
              totalCents={totalCents}
              onClose={() => setCustomOpen(false)}
              onPick={(c) => {
                setTenderCents(c);
                setCustomOpen(false);
              }}
            />
          ) : null}
        </>
      )}
    </Sheet>
  );
}

function CustomTender({
  totalCents,
  onClose,
  onPick,
}: {
  totalCents: number;
  onClose: () => void;
  onPick: (cents: number) => void;
}): ReactNode {
  const t = useT();
  const [cents, setCents] = useState<number | null>(null);

  return (
    <Sheet title={t("venta.tender")} onClose={onClose}>
      <div className="field">
        <MoneyInput valueCents={cents} onChange={setCents} label={t("venta.tender")} autoFocus />
      </div>
      <p className="faint">
        {t("venta.total")}: {formatMXN(totalCents)}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          className="btn grow primary"
          disabled={cents === null}
          onClick={() => cents !== null && onPick(cents)}
        >
          {t("common.add")}
        </button>
      </div>
    </Sheet>
  );
}

/** Recent sales with hold-to-void. The void is a new event, never a deletion. */
function RecentSales({ fair }: { fair: EventFair }): ReactNode {
  const t = useT();
  const events = useEvents(fair.id);
  const products = useProducts();

  const all = events ?? [];
  const voided = voidedIds(all);
  const recorded = all
    .filter((e) => e.type === "saleRecorded")
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 8);

  if (recorded.length === 0) return null;

  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>{t("venta.recent")}</h2>
      {recorded.map((sale) => {
        if (sale.type !== "saleRecorded") return null;
        const isVoided = voided.has(sale.id);
        const names = sale.items
          .map((i) => `${i.qty}× ${productById.get(i.productId)?.name ?? i.productId}`)
          .join(", ");
        const time = new Date(sale.ts).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <div className={`sale-row ${isVoided ? "voided" : ""}`} key={sale.id}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{names}</div>
              <div className="faint">
                {t("venta.saleAt", { time, pay: t(`venta.pay.${sale.payType}`) })}
                {isVoided ? ` · ${t("venta.voided")}` : ""}
              </div>
            </div>
            <Money cents={saleTotal(sale)} className="sr-amount" />
            {!isVoided ? (
              <HoldButton
                className="sm danger"
                label={t("venta.voidHold")}
                onConfirm={() => void voidSale(fair.id, sale.id)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
