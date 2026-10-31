// The debug page: every floor with its workers, queue and pull requests, the office's messages and the latest
// moments. It stays on as the admin view once the game exists. In the demo it can also hire and let go of pretend
// workers, and fake Claude's usage warning or limit (server/demoRoutes.ts).
import { useEffect, useState } from 'react';
import { isBusy, type Floor, type GhRepoSummary, type PullInfo } from '../../../shared/types';
import { command, floorPath, query } from '../api';
import { qaKey, useStore } from '../store';
import { activityIcon, momentText, taskText } from './describe';

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
      <Messages />
      <Moments />
    </main>
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

  if (problem) {
    return (
      <span className="muted" title={problem}>
        Can't list repositories
      </span>
    );
  }
  const free = repos.filter((r) => !floors.some((f) => f.id === r.nameWithOwner));
  if (!free.length) return null;
  const chosen = free.some((r) => r.nameWithOwner === pick) ? pick : free[0].nameWithOwner;
  return (
    <span className="connect">
      <select value={chosen} onChange={(e) => setPick(e.target.value)} aria-label="Repository to connect">
        {free.map((r) => (
          <option key={r.nameWithOwner} value={r.nameWithOwner}>
            {r.nameWithOwner}
          </option>
        ))}
      </select>
      <label>
        <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} /> auto-assign
      </label>
      <button onClick={() => run('POST', '/api/floors', { fullName: chosen, autoAssign })}>Connect</button>
    </span>
  );
}

function checksText(p: PullInfo): string {
  if (p.state !== 'OPEN') return '';
  if (p.mergeable === 'CONFLICTING') return '⚠️ conflicts';
  return { pending: '⏳ running', passing: '✅ passing', failing: '❌ failing', none: '' }[p.checks];
}

function FloorSection({ floor, run }: { floor: Floor; run: Run }) {
  const demo = useStore((s) => s.demo);
  const workers = useStore((s) => s.workers);
  const logs = useStore((s) => s.logs);
  const qa = useStore((s) => s.qa);
  const team = Object.values(workers)
    .filter((w) => w.floorId === floor.id)
    .sort((a, b) => a.desk - b.desk);
  const name = (id: string | null) => (id && workers[id]?.name) || '—';
  const fp = floorPath(floor.id);

  return (
    <section className="floor" style={{ borderColor: floor.color }}>
      <div className="floor-title">
        <h2>
          Floor {floor.floor} · {floor.fullName}
        </h2>
        <button onClick={() => run('POST', `/api/floors/${fp}/sync`)}>Sync</button>
        {demo && <button onClick={() => run('POST', `/api/demo/floors/${fp}/workers`)}>Hire</button>}
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
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {team.map((w) => (
                <tr key={w.id}>
                  <th scope="row">{w.name}</th>
                  <td>
                    <span className={`status status-${w.status}`}>{w.status}</span>
                    {!isBusy(w.status) && w.idleSince && <span className="muted"> since {time(w.idleSince)}</span>}
                    {w.status === 'error' && w.lastError && <div className="error">{w.lastError}</div>}
                  </td>
                  <td>{taskText(w.task) || <span className="muted">—</span>}</td>
                  <td>{w.activity ? `${activityIcon(w.activity.kind)} ${w.activity.detail}` : <span className="muted">—</span>}</td>
                  <td className="last-line">{logs[w.id]?.at(-1)?.text}</td>
                  <td className="actions">
                    <button disabled={!isBusy(w.status)} onClick={() => run('POST', `/api/workers/${w.id}/stop`)}>
                      Stop
                    </button>
                    <button disabled={w.status === 'idle' && !w.task} onClick={() => run('POST', `/api/workers/${w.id}/reset`)}>
                      Reset
                    </button>
                    {demo && <button onClick={() => run('DELETE', `/api/demo/workers/${w.id}`)}>Let go</button>}
                  </td>
                </tr>
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
