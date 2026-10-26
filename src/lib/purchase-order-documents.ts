import {capturePurchaseOrderExport} from './purchase-order-export-contract';
import {draftEstimateDisplay,draftStockDisplay} from './supplier-order-draft';
import type {DraftPdfDocument} from './draft-document-pdf';
import type {DraftXlsxDocument} from './draft-document-xlsx';

const estimate=(minor:string|null|undefined)=>minor===undefined?'Not saved':draftEstimateDisplay(minor===null?null:{currency:'USD',minor});
const notStock='Not applicable (non-stock item)';

/** A document projection of an already authorized saved response, with no source reads. */
function documents(value:unknown):{pdf:DraftPdfDocument;xlsx:DraftXlsxDocument}{
  const saved=capturePurchaseOrderExport(value),d=saved.draft,s=d.supplier,reference=saved.supplierReference;
  const quantityMeaning='Requested draft quantities only; supplier-observed, confirmed and received quantities are not recorded by this export.';
  const summary:[string,string][]=[
    ['Company',d.companyId],['PO number',d.number],['PO ID',d.id],['Saved revision',String(saved.revision)],
    ['Status',`${saved.status} (not purchase approval)`],['Saved at',d.createdAt],['Source',d.source],
    ['Source contract',d.contract],['Export contract',saved.contract],['Supplier',s.name],['Supplier ID',s.id],
    ['Supplier email',s.email??'Unavailable'],['Account reference',s.accountId],['Location reference',s.locationId],
    ['Delivery address',s.deliveryAddress],['Spending cap',estimate(d.capMinor).replace(' (estimate)','')],['Cap minor units',d.capMinor],
    ['Known subtotal',estimate(d.knownSubtotalMinor)],['Known subtotal minor units',d.knownSubtotalMinor],
    ['Price completeness',d.pricesComplete?'All line estimates saved':'Incomplete — unavailable estimates excluded'],
    ['Notes',d.notes||'None'],['Quantity meaning',quantityMeaning],
    ...(reference?[
      ['Saved supplier version',String(reference.version)],['Stable account ID',reference.accountId],['Stable location ID',reference.locationId],
    ] as [string,string][]:[]),
    ...(saved.review?[
      ['Reviewed content revision',String(saved.review.contentRevision)],['Reviewer',saved.review.actor],['Reviewed at',saved.review.at],
    ] as [string,string][]:[]),
    ...d.warnings.map((text):[string,string]=>['Saved warning',text]),
    ...saved.limitations.map((text):[string,string]=>['Export limitation',text]),
    ['Spreadsheet editing','Editing this file does not update Pantrack. Expand long cells to read every note.'],
  ];
  const columns:[string,number][]=[
    ['Line ID',36],['Kind',18],['Product',28],['Description',40],['Supplier SKU',28],['Purchase unit',22],['Whole packs',16],
    ['Per pack',24],['Stock quantity',28],['Stock dimension',18],['Exact minor units per pack',38],['Exact minor units total',44],
    ['Estimated unit price',28],['Estimated unit minor units',32],['Estimated line price',28],['Estimated line minor units',34],['Currency',14],
    ['Config ID',32],['Config version',18],['Mapping ID',32],['Mapping version',18],
    ['Proposal',36],['Proposal revision',18],['Proposal status',22],['Proposal contract',40],['Proposal warnings',48],['Review reasons',48],['Edit reason',40],
    ['Company',28],['PO number',26],['PO ID',36],['Saved revision',18],['Draft status',18],['Supplier',32],['Supplier ID',32],
    ['Account reference',28],['Location reference',28],['Draft label',48],['Draft warnings',64],['Export limitations',80],
  ];
  const lines=d.lines.map(line=>{
    const p=line.proposal;
    return [line.id,line.kind,line.productId??'Not applicable',line.description,line.sku,line.unitLabel,line.packs,
      line.stockUnitsPerPack?draftStockDisplay(line.stockUnitsPerPack):notStock,
      line.stockQuantity?draftStockDisplay(line.stockQuantity):notStock,
      line.stockQuantity?.dimension??'Not applicable',line.stockUnitsPerPack?.minor??'Not applicable',line.stockQuantity?.minor??'Not applicable',
      estimate(line.estimatedUnitMinor),line.estimatedUnitMinor===undefined?'Not saved':line.estimatedUnitMinor??'Unavailable',
      estimate(line.estimatedLineMinor),line.estimatedLineMinor??'Unavailable',d.currency,
      line.configId??'Not applicable',line.configVersion===null?'Not applicable':String(line.configVersion),
      line.mappingId??'Not applicable',line.mappingVersion===undefined?'Not applicable':String(line.mappingVersion),
      p?.proposalId??'Not applicable',p?String(p.revision):'Not applicable',p?.status??'Not applicable',p?.contract??'Not applicable',
      JSON.stringify(p?.warnings??[]),JSON.stringify(p?.reviewReasons??[]),p?.editReason??'None',
      d.companyId,d.number,d.id,String(saved.revision),saved.status,s.name,s.id,s.accountId,s.locationId,saved.label,
      JSON.stringify(d.warnings),JSON.stringify(saved.limitations)];
  });
  const context=summary.filter(([field])=>!['Saved warning','Export limitation','Spreadsheet editing'].includes(field))
    .map(([field,text])=>`${field}: ${text}`);
  return {
    pdf:{label:saved.label,title:'Purchase-order draft',pageReference:`PO ${d.number} | revision ${saved.revision} | ${saved.status}`,
      subject:'Saved purchase-order revision; estimates only. No order or inventory change.',creator:'Pantrack',context,
      items:d.lines.map((line,index)=>({title:`Item ${index+1}: ${line.description}`,rows:[
        {text:`Line: ${line.id} | ${line.kind} | product: ${line.productId??'Not applicable'}`,size:9,tone:'muted'},
        {text:`Supplier SKU: ${line.sku}`},{text:`Requested quantity: ${line.packs} whole packs | purchase unit: ${line.unitLabel}`},
        {text:`Per pack: ${line.stockUnitsPerPack?draftStockDisplay(line.stockUnitsPerPack):notStock}`},
        {text:`Stock quantity: ${line.stockQuantity?draftStockDisplay(line.stockQuantity):notStock}`},
        ...(line.stockQuantity?[{text:`Exact ${line.stockQuantity.dimension} minor units: ${line.stockUnitsPerPack!.minor} per pack; ${line.stockQuantity.minor} total`,size:9,tone:'muted' as const}]:[]),
        {text:`Estimated unit price: ${estimate(line.estimatedUnitMinor)}`},{text:`Estimated line price: ${estimate(line.estimatedLineMinor)}`},
        {text:`Saved config: ${line.configId??'Not applicable'} | version: ${line.configVersion??'Not applicable'}`,size:9,tone:'muted'},
        {text:`Saved mapping: ${line.mappingId??'Not applicable'} | version: ${line.mappingVersion??'Not applicable'}`,size:9,tone:'muted'},
        ...(line.proposal?[
          {text:`Proposal: ${line.proposal.proposalId} | revision ${line.proposal.revision}`,size:9,tone:'muted' as const},
          {text:`Source contract: ${line.proposal.contract} | status: ${line.proposal.status}`,size:9,tone:'muted' as const},
          {text:`Warnings: ${JSON.stringify(line.proposal.warnings)}`,size:9,tone:'warning' as const},
          {text:`Review reasons: ${JSON.stringify(line.proposal.reviewReasons)}`,size:9,tone:'warning' as const},
          {text:`Edit reason: ${line.proposal.editReason??'None'}`,size:9,tone:'muted' as const},
        ]:[]),
      ]})),warnings:[...d.warnings,...saved.limitations],closing:'Exporting records no order or inventory change.'},
    xlsx:{label:saved.label,printLabel:'Draft - no order placed.',creator:'Pantrack',
      subject:'Saved purchase-order revision; estimates only. No order or inventory change.',columns,lines,summary},
  };
}

export async function serializePurchaseOrderPdf(value:unknown,fontBytes:Uint8Array):Promise<Uint8Array>{
  const document=documents(value).pdf,fontCopy=new Uint8Array(fontBytes);
  const {serializeDraftDocumentPdf}=await import('./draft-document-pdf');
  return serializeDraftDocumentPdf(document,fontCopy);
}

export async function serializePurchaseOrderXlsx(value:unknown):Promise<Uint8Array>{
  const document=documents(value).xlsx;
  const {serializeDraftDocumentXlsx}=await import('./draft-document-xlsx');
  return serializeDraftDocumentXlsx(document);
}
