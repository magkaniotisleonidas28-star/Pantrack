import { z } from 'zod';
import { database } from '@/db/raw';
import { getChatGPTUser } from '@/lib/chatgpt-auth';
import { companyAccess } from '@/lib/company-access';
import { withCompanyRoute } from '@/lib/authorization';
import { exactInventoryPreviewEnabled } from '@/lib/exact-inventory-gate';
import { D1StockLevels, StockLevelError } from '@/lib/d1-stock-levels';

// R1e: suggested levels (read: any member); accepting, caution and ignore (owners and managers).
const disabled = () =>
  Response.json(
    { error: 'Suggested levels are not enabled in this workspace.', code: 'preview_disabled' },
    { status: 404 },
  );

const company = z.string().min(1).max(200),
  product = z.string().min(1).max(200),
  level = z.string().regex(/^(0|[1-9]\d{0,18})$/);
const levelsRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('accept'),
      companyId: company,
      productId: product,
      operationId: z.string().uuid(),
      expectedLevelMinor: level,
      expectedSettingsVersion: z.number().int().min(0).max(1_000_000),
    })
    .strict(),
  // productId '*' is the café's own setting; 'cafe' makes a product follow it again.
  z
    .object({
      action: z.literal('set_caution'),
      companyId: company,
      productId: product,
      caution: z.enum(['lean', 'balanced', 'cautious', 'cafe']),
    })
    .strict(),
  z
    .object({
      action: z.literal('ignore'),
      companyId: company,
      productId: product,
      expectedLevelMinor: level,
    })
    .strict(),
  z.object({ action: z.literal('unignore'), companyId: company, productId: product }).strict(),
]);

const status = { stale: 409, conflict: 409, not_suggested: 409, forbidden: 403 } as const;

async function handleGET(req: Request) {
  if (!exactInventoryPreviewEnabled()) return disabled();
  const companyId = new URL(req.url).searchParams.get('companyId')!;
  try {
    return Response.json(await new D1StockLevels(database()).read(companyId));
  } catch {
    return Response.json({ error: 'Could not load suggestions. Please retry.' }, { status: 503 });
  }
}

async function handlePOST(req: Request) {
  if (!exactInventoryPreviewEnabled()) return disabled();
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Please sign in.' }, { status: 401 });
  try {
    const body = levelsRequest.parse(await req.json());
    const member = await companyAccess(user.userId, body.companyId);
    if (!member) return Response.json({ error: 'Company access denied.' }, { status: 403 });
    const actor = {
        companyId: body.companyId,
        userId: user.userId,
        role: member.role as 'owner' | 'manager' | 'employee',
      },
      levels = new D1StockLevels(database());
    if (body.action === 'set_caution') return Response.json(await levels.setCaution(body, actor));
    if (body.action === 'ignore') return Response.json(await levels.ignore(body, actor));
    if (body.action === 'unignore') return Response.json(await levels.unignore(body, actor));
    const saved = await levels.accept(body, actor);
    return Response.json({ version: saved.version, target: saved.settings.target });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: 'Check the suggestion details.' }, { status: 400 });
    if (error instanceof StockLevelError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: status[error.code] },
      );
    return Response.json({ error: 'Could not save. Please retry.' }, { status: 503 });
  }
}

export const GET = withCompanyRoute('inventory', handleGET);
export const POST = withCompanyRoute('inventory', handlePOST);
