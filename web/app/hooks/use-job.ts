import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, fetchJson, postJson, readStorage, writeStorage } from '../api';
import type { Job, ServiceStatus } from '../types';

export function useLabStatus(path = '/api/lab/status') {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        setStatus(await fetchJson<ServiceStatus>(path, { signal: controller.signal }));
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
  }, [path]);
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
  legacyRunKey,
}: {
  storageKey: string;
  submitPath: string;
  pollPath: string;
  onReady?: (job: Job<T>) => Promise<void>;
  legacyRunKey?: string;
}) {
  const [pending, setPending] = useState<Pending<R> | null>(() => {
    const stored = readStorage<Pending<R>>(storageKey);
    try {
      const id = legacyRunKey ? sessionStorage.getItem(legacyRunKey) : null;
      return stored && id ? { ...stored, id: stored.id ?? id } : stored;
    } catch {
      return stored;
    }
  });
  const [job, setJob] = useState<Job<T> | null>(null),
    [error, setError] = useState<string | null>(null),
    [submitting, setSubmitting] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);
  const save = useCallback(
    (value: Pending<R> | null) => {
      writeStorage(storageKey, value);
      if (!value && legacyRunKey) writeStorage(legacyRunKey, null);
      setPending(value);
    },
    [storageKey, legacyRunKey],
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
  }, [pending?.id, pollPath, save, pollRevision]);
  const submit = async (request: R) => {
    if (submitting) return;
    if (pending?.id) {
      if (error) {
        setError(null);
        setPollRevision((value) => value + 1);
      }
      return;
    }
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
    running: submitting || Boolean(pending?.id && !error),
    reconnect: Boolean(pending && (!pending.id || error)),
    submit,
  };
}
