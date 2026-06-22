import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cls } from './common';

/**
 * App logo. Uses the transparent mark at `/transparent_logo.svg`, which
 * keeps its brand color and reads well on both light and dark surfaces
 * (no black tile). Falls back to a Lucide glyph if the asset is missing.
 */
export function Logo({ className }: { className?: string }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={cls('flex items-center justify-center rounded-md bg-accent/20 text-accent', className)}>
        <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <img
      src="/transparent_logo.svg"
      alt="CodeRouter"
      className={cls('object-contain', className)}
      onError={() => setFailed(true)}
    />
  );
}
