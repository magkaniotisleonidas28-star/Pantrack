import {offlineFetch} from './second-addition-investigation.mjs';

// Import this first: the SDK captures global fetch during module evaluation.
export const originalFetch=globalThis.fetch;
globalThis.fetch=offlineFetch(originalFetch);
Object.assign(process.env,{OPENAI_API_KEY:'fictional-test-only',PANTRACK_CART_AI_MODEL:'gpt-5.4-mini-2026-03-17',PANTRACK_CART_INPUT_USD_PER_MILLION:'0.75',PANTRACK_CART_OUTPUT_USD_PER_MILLION:'4.50'});
