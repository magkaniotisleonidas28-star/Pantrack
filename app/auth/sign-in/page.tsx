import AuthPanel from '@/app/auth-panel';
import { safeRelativeReturnPath } from '@/app/chatgpt-auth';

export const dynamic = 'force-dynamic';

export default async function SignIn({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  const params = await searchParams;
  return <AuthPanel returnTo={safeRelativeReturnPath(params.return_to ?? '/')} />;
}
