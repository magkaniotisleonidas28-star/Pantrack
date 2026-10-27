import {archiveCatalogQuery} from './purchase-order-archive-app-contract';
import {poId} from './purchase-order-contract';
import {archiveFail,captureArchiveArtifact,DocumentArchiveError} from './purchase-order-document-archive-contract';

/** Metadata only, from one current-membership snapshot. Held intents are never listed. */
export class D1DocumentArchiveCatalog{
  constructor(private readonly db:D1Database){}
  async list(value:unknown,actorId:string){
    try{
      const parsed=archiveCatalogQuery.safeParse(value);if(!parsed.success||!poId.safeParse(actorId).success)archiveFail('invalid_request');
      const query=parsed.data,member="company_id=? AND user_id=? AND role IN ('owner','manager')";
      const result=await this.db.batch<{artifact_json:unknown}>([
        this.db.prepare(`SELECT user_id FROM memberships WHERE ${member}`).bind(query.companyId,actorId),
        this.db.prepare(`SELECT artifact_json FROM document_archive_intents WHERE company_id=? AND artifact_json IS NOT NULL
          AND json_extract(request_json,'$.source.kind')=? AND (?='history' OR json_extract(request_json,'$.source.orderId')=?)
          AND EXISTS(SELECT 1 FROM memberships WHERE ${member})
          ORDER BY json_extract(artifact_json,'$.issuedAt') DESC,id DESC LIMIT 21 OFFSET ?`)
          .bind(query.companyId,query.kind,query.kind,query.orderId??'',query.companyId,actorId,query.offset),
      ]);
      if(!result[0].results.length)archiveFail('forbidden');
      const artifacts=result[1].results.slice(0,20).map(row=>{
        const artifact=captureArchiveArtifact(JSON.parse(String(row.artifact_json)));
        if(artifact.companyId!==query.companyId||artifact.source.kind!==query.kind||query.kind==='draft'&&artifact.source.records[0].id!==query.orderId)archiveFail('integrity');
        return artifact;
      });
      return {viewerId:actorId,artifacts,hasMore:result[1].results.length>20};
    }catch(error){if(error instanceof DocumentArchiveError)throw error;archiveFail('storage_unavailable');}
  }
}
