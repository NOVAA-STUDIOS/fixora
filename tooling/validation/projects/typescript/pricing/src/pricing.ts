// Line-item pricing with a fixed tax rate.

export interface LineItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

const TAX_RATE = 0.08;

export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export function withTax(items: LineItem[]): number {
  // BUG: a string is assigned where a number is required (TS2322). The template literal produces a
  // string, so every downstream numeric use is silently wrong until tsc rejects it.
  const total: number = `${subtotal(items) * (1 + TAX_RATE)}`;
  return total;
}
