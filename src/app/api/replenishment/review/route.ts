import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {exactInventoryPreviewEnabled} from '@/lib/exact-inventory-gate';
import {cloverSyncEnabled} from '@/lib/clover-sync';
import {D1ReplenishmentReview} from '@/lib/d1-replenishment-review';

// Provisional local preview policy. A8 acceptance still needs a reviewed hosted policy.
const PREVIEW_MAX_LAG_MS = 10 * 60_000;

async function handleGET(req: Request): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) return Response.json({error: 'Please sign in.'}, {status: 401});
  const params = new URL(req.url).searchParams;
  const companyId = params.get('companyId');
  const productId = params.get('productId');
  const member = await companyAccess(user.userId, companyId);
  if (!member || (member.role !== 'owner' && member.role !== 'manager')) {
    return Response.json({error: 'Manager access is required.'}, {status: 403});
  }
  if (!exactInventoryPreviewEnabled()) return Response.json({error: 'Exact inventory preview is off.'}, {status: 404});
  if (!productId || !productId.trim() || productId.length > 200) {
    return Response.json({error: 'Choose a product.'}, {status: 400});
  }
  try {
    const db = database();
    if (!await db.prepare('SELECT 1 FROM products WHERE owner=? AND id=?').bind(companyId, productId).first()) {
      return Response.json({error: 'Product not found.'}, {status: 404});
    }
    const result = await new D1ReplenishmentReview(db).buildWithClover({
      companyId: companyId!, productId,
      actor: {companyId: companyId!, userId: user.userId, role: member.role},
      supplier: {
        companyId: companyId!, source: 'fictional_fixture', mappingId: 'a8-preview-unmapped',
        mappingVersion: 1, supplierId: 'unverified', accountId: 'unverified',
        locationId: 'unverified', sku: 'unmapped',
      },
      priceEstimate: null,
    }, {syncEnabled: cloverSyncEnabled(), maxLagMs: PREVIEW_MAX_LAG_MS});
    return Response.json(result);
  } catch {
    return Response.json({error: 'Could not calculate this review. Please retry.'}, {status: 503});
  }
}

export const GET = withCompanyRoute('inventory', handleGET);
