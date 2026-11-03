import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { readGenerationMode } from './data-source';
import { TransferProvider } from './transfer-context';
import { useLabStatus } from './hooks/use-job';
import { AgeAcknowledgment, AgeProvider } from './components/age-acknowledgment';
import { PrivacyNote } from './components/privacy-note';
import { Header, Intro, RecoveryDetails, Footer } from './components/static-content';
import { Destinations, Players } from './components/players';
import { DeveloperTask } from './components/developer-task';
import { DeveloperBenchmarks } from './components/developer-benchmarks';
import { Proof, TransferExplanation } from './components/proof';
import { InvestigationPanel } from './components/investigation-panel';
import { RemixPanel } from './components/remix-panel';
import { ArtifactDetails } from './components/artifact-details';
import { MotionWorkbench } from './motion-workbench';

class AppBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application rendering failed', error, info.componentStack);
  }
  render() {
    return this.state.error ? (
      <main>
        <h1>The interface could not render.</h1>
        <p role="alert">
          Reload to reconnect. Saved runs and playable versions remain on the server.
        </p>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function Experience() {
  const status = useLabStatus();
  const playback = readGenerationMode() === 'playback-only';
  return (
    <main>
      <Header />
      <AgeAcknowledgment />
      <Intro />
      <Players />
      <RemixPanel status={status} />
      <Destinations />
      <details className="evidence-drawer" id="evidence-details">
        <summary>Explore the recovery, source and verification</summary>
        <TransferExplanation />
        {playback ? null : (
          <>
            <DeveloperTask />
            <DeveloperBenchmarks />
            <Proof />
            <InvestigationPanel status={status} />
          </>
        )}
        <RecoveryDetails />
        <ArtifactDetails />
      </details>
      <PrivacyNote />
      <Footer />
    </main>
  );
}
export function App() {
  if (
    !window.__MOTION_TRANSFER__ &&
    (new URL(location.href).searchParams.get('destination') === 'parallaxia' ||
      (location.pathname === '/' && !location.search))
  )
    return <MotionWorkbench />;
  return (
    <AppBoundary>
      <AgeProvider>
        <TransferProvider>
          <Experience />
        </TransferProvider>
      </AgeProvider>
    </AppBoundary>
  );
}
