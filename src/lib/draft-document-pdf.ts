import {PDFDocument, PageSizes, rgb, type PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {frozenCopy} from './supplier-simulation-contract';

type DraftPdfRow=Readonly<{text:string;size?:number;tone?:'muted'|'warning'}>;
export type DraftPdfDocument = Readonly<{
  label:string; title:string; subject:string; creator:string; pageReference?:string;
  context:readonly string[];
  items:readonly Readonly<{title:string;rows:readonly DraftPdfRow[]}>[];
  warnings:readonly string[]; closing:string;
}>;

/** Shared layout for the existing fictional preview and captured saved-draft documents. */
export async function serializeDraftDocumentPdf(value:DraftPdfDocument,fontBytes:Uint8Array):Promise<Uint8Array>{
  const document=frozenCopy(value),fontCopy=new Uint8Array(fontBytes);
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(fontCopy,{subset:true});
  const characters=new Set(font.getCharacterSet());
  const ink=rgb(0.12,0.22,0.17),muted=rgb(0.29,0.36,0.32),warning=rgb(0.48,0.22,0.08);
  const [width,height]=PageSizes.Letter,margin=48,available=width-margin*2;
  let page:PDFPage,y=0,continuation:string|null=null;
  pdf.setTitle(document.label);pdf.setSubject(document.subject);pdf.setCreator(document.creator);pdf.setLanguage('en');
  function newPage():void{
    if(pdf.getPageCount()>=500)throw new Error('The draft exceeds the PDF page limit.');
    page=pdf.addPage(PageSizes.Letter);
    page.drawText('PANTRACK / DRAFT REVIEW',{x:margin,y:height-48,size:10,font,color:muted});
    page.drawText(document.title,{x:margin,y:height-75,size:20,font,color:ink});
    page.drawText(document.label,{x:margin,y:height-96,size:11,font,color:warning});
    page.drawLine({start:{x:margin,y:height-108},end:{x:width-margin,y:height-108},thickness:0.7,color:rgb(0.76,0.81,0.77)});
    y=height-130;
    if(document.pageReference)for(const line of wrap(document.pageReference,9)){
      page.drawText(line,{x:margin,y,size:9,font,color:muted});y-=13;
    }
  }
  function visible(value:string):string{
    return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu,
      c=>c==='\n'?'\\n':c==='\r'?'\\r':c==='\t'?'\\t':`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
  }
  function wrap(value:string,size:number):string[]{
    const result:string[]=[];let line='';
    for(const c of visible(value)){
      if(!characters.has(c.codePointAt(0)!))throw new Error('This draft contains characters the PDF font cannot display. Use the text or CSV export.');
      if(font.widthOfTextAtSize(line+c,size)>available){
        const space=line.lastIndexOf(' ');
        if(space>0){result.push(line.slice(0,space));line=line.slice(space+1);}
        else{result.push(line);line='';}
      }
      line+=c;
    }
    result.push(line);return result;
  }
  function paragraph(value:string,size=10,color=ink):void{
    for(const line of wrap(value,size)){
      if(y<78){newPage();if(continuation){page.drawText(continuation,{x:margin,y,size:10,font,color:muted});y-=20;}}
      page.drawText(line,{x:margin,y,size,font,color});y-=size+4;
    }
  }
  function heading(value:string):void{if(y<135)newPage();else y-=10;paragraph(value,12);y-=4;}
  newPage();document.context.forEach(value=>paragraph(value));
  for(const [index,item] of document.items.entries()){
    const blockHeight=14+wrap(item.title,12).length*16+item.rows.reduce((sum,row)=>sum+wrap(row.text,row.size??10).length*((row.size??10)+4),0);
    if(blockHeight<=height-208&&y-blockHeight<78)newPage();
    continuation=`Item ${index+1} (continued)`;heading(item.title);
    item.rows.forEach(row=>paragraph(row.text,row.size??10,row.tone==='warning'?warning:row.tone==='muted'?muted:ink));
  }
  continuation=null;heading('Review before any separate ordering');
  document.warnings.forEach(value=>paragraph(value,10,warning));paragraph(document.closing,10,warning);
  const pages=pdf.getPages();
  for(const [index,item] of pages.entries()){
    item.drawText('Estimates only / no order recorded',{x:margin,y:43,size:9,font,color:muted});
    const number=`Page ${index+1} of ${pages.length}`;
    item.drawText(number,{x:width-margin-font.widthOfTextAtSize(number,9),y:43,size:9,font,color:muted});
  }
  return pdf.save();
}
