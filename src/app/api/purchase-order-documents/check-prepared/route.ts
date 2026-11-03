import { env } from 'cloudflare:workers';
import { database } from '@/db/raw';
import { getChatGPTUser } from '@/lib/chatgpt-auth';
import { withCompanyRoute } from '@/lib/authorization';
import { D1PreparedFileChecks } from '@/lib/d1-prepared-file-checks';
import { PreparedFileCheck } from '@/lib/prepared-file-check';
import { preparedFileCheckCommand } from '@/lib/prepared-file-check-contract';
import { R2DocumentArchiveObjects } from '@/lib/r2-document-archive-objects';
import { archiveFail, DocumentArchiveError } from '@/lib/purchase-order-document-archive-contract';

const authorized = withCompanyRoute('purchasing', async (req: Request) => {
  const bindings = env as unknown as {
    PANTRACK_DOCUMENT_ARCHIVE_PREVIEW?: string;
    DOCUMENT_ARCHIVE?: R2Bucket;
  };
  if (bindings.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW !== 'enabled')
    return Response.json({ error: 'Saved copies are unavailable.' }, { status: 404 });
  try {
    const text = await req.text();
    if (text.length > 4096 || new URL(req.url).search) archiveFail('invalid_request');
    const parsed = preparedFileCheckCommand.safeParse(JSON.parse(text));
    if (!parsed.success) archiveFail('invalid_request');
    const identity = async () => {
      const id = (await getChatGPTUser())?.userId ?? null;
      if (!id || req.headers.get('X-Pantrack-Archive-Viewer') !== id) archiveFail('forbidden');
      return id;
    };
    await identity();
    const objects = {
      read: async (key: string, max: number) => {
        if (!bindings.DOCUMENT_ARCHIVE) throw Error('Unavailable');
        return new R2DocumentArchiveObjects(bindings.DOCUMENT_ARCHIVE).read(key, max);
      },
    };
    return Response.json(
      await new PreparedFileCheck({
        identity,
        checks: new D1PreparedFileChecks(database()),
        objects,
      }).run(parsed.data),
    );
  } catch (error) {
    const code =
      error instanceof SyntaxError
        ? 'invalid_request'
        : error instanceof DocumentArchiveError
          ? error.code
          : 'storage_unavailable';
    return Response.json(
      { error: new DocumentArchiveError(code).message, code },
      {
        status:
          code === 'invalid_request'
            ? 400
            : code === 'forbidden'
              ? 403
              : code === 'missing'
                ? 404
                : code === 'storage_unavailable'
                  ? 503
                  : 409,
      },
    );
  }
});
export async function POST(req: Request) {
  const response = await authorized(req);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
