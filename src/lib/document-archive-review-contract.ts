import {z} from 'zod';
import {poId} from './purchase-order-contract';
import {archiveCatalogQuery} from './purchase-order-archive-app-contract';

export const archiveReviewQuery=archiveCatalogQuery;
export const archiveReviewDetailQuery=z.object({companyId:poId,kind:z.enum(['draft','history']),orderId:poId.optional(),
  id:z.string().uuid(),offset:z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)}).strict().superRefine((value,context)=>{
  if(value.kind==='draft'&&!value.orderId||value.kind==='history'&&value.orderId)context.addIssue({code:'custom',message:'Choose one saved-copy source.'});
});
export const archiveReviewLabels={pending:'Save in progress',unconfirmed:'Save not confirmed',held:'Held for review',missing:'File not found',
  damaged:'File contents did not match',unavailable:'File check unavailable',issued:'Copy issued'} as const;
export const archiveReviewReasons={source_changed:'The source changed before the copy could be issued.',generation_failed:'The file could not be generated safely.',
  forbidden:'Access changed during the save.',conflict:'The saved request did not match.',busy:'The save was already in progress.',
  held:'The save outcome could not be confirmed.',integrity:'The recorded file contents did not match.',fenced:'This attempt no longer owned the save.',
  storage_unavailable:'Storage could not confirm the result.',invalid_request:'The saved request could not be used.'} as const;
const status=z.enum(['pending','unconfirmed','held','missing','damaged','unavailable','issued']);
const reason=z.enum(['source_changed','generation_failed','forbidden','conflict','busy','held','integrity','fenced','storage_unavailable','invalid_request']);
export const archiveReviewItem=z.object({id:z.string().uuid(),companyId:poId,format:z.enum(['pdf','xlsx']),source:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('draft'),orderId:poId,revision:z.number().int().positive().safe()}).strict(),z.object({kind:z.literal('history')}).strict()]),
  requestedAt:z.string().datetime(),updatedAt:z.string().datetime(),status,reason:reason.nullable(),issued:z.boolean(),lastCheckedAt:z.string().datetime().nullable()}).strict();
export type ArchiveReviewItem=z.infer<typeof archiveReviewItem>;
export type ArchiveReviewSelection={companyId:string;kind:'draft'|'history';orderId?:string};
export const archiveReviewPage=z.object({viewerId:poId,items:z.array(archiveReviewItem).max(20),hasMore:z.boolean()}).strict();
export const archiveReviewDetail=z.object({viewerId:poId,item:archiveReviewItem,events:z.array(z.object({id:z.string().uuid(),at:z.string().datetime(),summary:z.string().min(1).max(200)}).strict()).max(20),hasMore:z.boolean()}).strict();
export type ArchiveReviewPage=z.infer<typeof archiveReviewPage>;
export type ArchiveReviewDetail=z.infer<typeof archiveReviewDetail>;
