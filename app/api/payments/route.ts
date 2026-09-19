import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {paymentConfig,stripe,PaymentError} from '@/lib/stripe-payments';
import {z} from 'zod';
import {appOrigin} from '@/lib/auth';
type Card={id:string;customer:string|null;type:string;card?:{brand:string;last4:string;exp_month:number;exp_year:number};billing_details?:{name:string|null}};
async function context(companyId:string){
 const account=await stripe<{id:string}>('account');
 const scope=account.id+':'+(paymentConfig()!.testMode?'test':'live');
 const row=await database().prepare('SELECT customer_id FROM payment_customers WHERE company_id=? AND provider_scope=?').bind(companyId,scope).first<{customer_id:string}>();
 return {scope,customer:row?.customer_id};
}
async function ensureCustomer(companyId:string,scope:string,existing?:string){
 if(existing)return existing;
 const customer=await stripe<{id:string}>('customers',{'metadata[company_id]':companyId},'pantry-customer:'+scope+':'+companyId);
 await database().prepare('INSERT OR IGNORE INTO payment_customers(company_id,provider_scope,customer_id) VALUES (?,?,?)').bind(companyId,scope,customer.id).run();
 const row=await database().prepare('SELECT customer_id FROM payment_customers WHERE company_id=? AND provider_scope=?').bind(companyId,scope).first<{customer_id:string}>();
 return row!.customer_id;
}
function failure(e:unknown){return Response.json({error:e instanceof PaymentError?e.message:e instanceof z.ZodError?'Invalid payment request.':'Payment methods are temporarily unavailable. Please retry.'},{status:e instanceof PaymentError?e.status:e instanceof z.ZodError?400:503});}
async function handleGET(req:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Please sign in.'},{status:401});
 try{
 const companyId=z.string().min(1).max(200).parse(new URL(req.url).searchParams.get('companyId'));
 const member=await companyAccess(user.userId,companyId);if(!member)return Response.json({error:'Company access denied.'},{status:403});
 if(member.role!=='owner')return Response.json({error:'Only the company owner can manage payment methods.'},{status:403});
 const config=paymentConfig();if(!config)return Response.json({configured:false,testMode:false,cards:[],defaultId:null},{headers:{'Cache-Control':'no-store'}});
 const {customer}=await context(companyId);
 if(!customer)return Response.json({configured:true,testMode:config.testMode,cards:[],defaultId:null},{headers:{'Cache-Control':'no-store'}});
 const [list,details]=await Promise.all([stripe<{data:Card[]}>('payment_methods?customer='+encodeURIComponent(customer)+'&type=card&limit=100'),stripe<{invoice_settings?:{default_payment_method?:string|null}}> ('customers/'+encodeURIComponent(customer))]);
 return Response.json({configured:true,testMode:config.testMode,cards:list.data.map(p=>({id:p.id,brand:p.card?.brand,last4:p.card?.last4,month:p.card?.exp_month,year:p.card?.exp_year,name:p.billing_details?.name||''})),defaultId:details.invoice_settings?.default_payment_method||null},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return failure(e);}
}
async function handlePOST(req:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Please sign in.'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Invalid request origin'},{status:403});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'JSON required'},{status:415});
 try{
 const b=z.object({action:z.enum(['setup','default','remove','verify']),companyId:z.string().min(1).max(200),requestId:z.string().uuid().optional(),paymentMethodId:z.string().regex(/^pm_[a-zA-Z0-9]+$/).optional(),sessionId:z.string().regex(/^cs_[a-zA-Z0-9_]+$/).optional()}).strict().parse(await req.json());
 const member=await companyAccess(user.userId,b.companyId);
 if(member?.role!=='owner')return Response.json({error:'Only the company owner can manage payment methods.'},{status:403});
 if(!paymentConfig())throw new PaymentError('Secure card setup is not configured yet.');
 const {scope,customer:existing}=await context(b.companyId);
 if(b.action==='setup'){
 if(!b.requestId)throw new PaymentError('Missing setup reference.',400);
 const customer=await ensureCustomer(b.companyId,scope,existing);
 const origin=appOrigin();
 const query='company='+encodeURIComponent(b.companyId);
 const session=await stripe<{url:string}>('checkout/sessions',{mode:'setup',customer,currency:'usd','payment_method_types[0]':'card',success_url:origin+'/?'+query+'&payment_setup=success&session_id={CHECKOUT_SESSION_ID}',cancel_url:origin+'/?'+query+'&payment_setup=canceled','metadata[company_id]':b.companyId,'setup_intent_data[metadata][company_id]':b.companyId},'pantry-setup:'+scope+':'+b.companyId+':'+b.requestId);
 if(!session.url||new URL(session.url).origin!=='https://checkout.stripe.com')throw new PaymentError('Secure card setup could not be opened.');
 return Response.json({url:session.url});
 }
 if(!existing)throw new PaymentError('No payment account found for this company.',404);
 if(b.action==='verify'){
 if(!b.sessionId)throw new PaymentError('Missing setup reference.',400);
 const session=await stripe<{customer:string;mode:string;status:string;metadata:{company_id?:string}}>('checkout/sessions/'+encodeURIComponent(b.sessionId));
 if(session.customer!==existing||session.metadata?.company_id!==b.companyId)throw new PaymentError('This card setup does not belong to this company.',403);
 if(session.mode!=='setup'||session.status!=='complete')throw new PaymentError('Card setup has not completed.',409);
 return Response.json({verified:true});
 }
 if(!b.paymentMethodId)throw new PaymentError('Choose a saved card.',400);
 const card=await stripe<Card>('payment_methods/'+encodeURIComponent(b.paymentMethodId));
 if(card.customer!==existing||card.type!=='card')throw new PaymentError('This card does not belong to this company.',403);
 if(b.action==='default')await stripe('customers/'+encodeURIComponent(existing),{'invoice_settings[default_payment_method]':card.id});
 else{
 const customer=await stripe<{invoice_settings?:{default_payment_method?:string|null}}>('customers/'+encodeURIComponent(existing));
 if(customer.invoice_settings?.default_payment_method===card.id)await stripe('customers/'+encodeURIComponent(existing),{'invoice_settings[default_payment_method]':''});
 await stripe('payment_methods/'+encodeURIComponent(card.id)+'/detach',{});
 }
 return Response.json({ok:true});
 }catch(e){return failure(e);}
}
export const GET=withCompanyRoute('payments',handleGET);
export const POST=withCompanyRoute('payments',handlePOST);
