// One request bound for the provider and every estimator. One UTF-8 byte per
// token plus envelope overhead is conservative for text.
export const inputCapBytes = 24000,
  inputOverheadBytes = 4096,
  outputCeiling = 2048;

const rate = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw Error('Invalid AI rate.');
  return n;
};

export function inputCeiling(request) {
  const n = Buffer.byteLength(JSON.stringify(request), 'utf8') + inputOverheadBytes;
  if (n > inputCapBytes) throw Error('AI_INPUT_TOO_LARGE');
  return n;
}

export function reservationMicros(request, inputRate, outputRate) {
  return ceilingMicros(inputCeiling(request), inputRate, outputRate);
}

// The largest reservation any admitted request can need.
export function maximumReservationMicros(inputRate, outputRate) {
  return ceilingMicros(inputCapBytes, inputRate, outputRate);
}

function ceilingMicros(input, inputRate, outputRate) {
  const micros = Math.ceil(input * rate(inputRate) + outputCeiling * rate(outputRate));
  if (!Number.isSafeInteger(micros) || micros <= 0) throw Error('Invalid AI reservation.');
  return micros;
}
