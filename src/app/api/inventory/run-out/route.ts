import { z } from 'zod';
import { database } from '@/db/raw';
import { getChatGPTUser } from '@/lib/chatgpt-auth';
import { withCompanyRoute } from '@/lib/authorization';
import { exactInventoryPreviewEnabled } from '@/lib/exact-inventory-gate';
import { D1RunOutReports } from '@/lib/d1-run-out-reports';
import { RunOutError, runOutErrorStatus, runOutRequest } from '@/lib/run-out-contract';

// R1c (decision 0011): any member reports "We just ran out" and sees open reports; owners and
// managers confirm a report as a zero count or dismiss it (permissions in withCompanyRoute).
const disabled = () =>
  Response.json(
    { error: 'Run-out reports are not enabled in this workspace.', code: 'preview_disabled' },
    { status: 404 },
  );

async function handleGET(req: Request) {
  if (!exactInventoryPreviewEnabled()) return disabled();
  const companyId = new URL(req.url).searchParams.get('companyId')!;
  try {
    const reports = new D1RunOutReports(database());
    const [open, stocked] = await Promise.all([
      reports.open(companyId),
      reports.stocked(companyId),
    ]);
    return Response.json({ open, stocked });
  } catch {
    return Response.json({ error: 'Could not load reports. Please retry.' }, { status: 503 });
  }
}

async function handlePOST(req: Request) {
  if (!exactInventoryPreviewEnabled()) return disabled();
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Please sign in.' }, { status: 401 });
  try {
    const body = runOutRequest.parse(await req.json());
    const reports = new D1RunOutReports(database()),
      actor = { userId: user.userId, email: user.email };
    if (body.action === 'report') return Response.json(await reports.report(body, actor));
    return Response.json(
      await reports.resolve(body, body.action === 'confirm' ? 'confirmed' : 'dismissed', actor),
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: 'Check the report details.' }, { status: 400 });
    if (error instanceof RunOutError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: runOutErrorStatus[error.code] },
      );
    return Response.json({ error: 'Could not save. Please retry.' }, { status: 503 });
  }
}

export const GET = withCompanyRoute('run-out', handleGET);
export const POST = withCompanyRoute('run-out', handlePOST);
