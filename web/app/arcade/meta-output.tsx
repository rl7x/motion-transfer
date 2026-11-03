import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, fetchJson } from '../api';
import { linkHref } from '../links';
import { intentBadges } from './intent';
import type { DashIntent } from './intent';
import { MetaChip } from './meta-chip';
import { PixelSprite } from './pixel-sprite';

interface OutputItem {
  type?: string;
  name?: string;
  arguments?: string;
  content?: { text?: string }[];
}
interface GenerationAttempt {
  attempt?: number;
  startedAt?: string;
  finishedAt?: string;
  inputTokens?: number;
  estimatedCostUsd?: number;
  passed?: boolean;
  failure?: string;
  response?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
    };
    output?: OutputItem[];
  };
}
export interface GenerationRecord {
  prompt?: string;
  model?: string;
  attempts?: GenerationAttempt[];
  estimatedCostUsd?: number;
}
export interface ReceiptCheck {
  name: string;
  passed: boolean;
  error?: string;
}
export interface ReceiptRecord {
  passed?: boolean;
  kind?: string;
  model?: string;
  summary?: string;
  intent?: DashIntent | null;
  rule?: { kind?: string } | null;
  frameSha256?: string;
  native?: { checks?: ReceiptCheck[]; executedIn?: string };
  browser?: { checks?: ReceiptCheck[] };
  experiment?: { satisfied?: boolean } | null;
}

export interface AttemptView {
  attempt: number;
  message: string | null;
  tool: string | null;
  args: Record<string, unknown> | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  ms: number | null;
  costUsd: number | null;
  passed: boolean | null;
  failure: string | null;
}

/** Read one recorded Meta response: its short message, the single tool call and usage. */
export function parseAttempt(attempt: GenerationAttempt, index: number): AttemptView {
  const output = Array.isArray(attempt.response?.output) ? attempt.response.output : [];
  const message =
    output
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .map((part) => part.text ?? '')
      .join(' ')
      .trim() || null;
  const call = output.find((item) => item.type === 'function_call');
  let args: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = call?.arguments ? JSON.parse(call.arguments) : null;
    if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
  } catch {
    args = null;
  }
  const usage = attempt.response?.usage;
  const started = Date.parse(attempt.startedAt ?? '');
  const finished = Date.parse(attempt.finishedAt ?? '');
  return {
    attempt: attempt.attempt ?? index + 1,
    message,
    tool: call?.name ?? null,
    args,
    inputTokens: usage?.input_tokens ?? attempt.inputTokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
    ms: Number.isFinite(started) && Number.isFinite(finished) ? finished - started : null,
    costUsd: typeof attempt.estimatedCostUsd === 'number' ? attempt.estimatedCostUsd : null,
    passed: typeof attempt.passed === 'boolean' ? attempt.passed : null,
    failure: attempt.failure ?? null,
  };
}

export function attemptsOf(generation: GenerationRecord | null): AttemptView[] {
  return Array.isArray(generation?.attempts) ? generation.attempts.map(parseAttempt) : [];
}

export function checksOf(receipt: ReceiptRecord | null): {
  native: ReceiptCheck[];
  browser: ReceiptCheck[];
} {
  const valid = (checks: unknown): ReceiptCheck[] =>
    Array.isArray(checks)
      ? checks.filter(
          (check): check is ReceiptCheck =>
            Boolean(check) && typeof check.name === 'string' && typeof check.passed === 'boolean',
        )
      : [];
  return { native: valid(receipt?.native?.checks), browser: valid(receipt?.browser?.checks) };
}

export interface ArtifactEvidence {
  generation: GenerationRecord | null;
  receipt: ReceiptRecord | null;
  loading: boolean;
  error: string;
}

/** Load the saved Meta response and verification receipt for one published version. */
export function useArtifactEvidence(id: string | null): ArtifactEvidence {
  const [state, setState] = useState<ArtifactEvidence>({
    generation: null,
    receipt: null,
    loading: Boolean(id),
    error: '',
  });
  useEffect(() => {
    if (!id || !/^[a-f0-9]{64}$/.test(id)) {
      setState({ generation: null, receipt: null, loading: false, error: '' });
      return;
    }
    const controller = new AbortController();
    setState({ generation: null, receipt: null, loading: true, error: '' });
    void Promise.allSettled([
      fetchJson<GenerationRecord>(`/artifacts/${id}/generation.json`, {
        signal: controller.signal,
      }),
      fetchJson<ReceiptRecord>(`/artifacts/${id}/receipt.json`, { signal: controller.signal }),
    ]).then(([generation, receipt]) => {
      if (controller.signal.aborted) return;
      setState({
        generation: generation.status === 'fulfilled' ? generation.value : null,
        receipt: receipt.status === 'fulfilled' ? receipt.value : null,
        loading: false,
        error:
          generation.status === 'rejected'
            ? errorMessage(generation.reason)
            : receipt.status === 'rejected'
              ? errorMessage(receipt.reason)
              : '',
      });
    });
    return () => controller.abort();
  }, [id]);
  return state;
}

/** Break single-line generated source into indented lines. Strings are left intact. */
export function formatSource(source: string): string {
  let out = '';
  let depth = 0;
  let paren = 0;
  let quote: string | null = null;
  const pad = () => '\n' + '  '.repeat(depth);
  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    if (quote) {
      out += ch;
      if (ch === '\\') out += source[++index] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '(') paren++;
    if (ch === ')') paren = Math.max(0, paren - 1);
    if (ch === '{') {
      depth++;
      out += '{' + pad();
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      out = out.trimEnd() + pad() + '}';
      const rest = source.slice(index + 1);
      if (paren === 0 && /^[A-Za-z_$]/.test(rest) && !/^else\b/.test(rest)) out += pad();
      continue;
    }
    if (ch === ';' && paren === 0) {
      out += ';' + pad();
      continue;
    }
    out += ch;
  }
  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .join('\n');
}

const TOKEN =
  /(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b(?:export|default|function|const|let|var|if|else|return|for|while|new|true|false|null|typeof)\b|\b(?:any|number|string|boolean)\b)/g;

function tokenClass(token: string): string | null {
  if (token.startsWith('//')) return 'tok-com';
  if (/^["'`]/.test(token)) return 'tok-str';
  if (/^\d/.test(token)) return 'tok-num';
  if (/^(any|number|string|boolean)$/.test(token)) return 'tok-type';
  if (/^[a-z]+$/.test(token)) return 'tok-key';
  return null;
}

export function CodeBlock({ source, label }: { source: string; label: string }) {
  const lines = formatSource(source).split('\n');
  return (
    <figure className="code">
      <figcaption>{label}</figcaption>
      <pre>
        <code>
          {lines.map((line, row) => (
            <span className="code__line" key={row}>
              {line.split(TOKEN).map((part, index) => {
                if (!part) return null;
                const kind = tokenClass(part);
                return kind ? (
                  <span key={index} className={kind}>
                    {part}
                  </span>
                ) : (
                  part
                );
              })}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

const TOOL_LABEL: Record<string, string> = {
  submit_parallaxia_adapter: 'adapter remix',
  submit_parallaxia_composition: 'dash-end composition',
  submit_parallaxia_experiment: 'checkpoint experiment',
};

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="meta-output__stat">
      <small>{label}</small>
      {children}
    </span>
  );
}

function AttemptCard({ view, total }: { view: AttemptView; total: number }) {
  const repair = view.attempt > 1;
  return (
    <li className={'attempt' + (view.passed === false ? ' is-failed' : ' is-passed')}>
      <span className="attempt__who">
        <PixelSprite name="spark" size={40} mood={view.passed === false ? 'slump' : undefined} />
      </span>
      <div className="attempt__body">
        <p className="attempt__heading">
          {repair ? `Repair · attempt ${view.attempt} of ${total}` : `Attempt ${view.attempt}`}
          {view.tool ? (
            <code className="attempt__tool" title={TOOL_LABEL[view.tool] ?? view.tool}>
              {view.tool}()
            </code>
          ) : null}
        </p>
        {view.message ? (
          <blockquote className="attempt__bubble">“{view.message}”</blockquote>
        ) : null}
        <p className="attempt__stats">
          {view.inputTokens !== null ? (
            <Stat label="in">{view.inputTokens.toLocaleString()} tok</Stat>
          ) : null}
          {view.outputTokens !== null ? (
            <Stat label="out">
              {view.outputTokens.toLocaleString()} tok
              {view.reasoningTokens ? ` · ${view.reasoningTokens} reasoning` : ''}
            </Stat>
          ) : null}
          {view.ms !== null ? <Stat label="time">{(view.ms / 1000).toFixed(1)} s</Stat> : null}
          {view.costUsd !== null ? <Stat label="cost">${view.costUsd.toFixed(5)}</Stat> : null}
        </p>
        <p className="attempt__outcome">
          {view.passed === false
            ? `✗ ${view.failure ?? 'Rejected by verification'}${view.attempt < total ? ' → sent back with verifier feedback' : ''}`
            : view.passed
              ? '✓ Passed verification'
              : null}
        </p>
      </div>
    </li>
  );
}

function CheckGroup({ title, checks }: { title: string; checks: ReceiptCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <div className="checks__group">
      <h4>
        {title} · {checks.filter((check) => check.passed).length}/{checks.length}
      </h4>
      <ul>
        {checks.map((check) => (
          <li key={check.name} className={check.passed ? 'is-passed' : 'is-failed'}>
            <span aria-hidden="true">{check.passed ? '✓' : '✗'}</span> {check.name}
            {check.error ? <small> — {check.error}</small> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The exact Meta request outcome behind one saved version: words, tool call, code and checks. */
export function MetaOutputPanel({
  artifactId,
  title,
  onClose,
}: {
  artifactId: string;
  title?: string;
  onClose?(): void;
}) {
  const { generation, receipt, loading, error } = useArtifactEvidence(artifactId);
  const attempts = attemptsOf(generation);
  const final = attempts[attempts.length - 1] ?? null;
  const args = final?.args ?? null;
  const source = typeof args?.source === 'string' ? args.source : null;
  const ruleSource =
    typeof args?.ruleSource === 'string' && args.ruleSource.trim() !== 'export default null;'
      ? args.ruleSource
      : null;
  const intent = (args?.intent as DashIntent | undefined) ?? receipt?.intent ?? null;
  const checks = checksOf(receipt);
  const model = generation?.model ?? receipt?.model ?? 'muse-spark';
  return (
    <section className="meta-output" aria-label="What Muse Spark wrote">
      <header className="meta-output__header">
        <div>
          <MetaChip>{model}</MetaChip>
          <h3>What Muse Spark wrote{title ? ` · ${title}` : ''}</h3>
          <p className="meta-output__via">
            Meta Model API · <code>POST /v1/responses</code> · one strict tool call per attempt
          </p>
        </div>
        {onClose ? (
          <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
            Close
          </button>
        ) : null}
      </header>
      {loading ? <p className="meta-output__loading">Opening the saved response…</p> : null}
      {!loading && !generation && !receipt ? (
        <p className="meta-output__empty">
          No saved Meta response is available for this version{error ? ` (${error})` : ''}.
        </p>
      ) : null}
      {generation?.prompt ? (
        <p className="meta-output__prompt">
          <small>You asked</small>
          <span>“{generation.prompt}”</span>
        </p>
      ) : null}
      {attempts.length > 0 ? (
        <ol className="meta-output__attempts">
          {attempts.map((view) => (
            <AttemptCard key={view.attempt} view={view} total={attempts.length} />
          ))}
        </ol>
      ) : null}
      {intent || typeof args?.summary === 'string' ? (
        <div className="meta-output__mapping">
          <h4>Mapping it chose</h4>
          <p className="badges">
            {intentBadges(intent).map((badge) => (
              <span key={badge.key} className="badge">
                <b>{badge.glyph}</b> {badge.label}
              </span>
            ))}
            {typeof args?.interventionTick === 'number' ? (
              <span className="badge">
                <b>◎</b> dash at tick {args.interventionTick}
              </span>
            ) : null}
          </p>
          {typeof args?.summary === 'string' ? <p>{args.summary}</p> : null}
        </div>
      ) : null}
      {ruleSource ? <CodeBlock source={ruleSource} label="Host rule module · rule.mjs" /> : null}
      {source ? (
        <CodeBlock source={source} label="Adapter written by Muse Spark · adapter.ts" />
      ) : null}
      {checks.native.length + checks.browser.length > 0 ? (
        <div className="checks">
          <CheckGroup title="Restricted worker · native simulation" checks={checks.native} />
          <CheckGroup title="Headless browser · exact frame" checks={checks.browser} />
          {receipt?.frameSha256 ? (
            <p className="checks__hash">
              Published frame sha256 <code>{receipt.frameSha256.slice(0, 16)}…</code>
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="meta-output__links">
        <a href={linkHref(`/artifacts/${artifactId}/generation.json`)}>Raw Meta response</a> ·{' '}
        <a href={linkHref(`/artifacts/${artifactId}/adapter.ts`)}>adapter.ts</a> ·{' '}
        <a href={linkHref(`/artifacts/${artifactId}/receipt.json`)}>Verification receipt</a>
      </p>
    </section>
  );
}
