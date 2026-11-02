import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { TransferProvider } from './transfer-context';
import { useLabStatus } from './hooks/use-job';
import { Header, Intro, RecoveryDetails, Footer } from './components/static-content';
import { Destinations, Players } from './components/players';
import { DeveloperTask } from './components/developer-task';
import { DeveloperBenchmarks } from './components/developer-benchmarks';
import { Proof, TransferExplanation } from './components/proof';
import { InvestigationPanel } from './components/investigation-panel';
import { RemixPanel } from './components/remix-panel';
import { ArtifactDetails } from './components/artifact-details';

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
  return (
    <main>
      <Header />
      <Intro />
      <Destinations />
      <Players />
      <TransferExplanation />
      <DeveloperTask />
      <DeveloperBenchmarks />
      <Proof />
      <InvestigationPanel status={status} />
      <RecoveryDetails />
      <RemixPanel status={status} />
      <ArtifactDetails />
      <Footer />
    </main>
  );
}
export function App() {
  return (
    <AppBoundary>
      <TransferProvider>
        <Experience />
      </TransferProvider>
    </AppBoundary>
  );
}
