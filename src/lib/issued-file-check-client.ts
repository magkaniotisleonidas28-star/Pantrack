import {
  issuedFileCheckCommand,
  issuedFileCheckResponse,
  type IssuedFileCheckCommand,
  type IssuedFileCheckReceipt,
} from './issued-file-check-contract';
import { captureArchiveArtifact } from './purchase-order-document-archive-contract';
import { z } from 'zod';
import { poId } from './purchase-order-contract';

export type IssuedCheckClientState = {
  working: boolean;
  pending: boolean;
  retryable: boolean;
  message: string;
  check?: IssuedFileCheckReceipt;
  replayed?: boolean;
};
type Selection = { companyId: string; documentId: string };
type Dependencies = {
  fetch: typeof fetch;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  uuid: () => string;
  recorded: () => void;
};
/** Persist the exact command before POST; closing or stopping the view never invents a replacement check ID. */
export class IssuedFileCheckClient {
  readonly storageKey: string;
  private request: IssuedFileCheckCommand | null = null;
  private blocked = false;
  private disposed = false;
  private active: AbortController | null = null;
  constructor(
    private readonly selection: Selection,
    private readonly viewerId: string,
    private readonly dependencies: Dependencies,
    private readonly changed: (state: IssuedCheckClientState) => void,
  ) {
    this.storageKey =
      'pantrack.issued-file-check.v1:' +
      JSON.stringify([viewerId, selection.companyId, selection.documentId]);
    try {
      const stored = dependencies.storage.getItem(this.storageKey);
      if (stored) {
        const command = issuedFileCheckCommand.parse(JSON.parse(stored));
        if (
          command.companyId !== selection.companyId ||
          command.documentId !== selection.documentId
        )
          throw Error('scope');
        this.request = command;
      }
      this.emit(this.request ? 'An earlier check needs confirmation. Retry that same check.' : '');
    } catch {
      this.blocked = true;
      this.emit(
        'Check recovery information is unavailable. Review it before starting another check.',
      );
    }
  }
  private emit(message: string, extra: Partial<IssuedCheckClientState> = {}) {
    if (!this.disposed)
      this.changed({
        working: !!this.active,
        pending: !!this.request || this.blocked,
        retryable: !!this.request && !this.blocked,
        message,
        ...extra,
      });
  }
  async check() {
    if (this.request || this.active || this.disposed || this.blocked) return;
    try {
      const command = issuedFileCheckCommand.parse({
        ...this.selection,
        operationId: this.dependencies.uuid(),
      });
      this.dependencies.storage.setItem(this.storageKey, JSON.stringify(command));
      this.request = command;
    } catch {
      this.blocked = true;
      this.emit('The check could not be saved for recovery. No request was sent.');
      return;
    }
    await this.submit();
  }
  async retry() {
    if (this.request) await this.submit();
  }
  private async submit() {
    if (!this.request || this.active || this.disposed || this.blocked) return;
    const request = this.request,
      abort = new AbortController();
    this.active = abort;
    const current = () => !this.disposed && this.active === abort && !abort.signal.aborted;
    this.emit('Checking the existing file…');
    let recorded = false;
    try {
      const response = await this.dependencies.fetch('/api/purchase-order-documents/check', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: abort.signal,
        headers: { 'content-type': 'application/json', 'X-Pantrack-Archive-Viewer': this.viewerId },
        body: JSON.stringify(request),
      });
      if (!current()) {
        await response.body?.cancel().catch(() => {});
        return;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw Error('uncertain');
      }
      const result = issuedFileCheckResponse.parse(await response.json());
      if (!current()) return;
      const check = result.check;
      if (
        result.viewerId !== this.viewerId ||
        check.actorId !== this.viewerId ||
        check.companyId !== request.companyId ||
        check.documentId !== request.documentId ||
        check.operationId !== request.operationId
      )
        throw Error('scope');
      const metadata = await this.dependencies.fetch(
        '/api/purchase-order-documents?' +
          new URLSearchParams({
            companyId: request.companyId,
            id: request.documentId,
            view: 'metadata',
          }),
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: abort.signal,
        },
      );
      if (!current()) {
        await metadata.body?.cancel().catch(() => {});
        return;
      }
      if (!metadata.ok) {
        await metadata.body?.cancel().catch(() => {});
        throw Error('access');
      }
      const value = z
        .object({ viewerId: poId, artifact: z.unknown() })
        .strict()
        .parse(await metadata.json());
      if (!current()) return;
      const artifact = captureArchiveArtifact(value.artifact);
      if (
        value.viewerId !== this.viewerId ||
        artifact.companyId !== request.companyId ||
        artifact.id !== request.documentId
      )
        throw Error('access');
      try {
        this.dependencies.storage.removeItem(this.storageKey);
      } catch {
        this.blocked = true;
        throw Error('recovery');
      }
      this.request = null;
      recorded = true;
      this.emit('', { working: false, check, replayed: result.replayed });
    } catch {
      if (current())
        this.emit(
          'The check could not be confirmed. Retry this same check after refreshing your access.',
          { working: false },
        );
    } finally {
      if (this.active === abort) this.active = null;
    }
    if (recorded && !this.disposed) this.dependencies.recorded();
  }
  cancel() {
    if (!this.active || this.disposed) return;
    this.active.abort();
    this.active = null;
    this.emit(
      'Stopped waiting. The check may still finish. Retry this same check to retrieve its recorded result.',
    );
  }
  dispose() {
    this.disposed = true;
    this.active?.abort();
    this.active = null;
  }
}
