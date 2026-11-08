import { D1PreparedFileChecks } from './d1-prepared-file-checks';
import { observeDocumentFile } from './document-file-observation';
import { preparedFileCheckCommand } from './prepared-file-check-contract';
import {
  archiveFail,
  DocumentArchiveError,
  type PrivateDocumentObjects,
  type ArchiveObservation,
} from './purchase-order-document-archive-contract';

/** Reads only: no lease, source capture, generation, publication or object writer is provided. */
export class PreparedFileCheck {
  constructor(
    private readonly dependencies: {
      identity: () => Promise<string | null>;
      checks: D1PreparedFileChecks;
      objects: Pick<PrivateDocumentObjects, 'read'>;
    },
  ) {}
  async run(value: unknown) {
    try {
      const parsed = preparedFileCheckCommand.safeParse(value);
      if (!parsed.success) archiveFail('invalid_request');
      const command = parsed.data,
        actorId = await this.dependencies.identity();
      if (!actorId) archiveFail('forbidden');
      const sameActor = async () => {
        if ((await this.dependencies.identity()) !== actorId) archiveFail('forbidden');
      };
      const { checks, objects } = this.dependencies,
        { manifest, check } = await checks.start(command, actorId);
      if (check) {
        await sameActor();
        await checks.recheck(command, actorId, manifest);
        return { check, viewerId: actorId, replayed: true };
      }
      await sameActor();
      await checks.recheck(command, actorId, manifest, true);
      let observation: ArchiveObservation;
      try {
        observation = (await observeDocumentFile(objects, manifest)).observation;
      } catch {
        observation = { kind: 'read_unknown' };
      }
      const proof = await checks.observe(command, actorId, manifest, observation);
      await sameActor();
      await checks.recheck(command, actorId, manifest, true);
      const saved = await checks.complete(command, actorId, manifest, proof);
      await sameActor();
      await checks.recheck(command, actorId, manifest);
      return { check: saved, viewerId: actorId, replayed: false };
    } catch (error) {
      if (error instanceof DocumentArchiveError) throw error;
      archiveFail('storage_unavailable');
    }
  }
}
