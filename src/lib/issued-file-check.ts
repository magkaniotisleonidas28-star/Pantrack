import { D1DocumentArchiveJournal } from './d1-document-archive-journal';
import { D1IssuedFileChecks } from './d1-issued-file-checks';
import { readArchivedDocument } from './purchase-order-document-archive';
import { issuedFileCheckCommand } from './issued-file-check-contract';
import {
  archiveFail,
  DocumentArchiveError,
  type ArchiveObservation,
  type ArchiveReadObservationReceipt,
  type PrivateDocumentObjects,
} from './purchase-order-document-archive-contract';

/** A check can only use the issued-file reader; no generation or publication port is available. */
export class IssuedFileCheck {
  constructor(
    private readonly dependencies: {
      identity: () => Promise<string | null>;
      journal: D1DocumentArchiveJournal;
      checks: D1IssuedFileChecks;
      objects: PrivateDocumentObjects;
    },
  ) {}
  async run(value: unknown) {
    try {
      const parsed = issuedFileCheckCommand.safeParse(value);
      if (!parsed.success) archiveFail('invalid_request');
      const command = parsed.data,
        actorId = await this.dependencies.identity();
      if (!actorId) archiveFail('forbidden');
      const sameActor = async () => {
        const current = await this.dependencies.identity();
        if (current !== actorId) archiveFail('forbidden');
        return current;
      };
      const journal = this.dependencies.journal,
        artifact = await journal.open(command.companyId, command.documentId, actorId);
      const existing = await this.dependencies.checks.find(command, actorId, artifact);
      if (existing) {
        await sameActor();
        await journal.recheck(artifact, actorId);
        return { check: existing, viewerId: actorId, replayed: true };
      }
      let captured:
        { observation: ArchiveObservation; proof: ArchiveReadObservationReceipt } | undefined;
      try {
        await readArchivedDocument(
          {
            identity: sameActor,
            objects: this.dependencies.objects,
            journal: {
              open: (...args) => journal.open(...args),
              recheck: (...args) => journal.recheck(...args),
              observeRead: async (saved, who, observation) => {
                const proof = await journal.observeRead(saved, who, observation);
                captured = { observation, proof };
                return proof;
              },
            },
          },
          { companyId: command.companyId, id: command.documentId },
        );
      } catch (error) {
        if (
          !captured ||
          !(error instanceof DocumentArchiveError) ||
          !['held', 'integrity', 'storage_unavailable'].includes(error.code)
        )
          throw error;
      }
      if (!captured) archiveFail('storage_unavailable');
      await sameActor();
      await journal.recheck(artifact, actorId);
      const check = await this.dependencies.checks.record(
        command,
        actorId,
        artifact,
        captured.observation,
        captured.proof,
      );
      await sameActor();
      await journal.recheck(artifact, actorId);
      return { check, viewerId: actorId, replayed: false };
    } catch (error) {
      if (error instanceof DocumentArchiveError) throw error;
      archiveFail('storage_unavailable');
    }
  }
}
