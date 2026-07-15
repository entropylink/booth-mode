// Day summary export (plan.md §6 F4 — feeds the weekly-digest skill).
// Pure string builders so they can be asserted in fixtures; the download
// helper is the only impure part.

import { formatMXN } from "./money";
import type { DaySummary, EventFair } from "../core-data/types";

const PAY_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
};

export function daySummaryMarkdown(summary: DaySummary, fair: EventFair): string {
  const lines: string[] = [];

  lines.push(`# ${fair.name} — Resumen del día`);
  lines.push("");
  lines.push(`- Fecha: ${fair.dates.join(", ") || "—"}`);
  if (fair.location) lines.push(`- Lugar: ${fair.location}`);
  lines.push(`- Ventas: ${summary.saleCount} (${summary.voidCount} canceladas)`);
  lines.push("");

  lines.push("## Dinero");
  lines.push("");
  lines.push("| Concepto | Monto |");
  lines.push("|---|---:|");
  lines.push(`| Bruto | ${formatMXN(summary.grossCents)} |`);
  for (const [pay, cents] of Object.entries(summary.byPayType)) {
    lines.push(`| — ${PAY_LABELS[pay] ?? pay} | ${formatMXN(cents)} |`);
  }
  lines.push(`| Cuota de stand | −${formatMXN(summary.boothFeeCents)} |`);
  lines.push(`| Gastos | −${formatMXN(summary.expensesCents)} |`);
  lines.push(`| **Neto** | **${formatMXN(summary.netCents)}** |`);
  lines.push("");

  lines.push("## Utilidad");
  lines.push("");
  if (summary.grossProfitCents === null) {
    lines.push("_Sin costos capturados — la utilidad no se puede calcular todavía._");
  } else {
    lines.push(`- Costo de lo vendido: ${formatMXN(summary.cogsCents ?? 0)}`);
    lines.push(`- Utilidad bruta: ${formatMXN(summary.grossProfitCents)}`);
  }
  lines.push("");

  lines.push("## Caja");
  lines.push("");
  lines.push(`- Esperado: ${formatMXN(summary.cashExpectedCents)}`);
  if (summary.cashCountedCents === null) {
    lines.push("- Contado: — (sin corte de cierre)");
  } else {
    lines.push(`- Contado: ${formatMXN(summary.cashCountedCents)}`);
    lines.push(`- Diferencia: ${formatMXN(summary.cashDeltaCents ?? 0)}`);
  }
  lines.push("");

  lines.push("## Por producto");
  lines.push("");
  if (summary.byProduct.length === 0) {
    lines.push("_Sin ventas._");
  } else {
    lines.push("| Producto | Uds | Bruto |");
    lines.push("|---|---:|---:|");
    for (const p of summary.byProduct) {
      lines.push(
        `| ${p.productName} | ${p.qty} | ${formatMXN(p.grossCents)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Inventario");
  lines.push("");
  lines.push(
    `- Vendidas ${summary.unitsSold} de ${summary.unitsPacked} empacadas ` +
      `(${summary.sellThroughPct.toFixed(1)}% sell-through)`,
  );
  lines.push("");

  lines.push("## Resurtir mañana");
  lines.push("");
  if (summary.restockList.length === 0) {
    lines.push("_Nada por resurtir._");
  } else {
    for (const r of summary.restockList) {
      const status = r.soldOut ? "AGOTADO" : `quedan ${r.remaining}`;
      lines.push(`- **${r.productName}** / ${r.variant} — ${status} (vendidas ${r.sold})`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function daySummaryCSV(summary: DaySummary, fair: EventFair): string {
  const escape = (v: string): string =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const pesos = (cents: number): string => (cents / 100).toFixed(2);

  const rows = [["seccion", "concepto", "detalle", "cantidad", "monto"]];

  rows.push(["evento", "nombre", escape(fair.name), "", ""]);
  rows.push(["dinero", "bruto", "", "", pesos(summary.grossCents)]);
  for (const [pay, cents] of Object.entries(summary.byPayType)) {
    rows.push(["dinero", "por_pago", pay, "", pesos(cents)]);
  }
  rows.push(["dinero", "cuota_stand", "", "", pesos(summary.boothFeeCents)]);
  rows.push(["dinero", "gastos", "", "", pesos(summary.expensesCents)]);
  rows.push(["dinero", "neto", "", "", pesos(summary.netCents)]);
  rows.push(["caja", "esperado", "", "", pesos(summary.cashExpectedCents)]);
  if (summary.cashCountedCents !== null) {
    rows.push(["caja", "contado", "", "", pesos(summary.cashCountedCents)]);
    rows.push(["caja", "diferencia", "", "", pesos(summary.cashDeltaCents ?? 0)]);
  }
  for (const p of summary.byProduct) {
    rows.push([
      "producto",
      escape(p.productName),
      p.tierId,
      String(p.qty),
      pesos(p.grossCents),
    ]);
  }
  for (const r of summary.restockList) {
    rows.push([
      "resurtir",
      escape(r.productName),
      escape(r.variant),
      String(r.remaining),
      "",
    ]);
  }

  return rows.map((r) => r.join(",")).join("\n") + "\n";
}

/** Browser-only: trigger a file download. */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function slugDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
