import {D1InventoryManagementService,InventoryManagementError} from './d1-inventory-management';
import {curatedUnit,customUnit,toCanonical,readCanonical} from './inventory-quantities';
import {shortcutSubmission,wasteSubmission,type ShortcutSubmission,type WasteOptions,type WasteReceipt} from './waste-contract';

type ItemRow={product_id:string;data:string;config_id:string;version:number;stock_unit_id:string;stock_unit_version:number;label:string;kind:string;dimension:'mass'|'volume'|'count';numerator:string;denominator:string};
type ShortcutsRow={product_id:string;config_id:string;revision:number;operation_id:string;shortcuts_json:string};

export class D1WasteService {
  constructor(private readonly db:D1Database){}

  private async items(companyId:string){
    return (await this.db.prepare(`SELECT b.product_id,p.data,b.config_id,b.version,c.stock_unit_id,c.stock_unit_version,u.label,u.kind,u.dimension,u.numerator,u.denominator
      FROM inventory_balances_exact b JOIN products p ON p.owner=b.company_id AND p.id=b.product_id
      JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
      JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      WHERE b.company_id=? AND c.status='active' AND u.dimension IS NOT NULL AND u.numerator IS NOT NULL AND u.denominator IS NOT NULL`)
      .bind(companyId).all<ItemRow>()).results;
  }

  async options(companyId:string):Promise<WasteOptions>{
    const [items,settings]=await Promise.all([this.items(companyId),this.db.prepare('SELECT product_id,config_id,revision,operation_id,shortcuts_json FROM waste_shortcuts WHERE company_id=?').bind(companyId).all<ShortcutsRow>()]);
    return {enabled:true,serverNow:new Date().toISOString(),items:items.map(row=>{
      const settingsRow=settings.results.find(s=>s.product_id===row.product_id);
      const product=JSON.parse(row.data) as {name?:string};
      return {productId:row.product_id,name:typeof product.name==='string'?product.name:row.product_id,configId:row.config_id,version:row.version,
        unitId:row.stock_unit_id,unitLabel:row.label,
        shortcuts:settingsRow?.config_id===row.config_id?JSON.parse(settingsRow.shortcuts_json):[],shortcutRevision:settingsRow?.revision??0};
    }).sort((a,b)=>a.name.localeCompare(b.name))};
  }

  async record(input:unknown,actor:string):Promise<WasteReceipt>{
    const b=wasteSubmission.parse(input);
    await new D1InventoryManagementService(this.db).recordMovement({...b,actor,action:'waste',wasteReason:b.reason});
    // Deliberately omit balances, financial values, and other workers' audit data.
    return {operationId:b.operationId,productId:b.productId,amount:b.amount,unitId:b.unitId,reason:b.reason,effectiveAt:new Date(b.effectiveAt).toISOString()};
  }

  async saveShortcuts(input:unknown,actor:string){
    const b:ShortcutSubmission=shortcutSubmission.parse(input),json=JSON.stringify(b.shortcuts);
    const prior=await this.db.prepare('SELECT product_id,config_id,revision,operation_id,shortcuts_json FROM waste_shortcuts WHERE company_id=? AND operation_id=?').bind(b.companyId,b.operationId).first<ShortcutsRow>();
    const verify=(row:ShortcutsRow)=>{
      if(row.product_id!==b.productId||row.config_id!==b.configId||row.revision!==b.expectedRevision+1||row.shortcuts_json!==json)
        throw new InventoryManagementError('operation_conflict','That shortcut save reference has different details.');
    };
    if(prior){verify(prior);return {revision:prior.revision};}
    const item=(await this.items(b.companyId)).find(row=>row.product_id===b.productId);
    if(!item)throw new InventoryManagementError('not_found','Set up this ingredient and its opening count first.');
    if(item.config_id!==b.configId)throw new InventoryManagementError('concurrent_update','The ingredient unit changed. Refresh before saving shortcuts.');
    const unit=item.kind==='curated'?curatedUnit(item.stock_unit_id):customUnit({id:item.stock_unit_id,version:item.stock_unit_version,label:item.label,dimension:item.dimension,numerator:item.numerator,denominator:item.denominator,companyId:b.companyId,productId:b.productId});
    for(const entry of b.shortcuts){
      if(entry.unitId!==item.stock_unit_id)throw new InventoryManagementError('unit_incompatible','Shortcuts must use the current ingredient stock unit.');
      if(readCanonical(toCanonical(entry.amount,unit,{companyId:b.companyId,productId:b.productId}))<=BigInt(0))throw new InventoryManagementError('invalid_quantity','Shortcut quantities must be greater than zero.');
    }
    await this.db.prepare(`INSERT INTO waste_shortcuts(company_id,product_id,config_id,revision,operation_id,shortcuts_json,updated_by,updated_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND config_id=?)
        AND COALESCE((SELECT revision FROM waste_shortcuts WHERE company_id=? AND product_id=?),0)=?
      ON CONFLICT(company_id,product_id) DO UPDATE SET config_id=excluded.config_id,revision=excluded.revision,operation_id=excluded.operation_id,shortcuts_json=excluded.shortcuts_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at
      WHERE waste_shortcuts.revision=?`).bind(b.companyId,b.productId,b.configId,b.expectedRevision+1,b.operationId,json,actor,new Date().toISOString(),b.companyId,b.productId,b.configId,b.companyId,b.productId,b.expectedRevision,b.expectedRevision).run();
    const saved=await this.db.prepare('SELECT product_id,config_id,revision,operation_id,shortcuts_json FROM waste_shortcuts WHERE company_id=? AND operation_id=?').bind(b.companyId,b.operationId).first<ShortcutsRow>();
    if(!saved)throw new InventoryManagementError('concurrent_update','Shortcuts changed. Refresh before saving again.');
    verify(saved);
    return {revision:saved.revision};
  }
}
