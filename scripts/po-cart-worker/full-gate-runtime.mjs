import {resolve} from 'node:path';
import {mkdirSync,readdirSync} from 'node:fs';
import {readPrivate,writePrivate} from './private-files.mjs';
import {fullGateRoot,requireGateSource} from './acceptance-gate.mjs';
import {capturePreview} from './second-addition-cleanup.mjs';
export const gateActive=()=>process.env.PANTRACK_FULL_OFFLINE_GATE==='enabled';
export function assertGateSource(){if(gateActive())requireGateSource(readPrivate(fullGateRoot+'/freeze.json'));}
// Private recovery capability, captured before either SQL or credential-file IO.
export function captureGateCredential(credential){
 if(!gateActive())return;
 assertGateSource();writePrivate(fullGateRoot+'/issued/'+credential.credentialId+'.json',credential);
}
export async function verifyGateRevocation(credential,origin='http://127.0.0.1:5181'){
 if(!gateActive())return;
 const r=await fetch(origin+'/api/internal/po-cart-worker',{headers:{authorization:'Bearer '+credential.secret},signal:AbortSignal.timeout(10000)});
 await r.body?.cancel();if(r.status!==401)throw Error('Credential revocation unverified.');
 writePrivate(fullGateRoot+'/revoked/'+credential.credentialId+'.json',{credentialId:credential.credentialId,status:401});
}
export function registerGateProfile(path){
 if(!gateActive())return;assertGateSource();
 const key=Buffer.from(resolve(path)).toString('base64url');
 writePrivate(fullGateRoot+'/profiles/'+key+'.json',{path:resolve(path),workerPid:process.pid});
}
export function registerGateChild(child){
 if(!gateActive())return;
 const p=capturePreview(child);writePrivate(fullGateRoot+'/children/'+p.pid+'.json',{pid:p.pid,parent:p.parent,group:p.group,identity:p.identity});
}
export async function confineManagerContext(context){
 const origins=new Set(['http://127.0.0.1:5181','http://127.0.0.1:5182']);
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  return origins.has(url.origin)?route.continue():route.abort('blockedbyclient');
 });
 return context;
}
export function issuedGateCredentials(){
 mkdirSync(fullGateRoot+'/issued',{recursive:true,mode:0o700});
 return readdirSync(fullGateRoot+'/issued').map(file=>readPrivate(fullGateRoot+'/issued/'+file));
}
