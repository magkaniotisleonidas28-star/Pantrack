import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/inventory-quantities.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/inventory-quantities.mjs'});
const {curatedUnit,customUnit,toCanonical,formatCanonical,readCanonical,calculateTarget}=await import('../.sites-runtime/inventory-quantities.mjs');
const scope={companyId:'company-a',productId:'coffee'};
const q=(minor,dimension='mass')=>({dimension,minor:String(minor)});
const fails=(fn,code)=>assert.throws(fn,error=>error.code===code);

assert.deepEqual(toCanonical('5',curatedUnit('lb'),scope),q('2267961850'));
assert.equal(formatCanonical(q('2267961850')),'2267.961850');
assert.deepEqual(toCanonical('1',curatedUnit('gallon_us'),scope),q('3785411784','volume'));
assert.equal(formatCanonical(q('3785411784','volume')),'3785.411784');
assert.deepEqual(toCanonical('1',curatedUnit('mg'),scope),q(1000));
assert.deepEqual(toCanonical('0.000001',curatedUnit('mg'),scope),q(0));
assert.deepEqual(toCanonical('0.0005',curatedUnit('mg'),scope),q(1));
assert.deepEqual(toCanonical('-0.0005',curatedUnit('mg'),scope,{signed:true}),q(-1));
assert.equal(formatCanonical(q(-1)),'-0.000001');
assert.equal(formatCanonical(q(0)),'0.000000');
assert.equal(formatCanonical(q(1000,'count')),'1000');
assert.equal(formatCanonical(q('-9223372036854775808')),'-9223372036854.775808');

for(const input of ['1e3','NaN','Infinity',' 1','1 ','+1','01','.5','1.','-0','-0.000000','0.0000001',1,null,'1'.repeat(129)]){
 fails(()=>toCanonical(input,curatedUnit('g'),scope),'invalid_quantity');
}
fails(()=>toCanonical('-1',curatedUnit('g'),scope),'invalid_quantity');
fails(()=>toCanonical('1.5',curatedUnit('each'),scope),'invalid_quantity');
assert.equal(readCanonical(q('9223372036854775807')),BigInt('9223372036854775807'));
assert.equal(readCanonical(q('-9223372036854775808')),BigInt('-9223372036854775808'));
for(const minor of ['9223372036854775808','-9223372036854775809','-0','1.0','01','1e2'])fails(()=>readCanonical(q(minor)),'invalid_quantity');
fails(()=>readCanonical(q(1,'unknown')),'invalid_quantity');
fails(()=>toCanonical('9223372036854.775808',curatedUnit('g'),scope),'invalid_quantity');
assert.deepEqual(toCanonical('-9223372036854.775808',curatedUnit('g'),scope,{signed:true}),q('-9223372036854775808'));
fails(()=>curatedUnit('cup'),'unit_unclassified');
fails(()=>toCanonical('1',curatedUnit('cup_us'),scope,{dimension:'mass'}),'unit_incompatible');

const caseUnit=customUnit({...scope,id:'case',version:1,label:'Case',dimension:'count',numerator:'1000',denominator:'1'});
assert.deepEqual(toCanonical('1',caseUnit,scope),q(1000,'count'));
fails(()=>toCanonical('1',caseUnit,{...scope,companyId:'company-b'}),'unit_incompatible');
fails(()=>toCanonical('1',caseUnit,{...scope,productId:'milk'}),'unit_incompatible');
const half=customUnit({...scope,id:'half',version:1,label:'Half',dimension:'count',numerator:'1',denominator:'2'});
fails(()=>toCanonical('1',half,scope),'invalid_quantity');
assert.deepEqual(toCanonical('2',half,scope),q(1,'count'));
for(const change of [{numerator:'0'},{denominator:'0'},{numerator:'-1'},{denominator:'1.5'},{dimension:'density'},{version:0},{companyId:''}]){
 fails(()=>customUnit({...scope,id:'bag',version:1,label:'Bag',dimension:'mass',numerator:'1000',denominator:'1',...change}),'invalid_unit');
}
assert.ok(Object.isFrozen(caseUnit));
assert.ok(Object.isFrozen(curatedUnit('g')));
const changed=customUnit({...scope,id:'case',version:2,label:'Case',dimension:'count',numerator:'500',denominator:'1'});
assert.deepEqual(toCanonical('1',changed,scope),q(500,'count'));
assert.deepEqual(toCanonical('1',caseUnit,scope),q(1000,'count'),'New conversion definitions must not mutate prior versions.');

const input={target:q(100),onHand:q(20),incoming:q(10),pack:q(30),capacity:null,shelfLimit:null,hasOpeningCount:true,stale:false};
assert.deepEqual(calculateTarget(input),{position:q(30),shortfall:q(70),wantedPacks:'3',packs:'3',limitedBy:[],reviewReasons:[]});
assert.equal(calculateTarget({...input,incoming:q(80)}).packs,'0');
assert.equal(calculateTarget({...input,target:q(0)}).packs,'0');
assert.equal(calculateTarget({...input,pack:q(10)}).packs,'7');
assert.deepEqual(calculateTarget({...input,capacity:q(100)}).limitedBy,['capacity']);
assert.equal(calculateTarget({...input,capacity:q(100)}).packs,'2');
assert.equal(calculateTarget({...input,capacity:q(29)}).packs,'0');
assert.equal(calculateTarget({...input,shelfLimit:q(60)}).packs,'1');
assert.deepEqual(calculateTarget({...input,capacity:q(60),shelfLimit:q(60)}).limitedBy,['capacity','shelf_life']);
assert.deepEqual(calculateTarget({...input,stale:true}).reviewReasons,['stale_count']);
assert.equal(calculateTarget({...input,stale:true}).packs,'3','Stale counts produce a review requirement alongside the arithmetic.');
assert.equal(calculateTarget({...input,hasOpeningCount:false}).packs,'0');
assert.deepEqual(calculateTarget({...input,hasOpeningCount:false}).reviewReasons,['opening_count_required']);
fails(()=>calculateTarget({...input,pack:q(0)}),'invalid_quantity');
fails(()=>calculateTarget({...input,incoming:q(-1)}),'invalid_quantity');
fails(()=>calculateTarget({...input,target:q(100,'volume')}),'unit_incompatible');
fails(()=>calculateTarget({...input,onHand:q('9223372036854775807'),incoming:q(1)}),'invalid_quantity');
assert.equal(calculateTarget({...input,target:q('9007199254740993'),onHand:q(0),incoming:q(0),pack:q(1)}).packs,'9007199254740993');

// Compare exact ceiling/floor behavior over many sub-unit stock positions.
for(let stock=0;stock<20;stock++)for(let pack=1;pack<10;pack++){
 const result=calculateTarget({...input,target:q(20),onHand:q(stock),incoming:q(0),pack:q(pack),capacity:q(25)});
 const expected=Math.min(Math.ceil((20-stock)/pack),Math.floor((25-stock)/pack));
 assert.equal(result.packs,String(expected));
}
console.log('PASS: A4 exact quantities, scoped conversions, signed rounding and bounds, target shortfall, pack rounding, capacity/shelf caps, and count review requirements.');
