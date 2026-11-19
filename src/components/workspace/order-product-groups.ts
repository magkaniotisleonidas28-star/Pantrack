import { suppliers as knownSuppliers, type Product } from '@/lib/pantry';

export type OrderProductGroup = {
  supplier: string;
  products: Product[];
  chosenCount: number;
  /** Estimated subtotal of chosen products, in cents like product prices. */
  subtotal: number;
  /** The supplier's order minimum in cents, when one is known. */
  minimum?: number;
};

/** Groups the order page's products by supplier (A–Z), each sorted by category then name. */
export function groupOrderProducts(
  products: Product[],
  qty: Record<string, number>,
): OrderProductGroup[] {
  const bySupplier = new Map<string, Product[]>();
  for (const p of products) bySupplier.set(p.supplier, [...(bySupplier.get(p.supplier) ?? []), p]);
  return [...bySupplier.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplier, list]) => {
      const chosen = list.filter((p) => (qty[p.id] ?? 0) > 0);
      // Sample supplier minimums are whole dollars; prices are cents.
      const minimumDollars = knownSuppliers.find((s) => s.name === supplier)?.minimum;
      return {
        supplier,
        products: [...list].sort(
          (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
        ),
        chosenCount: chosen.length,
        subtotal: chosen.reduce((sum, p) => sum + p.price * qty[p.id], 0),
        ...(minimumDollars === undefined ? {} : { minimum: minimumDollars * 100 }),
      };
    });
}

/** Category filter choices, taken from the products themselves. */
export function orderCategories(products: Product[]) {
  return ['All products', ...[...new Set(products.map((p) => p.category))].sort()];
}
