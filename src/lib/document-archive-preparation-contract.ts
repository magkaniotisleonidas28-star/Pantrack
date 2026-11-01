import { z } from 'zod';
import {
  DOCUMENT_ARCHIVE_MAX_BYTES,
  DOCUMENT_ARCHIVE_TEMPLATES,
  archiveTemplate,
} from './purchase-order-document-archive-contract';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const expected = z
  .object({
    format: z.enum(['pdf', 'xlsx']),
    template: z.enum(DOCUMENT_ARCHIVE_TEMPLATES),
    size: z.number().int().positive().max(DOCUMENT_ARCHIVE_MAX_BYTES),
    sha256: digest,
    requestedAt: z.string().datetime(),
    sourceKind: z.enum(['draft', 'history']),
    sourceFingerprint: digest,
    sourceRecordCount: z.number().int().min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.template !== archiveTemplate(value.sourceKind, value.format) ||
      (value.sourceKind === 'draft' && value.sourceRecordCount !== 1)
    )
      context.addIssue({ code: 'custom', message: 'Prepared details did not match the source.' });
  });
export const archivePreparationEvidence = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_recorded') }).strict(),
  z.object({ state: z.literal('issued') }).strict(),
  z
    .object({
      state: z.literal('prepared'),
      expected,
      latestStorageEvidence: z
        .object({
          at: z.string().datetime(),
          outcome: z.enum(['matched', 'missing', 'damaged', 'unavailable', 'write_unconfirmed']),
        })
        .strict()
        .nullable(),
    })
    .strict(),
]);
export type ArchivePreparationEvidence = z.infer<typeof archivePreparationEvidence>;
