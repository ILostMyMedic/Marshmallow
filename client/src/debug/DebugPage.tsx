// The debug page: every floor with its workers, queue and pull requests, the office's messages and the latest
// moments. It stays on as the admin view once the game exists. In the demo it can also hire and let go of pretend
// workers, and fake Claude's usage warning or limit (server/demoRoutes.ts).
import { Fragment, useEffect, useState } from 'react';
import { isBusy, type Floor, type GhRepoSummary, type PullInfo } from '../../../shared/types';
import { CLAUDE_MODELS } from '../../../shared/models';
import { command, floorPath, query } from '../api';
import { qaKey, useStore } from '../store';
import { activityIcon, momentText, taskText } from './describe';
import { LiveTerminal } from './LiveTerminal';

type Run = (method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) => void;

const time = (t: number) => new Date(t).toLocaleTimeString();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function DebugPage() {
  const connected = useStore((s) => s.connected);
  const loaded = useStore((s) => s.loaded);
  const demo = useStore((s) => s.demo);
  const version = useStore((s) => s.version);
  const floors = useStore((s) => s.floors);
  const usage = useStore((s) => s.usage);
  const settings = useStore((s) => s.settings);
  const [error, setError] = useState('');

  // What a command changes arrives over /ws, so only a refusal needs showing here.
  const run: Run = (method, url, body) => {
    setError('');
    command(method, url, body).catch((err: Error) => setError(err.message));
  };

  return (
    <main className="debug">
      <header className="debug-header">
        <h1>Marshmallow</h1>
        <span className={`pill ${connected ? 'pill-ok' : 'pill-bad'}`}>{connected ? 'Connected' : 'Reconnecting…'}</span>
        {demo && <span className="pill">DEMO MODE</span>}
        {usage.state !== 'normal' && (
          <span className="pill pill-warn" title={usage.warning?.limit ?? undefined}>
            {usage.state === 'paused' ? '⛔ Paused' : '🐢 Pacing'}
            {usage.until && ` until ${time(usage.until)}`}
          </span>
        )}
        {version && <span className="muted">v{version}</span>}
        <span className="spacer" />
        <ModelField label="default model" value={settings.defaultModel} placeholder="claude-opus-5-5" onCommit={(v) => v && run('PATCH', '/api/settings', { defaultModel: v })} />
        <ConnectRepo run={run} />
        {demo && (
          <>
            <button onClick={() => run('POST', '/api/demo/usage', { kind: 'warning' })}>Usage warning</button>
            <button onClick={() => run('POST', '/api/demo/usage', { kind: 'limit' })}>Usage limit</button>
            <button onClick={() => run('POST', '/api/demo/reset')}>Reset</button>
          </>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <p className="muted">Waiting for the snapshot…</p>
      ) : floors.length === 0 ? (
        <p className="muted">No floors yet. Connect a repository to start.</p>
      ) : (
        floors.map((f) => <FloorSection key={f.id} floor={f} run={run} />)
      )}
      <Questions run={run} />
      <Messages />
      <Moments />
    </main>
  );
}

/** Workers' questions to you: open ones first, each with a box whose answer goes on the issue, as you. */
function Questions({ run }: { run: Run }) {
  const questions = useStore((s) => s.questions);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  if (!questions.length) return null;
  const open = questions.filter((q) => !q.answer);
  const answered = questions.filter((q) => q.answer);
  return (
    <section>
      <h2>Questions for you</h2>
      {open.length === 0 && <p className="muted">None waiting.</p>}
      {open.map((q) => (
        <div key={q.id} className="question">
          <p>
            <strong>{q.from}</strong> on {q.floorId} #{q.issueNumber} <span className="muted">· {time(q.askedAt)}</span>
            {q.url && (
              <>
                {' · '}
                <a href={q.url} target="_blank" rel="noreferrer">
                  on GitHub
                </a>
              </>
            )}
          </p>
          <blockquote>{q.text}</blockquote>
          <form
            className="connect"
            onSubmit={(e) => {
              e.preventDefault();
              run('POST', `/api/questions/${q.id}/answer`, { text: drafts[q.id] ?? '' });
            }}
          >
            <input value={drafts[q.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })} placeholder="Your answer (posted on the issue, as you)" size={50} />
            <button type="submit" disabled={!drafts[q.id]?.trim()}>
              Answer
            </button>
          </form>
        </div>
      ))}
      {answered.length > 0 && (
        <ul className="moments">
          {answered.map((q) => (
            <li key={q.id}>
              <span className="muted">
                {q.floorId} #{q.issueNumber}:
              </span>{' '}
              {q.from} asked “{q.text}” · you answered “{q.answer}”
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The office's messages to the manager (the phone, later): PRs that need them, merges GitHub refused, pacing. */
function Messages() {
  const messages = useStore((s) => s.messages);
  if (!messages.length) return null;
  return (
    <section>
      <h2>Messages</h2>
      <ul className="moments">
        {[...messages].reverse().map((m) => (
          <li key={m.id}>
            <span className="muted">{time(m.at)}</span> {m.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Picks a repository that isn't a floor yet and connects it. */
function ConnectRepo({ run }: { run: Run }) {
  const connected = useStore((s) => s.connected);
  const floors = useStore((s) => s.floors);
  const demo = useStore((s) => s.demo);
  const [repos, setRepos] = useState<GhRepoSummary[]>([]);
  const [problem, setProblem] = useState('');
  const [pick, setPick] = useState('');
  const [autoAssign, setAutoAssign] = useState(false);

  // On by default in the demo, where work starting by itself costs nothing.
  useEffect(() => setAutoAssign(demo), [demo]);

  useEffect(() => {
    if (!connected) return;
    setProblem('');
    query<GhRepoSummary[]>('/api/github/repos').then(setRepos, (err: Error) => setProblem(err.message));
  }, [connected]);

  // Your own repositories are suggested; any owner/name can be typed (an organisation's, say).
  const free = repos.filter((r) => !floors.some((f) => f.id === r.nameWithOwner));
  return (
    <span className="connect">
      <input list="repos-to-connect" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="owner/repo" aria-label="Repository to connect" title={problem || undefined} />
      <datalist id="repos-to-connect">
        {free.map((r) => (
          <option key={r.nameWithOwner} value={r.nameWithOwner} />
        ))}
      </datalist>
      <label>
        <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} /> auto-assign
      </label>
      <button disabled={!pick.trim()} onClick={() => run('POST', '/api/floors', { fullName: pick.trim(), autoAssign })}>
        Connect
      </button>
    </span>
  );
}

function checksText(p: PullInfo): string {
  if (p.state !== 'OPEN') return '';
  if (p.mergeable === 'CONFLICTING') return '⚠️ conflicts';
  return { pending: '⏳ running', passing: '✅ passing', failing: '❌ failing', none: '' }[p.checks];
}

function FloorSection({ floor, run }: { floor: Floor; run: Run }) {
  const workers = useStore((s) => s.workers);
  const logs = useStore((s) => s.logs);
  const qa = useStore((s) => s.qa);
  const team = Object.values(workers)
    .filter((w) => w.floorId === floor.id)
    .sort((a, b) => a.desk - b.desk);
  const defaultModel = useStore((s) => s.settings.defaultModel);
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const name = (id: string | null) => (id && workers[id]?.name) || '—';
  const fp = floorPath(floor.id);

  return (
    <section className="floor" style={{ borderColor: floor.color }}>
      <div className="floor-title">
        <h2>
          Floor {floor.floor} · {floor.fullName}
        </h2>
        <button onClick={() => run('POST', `/api/floors/${fp}/sync`)}>Sync</button>
        <button onClick={() => run('POST', `/api/floors/${fp}/workers`)}>Hire</button>
        <label className="connect">
          <input type="checkbox" checked={floor.autoAssign} onChange={(e) => run('PATCH', `/api/floors/${fp}`, { autoAssign: e.target.checked })} /> auto-assign
        </label>
      </div>
      <p className="muted">
        {plural(team.length, 'worker')} · {plural(floor.issues.length, 'open issue')} · clone {floor.cloneStatus}
        {floor.cloneError && ` (${floor.cloneError})`}
        {floor.lastSync && ` · synced ${time(floor.lastSync)}`}
      </p>
      {floor.syncError && <p className="error">Sync failed: {floor.syncError}</p>}

      <h3>Workers</h3>
      {team.length === 0 ? (
        <p className="muted">Nobody works here yet.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Task</th>
                <th scope="col">Doing</th>
                <th scope="col">Last line</th>
                <th scope="col">Model</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {team.map((w) => (
                <Fragment key={w.id}>
                <tr>
                  <th scope="row">{w.name}</th>
                  <td>
                    <span className={`status status-${w.status}`}>{w.status}</span>
                    {!isBusy(w.status) && w.idleSince && <span className="muted"> since {time(w.idleSince)}</span>}
                    {w.status === 'error' && w.lastError && <div className="error">{w.lastError}</div>}
                  </td>
                  <td>{taskText(w.task) || <span className="muted">—</span>}</td>
                  <td>{w.activity ? `${activityIcon(w.activity.kind)} ${w.activity.detail}` : <span className="muted">—</span>}</td>
                  <td className="last-line">{logs[w.id]?.at(-1)?.text}</td>
                  <td>
                    <ModelField value={w.model} placeholder={defaultModel} onCommit={(v) => run('PATCH', `/api/workers/${w.id}`, { model: v })} />
                  </td>
                  <td className="actions">
                    <button onClick={() => setOpenTerm(openTerm === w.id ? null : w.id)}>{openTerm === w.id ? 'Hide terminal' : 'Terminal'}</button>
                    <button disabled={!isBusy(w.status)} onClick={() => run('POST', `/api/workers/${w.id}/stop`)}>
                      Stop
                    </button>
                    <button disabled={w.status === 'idle' && !w.task} onClick={() => run('POST', `/api/workers/${w.id}/reset`)}>
                      Reset
                    </button>
                    <button onClick={() => run('DELETE', `/api/workers/${w.id}`)}>Let go</button>
                  </td>
                </tr>
                {openTerm === w.id && (
                  <tr>
                    <td colSpan={7}>
                      <LiveTerminal workerId={w.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Queue</h3>
      {floor.issues.length === 0 ? (
        <p className="muted">{floor.lastSync ? 'No open issues.' : 'Not synced yet.'}</p>
      ) : (
        <ol className="queue">
          {floor.issues.map((i) => {
            const pr = floor.pulls.find((p) => p.state === 'OPEN' && p.closesIssues.includes(i.number));
            const builder = team.find((w) => w.task?.kind === 'issue' && w.task.issueNumber === i.number);
            return (
              <li key={i.number}>
                #{i.number} {i.title} <span className="muted">· {pr ? `PR #${pr.number}` : builder ? `taken by ${builder.name}` : 'ready'}</span>
              </li>
            );
          })}
        </ol>
      )}

      <h3>Pull requests</h3>
      {floor.pulls.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">PR</th>
                <th scope="col">Title</th>
                <th scope="col">Branch</th>
                <th scope="col">Checks</th>
                <th scope="col">QA</th>
                <th scope="col">Author</th>
                <th scope="col">Tester</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {[...floor.pulls]
                .sort((a, b) => b.number - a.number)
                .map((p) => {
                  const rec = qa[qaKey(floor.id, p.number)];
                  return (
                    <tr key={p.number}>
                      <th scope="row">#{p.number}</th>
                      <td>{p.title}</td>
                      <td className="last-line">{p.headRefName}</td>
                      <td>{checksText(p)}</td>
                      <td>
                        {p.state === 'MERGED' ? (
                          '🔀 merged'
                        ) : rec ? (
                          <span className={rec.status === 'needs-human' ? 'error' : undefined}>
                            {rec.status} (round {rec.round})
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{name(rec?.devWorkerId ?? null)}</td>
                      <td>{name(rec?.qaWorkerId ?? null)}</td>
                      <td className="muted">
                        {rec?.mergeNote ?? rec?.summary}
                        {rec?.commentUrl && (
                          <>
                            {' '}
                            <a href={rec.commentUrl} target="_blank" rel="noreferrer">
                              report
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Moments() {
  const moments = useStore((s) => s.moments);
  const workers = useStore((s) => s.workers);
  if (!moments.length) return null;
  const name = (id: string | null) => (id && workers[id]?.name) || 'someone';
  return (
    <section>
      <h2>Moments</h2>
      <ul className="moments">
        {moments
          .map((m, i) => (
            <li key={`${m.at}-${m.type}-${i}`}>
              <span className="muted">{time(m.at)}</span> {momentText(m, name)}
            </li>
          ))
          .reverse()}
      </ul>
    </section>
  );
}

/** A model name, saved when you press Enter or leave the field; empty means the office default. */
function ModelField({ value, placeholder, onCommit, label }: { value: string; placeholder: string; onCommit: (v: string) => void; label?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft.trim() !== value && onCommit(draft.trim());
  const input = (
    <input
      className="model-field"
      value={draft}
      placeholder={placeholder}
      list="model-suggestions"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label={label ?? 'model'}
    />
  );
  return label ? (
    <label className="connect">
      {label} {input}
      <datalist id="model-suggestions">
        {MODEL_SUGGESTIONS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </label>
  ) : (
    input
  );
}

const MODEL_SUGGESTIONS = [...CLAUDE_MODELS, 'ollama/gpt-oss:20b', 'ollama/qwen3:8b'];
