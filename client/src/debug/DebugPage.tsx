// The debug page: the CEO, the world events outside, every floor with its coins, shop, workers, queue and pull requests,
// the office's messages and the latest moments. It stays on as the admin view once the game exists. In the demo it can
// also hire and let go of pretend workers, give a floor coins, and fake Claude's usage warning or limit
// (server/demoRoutes.ts).
import { Fragment, useEffect, useState } from 'react';
import { BODY_STYLES, DAY_MODES, isBusy, type BodyStyle, type DayMode, type Floor, type GhRepoSummary, type PullInfo } from '../../../shared/types';
import { STYLE_NAMES } from '../world/bodyStyle';
import { BOX_SIZE_INFO, BOX_SIZES } from '../../../shared/cloud';
import { CLAUDE_MODELS } from '../../../shared/models';
import { playbookFor } from '../../../shared/playbook';
import { officeDay, SEASON_SETTING_NAMES, SEASON_SETTINGS, seasonFor, parseSeasonSetting, type SeasonSetting } from '../../../shared/seasons';
import { EVENTS, type EventId, type EventSide } from '../../../shared/worldEvents';
import { command, floorPath, query } from '../api';
import { qaKey, useStore } from '../store';
import { activityIcon, momentText, taskText } from './describe';
import { eventGroups, eventHint, logLine, nextPick, span, timeLeft, type WorldLogEntry } from './worldDebug';
import { LiveTerminal } from '../ui/LiveTerminal';
import { ShopView } from '../ui/shop/ShopPanel';

type Run = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) => void;

const time = (t: number) => new Date(t).toLocaleTimeString();
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

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
        <a href="/">🏢 The office</a>
        <a href="/lab">🧸 Character lab</a>
        {usage.state !== 'normal' && (
          <span className="pill pill-warn" title={usage.warning?.limit ?? undefined}>
            {usage.state === 'paused' ? '⛔ Paused' : '🐢 Pacing'}
            {usage.until && ` until ${time(usage.until)}`}
          </span>
        )}
        {version && <span className="muted">v{version}</span>}
        <span className="spacer" />
        <label className="connect" title="The rules grow and shrink floors to fit the work, except floors held at a size">
          <input type="checkbox" checked={settings.autoscale} onChange={(e) => run('PATCH', '/api/settings', { autoscale: e.target.checked })} /> autoscale
        </label>
        <OfficeClockPicker run={run} />
        <SeasonPicker run={run} />
        <BodyStylePicker run={run} />
        <InkToggle run={run} />
        <OwnSetupToggle run={run} />
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
      ) : (
        <>
          <CeoSection run={run} />
          <CloudSection run={run} />
          <WorldSection run={run} />
        </>
      )}
      {!loaded ? null : floors.length === 0 ? (
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

const DAY_MODE_NAMES: Record<DayMode, string> = { cycle: '30-minute day', clock: 'your clock', day: 'always day' };

/** The office's clock, an office setting: the game's sky, light, lamps and lunch follow it in every tab (world/dayTime.ts). */
function OfficeClockPicker({ run }: { run: Run }) {
  const mode = useStore((s) => s.settings.dayMode);
  return (
    <label className="connect" title="What time it is in the office: a whole day every 30 minutes, each viewer's own clock, or always mid-afternoon. The same in every tab.">
      office clock
      <select value={mode} onChange={(e) => run('PATCH', '/api/settings', { dayMode: e.target.value as DayMode })}>
        {DAY_MODES.map((m) => (
          <option key={m} value={m}>
            {DAY_MODE_NAMES[m]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The season outside, an office setting: by the office's date, or any season shown now, in every tab (shared/seasons.ts). */
function SeasonPicker({ run }: { run: Run }) {
  const setting = useStore((s) => s.settings.season);
  const today = useStore((s) => s.world.today);
  const look = seasonFor(parseSeasonSetting(setting), today || officeDay(Date.now()));
  return (
    <label className="connect" title={`The season outside: snow, blossom, leaves, pumpkins, the Christmas tree, New Year's fireworks. The office's date is ${today || 'not known yet'}; showing ${look.label}. The game's ?season= shows another in one tab.`}>
      season
      <select value={setting} onChange={(e) => run('PATCH', '/api/settings', { season: e.target.value as SeasonSetting })}>
        {SEASON_SETTINGS.map((m) => (
          <option key={m} value={m}>
            {SEASON_SETTING_NAMES[m]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** How everyone in the office is drawn, an office setting: the character lab's chibi or stylized human, in every tab. */
function BodyStylePicker({ run }: { run: Run }) {
  const style = useStore((s) => s.settings.bodyStyle);
  return (
    <label className="connect" title="How everyone in the office is drawn, you included: the same in every tab.">
      body style
      <select value={style} onChange={(e) => run('PATCH', '/api/settings', { bodyStyle: e.target.value as BodyStyle })}>
        {BODY_STYLES.map((s) => (
          <option key={s} value={s}>
            {STYLE_NAMES[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The office's ink outlines, an office setting: off draws none at all (fewer draw calls), in every tab. */
function InkToggle({ run }: { run: Run }) {
  const on = useStore((s) => s.settings.inkOutlines);
  return (
    <label className="connect" title="Ink outlines round the furniture and the people. Off draws none at all, for fewer draw calls. The same in every tab.">
      <input type="checkbox" checked={on} onChange={(e) => run('PATCH', '/api/settings', { inkOutlines: e.target.checked })} /> ink outlines
    </label>
  );
}

/** Whether sessions load the manager's own Claude Code setup, an office setting (off: the repo's and the playbook's only). */
function OwnSetupToggle({ run }: { run: Run }) {
  const on = useStore((s) => s.settings.workersUseMySetup);
  return (
    <label className="connect" title="Sessions load your own Claude Code settings, CLAUDE.md, skills, plugins and memory. Off: --setting-sources project,local and auto memory off; your sign-in is used either way.">
      <input type="checkbox" checked={on} onChange={(e) => run('PATCH', '/api/settings', { workersUseMySetup: e.target.checked })} /> workers use my setup
    </label>
  );
}

/**
 * What a session on this floor gets from the playbook, as the office composes it at launch (shared/playbook.ts): the
 * rules after its instructions, and the plugin's files. The console's Playbook tab edits it.
 */
function FloorPlaybook({ floor }: { floor: Floor }) {
  const docs = useStore((s) => s.playbook.docs);
  const own = useStore((s) => s.settings.workersUseMySetup);
  const pb = playbookFor(docs, floor);
  return (
    <details className="debug-playbook">
      <summary>
        📘 What a session here gets: {pb.rulesDocs.length ? `${plural(pb.rulesDocs.length, 'rules doc')} (${pb.size.lines} lines, ~${pb.size.tokens} tokens a turn)` : 'no rules'}
        {pb.entries.length > 0 && ` · plugin: ${pb.entries.map((e) => `${e.kind} ${e.name}`).join(', ')}`} · {own ? 'your own setup too' : 'not your own setup'}
      </summary>
      {pb.rules && <pre className="qa-brief">{pb.rules}</pre>}
      {pb.files.map((f) => (
        <details key={f.path}>
          <summary>
            <code>plugin/{f.path}</code>
          </summary>
          <pre className="qa-brief">{f.content}</pre>
        </details>
      ))}
    </details>
  );
}

/** The clock, ticking every `ms`: for what counts down. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * The world events outside, for every tab at once (server/worldRoutes.ts): start any of them now, on a side or either;
 * what's on, with the time it has left, to end; when the director picks next, or soon; and what ran lately. The game's
 * ?event= and window.__mmEvents do the same.
 */
function WorldSection({ run }: { run: Run }) {
  const world = useStore((s) => s.world);
  const connected = useStore((s) => s.connected);
  const now = useNow(1000);
  const [side, setSide] = useState<'either' | EventSide>('either');
  const [log, setLog] = useState<WorldLogEntry[]>([]);
  // what ran changes only as events start and end, or the director's next pick moves
  useEffect(() => {
    if (connected) query<WorldLogEntry[]>('/api/world/log').then(setLog, () => undefined);
  }, [connected, world.running, world.nextAt]);
  const trigger = (id: EventId) => run('POST', '/api/world/trigger', { event: id, side: side === 'either' ? undefined : side });
  return (
    <section>
      <div className="floor-title">
        <h2>World events</h2>
        <label className="connect" title="Which side of the building: the sky's over that side, the street's down the street on that side">
          side
          <select value={side} onChange={(e) => setSide(e.target.value as 'either' | EventSide)}>
            <option value="either">either</option>
            <option value="west">west</option>
            <option value="east">east</option>
          </select>
        </label>
      </div>
      {eventGroups().map((g) => (
        <div key={g.title} className="floor-title" style={{ margin: '6px 0' }}>
          <strong title={g.hint}>{g.title}</strong>
          {g.events.map((e) => (
            <button key={e.id} title={eventHint(e)} onClick={() => trigger(e.id)}>
              {e.label}
            </button>
          ))}
        </div>
      ))}
      <h3>On now</h3>
      {world.running.length === 0 ? (
        <p className="muted">Nothing outside right now.</p>
      ) : (
        <ul className="moments">
          {world.running.map((r) => (
            <li key={r.key}>
              {EVENTS[r.id].label}{' '}
              <span className="muted">
                · {r.side} side · {span(timeLeft(r, now))} left{r.forced ? ' · on demand' : ''}
              </span>{' '}
              <button className="link" onClick={() => run('POST', '/api/world/end', { event: r.id })}>
                End
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="connect">
        Next pick {nextPick(world.nextAt, now)}
        <button title="Have the director pick the next event 5 seconds from now" onClick={() => run('POST', '/api/world/soon', { seconds: 5 })}>
          Soon
        </button>
        <button disabled={!world.running.length} onClick={() => run('POST', '/api/world/end', {})}>
          End all
        </button>
      </p>
      {log.length > 0 && (
        <>
          <h3>Lately</h3>
          <ul className="moments">
            {log.slice(0, 8).map((e) => (
              <li key={e.key}>
                <span className="muted">{time(e.startedAt)}</span> {logLine(e, now)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
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

/** The office's messages to the manager (the desktop's Notices, in the game): PRs that need them, merges GitHub refused, pacing. */
function Messages() {
  const messages = useStore((s) => s.messages);
  if (!messages.length) return null;
  return (
    <section>
      <h2>Messages</h2>
      <ul className="moments">
        {[...messages].reverse().map((m) => (
          <li key={m.id}>
            <span className="muted">{time(m.at)}</span> {m.from === 'ceo' ? <strong>CEO: </strong> : m.from === 'manager' ? <strong>You: </strong> : null}
            <span className={m.from === 'office' ? undefined : 'chat-line'}>{m.text}</span>
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

/** The floor's work branch, plainly: a name (empty: the default branch), made from the default branch first when GitHub lacks it and "create" is ticked. */
function WorkBranchField({ floor, run }: { floor: Floor; run: Run }) {
  const [name, setName] = useState(floor.workBranch ?? '');
  const [create, setCreate] = useState(false);
  useEffect(() => setName(floor.workBranch ?? ''), [floor.workBranch]);
  return (
    <form
      className="connect"
      title="Where the floor's work starts from and its PRs merge into"
      onSubmit={(e) => {
        e.preventDefault();
        run('PATCH', `/api/floors/${floorPath(floor.id)}`, { workBranch: name.trim() || null, createBranch: create });
      }}
    >
      work branch <input value={name} placeholder={floor.defaultBranch} size={10} aria-label="Work branch" onChange={(e) => setName(e.target.value)} />
      <label>
        <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} /> create
      </label>
      <button disabled={(name.trim() || null) === floor.workBranch}>Set</button>
    </form>
  );
}

function FloorSection({ floor, run }: { floor: Floor; run: Run }) {
  const workers = useStore((s) => s.workers);
  const logs = useStore((s) => s.logs);
  const qa = useStore((s) => s.qa);
  const team = Object.values(workers)
    .filter((w) => w.floorId === floor.id)
    .sort((a, b) => a.desk - b.desk);
  const defaultModel = useStore((s) => s.settings.defaultModel);
  const purse = useStore((s) => s.coins.floors[floor.id]);
  const demo = useStore((s) => s.demo);
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const [shop, setShop] = useState(false);
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
        <WorkBranchField floor={floor} run={run} />
        {floor.teamSize === null ? (
          <span className="pill">sized by the rules</span>
        ) : (
          <span className="pill pill-warn">
            held at {floor.teamSize}{' '}
            <button className="link" onClick={() => run('PATCH', `/api/floors/${fp}`, { teamSize: null })}>
              back to the rules
            </button>
          </span>
        )}
        <span className="pill" title="Coins to spend, and earned in all">
          🪙 {purse?.coins ?? 0} · {purse?.earned ?? 0} earned
        </span>
        {demo && (
          <button title="Give this floor 100 coins (demo only)" onClick={() => run('POST', `/api/floors/${fp}/coins/grant`, { amount: 100 })}>
            🪙 +100
          </button>
        )}
        <button onClick={() => setShop(!shop)}>{shop ? 'Hide the shop' : '🛍 Shop'}</button>
      </div>
      {shop && (
        <div className="debug-shop">
          <ShopView floorId={floor.id} tabs={false} />
        </div>
      )}
      <p className="muted">
        {plural(team.length, 'worker')} · {plural(floor.issues.length, 'open issue')} · clone {floor.cloneStatus}
        {floor.cloneError && ` (${floor.cloneError})`}
        {floor.lastSync && ` · synced ${time(floor.lastSync)}`}
      </p>
      {floor.syncError && <p className="error">Sync failed: {floor.syncError}</p>}
      <FloorBrief floor={floor} run={run} />
      <FloorPlaybook floor={floor} />

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
                    {w.leaving && <span className="muted"> · 🧳 leaving</span>}
                    {w.host === 'box' && <span className="muted"> · ☁ {w.cloud ?? 'cloud'}</span>}
                    {w.needsSignIn && (
                      <div>
                        <button
                          onClick={() => {
                            run('POST', `/api/workers/${w.id}/sign-in`);
                            setOpenTerm(w.id);
                          }}
                        >
                          🔑 Sign in
                        </button>
                      </div>
                    )}
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
                    <button title={w.host === 'box' ? 'Move to this computer' : 'Move to a cloud machine (an Upstash Box)'} onClick={() => run('POST', `/api/workers/${w.id}/move`, { host: w.host === 'box' ? 'local' : 'box' })}>
                      {w.host === 'box' ? '🖥 Move here' : '☁ Move'}
                    </button>
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
            const held = floor.held.find((h) => h.issue === i.number);
            return (
              <li key={i.number}>
                #{i.number} {i.title}{' '}
                <span className="muted">· {pr ? `PR #${pr.number}` : builder ? `taken by ${builder.name}` : held ? `waits for you: PR #${held.pr} was closed` : 'ready'}</span>
                {held && !pr && !builder && (
                  <button className="link" onClick={() => run('DELETE', `/api/floors/${fp}/held/${i.number}`)}>
                    Build again
                  </button>
                )}
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
                <th scope="col">Branch → base</th>
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
                      <td className="last-line">
                        {p.headRefName} → {p.baseRefName}
                      </td>
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

/** The CEO: hire one, then their status, model and terminal, and a box to write to them (the desktop has the chats, in the game). */
function CeoSection({ run }: { run: Run }) {
  const ceo = useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo') ?? null);
  const lastLine = useStore((s) => (ceo ? s.logs[ceo.id]?.at(-1)?.text : undefined));
  const defaultModel = useStore((s) => s.settings.defaultModel);
  const [draft, setDraft] = useState('');
  const [term, setTerm] = useState(false);
  if (!ceo) {
    return (
      <section className="ceo">
        <h2>CEO</h2>
        <p className="muted">
          No CEO yet. A CEO onboards new floors, plans your briefs into issues and answers your messages; it costs a session each time.{' '}
          <button onClick={() => run('POST', '/api/ceo')}>Hire a CEO</button>
        </p>
      </section>
    );
  }
  return (
    <section className="ceo">
      <div className="floor-title">
        <h2>CEO · {ceo.name}</h2>
        <span className={`status status-${ceo.status}`}>{ceo.status}</span>
        <ModelField value={ceo.model} placeholder={defaultModel} onCommit={(v) => run('PATCH', `/api/workers/${ceo.id}`, { model: v })} />
        <button onClick={() => setTerm(!term)}>{term ? 'Hide terminal' : 'Terminal'}</button>
        <button onClick={() => run('POST', `/api/workers/${ceo.id}/stop`)}>Stop</button>
        <button onClick={() => run('DELETE', '/api/ceo')}>Let go</button>
      </div>
      {ceo.status === 'error' && ceo.lastError && <p className="error">{ceo.lastError}</p>}
      {lastLine && <p className="last-line">{lastLine}</p>}
      {term && <LiveTerminal workerId={ceo.id} />}
      <form
        className="connect"
        onSubmit={(e) => {
          e.preventDefault();
          run('POST', '/api/ceo/message', { text: draft });
          setDraft('');
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message ${ceo.name}`} size={60} />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

/** A floor's brief (what it's building), which the CEO plans into issues, and the CEO's profile of the project. */
function FloorBrief({ floor, run }: { floor: Floor; run: Run }) {
  const [mission, setMission] = useState(floor.mission);
  useEffect(() => setMission(floor.mission), [floor.mission]);
  return (
    <details className="brief">
      <summary>
        {floor.summary || 'No profile yet'}
        {floor.mission && <span className="muted"> · brief: {floor.mission.slice(0, 80)}</span>}
      </summary>
      {floor.qaBrief && <pre className="qa-brief">{floor.qaBrief}</pre>}
      <form
        className="connect"
        onSubmit={(e) => {
          e.preventDefault();
          run('POST', `/api/floors/${floorPath(floor.id)}/plan`, { mission });
        }}
      >
        <textarea value={mission} onChange={(e) => setMission(e.target.value)} placeholder="What this floor should build next" rows={2} cols={60} />
        <button type="submit" disabled={!mission.trim()}>
          Plan it with the CEO
        </button>
      </form>
    </details>
  );
}

/** A secret field: saved with only its last characters shown, never sent back by the server. */
function SecretField({ label, set, hint, placeholder, onSave }: { label: string; set: boolean; hint: string; placeholder: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <form
      className="connect"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
        setDraft('');
      }}
    >
      {label} {set ? <span className="pill pill-ok">saved ••••{hint}</span> : <span className="pill">not set</span>}
      <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} size={28} />
      <button type="submit" disabled={!draft.trim()}>
        Save
      </button>
      {set && (
        <button type="button" onClick={() => onSave('')}>
          Remove
        </button>
      )}
    </form>
  );
}

const CREDENTIAL_SOURCE: Record<string, string> = {
  token: 'a token you saved',
  gh: 'your gh login',
  subscription: 'MARSHMALLOW_CLAUDE_TOKEN from your environment',
  apiKey: 'an Anthropic API key you saved',
  login: "each Box's own sign-in, in the worker's terminal",
};

/** Box workers: the Upstash account, where new workers work, and what Box workers sign in with. */
function CloudSection({ run }: { run: Run }) {
  const cloud = useStore((s) => s.cloud);
  const settings = useStore((s) => s.settings.cloud);
  const demo = useStore((s) => s.demo);
  const patch = (c: Partial<typeof settings>) => run('PATCH', '/api/settings', { cloud: { ...settings, ...c } });
  const source = (s: string | null) => (s ? CREDENTIAL_SOURCE[s] : 'missing');
  return (
    <details className="cloud">
      <summary>
        <strong>Cloud workers</strong> <span className="muted">· {settings.machineKind === 'box' && cloud.keySet ? 'new workers get an Upstash Box' : 'new workers work on this computer'}</span>
      </summary>
      <SecretField label="Upstash Box API key" set={cloud.keySet} hint={cloud.keyHint} placeholder="from console.upstash.com → Box" onSave={(key) => run('PUT', '/api/cloud/key', { key })} />
      {cloud.keyError && <p className="error">{cloud.keyError}</p>}
      {cloud.keySet && (
        <p className="connect">
          {cloud.boxes ? `${plural(cloud.boxes.total, 'Box', 'Boxes')} on the account · ${cloud.boxes.running} running · ${cloud.boxes.paused} paused` : 'Boxes not counted yet'}
          <button onClick={() => run('POST', '/api/cloud/test')}>Test</button>
          {!!cloud.boxes?.orphans && <button onClick={() => run('POST', '/api/cloud/orphans')}>Delete {plural(cloud.boxes.orphans, 'orphan')}</button>}
          {demo && <button onClick={() => run('POST', '/api/demo/expire-sign-ins')}>Expire sign-ins (demo)</button>}
        </p>
      )}
      <p className="connect">
        New workers work
        <select value={settings.machineKind} disabled={!cloud.keySet} onChange={(e) => patch({ machineKind: e.target.value as 'local' | 'box' })}>
          <option value="local">on this computer</option>
          <option value="box">in an Upstash Box each</option>
        </select>
        Box size
        <select value={settings.boxSize} onChange={(e) => patch({ boxSize: e.target.value as (typeof BOX_SIZES)[number] })}>
          {BOX_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} ({BOX_SIZE_INFO[s].spec}, ${BOX_SIZE_INFO[s].usdPerCpuHour.toFixed(2)}/CPU hour)
            </option>
          ))}
        </select>
        your plan's Box limit
        <input type="number" min={1} max={1000} value={settings.boxLimit} onChange={(e) => patch({ boxLimit: Number(e.target.value) })} style={{ width: '6ch' }} />
      </p>
      <p className="muted">GitHub in Boxes: {source(cloud.github.source)}. Claude in Boxes: {source(cloud.claude.source)}.</p>
      <SecretField label="GitHub token for Boxes" set={cloud.github.source === 'token'} hint={cloud.github.hint} placeholder="fine-grained, your floors' repos only" onSave={(value) => run('PUT', '/api/cloud/token', { kind: 'github', value })} />
      {cloud.claude.source !== 'subscription' && (
        <SecretField label="Anthropic API key" set={cloud.claude.source === 'apiKey'} hint={cloud.claude.hint} placeholder="sk-ant-… (billed per token)" onSave={(value) => run('PUT', '/api/cloud/token', { kind: 'anthropic', value })} />
      )}
    </details>
  );
}
