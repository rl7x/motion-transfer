import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, fetchJson, postJson, readStorage, writeStorage } from '../api';
import type { Job, ServiceStatus } from '../types';

export function useLabStatus() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        setStatus(await fetchJson<ServiceStatus>('/api/lab/status', { signal: controller.signal }));
      } catch {
        /* Keep the last known status during a transient read failure. */
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  return status;
}
interface Pending<R> {
  request: R;
  id?: string;
}
export function useJob<R extends { idempotencyKey: string }, T>({
  storageKey,
  submitPath,
  pollPath,
  onReady,
}: {
  storageKey: string;
  submitPath: string;
  pollPath: string;
  onReady?: (job: Job<T>) => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending<R> | null>(() =>
    readStorage<Pending<R>>(storageKey),
  );
  const [job, setJob] = useState<Job<T> | null>(null),
    [error, setError] = useState<string | null>(null),
    [submitting, setSubmitting] = useState(false);
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);
  const save = useCallback(
    (value: Pending<R> | null) => {
      writeStorage(storageKey, value);
      setPending(value);
    },
    [storageKey],
  );
  useEffect(() => {
    if (!pending?.id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await fetchJson<Job<T>>(pollPath + pending.id, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJob(result);
        if (['ready', 'failed'].includes(result.status)) {
          save(null);
          if (result.status === 'failed') setError(result.error ?? 'The run failed.');
          else await ready.current?.(result);
          return;
        }
        timer = setTimeout(() => {
          void poll();
        }, 750);
      } catch (failure) {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pending?.id, pollPath, save]);
  const submit = async (request: R) => {
    if (submitting || pending?.id) return;
    const selected = pending?.request ?? request;
    save({ request: selected });
    setSubmitting(true);
    setError(null);
    try {
      const result = await fetchJson<Job<T>>(submitPath, postJson(selected));
      setJob(result);
      save({ request: selected, id: result.id });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  };
  return {
    pending,
    job,
    error,
    submitting,
    running: submitting || Boolean(pending?.id),
    reconnect: Boolean(pending && !pending.id),
    submit,
  };
}
