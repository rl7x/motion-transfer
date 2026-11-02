import type { ButtonHTMLAttributes } from 'react';

export function HoldButton({
  onHold,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { onHold(pressed: boolean): void }) {
  return (
    <button
      {...props}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
      onBlur={() => onHold(false)}
      onKeyDown={(event) => {
        if (['Space', 'Enter'].includes(event.code)) {
          event.preventDefault();
          if (!event.repeat) onHold(true);
        }
      }}
      onKeyUp={(event) => {
        if (['Space', 'Enter'].includes(event.code)) {
          event.preventDefault();
          onHold(false);
        }
      }}
    />
  );
}
