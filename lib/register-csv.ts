export function parseRegisterCsv(text:string,knownKeys:Set<string>){
 if(text.length>50000)throw new Error('CSV must be smaller than 50 KB.');
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
 if(c==='"'){if(field||closed)throw new Error('Invalid CSV quoting.');quoted=true;}
 else if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}}
 else{if(closed)throw new Error('Unexpected text after a CSV quote.');field+=c;}}
 if(quoted)throw new Error('Unclosed CSV quote.');row.push(field);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.shift()?.map(v=>v.trim()).join(',')!=='provider,location,item_id,quantity')throw new Error('Use columns: provider,location,item_id,quantity.');
 if(!rows.length||rows.length>20)throw new Error('Use 1–20 sales rows per file.');const quantities:Record<string,number>={};
 for(const [index,r] of rows.entries()){if(r.length!==4)throw new Error('Row '+(index+2)+' must have four columns.');const [provider,location,itemId,amount]=r.map(v=>v.trim()),n=Number(amount),key=JSON.stringify([provider,location,itemId]);if(!amount||!Number.isInteger(n)||n<1||n>10000)throw new Error('Invalid quantity on row '+(index+2)+'.');if(!knownKeys.has(key))throw new Error('Unmapped item on row '+(index+2)+': '+itemId+'. Save its exact provider, location and item ID first.');quantities[key]=(quantities[key]||0)+n;if(quantities[key]>10000)throw new Error('Combined quantity exceeds 10,000.');}
 return quantities;
}
