import {
  preparedFileCheckCommand,
  preparedFileCheckResponse,
  type PreparedFileCheckCommand,
  type PreparedFileCheckReceipt,
} from './prepared-file-check-contract';
import {
  archiveReviewDetail,
  type ArchiveReviewSelection,
} from './document-archive-review-contract';

export type PreparedCheckClientState = {
  working: boolean;
  pending: boolean;
  retryable: boolean;
  message: string;
  check?: PreparedFileCheckReceipt;
  replayed?: boolean;
};
type Selection = ArchiveReviewSelection & { documentId: string };
type Dependencies = {
  fetch: typeof fetch;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  uuid: () => string;
  recorded: () => void;
  refused?: () => void;
};
/** Persist one scoped command before dispatch. Stop/dispose never erase an uncertain check. */
export class PreparedFileCheckClient {
  readonly storageKey: string;
  private request: PreparedFileCheckCommand | null = null;
  private blocked = false;
  private disposed = false;
  private active: AbortController | null = null;
  constructor(
    private readonly selection: Selection,
    private readonly viewerId: string,
    private readonly dependencies: Dependencies,
    private readonly changed: (state: PreparedCheckClientState) => void,
  ) {
    this.storageKey =
      'pantrack.prepared-file-check.v1:' +
      JSON.stringify([viewerId, selection.companyId, selection.documentId]);
    try {
      const stored = dependencies.storage.getItem(this.storageKey);
      if (stored) {
        const command = preparedFileCheckCommand.parse(JSON.parse(stored));
        if (
          command.companyId !== selection.companyId ||
          command.documentId !== selection.documentId
        )
          throw Error('scope');
        this.request = command;
      }
      this.emit(
        this.request
          ? 'An earlier prepared-file check needs confirmation. Retry that same check.'
          : '',
      );
    } catch {
      this.blocked = true;
      this.emit(
        'Check recovery information is unavailable. Review it before starting another check.',
      );
    }
  }
  private emit(message: string, extra: Partial<PreparedCheckClientState> = {}) {
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
      const command = preparedFileCheckCommand.parse({
        companyId: this.selection.companyId,
        documentId: this.selection.documentId,
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
    this.emit('Checking the prepared file…');
    let recorded = false,
      refused = false;
    try {
      const response = await this.dependencies.fetch(
        '/api/purchase-order-documents/check-prepared',
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: abort.signal,
          headers: {
            'content-type': 'application/json',
            'X-Pantrack-Archive-Viewer': this.viewerId,
          },
          body: JSON.stringify(request),
        },
      );
      if (!current()) {
        await response.body?.cancel().catch(() => {});
        return;
      }
      if (!response.ok) {
        refused = response.status === 401 || response.status === 403;
        await response.body?.cancel().catch(() => {});
        throw Error('uncertain');
      }
      const result = preparedFileCheckResponse.parse(await response.json());
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
            kind: this.selection.kind,
            ...(this.selection.kind === 'draft' ? { orderId: this.selection.orderId! } : {}),
            id: request.documentId,
            view: 'review-detail',
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
        refused = true;
        await metadata.body?.cancel().catch(() => {});
        throw Error('access');
      }
      const detail = archiveReviewDetail.parse(await metadata.json());
      if (!current()) return;
      const item = detail.item;
      if (
        detail.viewerId !== this.viewerId ||
        item.companyId !== request.companyId ||
        item.id !== request.documentId ||
        item.source.kind !== this.selection.kind ||
        (item.source.kind === 'draft' && item.source.orderId !== this.selection.orderId)
      )
        throw Error('scope');
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
          'The prepared-file check could not be confirmed. Retry this same check after refreshing your access.',
          { working: false },
        );
    } finally {
      if (this.active === abort) this.active = null;
    }
    if (recorded && !this.disposed) this.dependencies.recorded();
    else if (refused && !this.disposed && !abort.signal.aborted) this.dependencies.refused?.();
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
