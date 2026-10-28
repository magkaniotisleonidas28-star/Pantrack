'use client';
import { useEffect, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const key = 'pantrack-workspace-theme';
const changed = 'pantrack-workspace-theme-changed';
let localChoice: Theme | null = null;
function readTheme(): Theme {
  if (localChoice) return localChoice;
  try {
    return localStorage.getItem(key) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
const serverTheme = (): Theme => 'light';
function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    localChoice = null;
    notify();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(changed, notify);
  };
}

export function useWorkspaceTheme() {
  // The server snapshot preserves hydration; the client reads the browser store.
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  useEffect(() => {
    document.body.dataset.workspaceTheme = theme;
    return () => {
      delete document.body.dataset.workspaceTheme;
    };
  }, [theme]);
  function toggleTheme() {
    localChoice = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(key, localChoice);
    } catch {}
    window.dispatchEvent(new Event(changed));
  }
  return { theme, toggleTheme };
}
