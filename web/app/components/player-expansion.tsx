import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useExpanded(
  card: RefObject<HTMLElement | null>,
  frame: RefObject<HTMLIFrameElement | null>,
) {
  const [expanded, setExpanded] = useState(false);
  const inert = useRef<HTMLElement[]>([]);
  const restore = useCallback(() => {
    card.current?.classList.remove('is-expanded');
    document.body.classList.remove('player-expanded');
    for (const item of inert.current) item.inert = false;
    inert.current = [];
    setExpanded(false);
  }, [card]);
  useEffect(() => {
    const fullscreen = () => {
      if (!document.fullscreenElement) restore();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && !document.fullscreenElement) restore();
    };
    document.addEventListener('fullscreenchange', fullscreen);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('fullscreenchange', fullscreen);
      document.removeEventListener('keydown', escape);
      for (const item of inert.current) item.inert = false;
      document.body.classList.remove('player-expanded');
    };
  }, [restore]);
  const toggle = async () => {
    const element = card.current;
    if (!element) return;
    if (expanded) {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      restore();
      return;
    }
    if (document.fullscreenEnabled && element.requestFullscreen) {
      try {
        await element.requestFullscreen();
        setExpanded(true);
        frame.current?.focus();
        return;
      } catch {
        /* Fall back to a page-sized player. */
      }
    }
    element.classList.add('is-expanded');
    document.body.classList.add('player-expanded');
    for (
      let node: HTMLElement | null = element;
      node?.parentElement && node !== document.body;
      node = node.parentElement
    ) {
      for (const sibling of node.parentElement.children)
        if (sibling instanceof HTMLElement && sibling !== node && !sibling.inert) {
          sibling.inert = true;
          inert.current.push(sibling);
        }
    }
    setExpanded(true);
    frame.current?.focus();
  };
  return { expanded, toggle };
}
export function ExpandButton({
  id,
  expanded,
  toggle,
}: {
  id: string;
  expanded: boolean;
  toggle(): Promise<void>;
}) {
  return (
    <button
      className="expand-player"
      data-expand={id}
      aria-expanded={expanded}
      onClick={() => {
        void toggle();
      }}
    >
      {expanded ? 'Close large view ×' : 'Expand ⤢'}
    </button>
  );
}
