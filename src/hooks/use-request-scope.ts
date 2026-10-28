'use client';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { createRequestScope } from '@/lib/request-scope';

/** Cancel publication before an identity change paints, including StrictMode replay. */
export function useRequestScope(identity: string) {
  const scope = useRef(createRequestScope());
  useLayoutEffect(() => {
    const current = scope.current;
    current.activate();
    return () => current.invalidate();
  }, [identity]);
  return useCallback(() => scope.current.begin(), []);
}
