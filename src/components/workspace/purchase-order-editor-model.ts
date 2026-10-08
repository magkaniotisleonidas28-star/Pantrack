import type {PurchaseOrderSnapshot,PurchaseOrderView} from '@/lib/purchase-order-contract';

export type EditorLine={key:string;kind:'stock'|'non_stock';productId:string;sku:string;description:string;unitLabel:string;
  packs:string;estimate:string;configId?:string;configVersion?:number;mappingId?:string;mappingVersion?:number};
export type DraftEditor={source:'manual'|'proposals'|'registry';supplierId:string;supplierVersion?:number;accountId:string;locationId:string;
  name:string;email:string;address:string;cap:string;notes:string;lines:EditorLine[];proposalIds:string[]};
export const newLine=():EditorLine=>({key:crypto.randomUUID(),kind:'non_stock',productId:'',sku:'',description:'',unitLabel:'case',packs:'1',estimate:''});
export const emptyEditor=():DraftEditor=>({source:'registry',supplierId:'',accountId:'',locationId:'',name:'',email:'',address:'',cap:'',notes:'',lines:[],proposalIds:[]});
export function dollars(minor:string){const n=minor.padStart(3,'0');return `${n.slice(0,-2)}.${n.slice(-2)}`;}
export function cents(value:string){
  if(!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim()))throw Error('Enter a USD amount with at most two decimal places.');
  const [d,f='']=value.trim().split('.');return (BigInt(d)*BigInt(100)+BigInt(f.padEnd(2,'0'))).toString();
}
export function editorFrom(snapshot:PurchaseOrderSnapshot):DraftEditor {
  const saved=snapshot.registry,group=saved?.group??saved?.mappings[0];
  const accounts=saved?.profile.profile.accounts.filter(a=>a.reference===snapshot.supplier.accountId)??[];
  const accountId=group?.accountId??(accounts.length===1?accounts[0].id:'');
  const locations=saved?.profile.profile.locations.filter(l=>l.accountId===accountId&&l.reference===snapshot.supplier.locationId)??[];
  return {source:snapshot.source,supplierId:snapshot.supplier.id,supplierVersion:saved?.profile.version,
    accountId:saved?accountId:snapshot.supplier.accountId,locationId:saved?(group?.locationId??(locations.length===1?locations[0].id:'')):snapshot.supplier.locationId,
    name:snapshot.supplier.name,email:snapshot.supplier.email??'',address:snapshot.supplier.deliveryAddress,
    cap:dollars(snapshot.capMinor),notes:snapshot.notes,proposalIds:snapshot.lines.flatMap(l=>l.proposal?[l.proposal.proposalId]:[]),
    lines:snapshot.lines.map(l=>({key:l.id,kind:l.kind,productId:l.productId??'',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:l.packs,
      estimate:l.estimatedLineMinor===null?'':dollars(l.estimatedUnitMinor??(BigInt(l.estimatedLineMinor)/BigInt(l.packs)).toString()),
      configId:l.configId??undefined,configVersion:l.configVersion??undefined,mappingId:l.mappingId,mappingVersion:l.mappingVersion}))};
}
export function statusLabel(status:PurchaseOrderView['status']){
  return status==='reviewed'?'Reviewed — not approved or sent':status==='canceled'?'Canceled — not sent':'Draft — needs review';
}
/** Readable differences keyed by business identity, not positional line numbers. */
export function snapshotChanges(before:PurchaseOrderSnapshot,after:PurchaseOrderSnapshot):string[]{
  const result:string[]=[];
  const value=(v:unknown)=>v===null?'Unavailable':String(v||'Empty');
  for(const [label,a,b] of [['Supplier name',before.supplier.name,after.supplier.name],['Ordering email',before.supplier.email,after.supplier.email],
    ['Delivery address',before.supplier.deliveryAddress,after.supplier.deliveryAddress],['Proposed cap',`$${dollars(before.capMinor)}`,`$${dollars(after.capMinor)}`],['Notes',before.notes,after.notes]] as const)
    if(a!==b)result.push(`${label}: ${value(a)} → ${value(b)}`);
  const key=(l:PurchaseOrderSnapshot['lines'][number])=>l.productId?`stock:${l.productId}`:`non-stock:${l.sku}`;
  for(const l of before.lines){
    const next=after.lines.find(n=>key(n)===key(l));
    if(!next){result.push(`Removed ${l.description} (${l.sku})`);continue;}
    for(const [label,a,b] of [['Packs',l.packs,next.packs],['Description',l.description,next.description],['SKU',l.sku,next.sku],
      ['Order unit',l.unitLabel,next.unitLabel],['Pack quantity',l.stockUnitsPerPack?.minor??null,next.stockUnitsPerPack?.minor??null],
      ['Mapping version',l.mappingVersion??null,next.mappingVersion??null],['Pack configuration',l.configId,next.configId],
      ['Pack configuration version',l.configVersion,next.configVersion],
      ['Estimated line total',l.estimatedLineMinor===null?null:`$${dollars(l.estimatedLineMinor)}`,next.estimatedLineMinor===null?null:`$${dollars(next.estimatedLineMinor)}`]] as const)
      if(a!==b)result.push(`${l.description} — ${label}: ${value(a)} → ${value(b)}`);
  }
  for(const l of after.lines)if(!before.lines.some(b=>key(b)===key(l)))result.push(`Added ${l.description} (${l.sku}), ${l.packs} ${l.unitLabel}`);
  return result;
}
