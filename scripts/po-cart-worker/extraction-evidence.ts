import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
  lstatSync,
} from 'node:fs';
import { providerPhases } from '../cart-preview/ai-provider';

const phaseIds = providerPhases.flatMap((phase, id) => (phase.endsWith(':Extraction') ? [id] : []));
export const extractionEvidenceLimit = 65536;

export interface ExtractionEvidenceSink {
  capture(value: unknown, phase: string): void;
  healthy(): boolean;
  files(): string[];
  close(): void;
}

type EvidenceIo = { write: typeof writeFileSync; sync: typeof fsyncSync; close: typeof closeSync };

// Evaluation-only retention of the schema-valid extracted value, never a provider
// body, prompt or DOM. On 2026-11-10 a held case could not show whether the reader
// or its verifier was wrong. An invalid value is recorded only as invalid.
export function extractionEvidence(
  root: string,
  io: EvidenceIo = { write: writeFileSync, sync: fsyncSync, close: closeSync },
): ExtractionEvidenceSink {
  const descriptors = new Map<number, number>(),
    attempted = new Set<number>();
  let healthy = true,
    closed = false;
  const paths = phaseIds.map((id) => root + '/' + id + '.json');
  const close = () => {
    closed = true;
    for (const [id, fd] of descriptors) {
      descriptors.delete(id);
      try {
        io.close(fd);
      } catch {
        healthy = false;
      }
    }
  };
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    for (const [index, id] of phaseIds.entries())
      descriptors.set(id, openSync(paths[index], 'wx', 0o600));
    if (process.platform !== 'win32') {
      const dir = openSync(root, 'r');
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    }
  } catch {
    healthy = false;
    close();
    throw Error('AI_EXTRACTION_EVIDENCE_SETUP_FAILED');
  }
  return {
    healthy: () => healthy,
    files: () => [...paths],
    close,
    // `value` is the reader's schema-parsed result, or undefined when invalid.
    capture(value, phase) {
      const id = providerPhases.indexOf(phase),
        fd = descriptors.get(id);
      try {
        if (!healthy || closed || fd === undefined || attempted.has(id)) throw Error();
        attempted.add(id);
        const raw =
          JSON.stringify({
            version: 1,
            untrusted: true,
            phaseId: id,
            ...(value === undefined ? { valid: false } : { valid: true, value }),
          }) + '\n';
        if (Buffer.byteLength(raw) > extractionEvidenceLimit) throw Error();
        io.write(fd, raw);
        io.sync(fd);
        descriptors.delete(id);
        io.close(fd);
      } catch {
        healthy = false;
        throw Error('AI_EXTRACTION_EVIDENCE_FAILED');
      }
    },
  };
}

// Read files independently for acceptance: one record for each requested
// Extraction and empty slots elsewhere. Retained values are never instructions.
export function verifyExtractionEvidence(files: string[], phases: string[]) {
  try {
    const expected = phases
      .filter((p) => p.endsWith(':Extraction'))
      .map((p) => providerPhases.indexOf(p));
    if (
      files.length !== phaseIds.length ||
      new Set(files).size !== files.length ||
      expected.some((id) => !phaseIds.includes(id))
    )
      return false;
    const found: number[] = [];
    for (const [index, path] of files.entries()) {
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > extractionEvidenceLimit ||
        (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)
      )
        return false;
      if (stat.size === 0) continue;
      const e = JSON.parse(readFileSync(path, 'utf8'));
      if (
        e.version !== 1 ||
        e.untrusted !== true ||
        e.phaseId !== phaseIds[index] ||
        Object.keys(e).sort().join(',') !==
          (e.valid === true
            ? 'phaseId,untrusted,valid,value,version'
            : 'phaseId,untrusted,valid,version') ||
        (e.valid !== true && e.valid !== false)
      )
        return false;
      found.push(e.phaseId);
    }
    return JSON.stringify(found) === JSON.stringify(expected);
  } catch {
    return false;
  }
}
