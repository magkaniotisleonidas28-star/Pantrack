import { z } from 'zod';
import { poId } from './purchase-order-contract';
import { documentArchiveRequest } from './purchase-order-document-archive-contract';

export const archiveContinuationQuery = z
  .object({
    companyId: poId,
    id: z.string().uuid(),
    kind: z.enum(['draft', 'history']),
    orderId: poId.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.kind === 'draft' && !value.orderId) || (value.kind === 'history' && value.orderId))
      context.addIssue({ code: 'custom', message: 'Choose one saved-copy source.' });
  });
export const archiveContinuationResponse = z
  .object({ viewerId: poId, documentId: z.string().uuid(), request: documentArchiveRequest })
  .strict();
/** A browser recovery envelope only; the POST still receives the unchanged original command. */
export const archiveContinuationStored = z
  .object({
    contract: z.literal('pantrack.document-save-continuation.v1'),
    documentId: z.string().uuid(),
    request: documentArchiveRequest,
  })
  .strict();
