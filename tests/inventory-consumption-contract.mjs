import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({
  entryPoints:['src/lib/inventory-consumption-fake.ts'],
  bundle:true,
  platform:'node',
  format:'esm',
  outfile:'.sites-runtime/inventory-consumption-contract.mjs',
});

const {FakeInventoryConsumptionPort}=await import('../.sites-runtime/inventory-consumption-contract.mjs');
const contract='pantrack.inventory-consumption.v1';
const count=minor=>({dimension:'count',minor:String(minor)});
const mass=minor=>({dimension:'mass',minor:String(minor)});
const volume=minor=>({dimension:'volume',minor:String(minor)});
const cutoff='2026-01-01T00:00:00Z';

function fixture(){
 return {
  now:'2026-03-01T00:00:00Z',
  balances:[
   {companyId:'company-a',productId:'milk',dimension:'volume',onHandMinor:'200000000',version:4,classified:true,openingCountAt:cutoff},
   {companyId:'company-a',productId:'oat',dimension:'volume',onHandMinor:'200000000',version:2,classified:true,openingCountAt:cutoff},
   {companyId:'company-a',productId:'coffee',dimension:'mass',onHandMinor:'100000000',version:3,classified:true,openingCountAt:cutoff},
   {companyId:'company-a',productId:'cup',dimension:'count',onHandMinor:'100',version:8,classified:true,openingCountAt:cutoff},
   {companyId:'company-a',productId:'legacy-syrup',dimension:'volume',onHandMinor:'50000000',version:1,classified:false,openingCountAt:cutoff},
   {companyId:'company-a',productId:'uncounted',dimension:'volume',onHandMinor:'50000000',version:1,classified:true,openingCountAt:null},
  ],
  recipes:[
   {companyId:'company-a',recipeId:'latte',versionId:'latte-v1',status:'archived',activeFrom:'2026-01-01T00:00:00Z',activeTo:'2026-02-01T00:00:00Z',ingredients:[{productId:'milk',quantity:volume(10000000)},{productId:'cup',quantity:count(1)}]},
   {companyId:'company-a',recipeId:'latte',versionId:'latte-v2',status:'active',activeFrom:'2026-02-01T00:00:00Z',activeTo:null,ingredients:[{productId:'milk',quantity:volume(12000000)},{productId:'cup',quantity:count(1)}]},
   {companyId:'company-a',recipeId:'legacy-drink',versionId:'legacy-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'legacy-syrup',quantity:volume(1000000)}]},
   {companyId:'company-a',recipeId:'uncounted-drink',versionId:'uncounted-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'uncounted',quantity:volume(1000000)}]},
   {companyId:'company-a',recipeId:'broken-unit',versionId:'broken-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'milk',quantity:mass(1000000)}]},
   {companyId:'company-a',recipeId:'missing-stock',versionId:'missing-stock-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'ghost',quantity:volume(1000000)}]},
  ],
  modifiers:[
   {companyId:'company-a',recipeId:'latte',modifierId:'extra-shot',versionId:'extra-shot-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,deltas:[{productId:'coffee',quantity:mass(2000000)}]},
   {companyId:'company-a',recipeId:'latte',modifierId:'oat-swap',versionId:'oat-swap-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,deltas:[{productId:'milk',quantity:volume(-12000000)},{productId:'oat',quantity:volume(12000000)}]},
  ],
 };
}

function request(idempotencyKey,occurredAt,lines){
 return {contract,companyId:'company-a',idempotencyKey,occurredAt,lines};
}
const line=(lineId,recipeId,quantity='1',modifiers=[])=>({lineId,recipeId,quantity,modifiers});
const issueCodes=result=>result.issues.map(issue=>issue.code);

{
 const boundaryFixture=fixture();
 boundaryFixture.balances.find(balance=>balance.productId==='cup').onHandMinor='-9223372036854775807';
 const port=new FakeInventoryConsumptionPort(boundaryFixture);
 const result=await port.consume(request('signed-min','2026-02-15T00:00:00Z',[line('line-1','latte')]));
 assert.equal(result.status,'applied');
 assert.equal(port.getBalance('company-a','cup').onHandMinor,'-9223372036854775808');
 const before=port.getBalance('company-a','milk');
 const overflow=await port.consume(request('below-signed-min','2026-02-15T00:00:00Z',[line('line-1','latte')]));
 assert.equal(overflow.status,'rejected');
 assert.deepEqual(issueCodes(overflow),['invalid_quantity']);
 assert.deepEqual(port.getBalance('company-a','milk'),before,'Underflow must not partially deduct other products.');
 boundaryFixture.balances.find(balance=>balance.productId==='cup').onHandMinor='-9223372036854775808';
 assert.doesNotThrow(()=>new FakeInventoryConsumptionPort(boundaryFixture));
 boundaryFixture.balances.find(balance=>balance.productId==='cup').onHandMinor='-9223372036854775809';
 assert.throws(()=>new FakeInventoryConsumptionPort(boundaryFixture),/not canonical/);
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const boundary=await port.consume(request('activation-boundary','2026-02-01T00:00:00Z',[line('line-1','latte')]));
 assert.equal(boundary.status,'applied');
 assert.equal(boundary.selectedVersions[0].recipeVersionId,'latte-v2');
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const sale=request('sale-v1','2026-01-15T12:00:00Z',[line('line-1','latte','2')]);
 const applied=await port.consume(sale);
 assert.equal(applied.status,'applied');
 assert.equal(applied.replayed,false);
 assert.equal(applied.selectedVersions[0].recipeVersionId,'latte-v1');
 assert.deepEqual(applied.changes.map(change=>[change.productId,change.consumed.minor]),[['cup','2'],['milk','20000000']]);
 assert.equal(port.getBalance('company-a','milk').onHandMinor,'180000000');
 assert.equal(port.getBalance('company-a','cup').onHandMinor,'98');

 const replayed=await port.consume(sale);
 assert.equal(replayed.status,'applied');
 assert.equal(replayed.replayed,true);
 assert.equal(port.getBalance('company-a','milk').onHandMinor,'180000000');

 const conflict=await port.consume({...sale,lines:[line('line-1','latte','1')]});
 assert.equal(conflict.status,'rejected');
 assert.deepEqual(issueCodes(conflict),['idempotency_conflict']);
 assert.equal(port.getBalance('company-a','milk').onHandMinor,'180000000');
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const sale=request('concurrent-sale','2026-02-15T12:00:00Z',[line('line-1','latte')]);
 const results=await Promise.all([port.consume(sale),port.consume(sale)]);
 assert.deepEqual(results.map(result=>result.replayed).sort(),[false,true]);
 assert.ok(results.every(result=>result.status==='applied'));
 assert.equal(port.getBalance('company-a','milk').onHandMinor,'188000000');
 assert.equal(port.getBalance('company-a','cup').onHandMinor,'99');
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const sale=request('sale-v2-modifiers','2026-02-15T12:00:00-05:00',[
  line('line-1','latte','2',[{modifierId:'oat-swap',quantity:'2'},{modifierId:'extra-shot',quantity:'2'}]),
 ]);
 const applied=await port.consume(sale);
 assert.equal(applied.status,'applied');
 assert.equal(applied.selectedVersions[0].recipeVersionId,'latte-v2');
 assert.deepEqual(applied.selectedVersions[0].modifiers.map(modifier=>modifier.modifierVersionId),['oat-swap-v1','extra-shot-v1']);
 assert.deepEqual(applied.changes.map(change=>[change.productId,change.consumed.minor]),[['coffee','4000000'],['cup','2'],['oat','24000000']]);
 assert.equal(port.getBalance('company-a','milk').onHandMinor,'200000000');
 assert.equal(port.getBalance('company-a','oat').onHandMinor,'176000000');
 assert.equal(applied.occurredAt,'2026-02-15T17:00:00.000Z');
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const beforeMilk=port.getBalance('company-a','milk');
 const beforeCup=port.getBalance('company-a','cup');
 const held=await port.consume(request('negative-modifier','2026-01-15T12:00:00Z',[
  line('line-1','latte','1',[{modifierId:'oat-swap',quantity:'1'}]),
 ]));
 assert.equal(held.status,'held');
 assert.ok(issueCodes(held).includes('negative_modifier_result'));
 assert.deepEqual(port.getBalance('company-a','milk'),beforeMilk);
 assert.deepEqual(port.getBalance('company-a','cup'),beforeCup);
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const before=port.getBalance('company-a','milk');
 const held=await port.consume(request('line-local-negative','2026-01-15T12:00:00Z',[
  line('negative-line','latte','1',[{modifierId:'oat-swap',quantity:'1'}]),
  line('positive-line','latte','1'),
 ]));
 assert.equal(held.status,'held');
 assert.ok(issueCodes(held).includes('negative_modifier_result'));
 assert.deepEqual(port.getBalance('company-a','milk'),before);
}

{
 const cases=[
  ['cutoff',request('cutoff',cutoff,[line('line-1','latte')]),'before_count_cutoff'],
  ['unclassified',request('unclassified','2026-02-15T00:00:00Z',[line('line-1','legacy-drink')]),'unit_unclassified'],
  ['opening count',request('opening','2026-02-15T00:00:00Z',[line('line-1','uncounted-drink')]),'opening_count_required'],
  ['unit mismatch',request('unit','2026-02-15T00:00:00Z',[line('line-1','broken-unit')]),'unit_incompatible'],
  ['missing inventory',request('inventory','2026-02-15T00:00:00Z',[line('line-1','missing-stock')]),'inventory_not_configured'],
  ['missing modifier',request('modifier','2026-02-15T00:00:00Z',[line('line-1','latte','1',[{modifierId:'unknown',quantity:'1'}])]),'modifier_version_not_found'],
 ];
 for(const [name,input,code] of cases){
  const port=new FakeInventoryConsumptionPort(fixture());
  const before=port.getBalance('company-a','milk');
  const result=await port.consume(input);
  assert.equal(result.status,'held',name);
  assert.ok(issueCodes(result).includes(code),name);
  assert.deepEqual(port.getBalance('company-a','milk'),before,name);
 }
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const held=await port.consume(request('repairable','2026-02-15T00:00:00Z',[line('line-1','missing')]));
 assert.equal(held.status,'held');
 assert.deepEqual(issueCodes(held),['recipe_version_not_found']);
 const repaired=await port.consume(request('repairable','2026-02-15T00:00:00Z',[line('line-1','latte')]));
 assert.equal(repaired.status,'applied');
 assert.equal(repaired.replayed,false);
 assert.equal(port.getBalance('company-a','milk').onHandMinor,'188000000');
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const before=port.getBalance('company-a','milk');
 const held=await port.consume(request('atomic','2026-02-15T00:00:00Z',[
  line('valid','latte'),
  line('invalid','missing'),
 ]));
 assert.equal(held.status,'held');
 assert.deepEqual(issueCodes(held),['recipe_version_not_found']);
 assert.deepEqual(port.getBalance('company-a','milk'),before);
}

{
 const invalidCases=[
  [{...request('future','2026-04-01T00:00:00Z',[line('line-1','latte')])},'invalid_occurrence_time'],
  [{...request('timezone','2026-02-01T00:00:00',[line('line-1','latte')])},'invalid_occurrence_time'],
  [{...request('calendar','2026-02-30T00:00:00Z',[line('line-1','latte')])},'invalid_occurrence_time'],
  [{...request('contract','2026-02-01T00:00:00Z',[line('line-1','latte')]),contract:'pantrack.inventory-consumption.v0'},'invalid_contract'],
  [request('fraction','2026-02-15T00:00:00Z',[line('line-1','latte','1.5')]),'invalid_quantity'],
  [request('duplicate-lines','2026-02-15T00:00:00Z',[line('same','latte'),line('same','latte')]),'invalid_request'],
  [request('duplicate-modifiers','2026-02-15T00:00:00Z',[line('line-1','latte','1',[{modifierId:'extra-shot',quantity:'1'},{modifierId:'extra-shot',quantity:'1'}])]),'invalid_request'],
 ];
 for(const [input,code] of invalidCases){
  const port=new FakeInventoryConsumptionPort(fixture());
  const result=await port.consume(input);
  assert.equal(result.status,'rejected');
  assert.deepEqual(issueCodes(result),[code]);
 }
}

{
 const large=fixture();
 large.recipes.push({companyId:'company-a',recipeId:'overflow',versionId:'overflow-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'milk',quantity:volume('9223372036854775807')}]});
 const port=new FakeInventoryConsumptionPort(large);
 const result=await port.consume(request('overflow','2026-02-15T00:00:00Z',[line('line-1','overflow','2')]));
 assert.equal(result.status,'rejected');
 assert.deepEqual(issueCodes(result),['invalid_quantity']);
 assert.equal(port.getBalance('company-a','milk').onHandMinor,'200000000');
}

{
 const overlapping=fixture();
 overlapping.recipes.push({companyId:'company-a',recipeId:'latte',versionId:'overlap',status:'archived',activeFrom:'2026-01-15T00:00:00Z',activeTo:'2026-01-20T00:00:00Z',ingredients:[{productId:'milk',quantity:volume(1)}]});
 assert.throws(()=>new FakeInventoryConsumptionPort(overlapping),/intervals overlap/);
}

{
 const port=new FakeInventoryConsumptionPort(fixture());
 const foreign={...request('foreign','2026-02-15T00:00:00Z',[line('line-1','latte')]),companyId:'company-b'};
 const result=await port.consume(foreign);
 assert.equal(result.status,'held');
 assert.deepEqual(issueCodes(result),['recipe_version_not_found']);
 assert.equal(port.getBalance('company-a','milk').onHandMinor,'200000000');
 assert.equal(port.getBalance('company-b','milk'),null);
}

console.log('PASS: A2 consumption contract selects sale-time versions, applies canonical recipe/modifier quantities atomically, scopes companies, returns reviewable holds, and prevents duplicate deduction.');
