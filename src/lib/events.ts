// Append-only writers for the event log (plan.md §4).
//
// Every money action goes through here. Nothing else may write to db.events,
// and nothing — including this file — may ever update or delete an event.
// Cancelling is always a *new* compensating event.

import { db, newId } from "./dexie";
import type {
  Cents,
  DenominationCounts,
  ExpenseCategory,
  FloatKind,
  PayType,
  SaleItem,
} from "../core-data/types";

const now = (): string => new Date().toISOString();

export async function recordSale(input: {
  eventId: string;
  items: SaleItem[];
  payType: PayType;
  cashGivenCents?: Cents;
  changeDueCents?: Cents;
}): Promise<string> {
  const id = newId("sale");
  await db.events.add({
    type: "saleRecorded",
    id,
    eventId: input.eventId,
    ts: now(),
    items: input.items,
    payType: input.payType,
    cashGivenCents: input.cashGivenCents,
    changeDueCents: input.changeDueCents,
  });
  return id;
}

export async function voidSale(
  eventId: string,
  targetId: string,
  reason?: string,
): Promise<string> {
  const id = newId("void");
  await db.events.add({
    type: "saleVoided",
    id,
    eventId,
    ts: now(),
    targetId,
    reason,
  });
  return id;
}

export async function addExpense(input: {
  eventId: string;
  concept: string;
  amountCents: Cents;
  category: ExpenseCategory;
  paidFromBox: boolean;
}): Promise<string> {
  const id = newId("exp");
  await db.events.add({
    type: "expenseAdded",
    id,
    eventId: input.eventId,
    ts: now(),
    concept: input.concept,
    amountCents: input.amountCents,
    category: input.category,
    paidFromBox: input.paidFromBox,
  });
  return id;
}

export async function voidExpense(eventId: string, targetId: string): Promise<string> {
  const id = newId("expvoid");
  await db.events.add({ type: "expenseVoided", id, eventId, ts: now(), targetId });
  return id;
}

export async function recordFloatCount(input: {
  eventId: string;
  kind: FloatKind;
  denominations: DenominationCounts;
  totalCents: Cents;
}): Promise<string> {
  const id = newId("float");
  await db.events.add({
    type: "floatCounted",
    id,
    eventId: input.eventId,
    ts: now(),
    kind: input.kind,
    denominations: input.denominations,
    totalCents: input.totalCents,
  });
  return id;
}
