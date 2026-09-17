import type {Product} from './pantry';
export type Vendor={id:string;name:string;website:string;endpoint:string;account:string;deliveryAddress:string;notes:string;enabled:boolean;verified:boolean;hasToken?:boolean};
export type Policy={mode:'paused'|'review'|'automatic';intervalHours:number;maxOrder:number;dailyLimit:number;priceTolerance:number;allowedProducts:string[]};
export const defaultPolicy:Policy={mode:'paused',intervalHours:24,maxOrder:20000,dailyLimit:50000,priceTolerance:5,allowedProducts:[]};
export type Job={id:string;fingerprint:string;vendorId:string;vendorName:string;status:string;amount:number;created:string;message:string;items:(Product&{quantity:number;stockUnitsPerPack?:number;stockUnit?:string})[];vendorOrderId?:string};
