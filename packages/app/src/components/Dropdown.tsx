import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cls } from './common';

export type DropdownOption = {
  value: string;
  /** Rendered inside the menu row. */
  label: React.ReactNode;
  /** Rendered in the trigger button when selected (defaults to `label`). */
  buttonLabel?: React.ReactNode;
  /** Right-aligned secondary content in the menu row. */
  meta?: React.ReactNode;
  /** Plain text used for the search filter (defaults to a best-effort guess). */
  searchText?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: React.ReactNode;
  searchable?: boolean;
  disabled?: boolean;
  /** Override the trigger button classes entirely. */
  className?: string;
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
  /** Tailwind width class for the popover (e.g. `w-72`). Defaults to matching the trigger. */
  menuWidth?: string;
  emptyText?: string;
  /** Custom footer note rendered at the bottom of the menu. */
  footer?: React.ReactNode;
};

/**
 * Themed replacement for the native <select> — a button that opens a
 * popover list, with optional search. Used app-wide so dropdowns look
 * consistent (and not like the OS default).
 */
export function Dropdown({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  searchable = false,
  disabled = false,
  className,
  size = 'md',
  align = 'left',
  menuWidth,
  emptyText = 'No matches',
  footer,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const text = o.searchText ?? (typeof o.label === 'string' ? o.label : o.value);
      return `${text} ${o.value}`.toLowerCase().includes(q);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(Math.max(0, filtered.findIndex((o) => o.value === value)));
      // Flip the menu above the trigger when there isn't room below it.
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) {
        const estimate = Math.min(340, options.length * 36 + (searchable ? 44 : 0) + 16);
        const spaceBelow = window.innerHeight - rect.bottom;
        setOpenUp(spaceBelow < estimate && rect.top > spaceBelow);
      }
      if (searchable) setTimeout(() => inputRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (opt: DropdownOption): void => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[active]) commit(filtered[active]);
      else setOpen(true);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const sizeCls = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm';
  const triggerCls =
    className ??
    cls(
      'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-panel2 text-text outline-none transition-colors hover:border-accent focus:border-accent disabled:cursor-not-allowed disabled:opacity-40',
      sizeCls,
    );

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={triggerCls}
      >
        <span className={cls('min-w-0 truncate', !selected && 'text-muted')}>
          {selected ? selected.buttonLabel ?? selected.label : placeholder}
        </span>
        <ChevronDown className={cls('h-3.5 w-3.5 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className={cls(
            'absolute z-50 overflow-hidden rounded-lg border border-border bg-panel shadow-xl shadow-black/40',
            openUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            align === 'right' ? 'right-0' : 'left-0',
            menuWidth ?? 'min-w-full',
          )}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search…"
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-muted">{emptyText}</div>}
            {filtered.map((o, i) => {
              const isSel = o.value === value;
              return (
                <button
                  type="button"
                  key={o.value}
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(o);
                  }}
                  className={cls(
                    'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-40',
                    i === active ? 'bg-panel2' : 'hover:bg-panel2',
                  )}
                >
                  <span className={cls('flex min-w-0 items-center gap-2', isSel && 'text-accent')}>
                    <Check className={cls('h-3.5 w-3.5 shrink-0', isSel ? 'text-accent' : 'text-transparent')} />
                    <span className="min-w-0 truncate">{o.label}</span>
                  </span>
                  {o.meta && <span className="shrink-0 text-xs text-muted">{o.meta}</span>}
                </button>
              );
            })}
          </div>
          {footer && <div className="border-t border-border px-3 py-2 text-xs text-muted">{footer}</div>}
        </div>
      )}
    </div>
  );
}
