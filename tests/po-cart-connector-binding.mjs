import '../scripts/po-cart-worker/offline-boundary.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {localBrowser} from '@browserbasehq/stagehand';

await build({entryPoints:['scripts/cart-preview/browser-session.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/connector-binding-tests.mjs',logLevel:'silent'});
const {openLocalCartBrowser}=await import('../.sites-runtime/connector-binding-tests.mjs');
const root=mkdtempSync(join(tmpdir(),'pantrack-connector-binding-'));
const launch=localBrowser.launch,channel=chromium._channel,connect=chromium.connectOverCDP;
let launches=0,dispatches=0,closed=0,evidence;
const stopBeforeTransport=Error('Test stops before CDP transport.');
try{
 // Exercise both default delegations. No injected connect hook and no replacement
 // Playwright connectOverCDP method: its installed implementation must reach the
 // stubbed channel with its receiver and arguments intact, before network I/O.
 localBrowser.launch=async function(options){
  assert.equal(this,localBrowser);assert.equal(options.preserveUserDataDir,true);launches++;
  return {close:async()=>{closed++;}};
 };
 chromium._channel={connectOverCDP:async params=>{
  assert.match(params.endpointURL,/^http:\/\/127\.0\.0\.1:\d+$/);dispatches++;throw stopBeforeTransport;
 }};
 await assert.rejects(()=>openLocalCartBrowser('http://127.0.0.1:5182',root,true,'automation',()=>true,()=>{},
  {onEvidence:e=>{evidence=e;}}),e=>e===stopBeforeTransport);
 assert.equal(chromium.connectOverCDP,connect,'Installed receiver-dependent method was exercised');
 assert.equal(launches,1);assert.equal(dispatches,1);assert.equal(closed,1);
 assert.equal(evidence.browserAcquired,true);assert.equal(evidence.driverAcquired,false);
 assert.equal(evidence.browserClosed,true);assert.equal(evidence.proxyClosed,true);assert.equal(evidence.cleanupErrors,0);
 console.log('PASS: default launcher receiver and installed Playwright connector binding, with CDP transport stubbed; zero browser launches or provider requests.');
}finally{localBrowser.launch=launch;chromium._channel=channel;rmSync(root,{recursive:true,force:true});}
