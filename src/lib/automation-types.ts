import type {Product} from './pantry';
export type Vendor={id:string;name:string;website:string;endpoint:string;account:string;deliveryAddress:string;notes:string;enabled:boolean;verified:boolean;hasToken?:boolean};
export type Policy={mode:'paused'|'review'|'automatic';intervalHours:number;maxOrder:number;dailyLimit:number;priceTolerance:number;allowedProducts:string[]};
export const defaultPolicy:Policy={mode:'paused',intervalHours:24,maxOrder:20000,dailyLimit:50000,priceTolerance:5,allowedProducts:[]};
// M8/M11 must establish supplier validation and explicit reviewed-pilot authorization
// before submission can be implemented. Saved settings or runtime flags cannot bypass this gate.
export const purchasingBlockReason='Supplier order submission is disabled. A real supplier must be validated and the reviewed pilot explicitly authorized before purchases are enabled. You can prepare and review proposals.';
export type Job={id:string;fingerprint:string;vendorId:string;vendorName:string;status:string;amount:number;created:string;message:string;items:(Product&{quantity:number;stockUnitsPerPack?:number;stockUnit?:string})[];vendorOrderId?:string};
