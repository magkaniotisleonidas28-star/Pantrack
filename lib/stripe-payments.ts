import {env} from 'cloudflare:workers';
export class PaymentError extends Error{constructor(message:string,public status=503){super(message);}}
export function paymentConfig(){const key=(env as unknown as {STRIPE_SECRET_KEY?:string}).STRIPE_SECRET_KEY;return key?{key,testMode:key.includes('_test_')}:null;}
export async function stripe<T>(path:string,params?:Record<string,string>,idempotency?:string):Promise<T>{
 const config=paymentConfig();if(!config)throw new PaymentError('Secure card setup is not configured yet.');
 const headers:Record<string,string>={Authorization:'Bearer '+config.key,'Stripe-Version':'2024-06-20'};
 if(params)headers['Content-Type']='application/x-www-form-urlencoded';
 if(idempotency)headers['Idempotency-Key']=idempotency;
 let response:Response;
 try{response=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers,body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(15000)});}catch{throw new PaymentError('The payment provider did not respond. Please try again.');}
 if(!response.ok)throw new PaymentError('The payment provider could not complete this request. Please try again or contact the app administrator.');
 return await response.json() as T;
}
