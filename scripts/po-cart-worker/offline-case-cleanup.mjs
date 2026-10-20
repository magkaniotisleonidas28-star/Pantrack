import {chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {cleanupTaskBrowser} from './second-addition-cleanup.mjs';
import {writePrivate} from './private-files.mjs';
// Run before closing either HTTP fixture or its in-memory database. Independent
// cleanup actions continue even if another resource cannot be verified.
export async function finishOfflineFixture({f,dir,origin,worker,profile}){
 const result={credentialsRevoked:true,browserClosed:true,stateSaved:false,cleanupVerified:false};
 try{worker?.close();}catch{result.browserClosed=false;}
 if(profile)try{result.browserClosed&&=(await cleanupTaskBrowser(profile)).verified;}catch{result.browserClosed=false;}
 for(const c of f.issuedCredentials){
  try{f.revoke(c);const r=await fetch(origin+'/api/internal/po-cart-worker',{headers:{authorization:'Bearer '+c.secret}});await r.body?.cancel();if(r.status!==401)throw Error();}
  catch{result.credentialsRevoked=false;}
 }
 try{f.sql.exec("VACUUM INTO '"+resolve(dir+'/state.sqlite').replaceAll("'","''")+"'");chmodSync(dir+'/state.sqlite',0o600);result.stateSaved=true;}catch{}
 result.cleanupVerified=result.credentialsRevoked&&result.browserClosed&&result.stateSaved;
 writePrivate(dir+'/cleanup.json',result);return result;
}
