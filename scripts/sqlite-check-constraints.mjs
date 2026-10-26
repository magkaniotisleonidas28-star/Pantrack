import assert from 'node:assert/strict';

// SQLite exposes table DDL, rather than CHECK expressions through a pragma.
// Tokenize it without treating quoted text/comments as SQL structure. Comparing
// tokens preserves string contents while ignoring formatting and keyword case.
function tokens(sql){
  const result=[];
  for(let i=0;i<sql.length;){
    if(/\s/.test(sql[i])){i++;continue;}
    if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
    if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);assert.ok(end>=0,'Unclosed SQL comment');i=end+2;continue;}
    const start=i,quote=sql[i];
    if(['\'', '"','`','['].includes(quote)){
      const end=quote==='['?']':quote;i++;let closed=false;
      while(i<sql.length){if(sql[i]===end){if(sql[i+1]===end){i+=2;continue;}i++;closed=true;break;}i++;}
      assert.ok(closed,'Unclosed SQL quotation');const raw=sql.slice(start,i);
      result.push({kind:'quoted',raw,value:raw.slice(1,-1).split(end+end).join(end)});continue;
    }
    if(/[a-zA-Z_]/.test(sql[i])){i++;while(i<sql.length&&/[a-zA-Z0-9_$]/.test(sql[i]))i++;
      const raw=sql.slice(start,i);result.push({kind:'word',raw:raw.toLowerCase(),value:raw});continue;}
    result.push({kind:'symbol',raw:sql[i],value:sql[i]});i++;
  }
  return result;
}
function checks(sql){
  const input=tokens(sql),result=[];
  for(let i=0;i<input.length;i++){
    if(input[i].kind!=='word'||input[i].raw!=='check')continue;
    assert.equal(input[i+1]?.raw,'(','CHECK expression requires parentheses');
    const name=input[i-2]?.kind==='word'&&input[i-2].raw==='constraint'?input[i-1].value:null;
    const expression=[];let depth=1;i+=2;
    for(;i<input.length;i++){
      const item=input[i];if(item.kind==='symbol'){if(item.raw==='(')depth++;if(item.raw===')')depth--;}
      if(depth===0)break;expression.push(item.raw);
    }
    assert.equal(depth,0,'Unclosed CHECK expression');result.push({name,expression});
  }
  return result;
}
export function assertSqliteCheckConstraints(sql,definitions,tableName){
  const expected=Object.values(definitions??{});
  // Existing hand-authored legacy constraints are not declared in Drizzle.
  // For tables which declare checks, require the complete applied set exactly.
  if(!expected.length)return;
  assert.equal(typeof sql,'string',`Missing table DDL for ${tableName}.`);
  const sort=list=>list.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(sort(checks(sql)),sort(expected.map(({name,value})=>({name,expression:tokens(value).map(t=>t.raw)}))),
    `Applied CHECK constraints differ for ${tableName}.`);
}
