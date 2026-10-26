import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assertSqliteCheckConstraints} from '../scripts/sqlite-check-constraints.mjs';
const expected={state:{name:'state',value:"value IN ('ready','held')"},body:{name:'body',value:"length(value)>0 AND instr(value,'CHECK(')>=0"}};
function applied(sql,action){const db=new DatabaseSync(':memory:');try{db.exec(sql);action(db.prepare("SELECT sql FROM sqlite_schema WHERE name='sample'").get().sql);}finally{db.close();}}
const valid="CREATE TABLE sample(value TEXT,CONSTRAINT state CHECK(value IN ('ready','held')),CONSTRAINT body CHECK(length(value)>0 AND instr(value,'CHECK(')>=0))";
applied(valid,sql=>assertSqliteCheckConstraints(sql,expected,'sample'));
applied(valid.replace('value IN',"value /* CHECK(ignored) */ in").replace('length(value)>0','LENGTH ( value ) > 0'),sql=>assertSqliteCheckConstraints(sql,expected,'sample'));
for(const invalid of [valid.replace(",CONSTRAINT state CHECK(value IN ('ready','held'))",''),valid.replace("'ready'","'READY'"),
  valid.replace('length(value)>0','length(value)>1'),valid.replace('CREATE TABLE sample(value TEXT,','CREATE TABLE sample(value TEXT CHECK(value IS NOT NULL),')]){
  applied(invalid,sql=>assert.throws(()=>assertSqliteCheckConstraints(sql,expected,'sample'),/Applied CHECK constraints differ/));
}
applied(`CREATE TABLE sample("strange)" TEXT,CONSTRAINT "quoted" CHECK(instr("strange)",'it''s (CHECK)')>=0))`,sql=>
  assertSqliteCheckConstraints(sql,{quoted:{name:'quoted',value:`instr("strange)",'it''s (CHECK)')>=0`}},'sample'));
assert.throws(()=>assertSqliteCheckConstraints('CREATE TABLE sample(x TEXT,CONSTRAINT state CHECK(x>0',expected,'sample'),/Unclosed CHECK expression/);
assertSqliteCheckConstraints('CREATE TABLE legacy(x TEXT CHECK(length(x)>0))',{},'legacy');
console.log('PASS: applied CHECK validation preserves quoted values/nested structure, ignores comments/formatting, and rejects missing, changed, extra or incomplete schema-declared checks.');
