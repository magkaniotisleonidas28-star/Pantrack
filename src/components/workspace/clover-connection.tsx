'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogContent,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';

type Item={id:string;name:string};
type Status={ready:boolean;environment:string;connected:boolean;merchantId?:string;lastChecked?:string;syncEnabled:boolean;sync?:{startedAt:string;checkpoint:string;lastAttempt:string|null;lastSuccess:string|null;lastError:string|null;heldCount:number;lagMs:number};itemMappings:Array<{item_id:string;recipe_id:string}>;modifierMappings:Array<{item_id:string;modifier_id:string;inventory_modifier_id:string}>;recipes:Array<{recipe_id:string;name:string}>;recipeModifiers:Array<{recipe_id:string;modifier_id:string;name:string}>};
const failureMessages:Record<string,string>={
 oauth_state:'The Clover sign-in did not match this browser session. Start Connect Clover again in the same browser window.',
 session:'Your Pantrack session ended. Sign in and start Connect Clover again.',
 state_lookup:'Pantrack could not check the Clover sign-in attempt. Try again shortly.',
 state_expired:'This Clover sign-in attempt expired or was already used. Start Connect Clover again.',
 access:'Clover setup or company owner access changed. Check setup, then reconnect.',
 provider_denied:'Clover authorization was canceled. Start Connect Clover again when ready.',
 callback:'Clover did not return the expected authorization details. Check the sandbox app OAuth settings.',
 token_rejected:'Clover rejected the code or sandbox app credentials. Check the app secret in Cloudflare, then reconnect.',
 token_unavailable:'Pantrack could not reach Clover to exchange the code. Try again shortly.',
 token_response:'Clover returned an unexpected token response. Check the sandbox app OAuth settings.',
 merchant_rejected:'Clover denied access to this merchant. Check the app installation and Merchant READ permission.',
 merchant_unavailable:'Pantrack could not verify the Clover merchant. Try again shortly.',
 merchant_response:'Clover returned unexpected merchant details. Check the sandbox merchant and app.',
 merchant_mismatch:'Clover returned a different merchant. Check the selected sandbox merchant.',
 save:'Pantrack could not save the Clover connection. Try Connect Clover again.',
};

export default function CloverConnection({companyId,onMap}:{companyId:string;onMap:(item:Item,merchantId:string)=>void}){
 const [status,setStatus]=useState<Status|null>(null),[items,setItems]=useState<Item[]>([]),[modifiers,setModifiers]=useState<Item[]>([]),[itemOffset,setItemOffset]=useState<number|null>(0),[modifierOffset,setModifierOffset]=useState<number|null>(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(false),[selectedItem,setSelectedItem]=useState(''),[selectedModifier,setSelectedModifier]=useState(''),[selectedRecipe,setSelectedRecipe]=useState(''),[selectedRecipeModifier,setSelectedRecipeModifier]=useState('');
 async function refresh(){const r=await fetch('/api/clover?companyId='+encodeURIComponent(companyId));const d=await r.json() as Status&{error?:string};if(!r.ok)throw new Error(d.error||'Could not load Clover.');setStatus(d);}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const params=new URLSearchParams(location.search),returnedCompany=params.get('company');if(returnedCompany&&returnedCompany!==companyId)return;if(params.get('clover')==='failed'){const reason=params.get('reason')||'';setError((failureMessages[reason]||'Clover authorization could not be completed. Start Connect Clover again.')+(reason?' ('+reason+')':''));}else if(params.get('clover')==='connected')setNotice('Clover connected.');},[companyId]);
 async function action(action:string,extra:Record<string,unknown>={}){if(busy)return;setBusy(true);setError('');setNotice('');try{
  const r=await fetch('/api/clover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,action,...extra})});const d=await r.json() as {error?:string;url?:string;items?:Item[];nextOffset?:number|null;created?:number;held?:number};if(!r.ok)throw new Error(d.error||'Clover request failed.');
  if(d.url){window.location.assign(d.url);return;}
  if(action==='menu'){setItems(old=>[...new Map([...old,...(d.items||[])].map(i=>[i.id,i])).values()]);setItemOffset(d.nextOffset??null);}
  if(action==='modifiers'){setModifiers(old=>[...new Map([...old,...(d.items||[])].map(i=>[i.id,i])).values()]);setModifierOffset(d.nextOffset??null);}
  if(action==='disconnect'){setItems([]);setModifiers([]);setItemOffset(0);setModifierOffset(0);setConfirm(false);}
  if(action==='sync')setNotice(`Sync finished: ${d.created??0} new events, ${d.held??0} held for review.`);
  if(action==='mapItem'||action==='mapModifier')setNotice('Clover mapping saved. Past sales and inventory records were not changed.');
  await refresh();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const mappedRecipe=status?.itemMappings.find(row=>row.item_id===selectedItem)?.recipe_id;
 const modifierChoices=status?.recipeModifiers.filter(row=>row.recipe_id===mappedRecipe)||[];
 return <section className="catalog-card" style={{margin:'24px 0'}}><div className="between"><h2>Clover register connection</h2><span className="sample-tag">{status?(status.connected?'Authorized · '+status.environment:status.ready?'Ready to connect · '+status.environment:'Developer setup required'):'Loading connection…'}</span></div>
 <p>Authorize access on Clover’s website. Sales sync stays off until the server enables its separate development gate. Connect and map with fictional sandbox data only.</p>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
 {status&&!status.ready&&<div className="payment-callout"><strong>One-time setup for the Pantrack app owner</strong><p>Register Pantrack as a Clover web app, configure its callback URL and read permissions, and add its app ID and secret to the server. Start with a Clover sandbox account.</p><a href="/clover-setup-guide.md" target="_blank" rel="noreferrer">Open Clover setup instructions</a></div>}
 {status?.connected&&<p>Merchant ID: <strong>{status.merchantId}</strong><br/>Last successful contact: {status.lastChecked?new Date(status.lastChecked).toLocaleString():'Not checked'}</p>}
 <div className="inventory-actions"><Button disabled={busy||!status?.ready} onClick={()=>void action('connect')}>{status?.connected?'Reconnect Clover':'Connect Clover'}</Button>{status?.connected&&<><Button variant="outline" disabled={busy||itemOffset===null} onClick={()=>void action('menu',{offset:itemOffset||0})}>{items.length?'Load more menu items':'Load Clover menu'}</Button><Button variant="outline" disabled={busy||modifierOffset===null} onClick={()=>void action('modifiers',{offset:modifierOffset||0})}>{modifiers.length?'Load more modifiers':'Load Clover modifiers'}</Button><Button variant="outline" disabled={busy} onClick={()=>setConfirm(true)}>Disconnect</Button></>}</div>
 {status?.connected&&<section style={{marginTop:20}}><h3>Sales sync</h3><p>{status.syncEnabled?'Development sync gate enabled':'Sales sync disabled on this server'}. Initial sync starts at connection time; older orders are excluded.</p>{status.sync?<p>Last attempt: {status.sync.lastAttempt||'None'} · Last success: {status.sync.lastSuccess||'None'}<br/>Checkpoint: {status.sync.checkpoint} · Held events: {status.sync.heldCount}<br/>Lag: {Math.round(status.sync.lagMs/60000)} minutes{status.sync.lastError&&<> · Error: {status.sync.lastError}</>}</p>:<p>Reconnect Clover to establish a sales-sync starting point.</p>}<Button variant="outline" disabled={busy||!status.syncEnabled||!status.sync} onClick={()=>void action('sync')}>Sync now</Button></section>}
 {status?.connected&&items.length>0&&<section style={{marginTop:20}}><h3>Map Clover items</h3><p>Choose an active exact recipe for each Clover item or variation. An unmapped item holds its whole order.</p><label>Clover item<select value={selectedItem} onChange={e=>{setSelectedItem(e.target.value);setSelectedRecipe('');setSelectedRecipeModifier('');}}><option value="">Choose item</option>{items.map(item=><option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label><label>Pantrack recipe<select value={selectedRecipe} onChange={e=>setSelectedRecipe(e.target.value)}><option value="">Choose recipe</option>{status.recipes.map(recipe=><option key={recipe.recipe_id} value={recipe.recipe_id}>{recipe.name}</option>)}</select></label><div className="inventory-actions"><Button disabled={busy||!selectedItem||!selectedRecipe} onClick={()=>void action('mapItem',{itemId:selectedItem,recipeId:selectedRecipe})}>Save native item mapping</Button>{selectedItem&&<Button variant="outline" onClick={()=>onMap(items.find(item=>item.id===selectedItem)!,status.merchantId!)}>Add CSV mapping</Button>}</div>{mappedRecipe&&<p>Current native recipe: {status.recipes.find(recipe=>recipe.recipe_id===mappedRecipe)?.name||mappedRecipe}</p>}</section>}
 {status?.connected&&selectedItem&&mappedRecipe&&modifiers.length>0&&<section style={{marginTop:20}}><h3>Map Clover modifiers</h3><label>Clover modifier<select value={selectedModifier} onChange={e=>setSelectedModifier(e.target.value)}><option value="">Choose modifier</option>{modifiers.map(modifier=><option key={modifier.id} value={modifier.id}>{modifier.name} · {modifier.id}</option>)}</select></label><label>Pantrack recipe modifier<select value={selectedRecipeModifier} onChange={e=>setSelectedRecipeModifier(e.target.value)}><option value="">Choose modifier</option>{modifierChoices.map(modifier=><option key={modifier.modifier_id} value={modifier.modifier_id}>{modifier.name}</option>)}</select></label><Button disabled={busy||!selectedModifier||!selectedRecipeModifier} onClick={()=>void action('mapModifier',{itemId:selectedItem,modifierId:selectedModifier,inventoryModifierId:selectedRecipeModifier})}>Save modifier mapping</Button></section>}
 <AlertDialog open={confirm} onOpenChange={v=>!busy&&setConfirm(v)}><AlertDialogContent><AlertDialogTitle>Disconnect Clover?</AlertDialogTitle><AlertDialogDescription>Pantrack will delete the stored Clover tokens and stop sync. Your mappings and historical inventory remain. To revoke Clover-side access, also remove the app from Clover.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button disabled={busy} onClick={()=>void action('disconnect')}>Disconnect</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </section>;
}
