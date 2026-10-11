import {localBrowser,type StagehandBrowser} from '@browserbasehq/stagehand';
import {chromium,type Page} from 'playwright-core';
import {createServer,request as httpRequest} from 'node:http';
import {createServer as createPortProbe} from 'node:net';
import {resolve} from 'node:path';
import {existsSync,readdirSync,mkdirSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import type {CartEntry,CartLine} from '../../src/lib/cart-preview-contract';
import type {Product} from './model';
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
export async function browserProxy(origin:string,mode:BrowserMode='automation',accessAllowed=()=>true){
  const server=createServer((req,res)=>{
    let u:URL;try{u=new URL(req.url??'');}catch{res.writeHead(403);res.end();return;}
    if(!accessAllowed()||!allowedBrowserRequest(origin,u.href,req.method??'',mode)){res.writeHead(403);res.end('Blocked outside fictional storefront.');return;}
    const outgoing=httpRequest(u,{method:req.method,headers:{...req.headers,host:u.host}},r=>{if(r.headers.location){const target=new URL(r.headers.location,u);if(!allowedBrowserRequest(origin,target.href,'GET',mode)){r.resume();res.writeHead(403);res.end();return;}}res.writeHead(r.statusCode??502,r.headers);r.on('aborted',()=>res.destroy());r.on('error',()=>res.destroy());r.pipe(res);});
    outgoing.on('error',()=>{res.destroy();});req.pipe(outgoing);
  });
  server.on('connect',(_req,socket)=>{socket.on('error',()=>socket.destroy());socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const address=server.address();if(!address||typeof address==='string')throw Error('Proxy failed.');
  return {server,url:`http://127.0.0.1:${address.port}`};
}
export async function openLocalCartBrowser(origin:string,profilePath:string,headless=true,mode:BrowserMode='automation',accessAllowed=()=>true){
 const u=new URL(origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.origin!==origin)throw Error('Loopback storefront required.');
 mkdirSync(profilePath,{recursive:true,mode:0o700});if(process.platform!=='win32')chmodSync(profilePath,0o700);
 const proxy=await browserProxy(origin,mode,accessAllowed);let launched:StagehandBrowser|undefined;
 try{
      const cdpPort=await new Promise<number>((ok,fail)=>{const probe=createPortProbe();probe.once('error',fail);probe.listen(0,'127.0.0.1',()=>{const a=probe.address();if(!a||typeof a==='string')return fail(Error('No browser control port.'));probe.close(()=>ok(a.port));});});
      const browser=await localBrowser.launch({headless:headless,executablePath:cachedChrome(),userDataDir:profilePath,preserveUserDataDir:true,
        port:cdpPort,proxy:{server:proxy.url,bypass:`<-loopback>;127.0.0.1:${cdpPort}`},args:['--disable-background-networking','--disable-component-update','--disable-quic']});
      launched=browser;
      // Keep deterministic form operations in Playwright; Stagehand owns the local browser lifecycle.
      const driver=await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`),context=driver.contexts()[0];
      await context.route('**/*',route=>{const u=new URL(route.request().url());return accessAllowed()&&allowedBrowserRequest(origin,u.href,route.request().method(),mode)?route.continue():route.abort('blockedbyclient');});
      const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(10000);
  return {browser,driver,page,proxy:proxy.server};
 }catch(e){await launched?.close().catch(()=>{});proxy.server.close();throw e;}
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
 try{await s.browser.close();}catch(e){if(strict)throw e;}finally{await s.driver.close().catch(()=>{});s.proxy.closeAllConnections();s.proxy.close();}
}
