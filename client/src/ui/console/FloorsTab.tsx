// The console's Floors tab: every floor with its settings, a sync, the CEO's planning of its brief and the issues held
// for you, and connecting a repository as a new floor. Adapted from cubefarm client/src/ui/ManagerConsole.tsx (FloorsTab,
// FloorRow, FloorBrief) and ProjectPicker.tsx's GitHub mode (MIT). Cut: folders on this computer and new projects,
// disconnecting, floor colours, linked repos, auto-merge (always on here), the office's own update and app previews.
import { useEffect, useRef, useState } from 'react';
import type { Floor, GhRepoSummary } from '../../../../shared/types';
import { floorPath, query } from '../../api';
import { useStore } from '../../store';
import { rideTo } from '../../world/elevatorRide';
import { useView } from '../../world/view';
import { FloorBadge } from './fields';
import { freeRepos, repoName } from './forms';
import { showTab } from './nav';
import { run, useBusy } from './run';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Repositories listed at once; the filter finds the rest. */
const LIST_MAX = 60;

function useVisit() {
  const close = useView((s) => s.closeOverlay);
  return (floor: number) => {
    close();
    rideTo(floor);
  };
}

/** The floor's brief, which the CEO plans into issues, and the CEO's QA brief for it. */
function Brief({ floor, hasCeo }: { floor: Floor; hasCeo: boolean }) {
  const [mission, setMission] = useState(floor.mission);
  useEffect(() => setMission(floor.mission), [floor.mission]);
  const [busy, go] = useBusy();
  return (
    <details className="console-details">
      <summary>
        🗺 Brief <span className="console-hint">· {floor.mission ? floor.mission.slice(0, 90) + (floor.mission.length > 90 ? '…' : '') : 'none yet'}</span>
      </summary>
      <textarea value={mission} rows={3} placeholder="What should this floor build next? The CEO turns it into GitHub issues." onChange={(e) => setMission(e.target.value)} />
      <div className="console-row">
        {!hasCeo && (
          <span className="console-hint console-grow">
            Planning needs a CEO:{' '}
            <button className="link" onClick={() => showTab('team')}>
              hire one on the Team tab
            </button>
            .
          </span>
        )}
        <span className="console-grow" />
        <button className="console-btn good" disabled={!hasCeo || !mission.trim() || busy} onClick={() => go(run('POST', `/api/floors/${floorPath(floor.id)}/plan`, { mission }))}>
          🧠 Plan it with the CEO
        </button>
      </div>
      {floor.qaBrief && (
        <>
          <p className="console-hint">How QA tests this floor (written by the CEO):</p>
          <pre className="console-pre">{floor.qaBrief}</pre>
        </>
      )}
    </details>
  );
}

/** Issues whose PR was closed without merging: they wait for you instead of going back in line. */
function Held({ floor }: { floor: Floor }) {
  if (!floor.held.length) return null;
  return (
    <div className="console-held">
      <strong>✋ Waiting for you</strong>
      <ul>
        {floor.held.map((h) => (
          <li key={h.issue}>
            #{h.issue} {floor.issues.find((i) => i.number === h.issue)?.title}
            <span className="console-hint"> · PR #{h.pr} was closed without merging</span>{' '}
            <button className="console-btn small" title="Back in line: a free worker builds it again" onClick={() => void run('DELETE', `/api/floors/${floorPath(floor.id)}/held/${h.issue}`)}>
              Build again
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FloorCard({ floor, focused }: { floor: Floor; focused: boolean }) {
  const team = useStore((s) => Object.values(s.workers).filter((w) => w.floorId === floor.id && w.role !== 'ceo').length);
  const hasCeo = useStore((s) => Object.values(s.workers).some((w) => w.role === 'ceo'));
  const visit = useVisit();
  const [syncing, go] = useBusy();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  const fp = floorPath(floor.id);
  const patch = (p: { autoAssign?: boolean; browserTesting?: boolean }) => void run('PATCH', `/api/floors/${fp}`, p);
  const openPrs = floor.pulls.filter((p) => p.state === 'OPEN').length;
  return (
    <article ref={ref} className={`console-card console-floor${focused ? ' on' : ''}`} style={{ borderColor: floor.color }}>
      <header className="console-row">
        <FloorBadge floor={floor.floor} color={floor.color} />
        <div className="console-grow">
          <a href={floor.url} target="_blank" rel="noreferrer">
            <strong>{floor.fullName}</strong>
          </a>
          <div className="console-hint">{floor.summary ? `🧠 ${floor.summary}` : floor.description || (hasCeo ? 'The CEO studies it once it has synced.' : '')}</div>
        </div>
        <button className="console-btn" onClick={() => visit(floor.floor)}>
          Visit
        </button>
      </header>
      <div className="console-row console-meta">
        <span className="console-grow">
          {plural(team, 'worker')} · {plural(floor.issues.length, 'open issue')} · {plural(openPrs, 'open PR')}
          {floor.cloneStatus !== 'ready' && ` · clone ${floor.cloneStatus}`} · {floor.lastSync ? `synced ${time(floor.lastSync)}` : 'not synced yet'}
          {floor.teamSize !== null && ` · team held at ${floor.teamSize}`}
        </span>
        <button className="console-btn small" disabled={syncing} title="Fetch its issues and PRs from GitHub now" onClick={() => void go(run('POST', `/api/floors/${fp}/sync`))}>
          {syncing ? 'Syncing…' : '⟳ Sync'}
        </button>
      </div>
      {floor.cloneError && <p className="console-bad">Clone failed: {floor.cloneError}</p>}
      {floor.syncError && <p className="console-bad">Sync failed: {floor.syncError}</p>}
      <div className="console-row wrap">
        <label className="console-toggle" title="Free workers take the next ready issue on their own">
          <input type="checkbox" checked={floor.autoAssign} onChange={(e) => patch({ autoAssign: e.target.checked })} /> ⚡ Auto-assign issues
        </label>
        <label className="console-toggle" title="QA opens the app in a real browser (the Playwright MCP) and posts screenshots on the PR">
          <input type="checkbox" checked={floor.browserTesting} onChange={(e) => patch({ browserTesting: e.target.checked })} /> 🌐 Browser testing in QA
        </label>
      </div>
      <Held floor={floor} />
      <Brief floor={floor} hasCeo={hasCeo} />
    </article>
  );
}

/** One of your repositories (or an organisation's, or any typed owner/name) becomes the next floor. */
function ConnectRepo() {
  const floors = useStore((s) => s.floors);
  const demo = useStore((s) => s.demo);
  const connected = useStore((s) => s.connected);
  const autoscale = useStore((s) => s.settings.autoscale);
  const hasCeo = useStore((s) => Object.values(s.workers).some((w) => w.role === 'ceo'));
  const visit = useVisit();
  const [repos, setRepos] = useState<GhRepoSummary[] | null>(null);
  const [listProblem, setListProblem] = useState('');
  const [owner, setOwner] = useState('');
  const [filter, setFilter] = useState('');
  const [typed, setTyped] = useState('');
  const [mission, setMission] = useState('');
  // On by default in the demo, where work starting by itself costs nothing.
  const [autoAssign, setAutoAssign] = useState(demo);
  useEffect(() => setAutoAssign(demo), [demo]);
  const [busy, setBusy] = useState<string | null>(null);
  const [moved, setMoved] = useState<Floor | null>(null);

  const load = (o: string) => {
    setRepos(null);
    setListProblem('');
    query<GhRepoSummary[]>(`/api/github/repos${o ? `?owner=${encodeURIComponent(o)}` : ''}`).then(setRepos, (err: Error) => {
      setRepos([]);
      setListProblem(err.message);
    });
  };
  useEffect(() => {
    if (connected) load('');
  }, [connected]);

  const connect = async (fullName: string) => {
    setBusy(fullName);
    setMoved(null);
    const floor = await run<Floor>('POST', '/api/floors', { fullName, autoAssign, mission: mission.trim() || undefined });
    setBusy(null);
    if (!floor) return;
    setMoved(floor);
    setMission('');
    setTyped('');
  };
  const shown = freeRepos(repos ?? [], floors, filter);
  const name = repoName(typed);
  return (
    <div className="console-card">
      <h3 className="console-h">➕ Connect a repository</h3>
      <p className="console-hint">Each repository is a floor: its GitHub issues are the backlog, and the team's pull requests land there{demo ? ' (in the demo, on a fake GitHub)' : ', as you, through your gh login'}.</p>
      {moved && (
        <div className="console-done">
          🎉 <strong>{moved.fullName}</strong> moved into floor {moved.floor}. {autoscale ? 'The rules size its team once it has synced.' : 'Hire its team on the Team tab.'}
          {hasCeo && ' The CEO studies it first.'}{' '}
          <button className="console-btn small" onClick={() => visit(moved.floor)}>
            Visit
          </button>
        </div>
      )}
      <textarea value={mission} rows={2} placeholder="Brief for the CEO (optional): what should the team build?" onChange={(e) => setMission(e.target.value)} />
      <label className="console-toggle">
        <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} /> ⚡ Start work by itself: free workers take issues as they come (each floor can turn this off)
      </label>
      <div className="console-row">
        <input className="console-grow" value={filter} placeholder="Filter your repositories…" aria-label="Filter your repositories" onChange={(e) => setFilter(e.target.value)} />
        <input value={owner} placeholder="Organisation (optional)" aria-label="Organisation" style={{ width: '14ch' }} onChange={(e) => setOwner(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(owner.trim())} />
        <button className="console-btn" onClick={() => load(owner.trim())}>
          List
        </button>
      </div>
      <ul className="console-repos">
        {repos === null && <li className="console-hint">Asking GitHub for your repositories…</li>}
        {listProblem && <li className="console-bad">{listProblem}</li>}
        {repos && !listProblem && shown.length === 0 && <li className="console-hint">{repos.length ? "No matching repositories that aren't floors yet." : 'No repositories found.'}</li>}
        {shown.slice(0, LIST_MAX).map((r) => (
          <li key={r.nameWithOwner}>
            <div className="console-grow">
              <strong>{r.nameWithOwner}</strong> <span className="console-chip">{r.visibility.toLowerCase()}</span>
              {r.description && <div className="console-hint">{r.description}</div>}
            </div>
            <button className="console-btn good" disabled={!!busy} onClick={() => void connect(r.nameWithOwner)}>
              {busy === r.nameWithOwner ? 'Moving in…' : 'Connect'}
            </button>
          </li>
        ))}
        {shown.length > LIST_MAX && <li className="console-hint">…and {shown.length - LIST_MAX} more: filter to find them.</li>}
      </ul>
      <form
        className="console-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) void connect(name);
        }}
      >
        <input className="console-grow" value={typed} placeholder="…or type owner/name, or paste its GitHub link" aria-label="Repository to connect" onChange={(e) => setTyped(e.target.value)} />
        <button className="console-btn good" disabled={!name || !!busy}>
          {busy && busy === name ? 'Moving in…' : 'Connect'}
        </button>
      </form>
    </div>
  );
}

export function FloorsTab({ floorId }: { floorId?: string }) {
  const floors = useStore((s) => s.floors);
  return (
    <div className="console-grid">
      <section>
        <h3 className="console-h">🏢 Floors</h3>
        {floors.length === 0 && <p className="console-hint">No floors yet. Connect a repository to open the first one.</p>}
        {floors.map((f) => (
          <FloorCard key={f.id} floor={f} focused={f.id === floorId} />
        ))}
      </section>
      <section>
        <ConnectRepo />
      </section>
    </div>
  );
}
