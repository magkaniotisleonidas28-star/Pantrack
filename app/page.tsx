import {getChatGPTUser,chatGPTSignInPath} from './chatgpt-auth';
import CompanyPortal from './company-portal';
import {Package,Building2,ShieldCheck} from 'lucide-react';
export const dynamic='force-dynamic';
export default async function Page(){
const user=await getChatGPTUser();
if(user)return <CompanyPortal email={user.email}/>;
return <main className="signin-page"><section className="signin-card"><div className="brand"><span><Package size={24}/></span>pantrack.</div><div className="eyebrow">YOUR COMPANY'S PURCHASING WORKSPACE</div><h1>Everything you order.<br/>One place to manage it.</h1><p>Sign in to create your company workspace or return to your saved products and orders.</p><a className="signin-button" href={chatGPTSignInPath('/')} target="_top">Sign in with email <span>→</span></a><small>Use your verified email account. New users can create a company after signing in.</small><div className="signin-benefits"><span><Building2 size={18}/>Separate catalogs and orders for every company</span><span><ShieldCheck size={18}/>Company data stays behind sign-in</span></div><p className="signin-pilot">Pilot: prepare and export orders. Live purchasing is not connected.</p></section></main>;
}
