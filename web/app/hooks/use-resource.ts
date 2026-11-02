import { useEffect, useState } from 'react';
import { errorMessage, fetchJson } from '../api';

export function useResource<T>(path: string) {
  const [result, setResult] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<T>(path, { signal: controller.signal })
      .then((data) => setResult({ data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [path]);
  return result;
}
