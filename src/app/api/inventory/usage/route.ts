import { database } from '@/db/raw';
import { withCompanyRoute } from '@/lib/authorization';
import { exactInventoryPreviewEnabled } from '@/lib/exact-inventory-gate';
import { D1StockUsage } from '@/lib/d1-stock-usage';

// R1b: measured and recorded use per product. Read only; any company member may view it.
async function handleGET(req: Request) {
  if (!exactInventoryPreviewEnabled())
    return Response.json(
      { error: 'Usage and accuracy is not enabled in this workspace.', code: 'preview_disabled' },
      { status: 404 },
    );
  const companyId = new URL(req.url).searchParams.get('companyId')!;
  try {
    return Response.json(await new D1StockUsage(database()).read(companyId));
  } catch {
    return Response.json({ error: 'Could not load usage. Please retry.' }, { status: 503 });
  }
}

export const GET = withCompanyRoute('inventory', handleGET);
