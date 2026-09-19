export class BodyTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`Request body exceeds ${limit} bytes.`);
    this.name = 'BodyTooLargeError';
  }
}

/** Reads at most `limit` bytes and never retains an over-limit request body. */
export async function readBoundedUtf8(request: Request, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Body limit must be a non-negative safe integer.');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel();
        throw new BodyTooLargeError(limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}
