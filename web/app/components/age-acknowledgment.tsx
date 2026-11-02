import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { readStorage, writeStorage } from '../api';
import { modelPolicy, readGenerationMode } from '../data-source';

const AGE_KEY = 'motion-transfer-age';
interface AgeController {
  acknowledged: boolean;
  blocked: boolean;
  confirm(checked: boolean): void;
  allow(continuing: boolean): boolean;
}
const AgeContext = createContext<AgeController | null>(null);

export function AgeProvider({ children }: { children: ReactNode }) {
  const [acknowledged, setAcknowledged] = useState(() => readStorage<string>(AGE_KEY) === '18+');
  const [blocked, setBlocked] = useState(false);
  const confirm = useCallback((checked: boolean) => {
    writeStorage(AGE_KEY, checked ? '18+' : null);
    setAcknowledged(checked);
    if (checked) setBlocked(false);
  }, []);
  const allow = useCallback((continuing: boolean) => {
    if (continuing) return true;
    if (readGenerationMode() === 'playback-only') return false;
    if (readStorage<string>(AGE_KEY) === '18+') return true;
    setBlocked(true);
    document.getElementById('age-acknowledgment')?.scrollIntoView({ block: 'nearest' });
    document.getElementById('confirm-age')?.focus();
    return false;
  }, []);
  return <AgeContext value={{ acknowledged, blocked, confirm, allow }}>{children}</AgeContext>;
}

export function useAgeAcknowledgment() {
  const value = useContext(AgeContext);
  if (!value) throw Error('Age acknowledgment is unavailable');
  return value;
}

export function AgeAcknowledgment() {
  const mode = readGenerationMode();
  const { acknowledged, blocked, confirm } = useAgeAcknowledgment();
  return (
    <section id="age-acknowledgment" className="age-acknowledgment" data-generation={mode}>
      <div className="age-row">
        {mode === 'playback-only' ? (
          <p id="audience-notice">Intended audience: adults 18 and older. No account.</p>
        ) : (
          <label htmlFor="confirm-age">
            <input
              id="confirm-age"
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => confirm(event.target.checked)}
            />
            <span>I am 18 or older. No account is required to play or create.</span>
          </label>
        )}
        <a href="#privacy-note">Privacy</a>
      </div>
      <p id="model-policy" className="age-policy">
        {modelPolicy(mode)}
      </p>
      {blocked && (
        <p id="age-required" className="age-required" role="alert">
          Confirm you are 18 or older before a model request. Playing the saved challenge does not
          send one.
        </p>
      )}
    </section>
  );
}
