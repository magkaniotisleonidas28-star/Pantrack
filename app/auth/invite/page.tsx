import { getChatGPTUser, safeRelativeReturnPath } from '@/app/chatgpt-auth';
import { redirect } from 'next/navigation';
import InviteAcceptance from './invite-acceptance';

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const safeToken = typeof token === 'string' && token.length >= 32 && token.length <= 400 ? token : '';
  if (!safeToken) redirect('/');
  if (!await getChatGPTUser()) redirect(`/auth/sign-in?return_to=${encodeURIComponent(safeRelativeReturnPath(`/auth/invite?token=${encodeURIComponent(safeToken)}`))}`);
  return <InviteAcceptance token={safeToken} />;
}
