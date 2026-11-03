import { useTransfer } from '../transfer-context';

export function ShareStatus({ id, fallback = false }: { id: string; fallback?: boolean }) {
  const { shareMessage } = useTransfer();
  if (!shareMessage) return null;
  const showAddress = fallback && (shareMessage.local || !shareMessage.copied);
  return (
    <div className="share-status" id={id}>
      <p role="status">{shareMessage.text}</p>
      {showAddress && (
        <input
          id="share-fallback"
          className="share-fallback"
          readOnly
          spellCheck={false}
          value={shareMessage.url}
          aria-label="Playable address"
        />
      )}
    </div>
  );
}
