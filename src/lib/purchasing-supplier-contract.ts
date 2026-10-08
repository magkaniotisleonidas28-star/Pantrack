import {z} from 'zod';
import type {ExactQuantity} from './inventory-consumption-contract';
import type {UnitDefinition} from './inventory-quantities';

const id=z.string().trim().min(1).max(200);
const note=z.string().trim().max(1000);
const minor=z.string().regex(/^(0|[1-9]\d{0,11})$/).nullable();
const status=z.enum(['active','archived']);
export const supplierProfileSchema=z.object({name:id,email:z.string().trim().email().max(254).nullable(),
  telephone:z.string().trim().max(100),paymentTerms:note,minimumOrderMinor:minor,deliveryFeeMinor:minor,
  orderingInstructions:note,notes:note,
  emailAcceptance:z.object({status:z.enum(['unknown','not_accepted','manager_reported_accepted']),note}).strict(),
  accounts:z.array(z.object({id,reference:id,status}).strict()).min(1).max(50),
  locations:z.array(z.object({id,accountId:id,reference:id,address:z.string().trim().min(1).max(1000),status}).strict()).min(1).max(50),
}).strict().superRefine((p,ctx)=>{
  const accounts=new Set(p.accounts.map(a=>a.id)),locations=new Set(p.locations.map(l=>l.id));
  if(accounts.size!==p.accounts.length||locations.size!==p.locations.length||p.locations.some(l=>!accounts.has(l.accountId)))
    ctx.addIssue({code:'custom',message:'Use unique account/location IDs and valid account links.'});
  if(p.emailAcceptance.status!=='unknown'&&(p.emailAcceptance.note.length<4||p.emailAcceptance.status==='manager_reported_accepted'&&!p.email))
    ctx.addIssue({code:'custom',message:'Reported email acceptance needs an email and evidence note.'});
});
const command={companyId:id,operationId:id,reason:z.string().trim().min(4).max(500)};
export const saveSupplierSchema=z.object({...command,action:z.literal('save_profile'),supplierId:id,
  expectedVersion:z.number().int().min(0).max(1_000_000),profile:supplierProfileSchema}).strict();
export const archiveSupplierSchema=z.object({...command,action:z.literal('archive_profile'),supplierId:id,
  expectedVersion:z.number().int().positive().max(1_000_000)}).strict();
export const saveMappingSchema=z.object({...command,action:z.literal('save_mapping'),mappingId:id,
  expectedVersion:z.number().int().min(0).max(1_000_000),supplierId:id,expectedSupplierVersion:z.number().int().positive(),
  accountId:id,locationId:id,productId:id,expectedConfigId:id,expectedConfigVersion:z.number().int().positive(),
  sku:id,description:id,unitLabel:id,packAmount:z.string().max(128),packUnitId:id,packUnitVersion:z.number().int().positive(),
  estimatedUnitMinor:minor}).strict();
export const archiveMappingSchema=z.object({...command,action:z.literal('archive_mapping'),mappingId:id,
  expectedVersion:z.number().int().positive().max(1_000_000)}).strict();
export type SupplierProfile=z.infer<typeof supplierProfileSchema>;
export type SupplierVersion=Readonly<{companyId:string;id:string;version:number;status:'active'|'archived';
  profile:SupplierProfile;emailAcceptanceReportedBy:string;emailAcceptanceReportedAt:string;
  actor:string;reason:string;at:string}>;
export type MappingVersion=Readonly<{companyId:string;id:string;version:number;status:'active'|'archived';
  supplierId:string;accountId:string;locationId:string;productId:string;configId:string;configVersion:number;
  sku:string;description:string;unitLabel:string;packAmount:string;packUnit:UnitDefinition;stockUnitsPerPack:ExactQuantity;
  estimatedUnitMinor:string|null;actor:string;reason:string;at:string}>;
export type MappingProjection=Readonly<{contract:'pantrack.supplier-mapping.v1';mode:'review_only';source:'manual_registry';
  companyId:string;supplierId:string;supplierVersion:number;accountId:string;locationId:string;mapping:MappingVersion}>;
export type RegistryGuard={sql:string;args:(string|number)[]};
export class SupplierRegistryError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'missing'|'conflict'|'source_changed'|'storage_failure',message:string){super(message);this.name='SupplierRegistryError';}
}
export function registryFail(code:SupplierRegistryError['code'],message:string):never{throw new SupplierRegistryError(code,message);}
export function registryParse<T>(schema:z.ZodType<T>,value:unknown):T{
  if(JSON.stringify(value)?.length>100_000)registryFail('invalid_request','Registry input is too large.');
  const parsed=schema.safeParse(value);if(!parsed.success)registryFail('invalid_request','Check supplier fields, references and exact pack setup.');return parsed.data;
}
export function registryId(value:string){if(!id.safeParse(value).success)registryFail('invalid_request','Choose a valid company or record.');}
