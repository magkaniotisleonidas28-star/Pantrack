import { z } from 'zod';
import type { WasteReason } from './inventory-management-contract';
import type { SelectedRecipeVersion } from './inventory-consumption-contract';
const id = z.string().trim().min(1).max(200);
export const menuWasteSubmission = z.object({
    companyId: id, operationId: z.string().uuid(), sourceKind: z.enum(['product', 'recipe']), sourceId: id,
    sourceVersion: id, quantity: z.number().int().min(1).max(999),
    reason: z.enum(['end_of_day', 'spoiled', 'spilled', 'preparation_error', 'other']), note: z.string().trim().max(300),
    mode: z.enum(['unsold', 'replacement', 'sold']), effectiveAt: z.string().min(20).max(35),
    modifiers: z.array(z.object({ id, versionId: id, perItem: z.number().int().min(1).max(5) }).strict()).max(20),
    sale: z.object({ applicationKey: id, lineId: id }).strict().optional(),
}).strict().superRefine((b, ctx) => {
    if (b.mode !== 'sold' && b.sale)
        ctx.addIssue({ code: 'custom', message: 'Only already-counted waste can reference a sale.' });
    if ((b.mode === 'sold' || b.sourceKind === 'product') && b.modifiers.length)
        ctx.addIssue({ code: 'custom', message: 'This entry cannot select new modifiers.' });
    if (new Set(b.modifiers.map(m => m.id)).size !== b.modifiers.length)
        ctx.addIssue({ code: 'custom', message: 'Select each modifier once.' });
});
export type MenuWasteSubmission = z.infer<typeof menuWasteSubmission>;
export const menuWasteSetup = z.object({ companyId: id, productId: id, offered: z.boolean(), expectedRevision: z.number().int().nonnegative().safe(), operationId: z.string().uuid() }).strict();
export const menuWasteReview = z.object({ companyId: id, entryId: z.string().uuid(), operationId: z.string().uuid(), sale: z.object({ applicationKey: id, lineId: id }).strict() }).strict();
export type MenuWasteItem = {
    kind: 'product' | 'recipe';
    id: string;
    name: string;
    version: string;
    ready: boolean;
    issue: string | null;
    offered: boolean;
    revision: number;
    modifiers: Array<{
        id: string;
        versionId: string;
        name: string;
    }>;
};
export type MenuWasteOptions = {
    enabled: true;
    serverNow: string;
    items: MenuWasteItem[];
};
export type MenuWasteReceipt = {
    operationId: string;
    itemName: string;
    quantity: number;
    reason: WasteReason;
    mode: MenuWasteSubmission['mode'];
    effectiveAt: string;
    status: 'deducted' | 'classified' | 'held';
    message: string;
    selectedVersions: SelectedRecipeVersion[];
    effects: Array<{
        productId: string;
        minor: string;
        dimension: string;
    }>;
};
export type WasteSaleChoice = {
    applicationKey: string;
    lineId: string;
    name: string;
    occurredAt: string;
    available: number;
    modifiers: string[];
};
