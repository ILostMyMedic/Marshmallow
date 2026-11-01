// A worker's panel: who they are and what they're on, their live terminal, a message box that drops a note into their
// running session, and their setup (model, effort, stop, reset, let go, a cloud worker's sign-in). E on their desk or a
// click on their chip opens it; the CEO's desk opens theirs, where the message box writes to the CEO.
// Adapted from cubefarm client/src/ui/TerminalView.tsx and AgentSettings.tsx (MIT); cut: the career card, the follow
// cam, the browser pane, the mic, handing out work by hand, and the setup's name, look, coding agent, machine and prompt.
import { useEffect, useState, type ReactNode } from 'react';
import { isBusy, type EffortLevel, type Worker, type WorkerStatus } from '../../../shared/types';
import { CLAUDE_MODELS } from '../../../shared/models';
import { command } from '../api';
import { useStore } from '../store';
import { useView } from '../world/view';
import { LiveTerminal } from './LiveTerminal';
import { MessageBox } from './MessageBox';
import { Panel } from './Panel';
import { useCommand } from './useCommand';

/** What a worker is on, in a few words. */
export function doing(w: Worker) {
  const t = w.task;
  if (!t || w.status === 'idle') return w.role === 'ceo' ? 'CEO · running the company' : 'free';
  const what = t.kind === 'qa' ? `testing PR #${t.prNumber}` : t.kind === 'fix' ? `fixing PR #${t.prNumber}` : `issue #${t.issueNumber}`;
  return `${what} · ${t.title}`;
}

const STATUS_LABEL: Record<WorkerStatus, string> = { idle: 'free', preparing: 'setting up', working: 'working', done: 'done', error: 'needs help', stopped: 'stopped' };

export const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Local models a worker on this computer can run (a Box can't reach them); any other name can still be typed. */
const LOCAL_SUGGESTIONS = ['ollama/gpt-oss:20b', 'ollama/qwen3:8b'];

/** Time on the current task, ticking while they work. */
function Elapsed({ from, to }: { from: number; to: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [to]);
  const s = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000));
  return <span>⏱ {`${Math.floor(s / 60)}m ${s % 60}s`}</span>;
}

/** Their task as a link to GitHub, their branch, what they run on, and how long and how much it took. */
function TaskLine({ w }: { w: Worker }) {
  const floor = useStore((s) => s.floors.find((f) => f.id === w.floorId));
  const settings = useStore((s) => s.settings);
  const t = w.status === 'idle' ? null : w.task;
  const repo = floor?.url ?? '';
  const link = (href: string | null, text: ReactNode) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer">
        {text}
      </a>
    ) : (
      <span>{text}</span>
    );
  const prUrl = t?.prUrl ?? (t?.prNumber && repo ? `${repo}/pull/${t.prNumber}` : null);
  return (
    <div className="wp-meta">
      {!t ? (
        <span className="wp-muted">{w.role === 'ceo' ? 'Onboards floors, plans your briefs into issues and answers your messages.' : 'Nothing assigned'}</span>
      ) : t.kind === 'issue' ? (
        link(repo && t.issueNumber ? `${repo}/issues/${t.issueNumber}` : null, `Issue #${t.issueNumber}: ${t.title}`)
      ) : (
        link(prUrl, `${t.kind === 'qa' ? 'Testing' : 'Fixing'} PR #${t.prNumber}: ${t.title}`)
      )}
      {t?.kind === 'issue' && t.prNumber && link(prUrl, <span className="wp-chip wp-chip-good">PR #{t.prNumber}</span>)}
      {t?.branch && <code>{t.branch}</code>}
      <span className="wp-muted">
        {w.model || settings.defaultModel} · {w.effort || settings.defaultEffort} effort
      </span>
      {t && w.startedAt && (isBusy(w.status) || w.endedAt) && (
        <span className="wp-muted">
          <Elapsed from={w.startedAt} to={isBusy(w.status) ? null : w.endedAt} />
        </span>
      )}
      {t && w.turns > 0 && <span className="wp-muted">{w.turns} turns</span>}
      {t && w.costUsd > 0 && (
        <span className="wp-muted" title="API-equivalent cost reported by Claude Code; a subscription is billed by its plan">
          ≈${w.costUsd.toFixed(2)}
        </span>
      )}
      {w.host === 'box' && <span className="wp-chip">☁ {w.cloud ?? 'cloud'}</span>}
      {w.leaving && <span className="wp-chip">🧳 leaving after this task</span>}
    </div>
  );
}

/** A cloud worker whose Claude Code waits to be signed in: its own login runs in their terminal. */
function SignIn({ w }: { w: Worker }) {
  const { busy, error, run } = useCommand();
  const [started, setStarted] = useState(false);
  return (
    <div className="wp-signin" role="status">
      <span>
        <b>🔑 Sign {w.name}'s Claude Code in</b>
        <br />
        {started
          ? 'Open the link in their terminal, approve it with your Claude account, then paste the code the page gives you into the terminal and press Enter. Their cloud machine keeps the sign-in.'
          : "Their cloud machine's Claude Code isn't signed in, so they take no work. Sign in starts its own login in their terminal below."}
        {error && <span className="wp-error"> {error}</span>}
      </span>
      <button className="wp-btn" disabled={busy || isBusy(w.status)} onClick={() => void run(() => command('POST', `/api/workers/${w.id}/sign-in`)).then((ok) => ok && setStarted(true))}>
        {started ? '↻ Start over' : '🔑 Sign in'}
      </button>
    </div>
  );
}

/** The message box: a note into their running session, or for the CEO a message (it goes to your latest chat on the desktop, and so does their reply). */
function Message({ w }: { w: Worker }) {
  const { busy, error, run } = useCommand();
  const [text, setText] = useState('');
  const ceo = w.role === 'ceo';
  const can = ceo || w.status === 'working';
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const ok = await run(() => (ceo ? command('POST', '/api/ceo/message', { text: body }) : command('POST', `/api/workers/${w.id}/message`, { text: body })));
    if (ok) setText('');
  };
  return (
    <form
      className="wp-message"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <MessageBox
        value={text}
        onChange={setText}
        aria-label={`Message ${w.name}`}
        title="Enter sends · Shift+Enter adds a line"
        disabled={!can}
        placeholder={
          ceo
            ? `Message ${w.name}… (it goes to your latest chat on the desktop)`
            : w.status === 'working'
              ? `Tell ${w.name} something while they work…`
              : w.status === 'preparing'
                ? `${w.name} is setting up their desk: messages reach them once they're working`
                : `${w.name} has no session running: messages reach a worker while they work`
        }
      />
      <button className="wp-btn wp-btn-go" disabled={busy || !can || !text.trim()}>
        Send
      </button>
      {error && (
        <p className="wp-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** A model name, saved on Enter or when you leave the field; empty is the office default. */
function ModelField({ w, onSave }: { w: Worker; onSave: (model: string) => void }) {
  const fallback = useStore((s) => s.settings.defaultModel);
  const [draft, setDraft] = useState(w.model);
  useEffect(() => setDraft(w.model), [w.model]);
  const list = `wp-models-${w.id}`;
  return (
    <>
      <input
        className="wp-model"
        value={draft}
        list={list}
        placeholder={`${fallback} (default)`}
        aria-label="Model"
        title="A Claude model, or ollama/<name> for a local one on this computer. Empty: the office default."
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== w.model && onSave(draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <datalist id={list}>
        {[...CLAUDE_MODELS, ...(w.host === 'box' ? [] : LOCAL_SUGGESTIONS)].map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}

/** Model and effort (from their next session on), and stop, reset and let go; letting go asks first. */
export function WorkerSetup({ w, onGone }: { w: Worker; onGone?: () => void }) {
  const defaultEffort = useStore((s) => s.settings.defaultEffort);
  const { busy, error, run } = useCommand();
  const [confirming, setConfirming] = useState(false);
  const patch = (body: Partial<Pick<Worker, 'model' | 'effort'>>) => void run(() => command('PATCH', `/api/workers/${w.id}`, body));
  const ceo = w.role === 'ceo';
  const working = isBusy(w.status);
  return (
    <section className="wp-setup" aria-label={`${w.name}'s setup`}>
      <label className="wp-field">
        <span>Model</span>
        <ModelField w={w} onSave={(model) => patch({ model })} />
      </label>
      <label className="wp-field">
        <span>Effort</span>
        <select value={w.effort} onChange={(e) => patch({ effort: e.target.value as EffortLevel | '' })}>
          <option value="">default ({defaultEffort})</option>
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {working && <span className="wp-chip">Applies from their next session</span>}
      <span className="spacer" />
      <button className="wp-btn wp-btn-bad" disabled={busy || !working} title="End their session; they wait for you" onClick={() => void run(() => command('POST', `/api/workers/${w.id}/stop`))}>
        ■ Stop
      </button>
      <button
        className="wp-btn"
        disabled={busy || (w.status === 'idle' && !w.task)}
        title={ceo ? 'Back to idle, ready for the next job' : 'Clear their desk: their work goes back in line, and they take the next'}
        onClick={() => void run(() => command('POST', `/api/workers/${w.id}/reset`))}
      >
        ↺ Reset
      </button>
      <button className="wp-btn wp-btn-ghost" disabled={busy || confirming} onClick={() => setConfirming(true)}>
        👋 Let go
      </button>
      {confirming && (
        <div className="wp-confirm" role="alertdialog" aria-label={`Let ${w.name} go?`}>
          <span>
            <b>Let {w.name} go?</b>{' '}
            {ceo
              ? 'Their session stops, and the jobs waiting for them go with them. You can hire a CEO again from the desktop.'
              : 'A running session stops, and their desk is cleared (work on no branch is saved as a patch first). Branches they pushed stay on GitHub, and the floor keeps its new size.'}
          </span>
          <button className="wp-btn" disabled={busy} onClick={() => setConfirming(false)}>
            Keep them
          </button>
          <button
            className="wp-btn wp-btn-bad"
            disabled={busy}
            autoFocus
            onClick={() =>
              void run(() => command('DELETE', `/api/workers/${w.id}`)).then((ok) => {
                setConfirming(false);
                if (ok) onGone?.();
              })
            }
          >
            Let {w.name} go
          </button>
        </div>
      )}
      {error && (
        <p className="wp-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function WorkerPanel({ workerId }: { workerId: string }) {
  const w = useStore((s) => s.workers[workerId]);
  const close = useView((s) => s.closeOverlay);
  // Let go, from here or elsewhere: the panel says so rather than vanish while the overlay stays open.
  if (!w) {
    return (
      <Panel onClose={close} title="👋 Gone">
        <p className="panel-note">They've left the building.</p>
      </Panel>
    );
  }
  return (
    <Panel
      wide
      onClose={close}
      title={
        <>
          {w.name} <span className={`wp-status wp-status-${w.status}`}>{STATUS_LABEL[w.status]}</span> {doing(w) !== 'free' && <span className="panel-sub">· {doing(w)}</span>}
        </>
      }
    >
      <TaskLine w={w} />
      {w.lastError && (w.status === 'error' || w.status === 'stopped') && !w.needsSignIn && <p className="wp-error">⚠️ {w.lastError}</p>}
      {w.needsSignIn && <SignIn w={w} />}
      <div className="panel-terminal">
        <LiveTerminal workerId={w.id} />
      </div>
      <Message w={w} />
      <WorkerSetup w={w} onGone={close} />
      <p className="panel-note">Type in the terminal to talk to the CLI directly; Esc there interrupts Claude Code. Esc anywhere else closes this.</p>
    </Panel>
  );
}
