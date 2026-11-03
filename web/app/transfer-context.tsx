import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, fetchJson } from './api';
import {
  appPath,
  describeShare,
  logicalPathname,
  shareAddress,
  type ShareMessage,
} from './data-source';
import type { Ability, Artifact, Destination, DestinationId } from './types';

interface TransferState {
  destinations: Destination[];
  ability: Ability | null;
  destination: Destination | null;
  artifact: Artifact | null;
  revision: number;
  error: string | null;
  note: string;
}
interface TransferController extends TransferState {
  selectDestination(id: DestinationId): Promise<void>;
  openRoadsterArtifact(id: string): Promise<void>;
  savedRoadsterId?: string;
  shareMessage: ShareMessage | null;
  share(): Promise<void>;
}
const TransferContext = createContext<TransferController | null>(null);
async function roadsterArtifact(id: string, signal?: AbortSignal): Promise<Artifact> {
  const [artifact, report] = await Promise.all([
    fetchJson<Artifact>('/api/roadster/artifacts/' + id, { signal }),
    fetchJson<{ conformance: { results: unknown[] }; browser: { results: unknown[] } }>(
      '/roadster/artifacts/' + id + '/report.json',
      { signal },
    ),
  ]);
  return {
    ...artifact,
    conformanceChecks: report.conformance.results.length,
    browserChecks: report.browser.results.length,
  };
}
export function TransferProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TransferState>({
    destinations: [],
    ability: null,
    destination: null,
    artifact: null,
    revision: 0,
    error: null,
    note: 'Reading saved, verified destinations…',
  });
  const cache = useRef<{ paku?: Artifact; roadster?: Artifact }>({});
  const version = useRef(0);
  const [shareMessage, setShareMessage] = useState<ShareMessage | null>(null);
  const choose = useCallback(
    (destination: Destination, artifact: Artifact | null, navigate = false) => {
      version.current++;
      setState((current) => ({
        ...current,
        destination,
        artifact,
        revision: current.revision + 1,
        error: null,
        note: `${destination.name}: playing a saved ${artifact?.parentArtifactId ? 'remix' : 'transfer'}. Choosing a destination makes no model request.`,
      }));
      setShareMessage(null);
      if (navigate) {
        const next =
          destination.id === 'roadster'
            ? '/roadster/play/' + artifact?.id
            : artifact?.parentArtifactId
              ? '/play/' + artifact.id
              : '/?destination=' + destination.id;
        history.pushState({}, '', appPath(next));
      }
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [catalog, ability, transfer] = await Promise.all([
        fetchJson<{ destinations: Destination[] }>('/api/destinations', {
          signal: controller.signal,
        }),
        fetchJson<Ability>('/api/ability', { signal: controller.signal }),
        fetchJson<Artifact & { status: string }>('/api/transfer', { signal: controller.signal }),
      ]);
      let destinations = catalog.destinations.filter((item) => item.componentId === ability.id);
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) destinations = destinations.filter((item) => item.id !== 'roadster');
      else gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (!destinations.length) throw Error('No verified destinations are available');
      if (transfer.status === 'verified')
        cache.current.paku = {
          ...transfer,
          intent: { unitScale: 0.5, activation: 'held', direction: 'facing' },
        };
      const car = destinations.find((item) => item.id === 'roadster');
      if (car) cache.current.roadster = await roadsterArtifact(car.artifactId, controller.signal);
      if (!controller.signal.aborted)
        setState((current) => ({ ...current, destinations, ability }));
    })().catch((error: unknown) => {
      if (!controller.signal.aborted)
        setState((current) => ({
          ...current,
          error: errorMessage(error),
          note: errorMessage(error),
        }));
    });
    return () => controller.abort();
  }, []);
  const loadRoute = useCallback(
    async (signal: AbortSignal) => {
      if (!state.destinations.length) return;
      const requestVersion = ++version.current;
      let target = state.destinations.find(
        (item) => item.id === new URL(location.href).searchParams.get('destination'),
      );
      const pathname = logicalPathname(location.pathname);
      const carId = pathname.match(/^\/roadster\/play\/([a-f0-9]{64})$/)?.[1];
      const id = pathname.match(/^\/play\/([a-f0-9]{64})$/)?.[1];
      if (carId) {
        cache.current.roadster = await roadsterArtifact(carId, signal);
        target = state.destinations.find((item) => item.id === 'roadster');
      }
      if (id) {
        target = state.destinations.find((item) => item.artifactId === id);
        if (!target) {
          cache.current.paku = await fetchJson<Artifact>('/api/artifacts/' + id, { signal });
          target = state.destinations.find((item) => item.id === 'paku-paku');
        }
      }
      if (requestVersion !== version.current || signal.aborted) return;
      const destination = target ?? state.destinations[0];
      if (destination)
        choose(
          destination,
          destination.id === 'roadster'
            ? (cache.current.roadster ?? null)
            : destination.id === 'paku-paku'
              ? (cache.current.paku ?? null)
              : null,
        );
    },
    [state.destinations, choose],
  );
  useEffect(() => {
    const controller = new AbortController();
    const route = () => {
      void loadRoute(controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            error: errorMessage(error),
            note: errorMessage(error),
          }));
      });
    };
    route();
    window.addEventListener('popstate', route);
    return () => {
      controller.abort();
      window.removeEventListener('popstate', route);
    };
  }, [loadRoute]);
  const selectDestination = useCallback(
    async (id: DestinationId) => {
      const destination = state.destinations.find((item) => item.id === id);
      if (!destination) throw Error('Destination unavailable');
      choose(
        destination,
        id === 'roadster'
          ? (cache.current.roadster ?? null)
          : id === 'paku-paku'
            ? (cache.current.paku ?? null)
            : null,
        true,
      );
    },
    [state.destinations, choose],
  );
  const openRoadsterArtifact = useCallback(
    async (id: string) => {
      const artifact = await roadsterArtifact(id);
      const destination = state.destinations.find((item) => item.id === 'roadster');
      if (!destination) throw Error('Destination unavailable');
      cache.current.roadster = artifact;
      choose(destination, artifact, true);
    },
    [state.destinations, choose],
  );
  const savedRoadsterId = state.destinations.find((item) => item.id === 'roadster')?.artifactId;
  // Retain the existing diagnostic/automation interface; application components use context.
  useEffect(() => {
    window.currentDestination = state.destination?.id;
    window.currentArtifact = state.destination?.id === 'roadster' ? null : state.artifact;
    window.currentRoadsterArtifact = state.destination?.id === 'roadster' ? state.artifact : null;
    window.savedRoadsterId = savedRoadsterId;
    window.selectDestination = selectDestination;
    window.openRoadsterArtifact = openRoadsterArtifact;
    return () => {
      delete window.selectDestination;
      delete window.openRoadsterArtifact;
    };
  }, [state.destination, state.artifact, savedRoadsterId, selectDestination, openRoadsterArtifact]);
  async function share() {
    const { destination, artifact } = state;
    if (!destination) return;
    const path =
      destination.id === 'roadster'
        ? '/roadster/play/' + artifact?.id
        : artifact
          ? '/play/' + artifact.id
          : '/?destination=' + destination.id;
    const address = shareAddress(path);
    if (address.unconfigured) {
      setShareMessage({
        text: 'A public link is not configured.',
        url: '',
        copied: false,
        local: false,
      });
      return;
    }
    let copied = false;
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(address.url);
      copied = true;
    } catch {
      /* Leave the address visible when the clipboard is blocked or unavailable. */
    }
    setShareMessage(describeShare(address.url, copied));
  }
  return (
    <TransferContext
      value={{
        ...state,
        selectDestination,
        openRoadsterArtifact,
        savedRoadsterId,
        shareMessage,
        share,
      }}
    >
      {children}
    </TransferContext>
  );
}
export function useTransfer() {
  const value = useContext(TransferContext);
  if (!value) throw Error('Transfer context is unavailable');
  return value;
}
