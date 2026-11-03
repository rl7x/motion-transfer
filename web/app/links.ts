import { appPath } from './data-source';

/** Root-absolute link or frame address. Unset base path returns the same string the local app uses. */
export function linkHref<T extends string | null | undefined>(path: T): T {
  if (typeof path !== 'string' || path.length === 0) return path;
  return appPath(path) as T;
}
