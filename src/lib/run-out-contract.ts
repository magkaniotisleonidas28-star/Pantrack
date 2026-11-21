import { z } from 'zod';

/** R1c (decision 0011): "We just ran out" reports and their outcomes. */
export const RUN_OUT_NOTE_MAX = 200;

const base = {
  companyId: z.string().min(1).max(200),
  operationId: z.string().uuid(),
};

export const runOutRequest = z.discriminatedUnion('action', [
  z.object({
    ...base,
    action: z.literal('report'),
    productId: z.string().min(1).max(200),
    note: z.string().max(RUN_OUT_NOTE_MAX).default(''),
  }),
  z.object({ ...base, action: z.literal('confirm'), reportId: z.string().min(1).max(200) }),
  z.object({ ...base, action: z.literal('dismiss'), reportId: z.string().min(1).max(200) }),
]);
export type RunOutRequest = z.infer<typeof runOutRequest>;

export type RunOutReportView = Readonly<{
  id: string;
  productId: string;
  reporterEmail: string;
  note: string;
  reportedAt: string;
}>;

export type RunOutReportOutcome = Readonly<{
  report: RunOutReportView;
  /** False when this product already had an open report, which is returned instead. */
  created: boolean;
}>;

export type RunOutResolutionOutcome = Readonly<{
  outcome: 'confirmed' | 'dismissed';
  reportIds: readonly string[];
  countId: string | null;
}>;

export class RunOutError extends Error {
  constructor(
    public readonly code: 'not_found' | 'no_stock' | 'conflict' | 'already_resolved' | 'stale',
    message: string,
  ) {
    super(message);
    this.name = 'RunOutError';
  }
}

export const runOutErrorStatus: Record<RunOutError['code'], number> = {
  not_found: 404,
  no_stock: 400,
  conflict: 409,
  already_resolved: 409,
  stale: 409,
};
