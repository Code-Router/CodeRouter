import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cls } from './common';
import logoUrl from '../assets/transparent_logo.svg';

/**
 * App logo. Uses the transparent mark, which keeps its brand color and
 * reads well on both light and dark surfaces (no black tile). The asset is
 * imported (not referenced by absolute path) so Vite resolves it relative
 * to the bundle — an absolute `/…` path breaks under the packaged app's
 * `file://` origin, which is why the logo went missing on Windows. Falls
 * back to a Lucide glyph if the asset ever fails to load.
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
  return <img src={logoUrl} alt="CodeRouter" className={cls('object-contain', className)} onError={() => setFailed(true)} />;
}
