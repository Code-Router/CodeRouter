import React, { useEffect, useState } from 'react';
import type { ChatMessageRecord } from '@coderouter/core';
import { api, type ChatSummary } from '../lib/api';
import { EmptyState, Spinner, cls, money, timeAgo } from '../components/common';

export function ChatsPage({ project }: { project: string | null }): React.ReactElement {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [active, setActive] = useState<ChatSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[] | null>(null);

  useEffect(() => {
    void api.chats().then((r) => setChats(r.chats)).catch(() => setChats([]));
  }, []);

  useEffect(() => {
    if (!active) return;
    setMessages(null);
    void api.chat(active.cwd, active.id).then((r) => setMessages(r.messages)).catch(() => setMessages([]));
  }, [active]);

  if (!chats) return <Spinner />;
  const shown = project ? chats : chats; // all chats; project picker just hints context

  return (
    <div className="flex h-full gap-4">
      <div className="w-80 shrink-0 space-y-2 overflow-y-auto pr-1">
        {shown.length === 0 && <EmptyState title="No chats yet" hint="Conversations from the REPL appear here." />}
        {shown.map((c) => (
          <button
            key={`${c.cwd}:${c.id}`}
            onClick={() => setActive(c)}
            className={cls(
              'card w-full text-left transition-colors hover:border-accent',
              active?.id === c.id && 'border-accent',
            )}
          >
            <div className="truncate text-sm font-medium">{c.title}</div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted">
              <span>{c.project} · {c.mode}</span>
              <span>{timeAgo(c.updatedAt)}</span>
            </div>
            <div className="mt-1 text-xs text-muted">{c.messageCount} msgs · {money(c.costUsd)}</div>
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {!active && <EmptyState title="Select a conversation" />}
        {active && !messages && <Spinner />}
        {active && messages && (
          <div className="space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={cls('card', m.role === 'user' ? 'border-accent/40' : '')}>
                <div className="mb-1 flex items-center justify-between text-xs text-muted">
                  <span className="uppercase tracking-wide">{m.role}</span>
                  <span>{m.route ?? ''} {m.costUsd ? `· ${money(m.costUsd)}` : ''}</span>
                </div>
                <div className="whitespace-pre-wrap text-sm">{m.text || <span className="text-muted">(no text)</span>}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
