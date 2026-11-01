import { z } from 'zod';
import { poId } from './purchase-order-contract';
export const issuedFileCheckCommand = z
  .object({ companyId: poId, documentId: z.string().uuid(), operationId: z.string().uuid() })
  .strict();
export type IssuedFileCheckCommand = z.infer<typeof issuedFileCheckCommand>;
export const issuedFileCheckReceipt = z
  .object({
    contract: z.literal('pantrack.issued-file-check.v1'),
    companyId: poId,
    documentId: z.string().uuid(),
    operationId: z.string().uuid(),
    actorId: poId,
    checkedAt: z.string().datetime(),
    outcome: z.enum(['verified', 'missing', 'damaged', 'unavailable']),
  })
  .strict();
export type IssuedFileCheckReceipt = z.infer<typeof issuedFileCheckReceipt>;
export const issuedFileCheckResponse = z
  .object({ check: issuedFileCheckReceipt, viewerId: poId, replayed: z.boolean() })
  .strict();
const metadata = z
  .object({
    contract: z.literal('pantrack.issued-file-check.v1'),
    operationId: z.string().uuid(),
    manifestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    observationId: z.string().uuid(),
  })
  .strict();
const object = {
  kind: z.literal('object'),
  present: z.boolean(),
  reportedSize: z.number().int().safe().nullable(),
  byteLength: z.number().int().nonnegative().safe().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
};
export const issuedCheckObservation = z.discriminatedUnion('kind', [
  z.object(object).strict(),
  z.object({ kind: z.literal('read_unknown') }).strict(),
]);
export const issuedCheckPayload = z.discriminatedUnion('kind', [
  z.object({ ...object, check: metadata }).strict(),
  z.object({ kind: z.literal('read_unknown'), check: metadata }).strict(),
]);
