'use client';
import { useEffect, useState } from 'react';

/** Keep expiry labels current without reading a changing clock during render. */
export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
