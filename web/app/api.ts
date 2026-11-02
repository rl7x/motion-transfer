import { injectedResource } from './data-source';

export async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  if ((options?.method ?? 'GET') === 'GET' && typeof window !== 'undefined') {
    const injected = injectedResource(path);
    if (injected !== undefined) return injected as T;
  }
  const response = await fetch(path, options);
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body ? String(body.error) : 'Request failed';
    throw new Error(message);
  }
  return body as T;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
export function readStorage<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
export function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Server journals retain requests when local storage is unavailable. */
  }
}
