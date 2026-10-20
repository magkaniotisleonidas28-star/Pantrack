import {localBrowser,type StagehandBrowser} from '@browserbasehq/stagehand';
import {chromium,type Page,type Browser} from 'playwright-core';
import {createServer,request as httpRequest} from 'node:http';
import {createServer as createPortProbe} from 'node:net';
import {resolve} from 'node:path';
import {existsSync,readdirSync,mkdirSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import type {CartEntry,CartLine} from '../../src/lib/cart-preview-contract';
import type {Product} from './model';
import type {Diagnostic} from '../po-cart-worker/browser-diagnostics';
function cachedChrome(){
  if(process.env.CHROME_PATH)return process.env.CHROME_PATH;
  const root=process.platform==='darwin'?resolve(homedir(),'Library/Caches/ms-playwright'):process.platform==='win32'?resolve(process.env.LOCALAPPDATA??homedir(),'ms-playwright'):resolve(process.env.XDG_CACHE_HOME??resolve(homedir(),'.cache'),'ms-playwright');
  if(!existsSync(root))return undefined;
  for(const name of readdirSync(root).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse())for(const suffix of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing','chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing','chrome-linux64/chrome','chrome-win64/chrome.exe']){
    const path=resolve(root,name,suffix);if(existsSync(path))return path;
  }
  return undefined;
}

const storefrontPath=(path:string)=>['/catalog','/cart','/add','/login'].includes(path)||/^\/session\/[-a-zA-Z0-9]{1,100}$/.test(path);

// Independent network boundary for the browser. No CONNECT tunnels or other origins.
export type BrowserMode='automation'|'sign_in'|'inspect';
export function allowedBrowserRequest(origin:string,url:string,method:string,mode:BrowserMode){
 const u=new URL(url);return u.origin===origin&&storefrontPath(u.pathname)&&(mode==='automation'?['GET','POST'].includes(method):method==='GET'&&u.pathname!=='/add'||mode==='sign_in'&&method==='POST'&&u.pathname==='/login');
}
export async function browserProxy(origin:string,mode:BrowserMode='automation',accessAllowed=()=>true,observe=(_url:string,_method:string)=>{},diagnostic:Diagnostic=()=>{}){
  const server=createServer((req,res)=>{
    let u:URL;try{u=new URL(req.url??'');}catch{res.writeHead(403);res.end();return;}
    observe(u.href,req.method??'');
    const add=u.origin===origin&&u.pathname==='/add'&&req.method==='POST';if(add)diagnostic('proxy_add');
    if(!accessAllowed()||!allowedBrowserRequest(origin,u.href,req.method??'',mode)){res.writeHead(403);res.end('Blocked outside fictional storefront.');return;}
    const outgoing=httpRequest(u,{method:req.method,headers:{...req.headers,host:u.host}},r=>{if(add)diagnostic('proxy_response',{status:r.statusCode??502});if(r.headers.location){const target=new URL(r.headers.location,u);if(!allowedBrowserRequest(origin,target.href,'GET',mode)){r.resume();res.writeHead(403);res.end();return;}}res.writeHead(r.statusCode??502,r.headers);r.on('end',()=>{if(add)diagnostic('proxy_end');});r.on('aborted',()=>{if(add)diagnostic('proxy_aborted');res.destroy();});r.on('error',()=>res.destroy());r.pipe(res);});
    outgoing.on('finish',()=>{if(add)diagnostic('proxy_forward');});outgoing.on('error',()=>{if(add)diagnostic('proxy_error');res.destroy();});req.pipe(outgoing);
  });
  server.on('connect',(req,socket)=>{try{observe('https://'+req.url,'CONNECT');}catch{observe('https://invalid.example','CONNECT');}
    socket.on('error',()=>socket.destroy());socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const address=server.address();if(!address||typeof address==='string')throw Error('Proxy failed.');
  return {server,url:`http://127.0.0.1:${address.port}`};
}
export type BrowserEvidence={externalRequests:number;blockedBackgroundRequests:number;checkoutSubmissions:number;blockedTelemetry:number;
 proxyObserved:boolean;pageIntercepted:boolean;launchAttempted:boolean;browserAcquired:boolean;driverAcquired:boolean;
 browserClosed:boolean;driverClosed:boolean;proxyClosed:boolean;cleanupErrors:number};
type BrowserHooks={onEvidence?:(e:BrowserEvidence)=>void;launch?:typeof localBrowser.launch;connect?:typeof chromium.connectOverCDP;
 createProxy?:typeof browserProxy;closeTimeoutMs?:number};
// Bounded teardown always attempts every acquired resource, even after a rejection
// or an SDK close that never settles. A timeout is retained as a cleanup failure.
async function closeResources(browser:StagehandBrowser|undefined,driver:Browser|undefined,proxy:ReturnType<typeof createServer>|undefined,
 evidence:BrowserEvidence,diagnostic:Diagnostic,publish:()=>void,timeoutMs=5000){
 diagnostic('closing');
 const attempt=async(key:'browserClosed'|'driverClosed'|'proxyClosed',close:()=>Promise<unknown>)=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([close(),new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error('Resource close timed out.')),timeoutMs);})]);evidence[key]=true;}
  catch{evidence.cleanupErrors++;diagnostic('cleanup_failed');}finally{clearTimeout(timer);publish();}
 };
 if(browser)await attempt('browserClosed',()=>browser.close());
 if(driver)await attempt('driverClosed',()=>driver.close());
 if(proxy)await attempt('proxyClosed',()=>new Promise<void>((ok,fail)=>{proxy.closeAllConnections();proxy.close(e=>e?fail(e):ok());}));
 if(evidence.browserClosed&&evidence.driverClosed&&evidence.proxyClosed&&evidence.cleanupErrors===0)diagnostic('closed');
 return evidence.cleanupErrors===0&&evidence.browserClosed&&evidence.driverClosed&&evidence.proxyClosed;
}
export async function openLocalCartBrowser(origin:string,profilePath:string,headless=true,mode:BrowserMode='automation',accessAllowed=()=>true,diagnostic:Diagnostic=()=>{},hooks:BrowserHooks={}){
 const u=new URL(origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.origin!==origin)throw Error('Loopback storefront required.');
 mkdirSync(profilePath,{recursive:true,mode:0o700});if(process.platform!=='win32')chmodSync(profilePath,0o700);
 const network:BrowserEvidence={externalRequests:0,blockedBackgroundRequests:0,checkoutSubmissions:0,blockedTelemetry:0,
  proxyObserved:false,pageIntercepted:false,launchAttempted:false,browserAcquired:false,driverAcquired:false,
  browserClosed:true,driverClosed:true,proxyClosed:true,cleanupErrors:0};
 const publish=()=>hooks.onEvidence?.({...network});publish();
 const observe=(url:string,method:string,pageRequest=false)=>{const u=new URL(url);
   // Page requests are intercepted before the proxy. Chromium's own startup
   // traffic can bypass page interception, but cannot pass the proxy allowlist.
   if(u.origin!==origin){if(pageRequest)network.externalRequests++;else network.blockedBackgroundRequests++;}
   if(u.pathname==='/checkout'&&method==='POST')network.checkoutSubmissions++;
   if(u.origin===origin&&u.pathname==='/v1/traces')network.blockedTelemetry++;publish();};
 let proxy:Awaited<ReturnType<typeof browserProxy>>|undefined,launched:StagehandBrowser|undefined,driver:Browser|undefined;
 try{
      proxy=await (hooks.createProxy??browserProxy)(origin,mode,accessAllowed,observe,diagnostic);
      network.proxyObserved=true;network.proxyClosed=false;publish();diagnostic('proxy_created');
      diagnostic('launch');
      const cdpPort=await new Promise<number>((ok,fail)=>{const probe=createPortProbe();probe.once('error',fail);probe.listen(0,'127.0.0.1',()=>{const a=probe.address();if(!a||typeof a==='string')return fail(Error('No browser control port.'));probe.close(()=>ok(a.port));});});
      network.launchAttempted=true;network.browserClosed=false;publish();
      const launch=hooks.launch??((options:Parameters<typeof localBrowser.launch>[0])=>localBrowser.launch(options));
      const browser=await launch({headless:headless,executablePath:cachedChrome(),userDataDir:profilePath,preserveUserDataDir:true,
        // Chromium replaces duplicate disable-features flags. Preserve the
        // pinned SDK's defaults while also suppressing its background time query.
        port:cdpPort,proxy:{server:proxy.url,bypass:`<-loopback>;127.0.0.1:${cdpPort}`},args:['--disable-background-networking','--disable-component-update','--disable-quic',
          '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,AutofillServerCommunication,PrivacySandboxSettings4,RenderDocument,NetworkTimeServiceQuerying,AimEnabled']});
      launched=browser;network.browserAcquired=true;publish();
      // Keep deterministic form operations in Playwright; Stagehand owns the local browser lifecycle.
      const connect=hooks.connect??((endpoint:string)=>chromium.connectOverCDP(endpoint));
      driver=await connect(`http://127.0.0.1:${cdpPort}`);network.driverAcquired=true;network.driverClosed=false;publish();
      const context=driver.contexts()[0];
      diagnostic('connected');driver.on('disconnected',()=>diagnostic('disconnected'));
      await context.route('**/*',route=>{const u=new URL(route.request().url());observe(u.href,route.request().method(),true);return accessAllowed()&&allowedBrowserRequest(origin,u.href,route.request().method(),mode)?route.continue():route.abort('blockedbyclient');});
      network.pageIntercepted=true;publish();diagnostic('interception_ready');
      const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(10000);
      page.on('close',()=>diagnostic('page_closed'));
      page.on('crash',()=>diagnostic('page_crashed'));
      const isAdd=(r:{url():string;method():string})=>r.url()===origin+'/add'&&r.method()==='POST';
      page.on('request',r=>{if(isAdd(r))diagnostic('add_request');});page.on('response',r=>{if(isAdd(r.request()))diagnostic('add_response',{status:r.status()});});
      page.on('requestfinished',r=>{if(isAdd(r))diagnostic('add_finished');});page.on('requestfailed',r=>{if(isAdd(r))diagnostic('add_failed');});
  return {browser,driver,page,proxy:proxy.server,network,diagnostic,publish,closeTimeoutMs:hooks.closeTimeoutMs};
 }catch(e){await closeResources(launched,driver,proxy?.server,network,diagnostic,publish,hooks.closeTimeoutMs);throw e;}
}
export async function readCart(page:Page,origin:string):Promise<CartEntry[]>{
 await page.goto(origin+'/cart',{waitUntil:'networkidle',timeout:10000});
 if(await page.locator('[data-login]').count())throw Error('LOGIN_REQUIRED');
 return page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('[data-cart-item]')).map(e=>({sku:e.dataset.sku!,unitLabel:e.dataset.pack!,packs:e.dataset.packs!,unitMinor:e.dataset.price!})));
}
export async function readProducts(page:Page):Promise<Product[]>{return page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('[data-product]')).map(e=>({index:Number(e.dataset.product),sku:e.dataset.sku!,unitLabel:e.dataset.pack!,unitMinor:e.dataset.price!,available:e.dataset.stock==='yes',text:e.innerText})));}
export function exactProduct(products:Product[],line:CartLine){
 const matches=products.filter(p=>p.sku===line.sku);if(matches.length!==1)throw Error('CHANGED_PRODUCT');
 const p=matches[0];if(p.unitLabel!==line.unitLabel||p.unitMinor!==line.unitMinor||!p.available)throw Error('CHANGED_PRODUCT');return p.index;
}
export async function closeLocalCartBrowser(s:Awaited<ReturnType<typeof openLocalCartBrowser>>,strict=false){
 const closed=await closeResources(s.browser,s.driver,s.proxy,s.network,s.diagnostic,s.publish,s.closeTimeoutMs);
 if(!closed&&strict)throw Error('Browser resource cleanup failed.');return closed;
}
