import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

type ThemeCtx = { pref: ThemePref; resolved: 'light' | 'dark'; setPref: (p: ThemePref) => void };

const Ctx = createContext<ThemeCtx>({ pref: 'system', resolved: 'dark', setPref: () => {} });
const KEY = 'coderouter.theme';

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

function apply(resolved: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.classList.toggle('light', resolved === 'light');
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [pref, setPrefState] = useState<ThemePref>(() => (localStorage.getItem(KEY) as ThemePref) || 'system');
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    (pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref),
  );

  useEffect(() => {
    const next = pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;
    setResolved(next);
    apply(next);
  }, [pref]);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      const next = mq.matches ? 'dark' : 'light';
      setResolved(next);
      apply(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = (p: ThemePref): void => {
    localStorage.setItem(KEY, p);
    setPrefState(p);
  };

  return <Ctx.Provider value={{ pref, resolved, setPref }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
