import {canonicalJson,frozenCopy} from './supplier-simulation-contract';
import {curatedUnit,customUnit,toCanonical,readCanonical,type UnitDefinition} from './inventory-quantities';
import {saveSupplierSchema,archiveSupplierSchema,saveMappingSchema,archiveMappingSchema,
  registryFail,registryParse,registryId,type SupplierVersion,type MappingVersion,type MappingProjection,type RegistryGuard} from './purchasing-supplier-contract';

const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
type Head={id:string;version:number;status:'active'|'archived';name:string;updated_at:string};
type UnitRow={unit_id:string;version:number;kind:string;dimension:'count'|'mass'|'volume';label:string;numerator:string;denominator:string};
type Config={id:string;version:number;dimension:UnitRow['dimension']};
type Command={companyId:string;operationId:string;reason:string;expectedVersion:number};
type Result=SupplierVersion|MappingVersion;

/** Review-only registry. No external effects or inventory/proposal writers. */
export class D1PurchasingSuppliers {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>;clock?:{now():Date}}){}
  private now(){return (this.options.clock?.now()??new Date()).toISOString();}
  private async actor(companyId:string){
    registryId(companyId);const actor=await this.options.identity();
    if(!actor||!await this.db.prepare(`SELECT 1 WHERE ${MEMBER}`).bind(companyId,actor).first())registryFail('forbidden','Manager or owner membership is required.');
    return actor;
  }
  private async receipt(companyId:string,operationId:string,fingerprint:string):Promise<Result|null>{
    const actor=await this.actor(companyId);
    const row=await this.db.prepare(`SELECT fingerprint,result_json FROM purchasing_registry_operations WHERE company_id=? AND operation_id=? AND ${MEMBER}`)
      .bind(companyId,operationId,companyId,actor).first<{fingerprint:string;result_json:string}>();
    if(!row)return null;if(row.fingerprint!==fingerprint)registryFail('conflict','Operation ID has different details or actor.');
    return frozenCopy(JSON.parse(row.result_json) as Result);
  }
  private async commit(input:Command,actor:string,fingerprint:string,result:Result,kind:'profile'|'mapping',guards:RegistryGuard[],statements:D1PreparedStatement[]){
    const receipt=this.db.prepare(`INSERT INTO purchasing_registry_operations(company_id,operation_id,fingerprint,result_json,write_guard)
      VALUES (?,?,?,?,CASE WHEN ${MEMBER} THEN 1 ELSE 0 END)`).bind(input.companyId,input.operationId,fingerprint,JSON.stringify(result),input.companyId,actor);
    const checks=guards.map(g=>this.db.prepare(`INSERT INTO purchasing_registry_operations(company_id,operation_id,fingerprint,result_json,write_guard)
      SELECT ?,?,?,'{}',0 WHERE NOT (${g.sql})`).bind(input.companyId,input.operationId,fingerprint,...g.args));
    const event=this.db.prepare(`INSERT INTO purchasing_registry_events(company_id,kind,entity_id,version,operation_id,actor,reason,at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(input.companyId,kind,result.id,result.version,input.operationId,actor,input.reason,result.at);
    try{await this.db.batch([receipt,...checks,...statements,event]);}
    catch{const replay=await this.receipt(input.companyId,input.operationId,fingerprint);if(replay)return replay;
      registryFail('conflict','Supplier, mapping, configuration or membership changed; no registry change committed. Reload and review.');}
    const saved=await this.receipt(input.companyId,input.operationId,fingerprint);
    if(!saved)registryFail('storage_failure','Save outcome is uncertain; retry the same request.');return saved;
  }
  private page(offset:number){if(!Number.isSafeInteger(offset)||offset<0||offset>1_000_000)registryFail('invalid_request','Invalid list offset.');}
  async list(companyId:string,offset=0){
    const actor=await this.actor(companyId);this.page(offset);
    const rows=await this.db.prepare(`SELECT id,version,status,name,updated_at FROM purchasing_suppliers WHERE company_id=? AND ${MEMBER}
      ORDER BY updated_at DESC,id DESC LIMIT 21 OFFSET ?`).bind(companyId,companyId,actor,offset).all<Head>();
    return frozenCopy({suppliers:rows.results.slice(0,20),hasMore:rows.results.length>20});
  }
  async profile(companyId:string,id:string,version?:number):Promise<SupplierVersion>{
    const actor=await this.actor(companyId);registryId(id);
    if(version!==undefined&&(!Number.isSafeInteger(version)||version<1))registryFail('invalid_request','Invalid supplier version.');
    const row=await this.db.prepare(`SELECT v.data_json FROM purchasing_supplier_versions v JOIN purchasing_suppliers h
      ON h.company_id=v.company_id AND h.id=v.id WHERE v.company_id=? AND v.id=? AND v.version=${version===undefined?'h.version':'?'} AND ${MEMBER}`)
      .bind(companyId,id,...(version===undefined?[]:[version]),companyId,actor).first<{data_json:string}>();
    if(!row)registryFail('missing','Supplier not found.');return frozenCopy(JSON.parse(row.data_json) as SupplierVersion);
  }
  async history(companyId:string,id:string,kind:'profile'|'mapping',offset=0){
    const actor=await this.actor(companyId);registryId(id);this.page(offset);
    const table=kind==='profile'?'purchasing_supplier_versions':'purchasing_mapping_versions';
    const rows=await this.db.prepare(`SELECT data_json FROM ${table} WHERE company_id=? AND id=? AND ${MEMBER} ORDER BY version DESC LIMIT 21 OFFSET ?`)
      .bind(companyId,id,companyId,actor,offset).all<{data_json:string}>();
    return frozenCopy({versions:rows.results.slice(0,20).map(r=>JSON.parse(r.data_json) as Result),hasMore:rows.results.length>20});
  }
  async saveProfile(value:unknown):Promise<SupplierVersion>{
    const input=registryParse(saveSupplierSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const replay=await this.receipt(input.companyId,input.operationId,fingerprint);if(replay)return replay as SupplierVersion;
    const old=input.expectedVersion===0?null:await this.profile(input.companyId,input.supplierId);
    if(old&&(old.version!==input.expectedVersion||old.status!=='active'))registryFail('conflict','Supplier version changed or is archived.');
    if(old){
      for(const a of old.profile.accounts){const next=input.profile.accounts.find(n=>n.id===a.id);
        if(!next||a.status==='archived'&&next.status!=='archived')registryFail('invalid_request','Keep account IDs and archive instead of removing them.');}
      for(const l of old.profile.locations){const next=input.profile.locations.find(n=>n.id===l.id);
        if(!next||next.accountId!==l.accountId||l.status==='archived'&&next.status!=='archived')registryFail('invalid_request','Keep location identities and their account links.');}
    }
    const at=this.now(),acceptanceUnchanged=old&&canonicalJson(old.profile.emailAcceptance)===canonicalJson(input.profile.emailAcceptance)&&old.profile.email===input.profile.email;
    const result:SupplierVersion={companyId:input.companyId,id:input.supplierId,version:input.expectedVersion+1,status:'active',profile:input.profile,
      emailAcceptanceReportedBy:acceptanceUnchanged?old.emailAcceptanceReportedBy:actor,emailAcceptanceReportedAt:acceptanceUnchanged?old.emailAcceptanceReportedAt:at,
      actor,reason:input.reason,at};
    return this.writeProfile(input,actor,fingerprint,result);
  }
  private async writeProfile(input:Command,actor:string,fingerprint:string,result:SupplierVersion):Promise<SupplierVersion>{
    const create=input.expectedVersion===0;
    const guard={sql:`COALESCE((SELECT version FROM purchasing_suppliers WHERE company_id=? AND id=?),0)=?`,args:[input.companyId,result.id,input.expectedVersion]};
    const head=create?this.db.prepare(`INSERT INTO purchasing_suppliers(company_id,id,version,status,name,updated_at) VALUES(?,?,?,?,?,?)`)
      .bind(input.companyId,result.id,result.version,result.status,result.profile.name,result.at):
      this.db.prepare(`UPDATE purchasing_suppliers SET version=?,status=?,name=?,updated_at=? WHERE company_id=? AND id=? AND version=? AND status='active'`)
        .bind(result.version,result.status,result.profile.name,result.at,input.companyId,result.id,input.expectedVersion);
    return await this.commit(input,actor,fingerprint,result,'profile',[guard],[head,
      this.db.prepare(`INSERT INTO purchasing_supplier_versions(company_id,id,version,data_json) VALUES(?,?,?,?)`).bind(input.companyId,result.id,result.version,JSON.stringify(result))]) as SupplierVersion;
  }
  async archiveProfile(value:unknown):Promise<SupplierVersion>{
    const input=registryParse(archiveSupplierSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const replay=await this.receipt(input.companyId,input.operationId,fingerprint);if(replay)return replay as SupplierVersion;
    const old=await this.profile(input.companyId,input.supplierId);
    if(old.version!==input.expectedVersion||old.status!=='active')registryFail('conflict','Supplier is changed or archived.');
    return this.writeProfile(input,actor,fingerprint,{...old,version:old.version+1,status:'archived',actor,reason:input.reason,at:this.now()});
  }
  private group(profile:SupplierVersion,accountId:string,locationId:string){
    const account=profile.profile.accounts.find(a=>a.id===accountId),location=profile.profile.locations.find(l=>l.id===locationId);
    if(profile.status!=='active'||!account||account.status!=='active'||!location||location.status!=='active'||location.accountId!==account.id)
      registryFail('source_changed','Choose an active supplier, account and delivery location.');return {account,location};
  }
  async config(companyId:string,productId:string):Promise<Config>{
    await this.actor(companyId);registryId(productId);
    const row=await this.db.prepare(`SELECT c.id,c.version,u.dimension FROM inventory_config_versions c JOIN product_unit_versions u
      ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      WHERE c.company_id=? AND c.product_id=? AND c.status='active'`).bind(companyId,productId).first<Config>();
    if(!row||!['count','mass','volume'].includes(row.dimension))registryFail('source_changed','An active classified inventory item is required.');return row;
  }
  private decodeUnit(companyId:string,productId:string,row:UnitRow):UnitDefinition{
    if(row.kind==='curated')return curatedUnit(row.unit_id);
    if(row.kind!=='custom')registryFail('source_changed','This measurement is unclassified.');
    return customUnit({id:row.unit_id,version:row.version,label:row.label,dimension:row.dimension,numerator:row.numerator,denominator:row.denominator,companyId,productId});
  }
  async units(companyId:string,productId:string){
    const actor=await this.actor(companyId);const config=await this.config(companyId,productId);
    const rows=await this.db.prepare(`SELECT unit_id,version,kind,dimension,label,numerator,denominator FROM product_unit_versions
      WHERE company_id=? AND product_id=? AND kind='custom' AND retired_at IS NULL AND ${MEMBER} ORDER BY label,unit_id,version LIMIT 501`)
      .bind(companyId,productId,companyId,actor).all<UnitRow>();
    if(rows.results.length>500)registryFail('invalid_request','Preview supports up to 500 custom units per item.');
    return frozenCopy({config,units:rows.results.map(r=>this.decodeUnit(companyId,productId,r))});
  }
  async stocks(companyId:string,offset=0){
    const actor=await this.actor(companyId);this.page(offset);
    const rows=await this.db.prepare(`SELECT c.product_id,c.id AS config_id,c.version AS config_version,u.dimension,
      COALESCE(json_extract(p.data,'$.name'),c.product_id) AS name FROM inventory_config_versions c
      JOIN products p ON p.owner=c.company_id AND p.id=c.product_id JOIN product_unit_versions u
        ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      WHERE c.company_id=? AND c.status='active' AND u.dimension IN ('count','mass','volume') AND ${MEMBER}
      ORDER BY name,c.product_id LIMIT 21 OFFSET ?`).bind(companyId,companyId,actor,offset)
      .all<{product_id:string;config_id:string;config_version:number;dimension:UnitRow['dimension'];name:string}>();
    return frozenCopy({stocks:rows.results.slice(0,20),hasMore:rows.results.length>20});
  }
  async mapping(companyId:string,id:string):Promise<MappingVersion>{
    const actor=await this.actor(companyId);registryId(id);
    const row=await this.db.prepare(`SELECT v.data_json FROM purchasing_mapping_versions v JOIN purchasing_mappings h
      ON h.company_id=v.company_id AND h.id=v.id AND h.version=v.version WHERE v.company_id=? AND v.id=? AND ${MEMBER}`)
      .bind(companyId,id,companyId,actor).first<{data_json:string}>();
    if(!row)registryFail('missing','Mapping not found.');return frozenCopy(JSON.parse(row.data_json) as MappingVersion);
  }
  async mappings(companyId:string,supplierId:string,offset=0){
    const actor=await this.actor(companyId);await this.profile(companyId,supplierId);this.page(offset);
    const rows=await this.db.prepare(`SELECT v.data_json FROM purchasing_mapping_versions v JOIN purchasing_mappings h
      ON h.company_id=v.company_id AND h.id=v.id AND h.version=v.version WHERE h.company_id=? AND h.supplier_id=? AND ${MEMBER}
      ORDER BY h.updated_at DESC,h.id DESC LIMIT 21 OFFSET ?`).bind(companyId,supplierId,companyId,actor,offset).all<{data_json:string}>();
    const mappings=[];
    for(const row of rows.results.slice(0,20)){
      const mapping=JSON.parse(row.data_json) as MappingVersion;let warning:string|null=null;
      try{await this.projection(companyId,mapping.id);}catch{warning='Archived or stale setup; review before new use.';}
      mappings.push({mapping,warning});
    }
    return frozenCopy({mappings,hasMore:rows.results.length>20});
  }
  async saveMapping(value:unknown):Promise<MappingVersion>{
    const input=registryParse(saveMappingSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const replay=await this.receipt(input.companyId,input.operationId,fingerprint);if(replay)return replay as MappingVersion;
    const profile=await this.profile(input.companyId,input.supplierId);this.group(profile,input.accountId,input.locationId);
    if(profile.version!==input.expectedSupplierVersion)registryFail('source_changed','Supplier version changed.');
    const old=input.expectedVersion===0?null:await this.mapping(input.companyId,input.mappingId);
    if(old&&(old.status!=='active'||old.version!==input.expectedVersion||old.supplierId!==input.supplierId||old.accountId!==input.accountId||old.locationId!==input.locationId||old.productId!==input.productId))
      registryFail('conflict','Mapping identity or version changed; create a new mapping for another item/group.');
    const config=await this.config(input.companyId,input.productId);
    if(config.id!==input.expectedConfigId||config.version!==input.expectedConfigVersion)registryFail('source_changed','Inventory configuration changed.');
    let unit:UnitDefinition;
    try{unit=curatedUnit(input.packUnitId);if(unit.version!==input.packUnitVersion)registryFail('source_changed','Unit version changed.');}
    catch{const row=await this.db.prepare(`SELECT unit_id,version,kind,dimension,label,numerator,denominator FROM product_unit_versions
      WHERE company_id=? AND product_id=? AND unit_id=? AND version=? AND kind='custom' AND retired_at IS NULL`)
      .bind(input.companyId,input.productId,input.packUnitId,input.packUnitVersion).first<UnitRow>();
      if(!row)registryFail('source_changed','Choose a current measurement for this inventory item.');unit=this.decodeUnit(input.companyId,input.productId,row);}
    let pack;
    try{pack=toCanonical(input.packAmount,unit,{companyId:input.companyId,productId:input.productId},{dimension:config.dimension});
      if(readCanonical(pack)<=BigInt(0))registryFail('invalid_request','Pack contents must be positive.');}
    catch{registryFail('invalid_request','Pack contents must be positive, exact and compatible with the inventory measurement.');}
    const result:MappingVersion={companyId:input.companyId,id:input.mappingId,version:input.expectedVersion+1,status:'active',
      supplierId:input.supplierId,accountId:input.accountId,locationId:input.locationId,productId:input.productId,configId:config.id,configVersion:config.version,
      sku:input.sku,description:input.description,unitLabel:input.unitLabel,packAmount:input.packAmount,packUnit:unit,stockUnitsPerPack:pack,
      estimatedUnitMinor:input.estimatedUnitMinor,actor,reason:input.reason,at:this.now()};
    return this.writeMapping(input,actor,fingerprint,result,[this.profileGuard(profile),...this.configGuards(result)]);
  }
  private profileGuard(profile:SupplierVersion):RegistryGuard{return {sql:"EXISTS (SELECT 1 FROM purchasing_suppliers WHERE company_id=? AND id=? AND version=? AND status='active')",args:[profile.companyId,profile.id,profile.version]};}
  private configGuards(mapping:MappingVersion):RegistryGuard[]{
    const guards:RegistryGuard[]=[{sql:"EXISTS (SELECT 1 FROM inventory_config_versions WHERE company_id=? AND product_id=? AND id=? AND version=? AND status='active')",
      args:[mapping.companyId,mapping.productId,mapping.configId,mapping.configVersion]}];
    if(mapping.packUnit.kind==='custom')guards.push({sql:"EXISTS (SELECT 1 FROM product_unit_versions WHERE company_id=? AND product_id=? AND unit_id=? AND version=? AND kind='custom' AND retired_at IS NULL)",
      args:[mapping.companyId,mapping.productId,mapping.packUnit.id,mapping.packUnit.version]});return guards;
  }
  private async writeMapping(input:Command,actor:string,fingerprint:string,result:MappingVersion,guards:RegistryGuard[]):Promise<MappingVersion>{
    guards.push({sql:'COALESCE((SELECT version FROM purchasing_mappings WHERE company_id=? AND id=?),0)=?',args:[input.companyId,result.id,input.expectedVersion]});
    const head=input.expectedVersion===0?this.db.prepare(`INSERT INTO purchasing_mappings(company_id,id,version,status,supplier_id,account_id,location_id,product_id,sku,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(input.companyId,result.id,result.version,result.status,result.supplierId,result.accountId,result.locationId,result.productId,result.sku,result.at):
      this.db.prepare(`UPDATE purchasing_mappings SET version=?,status=?,sku=?,updated_at=? WHERE company_id=? AND id=? AND version=? AND status='active'`)
        .bind(result.version,result.status,result.sku,result.at,input.companyId,result.id,input.expectedVersion);
    return await this.commit(input,actor,fingerprint,result,'mapping',guards,[head,
      this.db.prepare('INSERT INTO purchasing_mapping_versions(company_id,id,version,data_json) VALUES(?,?,?,?)').bind(input.companyId,result.id,result.version,JSON.stringify(result))]) as MappingVersion;
  }
  async archiveMapping(value:unknown):Promise<MappingVersion>{
    const input=registryParse(archiveMappingSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const replay=await this.receipt(input.companyId,input.operationId,fingerprint);if(replay)return replay as MappingVersion;
    const old=await this.mapping(input.companyId,input.mappingId);
    if(old.version!==input.expectedVersion||old.status!=='active')registryFail('conflict','Mapping is changed or archived.');
    return this.writeMapping(input,actor,fingerprint,{...old,version:old.version+1,status:'archived',actor,reason:input.reason,at:this.now()},[]);
  }
  async projection(companyId:string,mappingId:string):Promise<MappingProjection>{
    const mapping=await this.mapping(companyId,mappingId),profile=await this.profile(companyId,mapping.supplierId);this.group(profile,mapping.accountId,mapping.locationId);
    const config=await this.config(companyId,mapping.productId);
    if(mapping.status!=='active'||config.id!==mapping.configId||config.version!==mapping.configVersion)registryFail('source_changed','Mapping or inventory configuration needs review.');
    if(mapping.packUnit.kind==='custom'){
      const guard=this.configGuards(mapping)[1];
      if(!await this.db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.args).first())registryFail('source_changed','Custom measurement is retired.');
    }
    return frozenCopy({contract:'pantrack.supplier-mapping.v1',mode:'review_only',source:'manual_registry',companyId,
      supplierId:profile.id,supplierVersion:profile.version,accountId:mapping.accountId,locationId:mapping.locationId,mapping});
  }
  async draftSources(companyId:string,supplierId:string,supplierVersion:number,accountId:string,locationId:string,refs:{id:string;version:number}[]){
    const profile=await this.profile(companyId,supplierId),group=this.group(profile,accountId,locationId);
    if(profile.version!==supplierVersion)registryFail('source_changed','Supplier details changed; reload before saving.');
    const guards=[this.profileGuard(profile)],projections:MappingProjection[]=[];
    for(const ref of refs){const projection=await this.projection(companyId,ref.id),m=projection.mapping;
      if(m.version!==ref.version||m.supplierId!==supplierId||m.accountId!==accountId||m.locationId!==locationId||projection.supplierVersion!==supplierVersion)
        registryFail('source_changed','Mapping changed or belongs to another supplier group.');
      projections.push(projection);guards.push({sql:"EXISTS (SELECT 1 FROM purchasing_mappings WHERE company_id=? AND id=? AND version=? AND status='active')",args:[companyId,m.id,m.version]},...this.configGuards(m));}
    return {profile,...group,projections,guards};
  }
}
