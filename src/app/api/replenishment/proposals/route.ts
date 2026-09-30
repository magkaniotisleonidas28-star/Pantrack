import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {exactInventoryPreviewEnabled} from '@/lib/exact-inventory-gate';
import {a8ReviewPolicy, a8UnverifiedSupplier} from '@/lib/a8-review-source';
import {D1ReplenishmentProposalOrigins, ProposalOriginError} from '@/lib/d1-replenishment-proposal-origins';
import {D1ReplenishmentLifecycle, ProposalLifecycleError} from '@/lib/d1-replenishment-lifecycle';
import type {SettingsActor} from '@/lib/d1-replenishment-settings';
import {z} from 'zod';

const id = z.string().trim().min(1).max(200);
const action = z.discriminatedUnion('action', [
  z.object({action: z.literal('create'), companyId: id, productId: id,
    proposalId: id, createId: id}).strict(),
  z.object({action: z.literal('edit'), companyId: id, proposalId: id,
    expectedRevision: z.number().int().positive(), changeId: id,
    packs: z.string().regex(/^(?:0|[1-9]\d*)$/).max(20),
    reason: z.string().trim().min(4).max(500)}).strict(),
  z.object({action: z.literal('cancel'), companyId: id, proposalId: id,
    expectedRevision: z.number().int().positive(), changeId: id,
    reason: z.string().trim().min(4).max(500)}).strict(),
]);

function failure(error: unknown): Response {
  if (error instanceof z.ZodError) return Response.json({error: 'Check the proposal fields.'}, {status: 400});
  if (error instanceof ProposalOriginError || error instanceof ProposalLifecycleError) {
    const code = error.code;
    const status = code === 'forbidden' ? 403 : code === 'missing' ? 404 :
      ['invalid_request'].includes(code) ? 400 :
      ['source_unavailable', 'source_changed', 'quantity_reserved', 'create_conflict',
        'id_conflict', 'conflict'].includes(code) ? 409 : 503;
    return Response.json({error: error.message, code}, {status});
  }
  return Response.json({error: 'Could not load or save the proposal. Please retry.'}, {status: 503});
}

async function manager(companyId: string | null): Promise<SettingsActor | null> {
  const user = await getChatGPTUser();
  if (!user || !companyId) return null;
  const member = await companyAccess(user.userId, companyId);
  if (!member || (member.role !== 'owner' && member.role !== 'manager')) return null;
  return {companyId, userId: user.userId, role: member.role};
}

async function handleGET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const companyId = params.get('companyId');
  const productId = params.get('productId');
  const actor = await manager(companyId);
  if (!actor) return Response.json({error: 'Manager access is required.'}, {status: 403});
  if (!exactInventoryPreviewEnabled()) return Response.json({error: 'Exact inventory preview is off.'}, {status: 404});
  if (!productId || !id.safeParse(productId).success) return Response.json({error: 'Choose a product.'}, {status: 400});
  try {
    const db = database();
    const rows = await db.prepare(`SELECT id FROM replenishment_proposal_origins
      WHERE company_id=? AND product_id=?
        AND json_extract(snapshot_json,'$.contract')='pantrack.replenishment-review.v2'
      ORDER BY created_at DESC,id DESC LIMIT 20`).bind(companyId, productId).all<{id: string}>();
    const lifecycle = new D1ReplenishmentLifecycle(db, {salesPolicy: a8ReviewPolicy()});
    const views = await Promise.all(rows.results.map(row => lifecycle.get(companyId!, row.id, actor)));
    return Response.json({views: views.filter(view => view !== null)});
  } catch (error) { return failure(error); }
}

async function handlePOST(req: Request): Promise<Response> {
  try {
    const input = action.parse(await req.json());
    const actor = await manager(input.companyId);
    if (!actor) return Response.json({error: 'Manager access is required.'}, {status: 403});
    if (!exactInventoryPreviewEnabled()) return Response.json({error: 'Exact inventory preview is off.'}, {status: 404});
    const db = database();
    const policy = a8ReviewPolicy();
    if (input.action === 'create') {
      if (!await db.prepare('SELECT 1 FROM products WHERE owner=? AND id=?')
        .bind(input.companyId, input.productId).first()) {
        return Response.json({error: 'Product not found.'}, {status: 404});
      }
      await new D1ReplenishmentProposalOrigins(db).createWithClover({
        companyId: input.companyId, productId: input.productId, id: input.proposalId,
        createId: input.createId, actor, supplier: a8UnverifiedSupplier(input.companyId),
        priceEstimate: null,
      }, policy);
      const view = await new D1ReplenishmentLifecycle(db, {salesPolicy: policy})
        .get(input.companyId, input.proposalId, actor);
      return Response.json({view});
    }
    const lifecycle = new D1ReplenishmentLifecycle(db, {salesPolicy: policy});
    const view = input.action === 'edit'
      ? await lifecycle.edit({...input, actor})
      : await lifecycle.cancel({...input, actor});
    return Response.json({view});
  } catch (error) { return failure(error); }
}

export const GET = withCompanyRoute('inventory', handleGET);
export const POST = withCompanyRoute('inventory', handlePOST);
