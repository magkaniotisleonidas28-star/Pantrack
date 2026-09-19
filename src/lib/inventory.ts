export type InventorySettings={unit:string;unitsPerPack:number;targetStock?:number|null;dailyUse:number;leadDays:number;safety:number;reviewDays:number;countEveryDays:number;location:string;capacity:number|null;shelfDays:number|null;expiry:string;variancePct:number};
export type InventoryRecord={productId:string;settings:InventorySettings;onHand:number;incoming:number;lastCount:string|null;updated:string;version:number;estimatedUsed:number};
export type InventoryEvent={id:string;productId:string;action:string;quantity:number|null;note:string;created:string;actor:string};
export const defaultSettings:InventorySettings={unit:'unit',unitsPerPack:1,targetStock:null,dailyUse:0,leadDays:2,safety:0,reviewDays:7,countEveryDays:30,location:'Stockroom',capacity:null,shelfDays:null,expiry:'',variancePct:5};
export function recommendation(r:InventoryRecord,now=Date.now()){
 const s=r.settings,dueAt=r.lastCount?Date.parse(r.lastCount)+s.countEveryDays*86400000:null;
 const stale=dueAt===null||now>=dueAt;
 const expired=!!s.expiry&&Date.parse(s.expiry+'T23:59:59Z')<now;
 const uncertainty=(r.estimatedUsed||0)*s.variancePct/100;
 const fixedTarget=s.targetStock!==null&&s.targetStock!==undefined;
 const needsCheck=!r.lastCount||r.onHand<0||uncertainty>Math.max(s.safety,s.dailyUse,fixedTarget?s.targetStock!*s.variancePct/100:0);
 const position=r.onHand+r.incoming-(fixedTarget?0:uncertainty),trigger=fixedTarget?s.targetStock!:s.dailyUse*s.leadDays+s.safety;
 const target=fixedTarget?s.targetStock!:s.dailyUse*(s.leadDays+s.reviewDays)+s.safety;
 const wanted=position<=trigger?Math.max(0,Math.ceil((target-position)/s.unitsPerPack)):0;
 const capacityPacks=s.capacity===null?Infinity:Math.max(0,Math.floor((s.capacity-r.onHand-r.incoming)/s.unitsPerPack));
 const shelfPacks=s.shelfDays===null?Infinity:Math.max(0,Math.floor((s.dailyUse*s.shelfDays-r.onHand-r.incoming)/s.unitsPerPack));
 const missingUsage=s.dailyUse<=0&&(!fixedTarget||s.shelfDays!==null);
 const packs=needsCheck||expired||missingUsage?0:Math.min(999,wanted,capacityPacks,shelfPacks);
 const reason=needsCheck?'Verify estimate':expired?'Check expired stock':missingUsage?'Set daily usage':wanted>packs?'Storage or shelf-life limit':packs>0?'Restock suggested':'Stock covered';
 return {fixedTarget,shortfall:Math.max(0,target-position),needsCheck,uncertainty,packs,trigger,target,position,dueAt,stale,expired,reason,limited:wanted>packs&&!needsCheck&&!expired,daysLeft:s.dailyUse>0?r.onHand/s.dailyUse:null};
}
