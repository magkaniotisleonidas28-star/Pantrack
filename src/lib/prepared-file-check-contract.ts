import { z } from 'zod';
import { poId } from './purchase-order-contract';
import { issuedCheckObservation } from './issued-file-check-contract';

export const PREPARED_FILE_CHECK_CONTRACT = 'pantrack.prepared-file-check.v1' as const;
export const preparedFileCheckCommand = z
  .object({ companyId: poId, documentId: z.string().uuid(), operationId: z.string().uuid() })
  .strict();
export type PreparedFileCheckCommand = z.infer<typeof preparedFileCheckCommand>;
const common = {
  kind: z.literal('prepared_check'),
  contract: z.literal(PREPARED_FILE_CHECK_CONTRACT),
  operationId: z.string().uuid(),
  manifestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
};
export const preparedFileCheckEvent = z.discriminatedUnion('stage', [
  z.object({ ...common, stage: z.literal('requested'), manifest: z.unknown() }).strict(),
  z
    .object({ ...common, stage: z.literal('observed'), observation: issuedCheckObservation })
    .strict(),
  z.object({ ...common, stage: z.literal('completed'), observationId: z.string().uuid() }).strict(),
]);
export type PreparedFileCheckEvent = z.infer<typeof preparedFileCheckEvent>;
export const preparedFileCheckReceipt = z
  .object({
    contract: z.literal(PREPARED_FILE_CHECK_CONTRACT),
    companyId: poId,
    documentId: z.string().uuid(),
    operationId: z.string().uuid(),
    actorId: poId,
    manifestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    checkedAt: z.string().datetime(),
    outcome: z.enum(['verified', 'missing', 'damaged', 'unavailable']),
  })
  .strict();
export type PreparedFileCheckReceipt = z.infer<typeof preparedFileCheckReceipt>;
export const preparedFileCheckResponse = z
  .object({ check: preparedFileCheckReceipt, viewerId: poId, replayed: z.boolean() })
  .strict();
