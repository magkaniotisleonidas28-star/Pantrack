import {build} from 'esbuild';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {readPrivate,writePrivate} from './private-files.mjs';

export async function fixtureProvisioner(storefrontFile='.sites-runtime/po-cart-workers/local-storefront.json'){
  const output=resolve('.sites-runtime/po-cart-workers/modules/manager-fixture.mjs');
  await build({stdin:{contents:"export {BrowserFixtureStore} from './scripts/po-cart-worker/fixture-store.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:output,logLevel:'silent'});
  const {BrowserFixtureStore}=await import(pathToFileURL(output).href);
  const store=new BrowserFixtureStore(storefrontFile);
  return (current,fixtureFile)=>{
    const {id}=current.job,{browser,scope}=current;
    if(!browser||!scope)throw Error('Browser candidate required.');
    const file=readPrivate(fixtureFile),existing=file.jobs[id];store.refresh();
    if(existing){
      const saved=store.state.fixtures[id];
      if(!saved||saved.token!==existing.token||JSON.stringify(existing.scope)!==JSON.stringify(scope)||existing.layout!==browser.layout||existing.scenario!==browser.scenario)throw Error('Existing fixture requires review.');
      return;
    }
    // Recover a provisioning interruption without resetting an existing cart or issuing a new token.
    const fixture=store.state.fixtures[id]??store.provision(id,browser);
    if(fixture.layout!==browser.layout||fixture.scenario!==browser.scenario)throw Error('Fixture configuration changed.');
    file.jobs[id]={scope,...browser,token:fixture.token};writePrivate(fixtureFile,file);
  };
}
export async function browserCandidate(manifest){
  const credential=readPrivate(manifest.credentialFiles[0]);
  const r=await fetch(manifest.origin+'/api/internal/po-cart-worker',{redirect:'error',headers:{authorization:'Bearer '+credential.secret},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Local worker discovery failed.');return (await r.json()).current;
}
export function launchBrowserWorker(manifest,index=0){
  // File paths only. Neither credentials nor fixture tokens enter arguments or logs.
  const p=spawn(process.execPath,['scripts/po-cart-browser-worker.mjs','--credential',manifest.credentialFiles[index],
    '--journal',manifest.root+`/manager-journal-${index}.json`,'--fixture',manifest.fixtureFile,'--origin',manifest.origin,'--once'],
    {stdio:['ignore','ignore','ignore'],env:Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
  const done=new Promise((ok,fail)=>{p.once('error',fail);p.once('exit',code=>ok(code));});
  return {process:p,done};
}
export async function humanBrowserCandidate(manifest){
 const credential=readPrivate(manifest.credentialFiles[0]);
 const r=await fetch(manifest.origin+'/api/internal/po-cart-browser-session',{redirect:'error',headers:{authorization:'Bearer '+credential.secret},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Practice browser discovery failed.');return (await r.json()).current;
}
export function launchHumanBrowser(manifest,{headless=false}={}){
 const p=spawn(process.execPath,['scripts/po-cart-human-browser.mjs','--credential',manifest.credentialFiles[0],
  '--journal',manifest.root+'/human-journal.json','--fixture',manifest.fixtureFile,'--origin',manifest.origin,...(headless?['--headless']:[])],
  {stdio:['ignore','ignore','ignore'],env:Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
 return {process:p,done:new Promise((ok,fail)=>{p.once('error',fail);p.once('exit',code=>ok(code));})};
}
