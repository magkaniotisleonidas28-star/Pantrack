import type {
  ArchiveObservation,
  DocumentArchiveManifest,
} from './purchase-order-document-archive-contract';

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
