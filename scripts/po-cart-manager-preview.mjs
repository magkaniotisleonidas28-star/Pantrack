import './sites-env.mjs';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {fixtureCredential,privateCredentialPath} from './po-cart-worker/credentials.mjs';
import {readPrivate,journalLock} from './po-cart-worker/private-files.mjs';
import {browserCandidate,fixtureProvisioner,launchBrowserWorker,humanBrowserCandidate,launchHumanBrowser} from './po-cart-worker/manager-supervisor.mjs';
import {capturePreview,observePreviewExit,cleanupPreview} from './po-cart-worker/second-addition-cleanup.mjs';
import {registerGateChild} from './po-cart-worker/full-gate-runtime.mjs';
const root=process.env.PANTRACK_CART_MANAGER_ROOT??'.sites-runtime/po-cart-workers/manager-demo';privateCredentialPath(root);mkdirSync(root,{recursive:true,mode:0o700});
const release=journalLock(root+'/supervisor');let stopping=false,app,worker,appDone,appIdentity;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;worker?.process.kill('SIGTERM');});
async function execute(sql){
  const file=root+'/admin-'+randomUUID()+'.sql';writeFileSync(file,sql,{mode:0o600});
  try{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',file],{stdio:'ignore'});if(r.status!==0)throw Error('Local fixture administration failed.');}
  finally{unlinkSync(file);}
}
try{
  for(const port of [5181,5182])await new Promise((ok,fail)=>{const probe=createServer();probe.once('error',()=>fail(Error('Local demo ports are already occupied.')));probe.listen(port,'127.0.0.1',()=>probe.close(ok));});
  app=spawn(process.execPath,['scripts/po-cart-browser-worker-preview.mjs'],{detached:true,stdio:['ignore','ignore','ignore'],env:process.env});
  appDone=observePreviewExit(app);appIdentity=capturePreview(app);registerGateChild(app);
  appDone.then(()=>{stopping=true;});
  let ready=false;for(let i=0;i<120&&!stopping;i++){
    try{const r=await fetch('http://127.0.0.1:5181/signin-with-chatgpt?return_to=/',{redirect:'manual',signal:AbortSignal.timeout(1000)});if(r.headers.get('set-cookie')){ready=true;break;}}catch{}
    await new Promise(ok=>setTimeout(ok,500));
  }
  if(!ready)throw Error('Local application startup failed.');
  const manifestFile=root+'/manifest.json';
  let manifest;if(existsSync(manifestFile)){
    manifest=readPrivate(manifestFile);
    // Rotation preserves worker identity and its journal/receipts; no cart or job is reset.
    for(const file of manifest.credentialFiles)await fixtureCredential({execute,file,action:'rotate'});
  }else manifest=await seedLocalBrowserJob({enqueueJob:false,root});
  const provision=await fixtureProvisioner();
  console.log('Durable cart demo: http://127.0.0.1:5181/signin-with-chatgpt?return_to=/');
  console.log('Select Durable cart practice café → Purchase-order drafts. Authorize preparation, then Prepare fictional cart.');
  console.log('Fictional company: '+manifest.companyId+' · Reviewed draft: '+manifest.orderId);
  while(!stopping){
    const human=await humanBrowserCandidate(manifest),candidate=human??await browserCandidate(manifest);
    if(candidate){
      provision(candidate,manifest.fixtureFile);
      worker=human?launchHumanBrowser(manifest):launchBrowserWorker(manifest);const code=await worker.done;worker=null;
      if(code!==0)console.log('Preparation stopped; refresh manager status. Private recovery evidence retained.');
    }
    if(!stopping)await new Promise(ok=>setTimeout(ok,1000));
  }
}catch{console.error('Local manager demo stopped. Existing jobs, carts and private recovery files were retained.');process.exitCode=1;}
finally{
  stopping=true;if(worker){worker.process.kill('SIGTERM');await worker.done;}
  if(app){const cleanup=await cleanupPreview(app,appDone,appIdentity);if(!cleanup.verified)process.exitCode=1;}
  release();
}
