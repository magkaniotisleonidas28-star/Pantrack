import {D1InventoryManagementService,InventoryManagementError} from './d1-inventory-management';
import type {RecipePublishInput} from './inventory-management-contract';

export async function publishRecipe(db:D1Database,input:RecipePublishInput,now=new Date().toISOString()){
  const fingerprint=JSON.stringify(input),result={recipeId:input.recipeId,versionId:input.versionId};
  const receipt=async()=>{
    const row=await db.prepare('SELECT kind,fingerprint,result_json FROM inventory_setup_operations WHERE company_id=? AND operation_id=?').bind(input.companyId,input.operationId).first<{kind:string;fingerprint:string;result_json:string}>();
    if(!row)return null;
    if(row.kind!=='recipe_publish'||row.fingerprint!==fingerprint)throw new InventoryManagementError('operation_conflict','This save reference has different details.');
    return JSON.parse(row.result_json) as typeof result;
  };
  const saved=await receipt();if(saved)return saved;
  const fail=(message:string):never=>{throw new InventoryManagementError('invalid_recipe',message);};
  if(!input.name.trim()||!input.ingredients.length||input.modifiers.length>16||Object.keys(input.expectedModifiers).length>16||input.choices.length>10)fail('Check the recipe name, ingredients, and choices.');
  if(input.ingredients.length+input.modifiers.reduce((n,m)=>n+m.deltas.length,0)>100)fail('Use at most 100 ingredient changes in one recipe.');
  const ids=new Set(input.modifiers.map(m=>m.modifierId));
  if(ids.size!==input.modifiers.length||new Set(input.modifiers.map(m=>m.versionId)).size!==input.modifiers.length)fail('Modifier identities must be unique.');
  const grouped=new Set<string>();
  for(const group of input.choices){
    if(!group.name.trim()||group.modifierIds.length<2||new Set(group.modifierIds).size!==group.modifierIds.length)fail('A choice needs a name and at least two different options.');
    for(const id of group.modifierIds){if(!ids.has(id)||grouped.has(id))fail('Each choice option must belong to exactly one group.');grouped.add(id);}
  }
  if(new Set(input.choices.map(g=>g.id)).size!==input.choices.length)fail('Choice identities must be unique.');
  const service=new D1InventoryManagementService(db,{clock:{now:()=>new Date(now)}});
  const ingredients=await service.recipeAmounts(input.companyId,input.ingredients);
  const prepared=[];
  for(const modifier of input.modifiers){
    const deltas=await service.recipeAmounts(input.companyId,modifier.deltas.map(d=>({...d,amount:d.signed?'-'+d.amount:d.amount})),true);
    const lineage=await db.prepare('SELECT name FROM recipe_modifier_lineages WHERE company_id=? AND recipe_id=? AND id=?').bind(input.companyId,input.recipeId,modifier.modifierId).first<{name:string}>();
    if(lineage&&lineage.name!==modifier.name.trim())fail('Existing modifier names are fixed. Add a new modifier to rename one.');
    // A required ingredient choice must add its selected ingredient, not remove a baseline.
    if(grouped.has(modifier.modifierId)&&deltas.some(d=>ingredients.some(i=>i.productId===d.productId)))fail('Keep choice ingredients in the choice options, not in the fixed ingredients.');
    if(grouped.has(modifier.modifierId)&&deltas.some(d=>BigInt(d.quantity.minor)<=BigInt(0)))fail('Choice options must add a positive ingredient quantity.');
    const number=await db.prepare('SELECT COALESCE(MAX(version),0)+1 AS n FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=?').bind(input.companyId,input.recipeId,modifier.modifierId).first<{n:number}>();
    prepared.push({modifier,deltas,number:number!.n});
  }
  const version=await db.prepare('SELECT COALESCE(MAX(version),0)+1 AS n FROM recipe_versions WHERE company_id=? AND recipe_id=?').bind(input.companyId,input.recipeId).first<{n:number}>();
  const guards:string[]=[],guardValues:unknown[]=[];
  guards.push(input.expectedActiveVersionId?'EXISTS(SELECT 1 FROM recipe_versions WHERE company_id=? AND recipe_id=? AND id=? AND status=\'active\')':'NOT EXISTS(SELECT 1 FROM recipe_versions WHERE company_id=? AND recipe_id=? AND status=\'active\')');
  guardValues.push(input.companyId,input.recipeId,...(input.expectedActiveVersionId?[input.expectedActiveVersionId]:[]));
  const expected=Object.entries(input.expectedModifiers);
  guards.push('(SELECT count(*) FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND status=\'active\')=?');guardValues.push(input.companyId,input.recipeId,expected.length);
  for(const [id,versionId] of expected){guards.push('EXISTS(SELECT 1 FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=? AND status=\'active\')');guardValues.push(input.companyId,input.recipeId,id,versionId);}
  const statements:D1PreparedStatement[]=[db.prepare(`INSERT INTO inventory_setup_operations(company_id,operation_id,kind,fingerprint,result_json,write_guard,created_at) VALUES (?,?,'recipe_publish',?,?,CASE WHEN ${guards.join(' AND ')} THEN 1 ELSE 0 END,?)`).bind(input.companyId,input.operationId,fingerprint,JSON.stringify(result),...guardValues,now),
    db.prepare('INSERT OR IGNORE INTO recipe_lineages(company_id,id,created_by,created_at) VALUES (?,?,?,?)').bind(input.companyId,input.recipeId,input.actor,now),
    db.prepare("UPDATE recipe_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND status='active'").bind(now,input.companyId,input.recipeId),
    db.prepare("INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,legacy,created_by,created_at) VALUES (?,?,?,?,'draft',?,0,?,?)").bind(input.companyId,input.recipeId,input.versionId,version!.n,input.name.trim(),input.actor,now),
  ];
  ingredients.forEach((v,i)=>statements.push(service.recipeUnitStatement(input.companyId,v,input.actor,now),db.prepare('INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(input.companyId,input.recipeId,input.versionId,i,v.productId,v.unit.id,v.unit.version,v.quantity.dimension,v.quantity.minor,v.amount,v.unitId)));
  statements.push(db.prepare('INSERT INTO recipe_version_choices(company_id,recipe_id,version_id,groups_json) VALUES (?,?,?,?)').bind(input.companyId,input.recipeId,input.versionId,JSON.stringify(input.choices)),db.prepare("UPDATE recipe_modifier_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND status='active'").bind(now,input.companyId,input.recipeId));
  for(const {modifier:m,deltas,number} of prepared){
    statements.push(db.prepare('INSERT OR IGNORE INTO recipe_modifier_lineages(company_id,recipe_id,id,name,created_by,created_at) VALUES (?,?,?,?,?,?)').bind(input.companyId,input.recipeId,m.modifierId,m.name.trim(),input.actor,now),db.prepare("INSERT INTO recipe_modifier_versions(company_id,recipe_id,modifier_id,id,version,status,created_by,created_at) VALUES (?,?,?,?,?,'draft',?,?)").bind(input.companyId,input.recipeId,m.modifierId,m.versionId,number,input.actor,now));
    deltas.forEach((v,i)=>statements.push(service.recipeUnitStatement(input.companyId,v,input.actor,now),db.prepare('INSERT INTO recipe_modifier_deltas(company_id,recipe_id,modifier_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(input.companyId,input.recipeId,m.modifierId,m.versionId,i,v.productId,v.unit.id,v.unit.version,v.quantity.dimension,v.quantity.minor,v.amount,v.unitId)));
    statements.push(db.prepare("UPDATE recipe_modifier_versions SET status='active',active_from=? WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=?").bind(now,input.companyId,input.recipeId,m.modifierId,m.versionId));
  }
  statements.push(db.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id=? AND recipe_id=? AND id=?").bind(now,input.companyId,input.recipeId,input.versionId),db.prepare('INSERT INTO recipes(company_id,id,data) VALUES (?,?,?) ON CONFLICT(company_id,id) DO UPDATE SET data=excluded.data').bind(input.companyId,input.recipeId,JSON.stringify({id:input.recipeId,name:input.name.trim(),requiresChoices:input.choices.length>0,ingredients:input.ingredients.map(i=>({productId:i.productId,quantity:Number(i.amount),unit:i.unitId}))})));
  try{await db.batch(statements);}catch(error){const replay=await receipt();if(replay)return replay;if(String(error).includes('inventory_setup_write_guard'))throw new InventoryManagementError('concurrent_update','This recipe changed. Refresh before saving a new version.');throw error;}
  return result;
}
