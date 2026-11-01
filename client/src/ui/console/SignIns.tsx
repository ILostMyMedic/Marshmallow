// The Settings tab's sign-ins (GET /api/setup/status): the GitHub account gh acts as, Claude Code's sign-in on this
// computer, the local model servers and their models, and the Upstash key. Checked when the tab opens and on Refresh,
// never polled; who and whether only, never a key or a token. The Upstash key's state is the office's own (the store).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { SetupStatus, SignInState } from '../../../../shared/setup';
import { query } from '../../api';
import { useStore } from '../../store';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The id of the Cloud workers card, which the Upstash row links to. */
export const CLOUD_CARD_ID = 'console-cloud';

function Row({ label, ok, state, hint }: { label: string; ok: boolean | null; state: ReactNode; hint?: ReactNode }) {
  return (
    <div className="console-signin">
      <strong>{label}</strong>
      <span className={ok === null ? 'console-hint' : ok ? 'console-good' : 'console-bad'}>{state}</span>
      {hint && <span className="console-hint">{hint}</span>}
    </div>
  );
}

const missing = (s: SignInState) => s === 'missing';

function GitHubRow({ s }: { s: SetupStatus['github'] }) {
  if (s.state === 'ok') return <Row label="GitHub" ok state={<>✓ gh is signed in as <b>{s.login}</b></>} hint="The office and its workers act on GitHub as this account." />;
  return (
    <Row
      label="GitHub"
      ok={false}
      state={missing(s.state) ? "⚠ The GitHub CLI (gh) isn't installed" : '⚠ gh is not logged in'}
      hint={
        <>
          {missing(s.state) && 'Install it from cli.github.com, then '}Run <code>gh auth login</code> in a terminal, then Refresh.
        </>
      }
    />
  );
}

function ClaudeRow({ s }: { s: SetupStatus['claude'] }) {
  if (s.state === 'ok') {
    const how = [s.method, s.plan && `${s.plan} plan`, s.account].filter(Boolean).join(' · ');
    return <Row label="Claude" ok state={`✓ Claude Code is signed in${how ? ` (${how})` : ''}`} hint="Workers on this computer run Claude models with this sign-in." />;
  }
  const state = missing(s.state) ? "⚠ Claude Code wasn't found" : s.state === 'signed-out' ? '⚠ Claude Code is not signed in' : "? Couldn't tell whether Claude Code is signed in";
  return (
    <Row
      label="Claude"
      ok={s.state === 'unknown' ? null : false}
      state={state}
      hint={
        <>
          {missing(s.state) && <>Run <code>npm install</code> in the office's folder (it brings Claude Code), then </>}Sign in by running <code>claude</code> once in a terminal, then Refresh.
        </>
      }
    />
  );
}

function ServerRow({ s }: { s: SetupStatus['localServers'][number] }) {
  if (!s.reachable)
    return (
      <Row
        label={s.label}
        ok={null}
        state={`— Not running at ${s.url}`}
        hint={
          <>
            Only workers on <code>{s.id}/&lt;model&gt;</code> need it: start it (<code>{s.id} serve</code>), then Refresh.
          </>
        }
      />
    );
  return (
    <Row
      label={s.label}
      ok
      state={`✓ Running at ${s.url}${s.models.length ? `, with ${s.models.length} model${s.models.length === 1 ? '' : 's'}` : ''}`}
      hint={
        s.models.length ? (
          <>
            Pick one as <code>{s.id}/{s.models[0]}</code>: {s.models.join(', ')}
          </>
        ) : (
          <>
            No models yet: <code>{s.id} pull gpt-oss:20b</code>
          </>
        )
      }
    />
  );
}

function UpstashRow() {
  const cloud = useStore((s) => s.cloud);
  const toField = () => document.getElementById(CLOUD_CARD_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const link = (
    <button className="link" onClick={toField}>
      {cloud.keySet ? 'Cloud workers' : 'Save one under Cloud workers'}
    </button>
  );
  if (!cloud.keySet) return <Row label="Upstash" ok={null} state="— No Box API key saved" hint={<>Only cloud workers need it. {link}.</>} />;
  return <Row label="Upstash" ok={!cloud.keyError} state={cloud.keyError ? `⚠ ${cloud.keyError}` : '✓ A Box API key is saved'} hint={<>It's kept on this computer, never shown again: {link}.</>} />;
}

export function SignInsCard() {
  const demo = useStore((s) => s.demo);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [problem, setProblem] = useState('');
  const [checking, setChecking] = useState(false);
  const check = useCallback(() => {
    setChecking(true);
    setProblem('');
    query<SetupStatus>('/api/setup/status')
      .then(setStatus, (err: Error) => setProblem(err.message))
      .finally(() => setChecking(false));
  }, []);
  useEffect(check, [check]);
  return (
    <section className="console-card console-span">
      <div className="console-row">
        <h3 className="console-h console-grow">🔑 Sign-ins</h3>
        {status && <span className="console-hint">checked {time(status.checkedAt)}</span>}
        <button className="console-btn small" disabled={checking} onClick={check}>
          {checking ? 'Checking…' : '⟳ Refresh'}
        </button>
      </div>
      <p className="console-hint">What the office runs on, on this computer{demo ? ' (in the demo, pretend ones)' : ''}.</p>
      {problem && <p className="console-bad">{problem}</p>}
      {!status && !problem && <p className="console-hint">Checking…</p>}
      {status && (
        <>
          <GitHubRow s={status.github} />
          <ClaudeRow s={status.claude} />
          {status.localServers.map((s) => (
            <ServerRow key={s.id} s={s} />
          ))}
        </>
      )}
      <UpstashRow />
    </section>
  );
}
