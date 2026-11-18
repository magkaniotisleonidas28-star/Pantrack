import { getChatGPTUser } from '@/lib/chatgpt-auth';
import CompanyPortal from '@/components/workspace/company-portal';
import AuthForm from './auth/auth-form';
import AuthShell from './auth/auth-shell';
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getChatGPTUser();
  if (user) return <CompanyPortal email={user.email} />;
  return (
    <AuthShell>
      <AuthForm />
    </AuthShell>
  );
}
