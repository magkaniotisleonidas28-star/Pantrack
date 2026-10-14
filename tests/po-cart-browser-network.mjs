import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer,request} from 'node:http';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,rmSync,writeFileSync,statSync,symlinkSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {profileLock} from '../scripts/po-cart-worker/private-files.mjs';
await build({entryPoints:['scripts/cart-preview/browser-session.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/browser-network-tests.mjs'});
const {browserProxy}=await import('../.sites-runtime/browser-network-tests.mjs');
let hits=0;const external=createServer((req,res)=>{hits++;res.end('Forbidden external destination');});
await new Promise(ok=>external.listen(0,'127.0.0.1',ok));const outside='http://127.0.0.1:'+external.address().port;
const server=createServer((req,res)=>{if(req.url==='/catalog?external')res.writeHead(303,{location:outside+'/cart'});
 else if(req.url==='/catalog?checkout')res.writeHead(303,{location:'/checkout'});else if(req.url==='/catalog?local')res.writeHead(303,{location:'/cart'});res.end('fixture');});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port,observed=[],proxy=await browserProxy(origin,'automation',()=>true,(url,method)=>observed.push({url,method}));
const via=(url,method='GET')=>new Promise((ok,fail)=>{const r=request(proxy.url,{method,path:url},res=>{res.resume();res.on('end',()=>ok(res.statusCode));});r.on('error',fail);r.end();});
const root='.sites-runtime/po-cart-workers/lock-tests-'+randomUUID();mkdirSync(root,{recursive:true,mode:0o700});
try{
 for(const path of ['/catalog','/cart','/add','/session/private-fixture'])assert.equal(await via(origin+path),200);
 for(const url of [outside+'/catalog',origin+'/checkout',origin+'/checkout/',origin+'/unknown',origin+'/v1/traces',origin+'/__disabled_google/ListAccounts'])assert.equal(await via(url),403);
 assert.equal(await via(origin+'/cart','DELETE'),403);assert.equal(await via(origin+'/catalog?external'),403);assert.equal(await via(origin+'/catalog?checkout'),403);assert.equal(await via(origin+'/catalog?local'),303);assert.equal(hits,0);
 const connect=await new Promise((ok,fail)=>{const r=request(proxy.url,{method:'CONNECT',path:'example.invalid:443'});r.on('connect',(res,socket)=>{socket.destroy();ok(res.statusCode);});r.on('error',fail);r.end();});
 assert.equal(connect,403);assert.ok(observed.some(r=>r.method==='CONNECT'&&r.url==='https://example.invalid:443'));assert.equal(hits,0);
 for(const mode of ['sign_in','inspect']){
  const human=await browserProxy(origin,mode);
  const requestHuman=(path,method='GET')=>new Promise((ok,fail)=>{const r=request(human.url,{method,path:origin+path},res=>{res.resume();res.on('end',()=>ok(res.statusCode));});r.on('error',fail);r.end();});
  try{for(const path of ['/catalog','/cart','/session/private-fixture'])assert.equal(await requestHuman(path),200);
   for(const method of ['GET','POST'])for(const path of ['/add','/checkout'])assert.equal(await requestHuman(path,method),403);
   assert.equal(await requestHuman('/login','POST'),mode==='sign_in'?200:403);
   for(const path of ['/cart','/catalog'])assert.equal(await requestHuman(path,'POST'),403);
  }finally{human.server.closeAllConnections();await new Promise(ok=>human.server.close(ok));}
 }
 let access=true;const expiring=await browserProxy(origin,'sign_in',()=>access);
 const expires=()=>new Promise((ok,fail)=>{const r=request(expiring.url,{path:origin+'/cart'},res=>{res.resume();res.on('end',()=>ok(res.statusCode));});r.on('error',fail);r.end();});
 try{assert.equal(await expires(),200);access=false;assert.equal(await expires(),403);}finally{expiring.server.closeAllConnections();await new Promise(ok=>expiring.server.close(ok));}
 const lock=resolve(root,'account'),release=profileLock(lock);
 const code="import {profileLock} from './scripts/po-cart-worker/private-files.mjs';try{profileLock(process.argv[1]);process.exitCode=1;}catch{process.exitCode=0;}";
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',code,lock],{encoding:'utf8'}).status,0,'A live profile owner cannot be displaced');
 if(process.platform!=='win32')assert.equal(statSync(lock+'.lock').mode&0o777,0o600);release();
 const exited=spawnSync(process.execPath,['--input-type=module','-e',"import {profileLock} from './scripts/po-cart-worker/private-files.mjs';profileLock(process.argv[1]);",lock],{encoding:'utf8'});assert.equal(exited.status,0);
 profileLock(lock)();
 if(process.platform!=='win32'){mkdirSync(lock,{recursive:true,mode:0o700});symlinkSync('fixture-host-'+process.pid,lock+'/SingletonLock');
  assert.throws(()=>profileLock(lock),/still open/,'A browser that outlived its worker blocks reuse');unlinkSync(lock+'/SingletonLock');profileLock(lock)();}
 writeFileSync(lock+'.lock.reclaim','review required',{mode:0o600});assert.throws(()=>profileLock(lock));
}finally{proxy.server.closeAllConnections();await new Promise(ok=>proxy.server.close(ok));server.closeAllConnections();await new Promise(ok=>server.close(ok));await new Promise(ok=>external.close(ok));rmSync(root,{recursive:true,force:true});}
console.log('PASS: proxy origin/path/method/redirect restrictions, zero external contacts, private account lock survives live-owner contention and safely reclaims dead owners.');
