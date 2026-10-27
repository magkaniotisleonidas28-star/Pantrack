import {z} from 'zod';
import {poId} from './purchase-order-contract';
import {captureArchiveArtifact,type DocumentArchiveArtifact} from './purchase-order-document-archive-contract';

export const archiveCatalogQuery=z.object({companyId:poId,kind:z.enum(['draft','history']),orderId:poId.optional(),
  offset:z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)}).strict().superRefine((value,context)=>{
  if(value.kind==='draft'&&!value.orderId||value.kind==='history'&&value.orderId)context.addIssue({code:'custom',message:'Choose one saved-copy source.'});
});
export type ArchiveCatalogQuery=z.infer<typeof archiveCatalogQuery>;
export const archiveReadQuery=z.object({companyId:poId,id:z.string().uuid(),view:z.enum(['download','metadata']).default('download')}).strict();
export function archiveFilename(artifact:DocumentArchiveArtifact){return `pantrack-saved-${artifact.id}.${artifact.format}`;}
export function captureArchiveCatalog(value:unknown){
  const parsed=z.object({viewerId:poId,artifacts:z.array(z.unknown()).max(20),hasMore:z.boolean()}).strict().parse(value);
  return {...parsed,artifacts:parsed.artifacts.map(captureArchiveArtifact)};
}
