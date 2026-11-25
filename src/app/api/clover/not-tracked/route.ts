import { withCompanyRoute } from '@/lib/authorization';
import { getChatGPTUser } from '@/lib/chatgpt-auth';
import { database } from '@/db/raw';
import { cloverConnection } from '@/lib/clover';
import { D1CloverNotTracked, unlinkedClover } from '@/lib/d1-clover-not-tracked';
import { z } from 'zod';

/**
 * Clover items and options marked Not tracked, and what paused Clover sales are
 * waiting on (decision 0012, step P2). Owners and managers: the route family
 * checks the role before these handlers run.
 */
async function handleGET(req: Request) {
  try {
    const companyId = new URL(req.url).searchParams.get('companyId')!;
    const row = await cloverConnection(companyId);
    if (!row) return Response.json({ connected: false, marks: [], unlinked: null });
    const db = database(),
      scope = { companyId, environment: row.environment, merchantId: row.merchant_id };
    const [marks, unlinked] = await Promise.all([
      new D1CloverNotTracked(db).list(scope),
      unlinkedClover(db, companyId, row).catch(() => null),
    ]);
    return Response.json({ connected: true, marks, unlinked });
  } catch {
    return Response.json({ error: 'Could not load Clover items.' }, { status: 503 });
  }
}

const cloverId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_:.-]+$/);
const body = z
  .object({
    companyId: z.string().min(1),
    action: z.enum(['mark', 'unmark']),
    kind: z.enum(['item', 'option']),
    externalId: cloverId,
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

async function handlePOST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Please sign in.' }, { status: 401 });
  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch {
    return Response.json({ error: 'Choose a Clover item or option.' }, { status: 400 });
  }
  try {
    const db = database(),
      row = await cloverConnection(input.companyId);
    if (!row) return Response.json({ error: 'Connect Clover first.' }, { status: 400 });
    const scope = {
      companyId: input.companyId,
      environment: row.environment,
      merchantId: row.merchant_id,
    };
    if (input.action === 'mark' && input.kind === 'item') {
      const linked = await db
        .prepare(
          'SELECT 1 AS found FROM clover_item_mappings WHERE company_id=? AND environment=? AND merchant_id=? AND item_id=?',
        )
        .bind(scope.companyId, scope.environment, scope.merchantId, input.externalId)
        .first();
      if (linked)
        return Response.json(
          { error: 'This item is linked to a recipe, so its sales already come off stock.' },
          { status: 400 },
        );
    }
    const store = new D1CloverNotTracked(db);
    const changed =
      input.action === 'mark'
        ? await store.mark(scope, {
            kind: input.kind,
            externalId: input.externalId,
            name: input.name ?? null,
            actor: user.email,
          })
        : await store.unmark(scope, {
            kind: input.kind,
            externalId: input.externalId,
            actor: user.email,
          });
    return Response.json({ ok: true, changed });
  } catch {
    return Response.json({ error: 'Could not save. Try again.' }, { status: 503 });
  }
}

export const GET = withCompanyRoute('clover-not-tracked', handleGET);
export const POST = withCompanyRoute('clover-not-tracked', handlePOST);
