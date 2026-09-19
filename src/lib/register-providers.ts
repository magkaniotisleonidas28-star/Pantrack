export const registerProviders=[
 {id:'clover',name:'Clover'}, {id:'square',name:'Square'}, {id:'toast',name:'Toast'},
 {id:'lightspeed',name:'Lightspeed'}, {id:'shopify',name:'Shopify POS'},
 {id:'touchbistro',name:'TouchBistro'}, {id:'revel',name:'Revel'},
 {id:'ncr',name:'NCR / Aloha'}, {id:'spoton',name:'SpotOn'},
 {id:'eposnow',name:'Epos Now'}, {id:'sumup',name:'SumUp'},
 {id:'other',name:'Other / custom POS'}
] as const;
export type RegisterSettings={provider:string;customName:string;location:string};
export const defaultRegister:RegisterSettings={provider:'clover',customName:'',location:''};
export function registerName(s:RegisterSettings){return s.provider==='other'?s.customName:registerProviders.find(p=>p.id===s.provider)?.name||s.provider;}
