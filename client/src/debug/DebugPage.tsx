// The debug page: every floor with its workers, queue and pull requests, and the latest moments. It stays on as the
// admin view once the game exists. In the demo its buttons drive pretend changes (server/demoRoutes.ts).
import { useState } from 'react';
import { isBusy, type Floor } from '../../../shared/types';
import { command, floorPath } from '../api';
import { qaKey, useStore } from '../store';
import { activityIcon, momentText, taskText } from './describe';

type Run = (method: 'POST' | 'DELETE', url: string) => void;

const time = (t: number) => new Date(t).toLocaleTimeString();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function DebugPage() {
  const connected = useStore((s) => s.connected);
  const loaded = useStore((s) => s.loaded);
  const demo = useStore((s) => s.demo);
  const version = useStore((s) => s.version);
  const floors = useStore((s) => s.floors);
  const [error, setError] = useState('');

  // What a command changes arrives over /ws, so only a refusal needs showing here.
  const run: Run = (method, url) => {
    setError('');
    command(method, url).catch((err: Error) => setError(err.message));
  };

  return (
    <main className="debug">
      <header className="debug-header">
        <h1>Marshmallow</h1>
        <span className={`pill ${connected ? 'pill-ok' : 'pill-bad'}`}>{connected ? 'Connected' : 'Reconnecting…'}</span>
        {demo && <span className="pill">DEMO MODE</span>}
        {version && <span className="muted">v{version}</span>}
        <span className="spacer" />
        {demo && (
          <>
            <button onClick={() => run('POST', '/api/demo/floors')}>Add floor</button>
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
        <p className="muted">No floors yet.{demo && ' Add one to start.'}</p>
      ) : (
        floors.map((f) => <FloorSection key={f.id} floor={f} run={run} />)
      )}
      <Moments />
    </main>
  );
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
  const floorUrl = `/api/demo/floors/${floorPath(floor.id)}`;

  return (
    <section className="floor" style={{ borderColor: floor.color }}>
      <div className="floor-title">
        <h2>
          Floor {floor.floor} · {floor.fullName}
        </h2>
        {demo && <button onClick={() => run('POST', `${floorUrl}/workers`)}>Hire</button>}
      </div>
      <p className="muted">
        {plural(team.length, 'worker')} · {plural(floor.issues.length, 'open issue')} · clone {floor.cloneStatus}
        {floor.lastSync && ` · synced ${time(floor.lastSync)}`}
        {floor.syncError && ` · sync failed: ${floor.syncError}`}
      </p>

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
                {demo && <th scope="col" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {team.map((w) => (
                <tr key={w.id}>
                  <th scope="row">{w.name}</th>
                  <td>
                    <span className={`status status-${w.status}`}>{w.status}</span>
                    {!isBusy(w.status) && w.idleSince && <span className="muted"> since {time(w.idleSince)}</span>}
                  </td>
                  <td>{taskText(w.task) || <span className="muted">—</span>}</td>
                  <td>{w.activity ? `${activityIcon(w.activity.kind)} ${w.activity.detail}` : <span className="muted">—</span>}</td>
                  <td className="last-line">{logs[w.id]?.at(-1)?.text}</td>
                  {demo && (
                    <td className="actions">
                      <button onClick={() => run('POST', `/api/demo/workers/${w.id}/step`)}>Step</button>
                      <button onClick={() => run('DELETE', `/api/demo/workers/${w.id}`)}>Let go</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Queue</h3>
      {floor.issues.length === 0 ? (
        <p className="muted">No open issues.</p>
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
                <th scope="col">QA</th>
                <th scope="col">Author</th>
                <th scope="col">Tester</th>
                <th scope="col">Note</th>
                {demo && <th scope="col" aria-label="Actions" />}
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
                      <td>{p.state === 'MERGED' ? 'merged' : rec ? `${rec.status} (round ${rec.round})` : <span className="muted">—</span>}</td>
                      <td>{name(rec?.devWorkerId ?? null)}</td>
                      <td>{name(rec?.qaWorkerId ?? null)}</td>
                      <td className="muted">{rec?.summary ?? rec?.mergeNote}</td>
                      {demo && <td className="actions">{rec && <button onClick={() => run('POST', `${floorUrl}/pulls/${p.number}/qa-step`)}>QA step</button>}</td>}
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
