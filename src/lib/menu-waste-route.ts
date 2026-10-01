import { z } from 'zod';
import { getChatGPTUser } from './chatgpt-auth';
import { companyAccess } from './company-access';
import { database } from '@/db/raw';
import { exactInventoryPreviewEnabled } from './exact-inventory-gate';
import { D1MenuWasteService } from './d1-menu-waste';
import { InventoryManagementError } from './d1-inventory-management';
export async function handleMenuWaste(req: Request, kind: 'items' | 'entries' | 'setup' | 'sales' | 'review') {
    if (!exactInventoryPreviewEnabled())
        return Response.json({ error: 'Waste recording is not enabled.', code: 'preview_disabled' }, { status: 404 });
    try {
        const user = await getChatGPTUser();
        if (!user)
            return Response.json({ error: 'Please sign in again.' }, { status: 401 });
        const service = new D1MenuWasteService(database()), url = new URL(req.url), companyId = url.searchParams.get('companyId');
        if (req.method === 'GET') {
            if (kind === 'items') {
                const member = await companyAccess(user.userId, companyId);
                return Response.json(await service.options(companyId!, member?.role === 'owner' || member?.role === 'manager'));
            }
            if (kind === 'sales') {
                const params = z.object({ sourceKind: z.enum(['product', 'recipe']), sourceId: z.string().min(1).max(200) }).parse(Object.fromEntries(url.searchParams));
                return Response.json({ sales: await service.sales(companyId!, params.sourceKind, params.sourceId) });
            }
            return Response.json({ entries: await service.held(companyId!) });
        }
        const input: unknown = await req.json();
        const result = kind === 'setup' ? await service.setup(input, user.userId) : kind === 'review' ? await service.review(input, user.userId) : await service.record(input, user.userId);
        return Response.json({ ok: true, result });
    }
    catch (e) {
        if (e instanceof z.ZodError)
            return Response.json({ error: 'Check the item, whole quantity, reason, and optional note.' }, { status: 400 });
        if (e instanceof InventoryManagementError && e.code !== 'corrupt_store')
            return Response.json({ error: e.code === 'before_count_cutoff' ? 'A newer stock count exists. Refresh before recording this waste.' : e.message, code: e.code }, { status: e.code === 'not_found' ? 404 : ['concurrent_update', 'operation_conflict'].includes(e.code) ? 409 : 400 });
        return Response.json({ error: 'The save needs confirmation. Retry this same entry.', uncertain: true }, { status: 503 });
    }
}
