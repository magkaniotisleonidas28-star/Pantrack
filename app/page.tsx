import { getChatGPTUser } from './chatgpt-auth';
import CompanyPortal from './company-portal';
import AuthPanel from './auth-panel';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getChatGPTUser();
  return user ? <CompanyPortal email={user.email} /> : <AuthPanel />;
}
