import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({
  entryPoints:['src/lib/d1-inventory-management.ts'],
  bundle:true,
  platform:'node',
  format:'esm',
  outfile:'.sites-runtime/inventory-management-contract.mjs',
});
const {D1InventoryManagementService}=await import('../.sites-runtime/inventory-management-contract.mjs');
await build({entryPoints:['src/lib/modifier-editor.ts','src/lib/waste-client.ts'],bundle:true,platform:'node',format:'esm',outdir:'.sites-runtime/modifier-editor-test'});
const {modifierChanges,modifierDraftRequest}=await import('../.sites-runtime/modifier-editor-test/modifier-editor.js');
const {sendSaveRequest}=await import('../.sites-runtime/modifier-editor-test/waste-client.js');

class Statement{
  constructor(database,query,values=[]){this.database=database;this.query=query;this.values=values;}
  bind(...values){return new Statement(this.database,this.query,values);}
  async first(){return this.database.prepare(this.query).get(...this.values)??null;}
  async all(){return {success:true,results:this.database.prepare(this.query).all(...this.values),meta:{changes:0}};}
  runSync(){const result=this.database.prepare(this.query).run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
  async run(){return this.runSync();}
}
class Database{
  constructor(sql){this.sql=sql;}
  prepare(query){return new Statement(this.sql,query);}
  async batch(statements){
    this.sql.exec('BEGIN IMMEDIATE');
    try{
      const results=statements.map(statement=>statement.runSync());
      this.sql.exec('COMMIT');
      return results;
    }catch(error){
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }
}

const now='2026-03-01T00:00:00.000Z';
const clock={now:()=>new Date(now)};
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
for(const entry of journal.entries)sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
for(const companyId of ['company-a','company-b'])sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(companyId,companyId,now);
for(const companyId of ['company-a','company-b'])for(const productId of ['milk','cups','beans']){
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(companyId,productId,JSON.stringify({id:productId,name:productId,unit:'legacy'}));
}
const database=new Database(sql);
const service=new D1InventoryManagementService(database,{clock});
const configure=(overrides={})=>service.configure({
  companyId:'company-a',productId:'milk',operationId:'config-milk-1',actor:'manager-a',
  stockUnit:{kind:'curated',id:'mL'},purchaseUnitLabel:'carton',purchaseAmount:'1000',
  openingAmount:'10',effectiveAt:'2026-01-01T12:00:00Z',...overrides,
});
const rejectsCode=async(promise,code)=>assert.rejects(promise,error=>error?.code===code);

const opened=await configure();
assert.deepEqual(opened.onHand,{dimension:'volume',minor:'10000000'});
assert.equal(opened.version,1);
assert.equal((await service.read('company-a')).legacyReview.products.find(item=>item.productId==='milk').needsOpeningCount,false);
assert.equal(sql.prepare("SELECT count(*) AS count FROM inventory_reconciliations WHERE company_id='company-a'").get().count,1);
assert.equal((await configure()).version,1,'Identical configuration receipt is idempotent.');
assert.equal(sql.prepare("SELECT version FROM inventory WHERE company_id='company-a' AND product_id='milk'").get().version,1);
await rejectsCode(configure({purchaseAmount:'2000'}),'operation_conflict');

const reconfigured=await configure({operationId:'config-milk-2',stockUnit:{kind:'curated',id:'L'},purchaseUnitLabel:'case',purchaseAmount:'12',openingAmount:undefined,effectiveAt:'2026-01-02T12:00:00Z'});
assert.deepEqual(reconfigured.onHand,{dimension:'volume',minor:'10000000'},'Same-dimension unit change preserves canonical stock.');
assert.equal(reconfigured.version,2);
assert.equal(sql.prepare("SELECT count(*) AS count FROM inventory_config_versions WHERE company_id='company-a' AND product_id='milk' AND status='active'").get().count,1);

const movement={companyId:'company-a',productId:'milk',operationId:'receive-1',expectedVersion:2,actor:'manager-a',action:'receive',amount:'1',unitId:'L',effectiveAt:'2026-01-03T12:00:00Z',note:'delivery'};
const received=await service.recordMovement(movement);
assert.deepEqual(received.onHand,{dimension:'volume',minor:'1010000000'});
assert.equal(received.version,3);
const legacyAfterMovement=sql.prepare("SELECT data,version FROM inventory WHERE company_id='company-a' AND product_id='milk'").get();
assert.equal((await service.recordMovement(movement)).version,3,'Movement replay does not apply twice.');
assert.deepEqual(sql.prepare("SELECT data,version FROM inventory WHERE company_id='company-a' AND product_id='milk'").get(),legacyAfterMovement,'Replay does not rewrite the legacy projection.');
await rejectsCode(service.recordMovement({...movement,amount:'2'}),'operation_conflict');
await rejectsCode(service.recordMovement({...movement,operationId:'stale',amount:'2'}),'concurrent_update');
assert.equal(sql.prepare("SELECT count(*) AS count FROM inventory_events_exact WHERE company_id='company-a' AND id='movement:stale'").get().count,0);

const counted=await service.recordCount({companyId:'company-a',productId:'milk',operationId:'count-2',expectedVersion:3,actor:'manager-a',amount:'900',unitId:'mL',effectiveAt:'2026-01-04T12:00:00Z',note:'weekly count'});
assert.deepEqual(counted.onHand,{dimension:'volume',minor:'900000000'});
assert.equal(counted.version,4);
const reconciliation=sql.prepare("SELECT estimate_before_minor,variance_minor FROM inventory_reconciliations WHERE company_id='company-a' AND id='count:count-2'").get();
assert.equal(reconciliation.estimate_before_minor,'1010000000');
assert.equal(reconciliation.variance_minor,'-110000000');
assert.equal((await service.recordCount({companyId:'company-a',productId:'milk',operationId:'count-2',expectedVersion:3,actor:'manager-a',amount:'900',unitId:'mL',effectiveAt:'2026-01-04T12:00:00Z',note:'weekly count'})).version,4);
await rejectsCode(service.recordMovement({...movement,operationId:'backdated',expectedVersion:4,effectiveAt:'2026-01-04T12:00:00Z'}),'before_count_cutoff');
await rejectsCode(configure({operationId:'config-milk-count',stockUnit:{kind:'curated',id:'each'},purchaseUnitLabel:'box',purchaseAmount:'1',openingAmount:'2',effectiveAt:'2026-01-05T12:00:00Z'}),'unit_incompatible');

await configure({productId:'cups',operationId:'config-cups',stockUnit:{kind:'curated',id:'each'},purchaseUnitLabel:'sleeve',purchaseAmount:'50',openingAmount:'20',effectiveAt:'2026-01-01T12:00:00Z'});
const competingConfigs=await Promise.allSettled([
  configure({productId:'cups',operationId:'config-cups-2',stockUnit:{kind:'curated',id:'each'},purchaseUnitLabel:'case',purchaseAmount:'100',openingAmount:undefined,effectiveAt:'2026-01-02T12:00:00Z'}),
  configure({productId:'cups',operationId:'config-cups-3',stockUnit:{kind:'curated',id:'each'},purchaseUnitLabel:'box',purchaseAmount:'200',openingAmount:undefined,effectiveAt:'2026-01-02T13:00:00Z'}),
]);
assert.deepEqual(competingConfigs.map(result=>result.status).sort(),['fulfilled','rejected']);
assert.equal(sql.prepare("SELECT count(*) AS count FROM inventory_config_versions WHERE company_id='company-a' AND product_id='cups' AND status='pending'").get().count,0,'A lost configuration CAS rolls back its pending row.');
assert.equal(sql.prepare("SELECT count(*) AS count FROM inventory_config_versions WHERE company_id='company-a' AND product_id='cups' AND status='active'").get().count,1);
const beans=await configure({productId:'beans',operationId:'config-beans',stockUnit:{kind:'custom',id:'scoop',label:'7 g scoop',dimension:'mass',numerator:'7',denominator:'1'},purchaseUnitLabel:'bag',purchaseAmount:'10',openingAmount:'2',effectiveAt:'2026-01-01T12:00:00Z'});
assert.deepEqual(beans.onHand,{dimension:'mass',minor:'14000000'});

sql.prepare('INSERT INTO recipes(company_id,id,data) VALUES (?,?,?)').run('company-a','legacy-latte',JSON.stringify({id:'legacy-latte',name:'Legacy latte',ingredients:[{productId:'milk',quantity:3,unit:'splash'}]}));
sql.prepare('INSERT INTO recipe_lineages(company_id,id,created_by,created_at) VALUES (?,?,?,?)').run('company-a','legacy-latte','migration',now);
sql.prepare(`INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,active_from,active_to,legacy,created_by,created_at)
  VALUES (?,?,?,1,'draft',?,NULL,NULL,1,?,?)`).run('company-a','legacy-latte','legacy','Legacy latte','migration',now);
sql.prepare(`INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id,legacy_unit_label)
  VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL,?,NULL,?)`).run('company-a','legacy-latte','legacy',0,'milk','3','splash');
sql.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id='company-a' AND recipe_id='legacy-latte' AND id='legacy'").run(now);
assert.deepEqual((await service.read('company-a')).legacyRecipeIds,['legacy-latte']);
assert.equal((await service.read('company-a')).legacyReview.recipes.find(item=>item.recipeId==='legacy-latte').needsReviewedVersion,true);
await service.saveRecipeDraft({companyId:'company-a',recipeId:'legacy-latte',draftId:'legacy-latte-v2',actor:'manager-a',name:'Reviewed latte',ingredients:[{productId:'milk',amount:'100',unitId:'mL'}]});
assert.equal((await service.activateRecipe({companyId:'company-a',recipeId:'legacy-latte',versionId:'legacy-latte-v2',actor:'manager-a',expectedActiveVersionId:null})).status,'active');
assert.equal(sql.prepare("SELECT status FROM recipe_versions WHERE company_id='company-a' AND recipe_id='legacy-latte' AND id='legacy'").get().status,'archived','A reviewed replacement atomically archives the legacy active version.');
assert.deepEqual((await service.read('company-a')).legacyRecipeIds,[]);
assert.equal((await service.read('company-a')).legacyReview.recipes.find(item=>item.recipeId==='legacy-latte').needsReviewedVersion,false);

const draft1=await service.saveRecipeDraft({companyId:'company-a',recipeId:'latte',draftId:'latte-v1',actor:'manager-a',name:'Latte',ingredients:[{productId:'milk',amount:'100',unitId:'mL'},{productId:'cups',amount:'1',unitId:'each'}]});
assert.equal(draft1.status,'draft');
const active1=await service.activateRecipe({companyId:'company-a',recipeId:'latte',versionId:'latte-v1',actor:'manager-a',expectedActiveVersionId:null});
assert.equal(active1.status,'active');
await rejectsCode(service.saveRecipeDraft({companyId:'company-a',recipeId:'latte',draftId:'latte-v1',actor:'manager-a',name:'Changed',ingredients:[{productId:'milk',amount:'200',unitId:'mL'}]}),'immutable_version');
await service.saveRecipeDraft({companyId:'company-a',recipeId:'latte',draftId:'latte-v2',actor:'manager-a',name:'Large latte',ingredients:[{productId:'milk',amount:'120',unitId:'mL'},{productId:'cups',amount:'1',unitId:'each'}]});
const active2=await service.activateRecipe({companyId:'company-a',recipeId:'latte',versionId:'latte-v2',actor:'manager-a',expectedActiveVersionId:'latte-v1'});
assert.equal(active2.status,'active');
assert.equal(sql.prepare("SELECT status FROM recipe_versions WHERE company_id='company-a' AND recipe_id='latte' AND id='latte-v1'").get().status,'archived');
assert.equal(JSON.parse(sql.prepare("SELECT data FROM recipes WHERE company_id='company-a' AND id='latte'").get().data).name,'Large latte');
assert.throws(()=>sql.prepare("UPDATE recipe_version_ingredients SET entered_amount='999' WHERE company_id='company-a' AND recipe_id='latte' AND version_id='latte-v2'").run(),/drafts/);
await service.saveRecipeDraft({companyId:'company-a',recipeId:'latte',draftId:'latte-v3',actor:'manager-a',name:'Iced latte',ingredients:[{productId:'milk',amount:'130',unitId:'mL'}]});
await service.saveRecipeDraft({companyId:'company-a',recipeId:'latte',draftId:'latte-v4',actor:'manager-a',name:'Hot latte',ingredients:[{productId:'milk',amount:'140',unitId:'mL'}]});
const competingActivations=await Promise.allSettled([
  service.activateRecipe({companyId:'company-a',recipeId:'latte',versionId:'latte-v3',actor:'manager-a',expectedActiveVersionId:'latte-v2'}),
  service.activateRecipe({companyId:'company-a',recipeId:'latte',versionId:'latte-v4',actor:'manager-a',expectedActiveVersionId:'latte-v2'}),
]);
assert.deepEqual(competingActivations.map(result=>result.status).sort(),['fulfilled','rejected']);
assert.equal(sql.prepare("SELECT count(*) AS count FROM recipe_versions WHERE company_id='company-a' AND recipe_id='latte' AND status='active'").get().count,1);

const modifierDraft=await service.saveModifierDraft({companyId:'company-a',recipeId:'latte',modifierId:'less-milk',draftId:'less-milk-v1',actor:'manager-a',name:'Less milk',deltas:[{productId:'milk',amount:'10',unitId:'mL',signed:true}]});
assert.equal(modifierDraft.deltas[0].quantity.minor,'-10000000');
assert.equal((await service.activateModifier({companyId:'company-a',recipeId:'latte',modifierId:'less-milk',versionId:'less-milk-v1',actor:'manager-a',expectedActiveVersionId:null})).status,'active');
assert.throws(()=>sql.prepare("DELETE FROM recipe_modifier_deltas WHERE company_id='company-a' AND recipe_id='latte'").run(),/drafts/);
const currentRecipeId=sql.prepare("SELECT id FROM recipe_versions WHERE company_id='company-a' AND recipe_id='latte' AND status='active'").get().id;
assert.equal((await service.archiveRecipe({companyId:'company-a',recipeId:'latte',versionId:currentRecipeId,actor:'manager-a'})).status,'archived');
assert.equal(sql.prepare("SELECT count(*) AS count FROM recipes WHERE company_id='company-a' AND id='latte'").get().count,0,'Archiving without replacement removes the legacy active projection.');
assert.equal((await service.archiveModifier({companyId:'company-a',recipeId:'latte',modifierId:'less-milk',versionId:'less-milk-v1',actor:'manager-a'})).status,'archived');

const companyB=new D1InventoryManagementService(database,{clock});
assert.deepEqual(await companyB.read('company-b'),{records:[],reconciliations:[],legacyRecipeIds:[],recipes:[],modifiers:[],legacyReview:{products:[],recipes:[]}});
const restarted=new D1InventoryManagementService(database,{clock});
const view=await restarted.read('company-a');
assert.equal(view.records.length,3);
assert.equal(view.recipes.filter(version=>version.status==='active').length,1);
assert.equal(view.recipes.find(version=>version.versionId==='latte-v1').status,'archived');
assert.equal(view.modifiers[0].status,'archived');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);

// Copying an ingredient rule never reuses its source identity or an old custom
// conversion. A later edit to the copy must leave the source and stock intact.
for(const recipeId of ['copy-source','copy-target'])await service.saveRecipeDraft({companyId:'company-a',recipeId,draftId:recipeId+'-v1',actor:'manager-a',name:recipeId,ingredients:[{productId:'milk',amount:'100',unitId:'mL'}]});
const sourceInput={companyId:'company-a',recipeId:'copy-source',modifierId:'source-swap',draftId:'source-swap-v1',actor:'manager-a',name:'Milk and shot change',deltas:[{productId:'milk',amount:'10',unitId:'mL',signed:true},{productId:'beans',amount:'1',unitId:'scoop',signed:false}]};
await service.saveModifierDraft(sourceInput);
const source=await service.activateModifier({companyId:'company-a',recipeId:'copy-source',modifierId:'source-swap',versionId:'source-swap-v1',actor:'manager-a',expectedActiveVersionId:null});
await configure({productId:'beans',operationId:'beans-later-scoop',stockUnit:{kind:'custom',id:'scoop',label:'18 g scoop',dimension:'mass',numerator:'18',denominator:'1'},purchaseUnitLabel:'bag',purchaseAmount:'10',openingAmount:undefined,effectiveAt:'2026-01-05T00:00:00Z'});
const balancesBeforeCopy=sql.prepare('SELECT * FROM inventory_balances_exact ORDER BY company_id,product_id').all();
const copiedChanges=modifierChanges(source);
assert.deepEqual(copiedChanges,[{productId:'milk',amount:'10',unitId:'mL',direction:'remove'},{productId:'beans',amount:'7',unitId:'g',direction:'add'}]);
assert.equal(copiedChanges[1].amount,'7','A historical 7 g scoop must not become the current 18 g scoop when copied.');
const identity={modifierId:'copied-swap',draftId:'copied-swap-v1',existing:false,changes:copiedChanges};
const body=modifierDraftRequest('company-a','copy-target',identity,source.name,copiedChanges);
assert.deepEqual(Object.keys(body).sort(),['action','companyId','deltas','draftId','modifierId','name','recipeId'].sort(),'Editor-only fields must not escape into the strict API.');
const {action,...copyInput}=body;
await rejectsCode(service.saveModifierDraft({...copyInput,recipeId:'missing-recipe',actor:'manager-a'}),'not_found');
assert.equal(sql.prepare("SELECT count(*) AS n FROM product_unit_versions WHERE company_id='company-a' AND product_id='beans' AND unit_id='g'").get().n,0,'Rejected copies do not leave unit definitions behind.');
await service.saveModifierDraft({...copyInput,actor:'manager-a'});
await service.saveModifierDraft({...copyInput,actor:'manager-a'});
assert.equal(sql.prepare("SELECT count(*) AS n FROM recipe_modifier_versions WHERE company_id='company-a' AND recipe_id='copy-target'").get().n,1,'Retry retains one draft identity.');
copiedChanges[1].amount='8';
await service.saveModifierDraft({...modifierDraftRequest('company-a','copy-target',identity,source.name,copiedChanges),actor:'manager-a'});
const afterCopy=await service.read('company-a');
assert.deepEqual(afterCopy.modifiers.find(row=>row.recipeId==='copy-source').deltas,source.deltas,'Editing a copy does not alter its source.');
assert.equal(afterCopy.modifiers.find(row=>row.recipeId==='copy-target').deltas[1].quantity.minor,'8000000');
assert.deepEqual(sql.prepare('SELECT * FROM inventory_balances_exact ORDER BY company_id,product_id').all(),balancesBeforeCopy,'Modifier setup never deducts stock.');
for(const changes of [[{productId:'milk',amount:'0',unitId:'mL',direction:'add'}],[{productId:'milk',amount:'-10',unitId:'mL',direction:'remove'}],[...copiedChanges,copiedChanges[0]]])assert.throws(()=>modifierDraftRequest('company-a','copy-target',identity,source.name,changes));
const sent=[];
assert.equal((await sendSaveRequest('/api/inventory',body,async(_,init)=>{sent.push(init.body);throw new Error('lost acknowledgement');})).kind,'uncertain');
assert.equal((await sendSaveRequest('/api/inventory',body,async(_,init)=>{sent.push(init.body);return Response.json({ok:true});},true)).kind,'saved');
assert.equal(sent[0],sent[1],'A retry submits exactly the same recipe, draft identity and ingredient effects.');
assert.deepEqual(await companyB.read('company-b'),{records:[],reconciliations:[],legacyRecipeIds:[],recipes:[],modifiers:[],legacyReview:{products:[],recipes:[]}},'Copied rules remain company scoped.');
const failedDraft=new D1InventoryManagementService({prepare:query=>database.prepare(query),batch:statements=>database.batch([...statements,new Statement(sql,'INSERT INTO missing_modifier_test_table VALUES (1)')])},{clock});
await assert.rejects(failedDraft.saveModifierDraft({...copyInput,modifierId:'failed-copy',draftId:'failed-copy-v1',actor:'manager-a',deltas:[{productId:'beans',amount:'0.008',unitId:'kg',signed:false}]}),/no such table/);
assert.equal(sql.prepare("SELECT count(*) AS n FROM product_unit_versions WHERE company_id='company-a' AND product_id='beans' AND unit_id='kg'").get().n,0,'Unit definitions roll back with a failed draft transaction.');
assert.equal(sql.prepare("SELECT count(*) AS n FROM recipe_modifier_versions WHERE company_id='company-a' AND modifier_id='failed-copy'").get().n,0,'A failed batch leaves no partial modifier.');
await rejectsCode(service.saveModifierDraft({...copyInput,modifierId:'bad-unit',draftId:'bad-unit-v1',actor:'manager-a',deltas:[{productId:'beans',amount:'1',unitId:'mL',signed:false}]}),'unit_incompatible');
await rejectsCode(service.saveModifierDraft({...copyInput,companyId:'company-b',actor:'manager-a'}),'unit_unclassified');
await configure({productId:'beans',operationId:'reserved-custom-unit',stockUnit:{kind:'custom',id:'g',label:'Misnamed scoop',dimension:'mass',numerator:'18',denominator:'1'},purchaseUnitLabel:'bag',purchaseAmount:'1',openingAmount:undefined,effectiveAt:'2026-01-06T00:00:00Z'});
await rejectsCode(service.saveModifierDraft({...copyInput,modifierId:'ambiguous-copy',draftId:'ambiguous-copy-v1',actor:'manager-a'}),'unit_incompatible');

sql.close();
console.log('PASS: A4 D1 inventory management and W2 modifier reuse preserve exact quantities, signed changes, draft identity, independent copies, immutable history, stock, and company isolation.');
