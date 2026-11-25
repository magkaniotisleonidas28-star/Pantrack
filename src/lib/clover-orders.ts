import { UserFacingError } from '@/lib/user-facing-error';
import {
  SALES_EVENT_CONTRACT,
  type CloverPauseReason,
  type SalesEventDraftV1,
  type SalesSourceBinding,
} from '@/lib/sales-ingestion';

/** A Clover order Pantrack can't read safely, with the reason it is paused. */
export class CloverUnreadableOrder extends UserFacingError {
  constructor(
    public readonly reason: CloverPauseReason,
    message: string,
  ) {
    super(message);
    this.name = 'CloverUnreadableOrder';
  }
}

const unreadable = (message: string) =>
  new CloverUnreadableOrder('clover_unreadable_order', message);

type CloverCollection<T> = { elements: T[] };

type CloverModification = { id: string; modifier?: { id: string } };

type CloverLine = {
  id: string;
  item?: { id: string };
  unitQty?: number | null;
  modifications?: CloverCollection<CloverModification>;
};

export type CloverOrder = {
  id: string;
  createdTime: number;
  modifiedTime: number;
  total?: number;
  paymentState?: string;
  state?: string;
  deletedTime?: number;
  lineItems?: CloverCollection<CloverLine>;
  payments?: CloverCollection<{ id: string; createdTime?: number; clientCreatedTime?: number }>;
  refunds?: CloverCollection<{ id: string; amount: number }>;
};

export function cloverSource(
  companyId: string,
  environment: string,
  merchantId: string,
): SalesSourceBinding {
  return {
    kind: 'native',
    provider: 'clover',
    environment,
    connectionId: `clover:${companyId}`,
    merchantId,
    locationId: merchantId,
  };
}

function timestamp(value: number | undefined, label: string) {
  if (!Number.isSafeInteger(value) || !value || value < 0 || value > Date.now() + 300_000)
    throw unreadable(`Clover ${label} is missing or invalid.`);
  return new Date(value).toISOString();
}

function orderLines(order: CloverOrder, allowMissing = false): SalesEventDraftV1['lines'] {
  if (allowMissing && order.lineItems === undefined) return [];
  if (!order.lineItems || !Array.isArray(order.lineItems.elements))
    throw unreadable('Clover order lines are incomplete.');
  if (order.lineItems.elements.length >= 100)
    throw new CloverUnreadableOrder(
      'clover_order_too_large',
      'Clover order has 100 or more lines.',
    );
  return order.lineItems.elements.map((line) => {
    if (!line?.id) throw unreadable('Clover line item identity needs review.');
    // A custom amount is typed in at the register and has no menu item.
    if (!line.item?.id)
      throw new CloverUnreadableOrder('clover_custom_amount', 'Clover line has no menu item.');
    // Clover gives weighed or part quantities in thousandths; Pantrack reads whole items.
    if (line.unitQty != null && line.unitQty !== 1000)
      throw new CloverUnreadableOrder(
        'clover_sold_by_weight',
        'Clover line is sold by weight or a part quantity.',
      );
    const modifications = line.modifications?.elements ?? [];
    if (!Array.isArray(modifications)) throw unreadable('Clover modifiers are incomplete.');
    if (modifications.length >= 100)
      throw new CloverUnreadableOrder(
        'clover_order_too_large',
        'Clover line has 100 or more modifiers.',
      );
    return {
      externalLineId: line.id,
      externalItemId: line.item.id,
      quantity: '1',
      modifiers: modifications.map((mod) => {
        if (!mod?.id || !mod.modifier?.id)
          throw unreadable('Clover modifier identity needs review.');
        return {
          externalModifierLineId: mod.id,
          externalModifierId: mod.modifier.id,
          quantity: '1',
        };
      }),
    };
  });
}

export function normalizeCloverOrder(
  order: CloverOrder,
  startedAt: number,
): SalesEventDraftV1 | null {
  if (
    !order ||
    typeof order.id !== 'string' ||
    !order.id ||
    !Number.isSafeInteger(order.modifiedTime) ||
    order.modifiedTime <= 0 ||
    !Number.isSafeInteger(order.createdTime) ||
    order.createdTime <= 0
  )
    throw unreadable('Clover order identity or revision is invalid.');
  if (order.createdTime < startedAt) return null;
  const paymentState = order.paymentState?.toUpperCase() || 'OPEN';
  const paid = paymentState === 'PAID';
  const refundEntries = order.refunds?.elements;
  if (refundEntries && !Array.isArray(refundEntries))
    throw new CloverUnreadableOrder(
      'clover_refund_mismatch',
      'Clover refund expansion is incomplete.',
    );
  let linkedRefundStatus: 'refunded' | 'partially_refunded' | null = null;
  if (refundEntries?.length) {
    if (
      !Number.isSafeInteger(order.total) ||
      Number(order.total) <= 0 ||
      refundEntries.some(
        (refund) => !refund.id || !Number.isSafeInteger(refund.amount) || refund.amount <= 0,
      ) ||
      new Set(refundEntries.map((refund) => refund.id)).size !== refundEntries.length
    )
      throw new CloverUnreadableOrder(
        'clover_refund_mismatch',
        'Clover refund details need review.',
      );
    const refundedAmount = refundEntries.reduce((sum, refund) => sum + refund.amount, 0);
    if (!Number.isSafeInteger(refundedAmount) || refundedAmount > order.total!)
      throw new CloverUnreadableOrder(
        'clover_refund_mismatch',
        'Clover refund amount needs review.',
      );
    linkedRefundStatus = refundedAmount === order.total ? 'refunded' : 'partially_refunded';
  }
  const refunded =
    Boolean(linkedRefundStatus) ||
    paymentState === 'REFUNDED' ||
    paymentState === 'PARTIALLY_REFUNDED' ||
    paymentState === 'CREDITED';
  const canceled = Boolean(order.deletedTime) || order.state?.toUpperCase() === 'CANCELED';
  if (!paid && !refunded && !canceled) return null;
  const lines = orderLines(order);
  const paymentTimes =
    order.payments?.elements
      ?.map((value) => value.createdTime ?? value.clientCreatedTime)
      .filter((value): value is number => typeof value === 'number') ?? [];
  const hasPaymentTime = !paid || paymentTimes.length > 0;
  const occurredAt =
    paid && hasPaymentTime && !linkedRefundStatus
      ? timestamp(Math.max(...paymentTimes), 'payment time')
      : timestamp(order.modifiedTime, 'modification time');
  const eventType = refunded ? 'refund' : canceled ? 'cancellation' : 'sale';
  // A linked refund can become visible after a detail response for this same
  // modifiedTime was already received as PAID. Keep that receipt immutable and
  // give the refund its own adjacent revision, so a later poll can reconcile it.
  if (linkedRefundStatus && !Number.isSafeInteger(order.modifiedTime + 1))
    throw new CloverUnreadableOrder('clover_refund_mismatch', 'Clover refund revision is invalid.');
  const revision = linkedRefundStatus ? order.modifiedTime + 1 : order.modifiedTime;
  const externalEventId = linkedRefundStatus
    ? `${order.id}:refund:${refundEntries!
        .map((refund) => refund.id)
        .sort()
        .join(',')}`
    : `${order.id}:${order.modifiedTime}`;
  const draft: SalesEventDraftV1 = {
    schemaVersion: SALES_EVENT_CONTRACT,
    externalEventId,
    externalOrderId: order.id,
    revision,
    eventType,
    orderStatus:
      linkedRefundStatus ??
      (refunded
        ? paymentState === 'PARTIALLY_REFUNDED'
          ? 'partially_refunded'
          : 'refunded'
        : canceled
          ? 'canceled'
          : 'completed'),
    preparationStatus: refunded
      ? 'unknown'
      : paid
        ? 'fulfilled'
        : canceled
          ? 'not_started'
          : 'unknown',
    occurredAt,
    timeQuality: refunded || hasPaymentTime ? 'provider' : 'inferred',
    lines,
  };
  // Hash only the consumption-relevant projection. Never retain Clover's customer,
  // note, tender, or payment objects in the sales event store.
  draft.sourcePayload = { ...draft };
  return draft;
}

// This projection is valid only for an order returned by Clover's deletedTime
// filter. The list can omit deletedTime and lineItems while detail GET is 404.
export function normalizeCloverDeletedOrder(
  order: CloverOrder,
  startedAt: number,
): SalesEventDraftV1 | null {
  if (
    !order ||
    typeof order.id !== 'string' ||
    !order.id ||
    !Number.isSafeInteger(order.modifiedTime) ||
    order.modifiedTime <= 0 ||
    !Number.isSafeInteger(order.createdTime) ||
    order.createdTime <= 0
  )
    throw unreadable('Clover deleted order identity or revision is invalid.');
  if (order.createdTime < startedAt) return null;
  const draft: SalesEventDraftV1 = {
    schemaVersion: SALES_EVENT_CONTRACT,
    externalEventId: `${order.id}:${order.modifiedTime}`,
    externalOrderId: order.id,
    revision: order.modifiedTime,
    eventType: 'cancellation',
    orderStatus: 'canceled',
    preparationStatus: 'unknown',
    occurredAt: timestamp(order.modifiedTime, 'deletion modification time'),
    timeQuality: 'provider',
    lines: orderLines(order, true),
  };
  draft.sourcePayload = { ...draft };
  return draft;
}

/** The list entry Pantrack already checked: an order ID and a safe modified time. */
export type CloverOrderIdentity = { id: string; modifiedTime: number };

/**
 * An order Pantrack can't read is received as its own paused sale, with no
 * lines and a plain reason, so syncing moves on to later orders. Nothing from
 * it comes off stock until a person reviews it. A later change to the order in
 * Clover arrives as a new revision and is read as usual.
 */
export function pausedCloverOrder(
  identity: CloverOrderIdentity,
  reason: CloverPauseReason,
  now = Date.now(),
): SalesEventDraftV1 {
  // A refund can appear on a revision already received as paid, so it gets
  // the next revision, like a readable refund.
  const refund = reason === 'clover_refund_mismatch';
  const revision = refund ? identity.modifiedTime + 1 : identity.modifiedTime;
  const draft: SalesEventDraftV1 = {
    schemaVersion: SALES_EVENT_CONTRACT,
    externalEventId: refund
      ? `${identity.id}:refund-review:${identity.modifiedTime}`
      : `${identity.id}:${identity.modifiedTime}`,
    externalOrderId: identity.id,
    revision,
    eventType: refund ? 'refund' : 'sale',
    orderStatus: 'unknown',
    preparationStatus: 'unknown',
    occurredAt: new Date(Math.min(identity.modifiedTime, now)).toISOString(),
    timeQuality: 'inferred',
    lines: [],
    unreadable: reason,
  };
  draft.sourcePayload = { ...draft };
  return draft;
}

/**
 * Reads a Clover order. An order that can't be read safely becomes a paused
 * sale instead of stopping the sync. For a deleted order, whose lines may be
 * missing, an unreadable one is received as a plain deletion with no lines.
 */
export function readCloverOrder(
  identity: CloverOrderIdentity,
  order: CloverOrder,
  startedAt: number,
  deleted = false,
): SalesEventDraftV1 | null {
  try {
    return deleted
      ? normalizeCloverDeletedOrder(order, startedAt)
      : normalizeCloverOrder(order, startedAt);
  } catch (error) {
    if (!(error instanceof CloverUnreadableOrder)) throw error;
    if (!deleted) return pausedCloverOrder(identity, error.reason);
    const draft: SalesEventDraftV1 = {
      schemaVersion: SALES_EVENT_CONTRACT,
      externalEventId: `${identity.id}:${identity.modifiedTime}`,
      externalOrderId: identity.id,
      revision: identity.modifiedTime,
      eventType: 'cancellation',
      orderStatus: 'canceled',
      preparationStatus: 'unknown',
      occurredAt: new Date(Math.min(identity.modifiedTime, Date.now())).toISOString(),
      timeQuality: 'provider',
      lines: [],
    };
    draft.sourcePayload = { ...draft };
    return draft;
  }
}
