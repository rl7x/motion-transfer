import type { ReactNode } from 'react';

/** Marks work a Meta model produced, so it can be found at a glance. */
export function MetaChip({
  model = 'spark',
  children,
}: {
  model?: 'spark' | 'wonder';
  children?: ReactNode;
}) {
  return (
    <span className={'meta-chip meta-chip--' + model}>
      <span className="meta-chip__dot" aria-hidden="true" />
      {model === 'wonder' ? 'MUSE WONDER' : 'MUSE SPARK'}
      {children ? <span className="meta-chip__note">{children}</span> : null}
    </span>
  );
}
