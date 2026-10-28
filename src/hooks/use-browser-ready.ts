'use client';
import { useSyncExternalStore } from 'react';
const subscribe = () => () => {};
const browser = () => true;
const server = () => false;
/** Hydrate browser-only draft state without changing the server's empty editor. */
export function useBrowserReady() {
  return useSyncExternalStore(subscribe, browser, server);
}
