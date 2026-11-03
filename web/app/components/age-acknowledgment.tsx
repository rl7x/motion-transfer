import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { readStorage, writeStorage } from '../api';
import { readGenerationMode } from '../data-source';

const AGE_KEY = 'motion-transfer-age';
interface AgeController {
  acknowledged: boolean;
  blocked: boolean;
  confirm(checked: boolean): void;
  dismiss(): void;
  allow(continuing: boolean, continuation?: () => void): boolean;
}
const AgeContext = createContext<AgeController | null>(null);

export function AgeProvider({ children }: { children: ReactNode }) {
  const [acknowledged, setAcknowledged] = useState(() => readStorage<string>(AGE_KEY) === '18+');
  const [blocked, setBlocked] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const confirm = useCallback((checked: boolean) => {
    const continuation = pending.current;
    pending.current = null;
    writeStorage(AGE_KEY, checked ? '18+' : null);
    setAcknowledged(checked);
    if (checked) {
      setBlocked(false);
      continuation?.();
    }
  }, []);
  const dismiss = useCallback(() => {
    pending.current = null;
    setBlocked(false);
  }, []);
  const allow = useCallback((continuing: boolean, continuation?: () => void) => {
    if (continuing) return true;
    if (readGenerationMode() === 'playback-only') return false;
    if (readStorage<string>(AGE_KEY) === '18+') return true;
    pending.current = continuation ?? null;
    setBlocked(true);
    return false;
  }, []);
  return (
    <AgeContext value={{ acknowledged, blocked, confirm, dismiss, allow }}>{children}</AgeContext>
  );
}

export function useAgeAcknowledgment() {
  const value = useContext(AgeContext);
  if (!value) throw Error('Age acknowledgment is unavailable');
  return value;
}

export function AgeAcknowledgment() {
  const mode = readGenerationMode();
  const { blocked, confirm, dismiss } = useAgeAcknowledgment();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!blocked || !element) return;
    element.showModal();
    return () => element.close();
  }, [blocked]);
  if (mode === 'playback-only' || !blocked) return null;
  return (
    <dialog
      ref={dialog}
      className="creation-confirmation"
      aria-labelledby="creation-confirmation-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <h2 id="creation-confirmation-title">Confirm before creating</h2>
      <p id="age-required">Confirm you are 18 or older to create a new version.</p>
      <div className="toolbar">
        <button id="confirm-age" onClick={() => confirm(true)}>
          I’m 18 or older
        </button>
        <button onClick={dismiss}>Cancel</button>
      </div>
    </dialog>
  );
}
