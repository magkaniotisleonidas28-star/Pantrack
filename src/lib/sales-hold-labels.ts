/** Plain words for the reasons a sale is paused. Unknown codes are shown as they are. */
const LABELS: Record<string, string> = {
  clover_custom_amount: 'Custom amount with no menu item',
  clover_sold_by_weight: 'Item sold by weight or a part quantity',
  clover_order_too_large: 'Very large order (100 or more lines)',
  clover_refund_mismatch: 'Refund details don’t add up',
  clover_unreadable_order: 'Clover order details couldn’t be read',
};

/** True when the sale was paused because Clover's order couldn't be read. */
export function isUnreadableClover(reasons: string | null | undefined) {
  return (reasons ?? '').split(',').some((reason) => reason.startsWith('clover_'));
}

export function holdReasonText(reasons: string | null | undefined) {
  return (reasons ?? '')
    .split(',')
    .filter(Boolean)
    .map((reason) => LABELS[reason] ?? reason)
    .join(' · ');
}
