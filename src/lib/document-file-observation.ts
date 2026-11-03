import {
  DOCUMENT_ARCHIVE_MAX_BYTES,
  archiveObjectKey,
  type ArchiveObservation,
  type DocumentArchiveManifest,
  type PrivateDocumentObjects,
} from './purchase-order-document-archive-contract';
import { documentByteDigest } from './document-byte-digest';

/** One bounded object read, shared with save/retrieval. The caller must retain inputs before deciding. */
export async function observeDocumentFile(
  objects: Pick<PrivateDocumentObjects, 'read'>,
  manifest: DocumentArchiveManifest,
) {
  const object = await objects.read(await archiveObjectKey(manifest), DOCUMENT_ARCHIVE_MAX_BYTES);
  const bytes =
    object?.bytes instanceof Uint8Array && object.bytes.byteLength <= DOCUMENT_ARCHIVE_MAX_BYTES
      ? new Uint8Array(object.bytes)
      : null;
  const observation: ArchiveObservation = {
    kind: 'object',
    present: !!object,
    reportedSize: object && Number.isSafeInteger(object.size) ? object.size : null,
    byteLength: object?.bytes instanceof Uint8Array ? object.bytes.byteLength : null,
    sha256: bytes ? await documentByteDigest(bytes) : null,
  };
  return { bytes, observation };
}

/** Shared interpretation of persisted verification inputs; no file reads or side effects. */
export function documentFileOutcome(
  manifest: DocumentArchiveManifest,
  observation: ArchiveObservation,
) {
  if (observation.kind !== 'object') return 'unavailable' as const;
  if (!observation.present) return 'missing' as const;
  return observation.reportedSize === manifest.size &&
    observation.byteLength === manifest.size &&
    observation.sha256 === manifest.sha256
    ? ('verified' as const)
    : ('damaged' as const);
}
