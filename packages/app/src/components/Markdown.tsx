import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Compact markdown renderer for assistant messages. Component overrides
 * keep the output on-theme (code blocks, links, lists, tables) without
 * pulling in the typography plugin.
 */
export function Markdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="text-sm leading-relaxed text-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 whitespace-pre-wrap">{children}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold">{children}</h3>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="marker:text-muted">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} className="text-accent underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted">{children}</blockquote>
          ),
          code: ({ className, children }) => {
            const inline = !className;
            if (inline) return <code className="rounded bg-panel2 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
            return (
              <code className="block overflow-x-auto rounded-lg border border-border bg-panel2 p-3 font-mono text-[0.82em] leading-relaxed">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
