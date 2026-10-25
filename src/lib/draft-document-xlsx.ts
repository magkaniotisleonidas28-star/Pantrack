import {frozenCopy} from './supplier-simulation-contract';

export type DraftXlsxDocument=Readonly<{
  label:string;printLabel:string;creator:string;subject:string;
  columns:readonly (readonly [string,number])[];lines:readonly (readonly string[])[];
  summary:readonly (readonly [string,string])[];
}>;

/** Shared workbook layout and literal-cell escaping; libraries load only on demand. */
export async function serializeDraftDocumentXlsx(value:DraftXlsxDocument):Promise<Uint8Array>{
  const document=frozenCopy(value);
  function literal(value:string):string{
    if(/x005f_/i.test(value))throw new Error('A draft field contains an unsupported Excel escape marker. Use the text or CSV export.');
    for(const character of value){const point=character.codePointAt(0)!;
      if(point>=0xd800&&point<=0xdfff)throw new Error('The draft contains invalid Unicode text. Use the text or CSV export.');}
    const visible=value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\ufffe\uffff]/gu,
      c=>c==='\n'?'\\n':c==='\r'?'\\r':c==='\t'?'\\t':`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
    const encoded=visible.replace(/_x[0-9a-f]{4}_/gi,match=>`_x005F_${match.slice(1)}`);
    if(encoded.length>32767)throw new Error('A draft field exceeds the Excel cell limit. Use the text or CSV export.');
    return encoded;
  }
  // Capture and validate all strings before the first asynchronous library load.
  const lines=document.lines.map(row=>row.map(literal)),summary=document.summary.map(row=>row.map(literal));
  const {default:ExcelJS}=await import('exceljs');
  const workbook=new ExcelJS.Workbook();
  workbook.creator=document.creator;workbook.title=document.label;workbook.subject=document.subject;
  function sheet(name:string,fields:readonly (readonly [string,number])[],rows:string[][]):void{
    const worksheet=workbook.addWorksheet(name,{views:[{state:'frozen',xSplit:name==='Lines'?2:0,ySplit:5}],
      pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0},
      headerFooter:{oddHeader:`&L${document.printLabel}`,oddFooter:'&LEstimates only / no order recorded&RPage &P of &N'}});
    worksheet.columns=fields.map(([,width])=>({width}));
    const span=Math.min(fields.length,6);
    for(const [index,value] of [document.label,'Prices are estimates; supplier details and delivery remain unverified.',
      'Values are text to preserve exact quantities and identifiers. Expand long cells to read every note.'].entries()){
      worksheet.mergeCells(index+1,1,index+1,span);const row=worksheet.getRow(index+1);
      row.getCell(1).value=value;row.getCell(1).font={name:'Calibri',size:index===0?14:11,bold:index===0,color:{argb:'FF244F3B'}};
      row.getCell(1).alignment={vertical:'middle',wrapText:true};row.height=index===0?32:38;
    }
    worksheet.getRow(5).values=fields.map(([title])=>title);worksheet.getRow(5).height=36;
    worksheet.getRow(5).eachCell(cell=>{
      cell.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244F3B'}};cell.alignment={vertical:'middle',wrapText:true};
    });
    rows.forEach((values,index)=>{
      const row=worksheet.addRow(values);row.height=Math.min(120,Math.max(44,...values.map((value,i)=>Math.ceil(value.length/fields[i][1])*16)));
      row.eachCell(cell=>{
        cell.numFmt='@';cell.font={name:'Calibri',size:11,color:{argb:'FF20372D'}};cell.alignment={vertical:'top',wrapText:true};
        if(index%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF4F6F1'}};
      });
    });
    if(name==='Lines')worksheet.autoFilter=`A5:${worksheet.getCell(worksheet.rowCount,fields.length).address}`;
  }
  sheet('Draft',[['Field',26],['Value',100]],summary);sheet('Lines',document.columns,lines);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
