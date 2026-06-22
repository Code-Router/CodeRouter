import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { LoopEvent } from '@coderouter/core';
import { subscribeLoopEvents } from './api';

type Listener = (e: LoopEvent) => void;

type EventsCtx = {
  connected: boolean;
  subscribe: (fn: Listener) => () => void;
};

const Ctx = createContext<EventsCtx>({ connected: false, subscribe: () => () => {} });

/** Single SSE connection shared by the whole app; fans events out to subscribers. */
export function LoopEventsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let close: (() => void) | null = null;
    let cancelled = false;
    void subscribeLoopEvents((e) => {
      if ('type' in e && e.type === 'hello') {
        setConnected(true);
        return;
      }
      for (const l of listeners.current) l(e as LoopEvent);
    }).then((c) => {
      if (cancelled) c();
      else {
        close = c;
        setConnected(true);
      }
    });
    return () => {
      cancelled = true;
      close?.();
    };
  }, []);

  const value: EventsCtx = {
    connected,
    subscribe: (fn) => {
      listeners.current.add(fn);
      return () => listeners.current.delete(fn);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLoopEvents(fn: Listener, deps: React.DependencyList = []): void {
  const { subscribe } = useContext(Ctx);
  useEffect(() => subscribe(fn), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useDaemonConnected(): boolean {
  return useContext(Ctx).connected;
}
