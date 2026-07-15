// Turns the template's structured issues into sentences, in this app's
// language.
//
// core-data/template.ts describes problems as data because it is shared with
// Booth Mode, which defaults to Spanish while this app defaults to English.
// The phrasing belongs here, on the app side of that line.

import type { InferredColumn, TemplateIssue } from "../core-data/template";

type T = (key: string, opts?: Record<string, unknown>) => string;

export function formatIssue(t: T, issue: TemplateIssue): string {
  switch (issue.kind) {
    case "empty-file":
      return t("csv.emptyFile");
    case "missing-product-column":
      return t("csv.missingProductColumn");
    case "bad-value":
      return t("csv.badValue", {
        row: issue.row,
        column: t(`csv.col.${issue.column}`),
        value: issue.value === "" ? t("csv.blank") : issue.value,
      });
  }
}

export function formatInferred(t: T, inferred: InferredColumn): string {
  return t("csv.inferredColumn", {
    index: inferred.index,
    column: t(`csv.col.${inferred.column}`),
    samples: inferred.samples.join(", "),
  });
}
