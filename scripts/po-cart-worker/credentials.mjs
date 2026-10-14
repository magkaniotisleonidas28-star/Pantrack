import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
import {writePrivate,readPrivate} from './private-files.mjs';
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const root=resolve('.sites-runtime/po-cart-workers');
export function privateCredentialPath(path){
  const full=resolve(path),rel=relative(root,full);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Credentials must stay under .sites-runtime/po-cart-workers.');return full;
}
// Local administration only. execute receives SQL containing hashes, never bearer secrets.
export async function fixtureCredential({execute,file,action='issue',companyId,supplierId='cart-demo-supplier',accountId='DEMO-CART',consumerKind='fake',ttlSeconds=3600}){
  file=privateCredentialPath(file);
  if(!['fake','local_browser'].includes(consumerKind)||!['issue','rotate','revoke'].includes(action)||!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>3600)throw Error('Invalid fixture credential request.');
  const at=new Date().toISOString(),prior=action==='issue'?null:readPrivate(file);
  if(action==='revoke'){
    await execute(`UPDATE po_cart_worker_credentials SET status='revoked',revoked_at=${quote(at)} WHERE id=${quote(prior.credentialId)} AND worker_id=${quote(prior.workerId)} AND status='active';`);
    return {workerId:prior.workerId};
  }
  if(action==='issue'&&(!companyId||!supplierId||!accountId))throw Error('Fixture company and scope required.');
  const workerId=prior?.workerId??randomUUID(),credentialId=randomUUID(),secret=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(secret).digest('hex');
  let sql=action==='issue'?`INSERT INTO po_cart_worker_identities(id,company_id,supplier_id,account_id,version,status,created_at,consumer_kind) VALUES(${quote(workerId)},${quote(companyId)},${quote(supplierId)},${quote(accountId)},1,'active',${quote(at)},${quote(consumerKind)});\n`:
    `UPDATE po_cart_worker_credentials SET status='revoked',revoked_at=${quote(at)} WHERE worker_id=${quote(workerId)} AND status='active';\n`;
  sql+=`INSERT INTO po_cart_worker_credentials SELECT ${quote(credentialId)},id,${quote(hash)},version,'active',${quote(new Date(Date.now()+ttlSeconds*1000).toISOString())},${quote(at)},NULL FROM po_cart_worker_identities WHERE id=${quote(workerId)};\n`;
  if(prior)sql+=`INSERT INTO po_cart_worker_credential_events(worker_id,credential_id,kind,at) VALUES(${quote(workerId)},${quote(credentialId)},'rotated',${quote(at)});\n`;
  await execute(sql);writePrivate(file,{workerId,credentialId,secret});return {workerId};
}
