import {env} from 'cloudflare:workers';
import type {Vendor} from './automation-types';
const encoder=new TextEncoder();
export async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function encryptionKey(){const secret=(env as unknown as {VENDOR_ENCRYPTION_KEY?:string}).VENDOR_ENCRYPTION_KEY;if(!secret)throw new Error('Credential storage is not configured.');return crypto.subtle.importKey('raw',Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function encrypt(token:string,scope:string){if(!token)return '';const iv=crypto.getRandomValues(new Uint8Array(12)),key=await encryptionKey(),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(scope)},key,encoder.encode(token));return btoa(String.fromCharCode(...iv,...new Uint8Array(encrypted)));}
export async function decrypt(value:string,scope:string){if(!value)return '';const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:encoder.encode(scope)},await encryptionKey(),bytes.slice(12)));}
export function publicEndpoint(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||(u.port&&u.port!=='443')||!u.hostname.includes('.')||!/[a-z]/i.test(u.hostname)||u.hostname.includes(':')||u.hostname.endsWith('.')||/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(u.hostname)||/^\d+(\.\d+)*$/.test(u.hostname))throw new Error('Use a public HTTPS connector URL without query parameters, credentials, or a custom port.');return u;}
export async function adapter(vendor:Vendor,token:string,body:Record<string,unknown>){
 const endpoint=publicEndpoint(vendor.endpoint);
 const r=await fetch(endpoint.href,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({protocol:'pantrack.vendor.v1',account:vendor.account,...body}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('The connector returned an error. Check the vendor account and connector service.');
 const text=await r.text();if(text.length>100000)throw new Error('Connector response is too large.');
 return JSON.parse(text) as any;
}
