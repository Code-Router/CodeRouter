import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cls } from './common';

/**
 * App logo. Loads `/logo.svg` (served from `packages/app/public/`); if that
 * file isn't present yet, it falls back to a Lucide glyph so the UI never
 * shows a broken image. Drop your logo at `packages/app/public/logo.svg`
 * (or `logo.png`) and it appears here everywhere automatically.
 */
export function Logo({ className }: { className?: string }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={cls('flex items-center justify-center bg-accent/20 text-accent', className)}>
        <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <img
      src="/logo.svg"
      alt="CodeRouter"
      className={cls('object-contain', className)}
      onError={() => setFailed(true)}
    />
  );
}
