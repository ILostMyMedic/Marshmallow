// The console's Team tab: the CEO, and each floor's workers: hire, let go, stop, reset, move between this computer and
// an Upstash Box, their model and effort, a cloud worker's sign-in, and the floor's size. Adapted from cubefarm
// client/src/ui/ManagerConsole.tsx (TeamTab, AddAgent, CeoTab) (MIT). Cut: names and looks, coding agents other than
// Claude Code, prompt previews, career stats, the CEO's company reviews and team-change requests (theirs apply at once).
import { useEffect, useState } from 'react';
import { isBusy, type Floor, type Worker } from '../../../../shared/types';
import { floorPath } from '../../api';
import { taskText } from '../../debug/describe';
import { useStore } from '../../store';
import { act } from '../../world/actions';
import { ConfirmButton, EffortSelect, FloorBadge, ModelInput, ModelPick, StatusPill } from './fields';
import { hireCeo, run, useBusy } from './run';

const patchWorker = (id: string, p: { model?: string; effort?: string }) => run('PATCH', `/api/workers/${id}`, p);

function CeoCard() {
  const ceo = useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo') ?? null);
  const lastLine = useStore((s) => (ceo ? s.logs[ceo.id]?.at(-1)?.text : undefined));
  const defaultModel = useStore((s) => s.settings.defaultModel);
  const defaultEffort = useStore((s) => s.settings.defaultEffort);
  const [model, setModel] = useState('');
  const [hiring, go] = useBusy();
  if (!ceo)
    return (
      <article className="console-card console-ceo">
        <header className="console-row">
          <span className="console-avatar">🧠</span>
          <div className="console-grow">
            <strong>No CEO yet</strong>
            <div className="console-hint">A CEO studies each new floor, plans your briefs into issues, sizes teams on top of the rules and answers your messages. Each of those is a session.</div>
          </div>
        </header>
        <div className="console-row wrap">
          <span className="console-hint">On</span>
          <ModelPick value={model} placeholder={`${defaultModel} (the default)`} label="The new CEO's model" onChange={setModel} />
          <button className="console-btn good" disabled={hiring} onClick={() => void go(hireCeo(model)).then((c) => c && setModel(''))}>
            {hiring ? 'Hiring…' : 'Hire a CEO'}
          </button>
        </div>
      </article>
    );
  return (
    <article className="console-card console-ceo">
      <header className="console-row">
        <span className="console-avatar">🧠</span>
        <div className="console-grow">
          <strong>{ceo.name}</strong> <span className="console-hint">· CEO ·</span> <StatusPill status={ceo.status} />
          <div className={ceo.status === 'error' ? 'console-bad' : 'console-line'}>{ceo.status === 'error' ? ceo.lastError : lastLine}</div>
        </div>
      </header>
      <div className="console-row wrap">
        <ModelInput value={ceo.model} placeholder={defaultModel} label="The CEO's model" onCommit={(m) => patchWorker(ceo.id, { model: m })} />
        <EffortSelect value={ceo.effort} fallback={defaultEffort} label="The CEO's effort" onChange={(effort) => void patchWorker(ceo.id, { effort })} />
        <span className="console-grow" />
        <button className="console-btn" title="Chat with the CEO on your desktop (P)" onClick={() => act({ kind: 'desktop', app: 'chat' })}>
          💬 Chat
        </button>
        <button className="console-btn" onClick={() => act({ kind: 'terminal', workerId: ceo.id })}>
          Terminal
        </button>
        <button className="console-btn" disabled={!isBusy(ceo.status)} onClick={() => void run('POST', `/api/workers/${ceo.id}/stop`)}>
          Stop
        </button>
        <ConfirmButton question={`Let ${ceo.name} go?`} confirm="Let go" onConfirm={() => void run('DELETE', '/api/ceo')}>
          Let go
        </ConfirmButton>
      </div>
    </article>
  );
}

/** Holding the floor at a size (the rules leave it alone then), or handing it back to the rules. */
function TeamSize({ floor, max }: { floor: Floor; max: number }) {
  const autoscale = useStore((s) => s.settings.autoscale);
  const [size, setSize] = useState(floor.teamSize === null ? '' : String(floor.teamSize));
  useEffect(() => setSize(floor.teamSize === null ? '' : String(floor.teamSize)), [floor.teamSize]);
  const fp = floorPath(floor.id);
  const n = Number(size);
  const valid = size.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= max;
  return (
    <form
      className="console-size"
      title={`The rules grow and shrink a team to fit its work${autoscale ? '' : ' (autoscale is off on the Settings tab)'}. A floor held at a size is left to you; hiring or letting go by hand holds it too.`}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void run('PATCH', `/api/floors/${fp}`, { teamSize: n });
      }}
    >
      {floor.teamSize === null ? <span className="console-chip">{autoscale ? 'sized by the rules' : 'autoscale off'}</span> : <span className="console-chip warn">held at {floor.teamSize}</span>}
      <input type="number" min={0} max={max} value={size} placeholder="size" aria-label={`Hold ${floor.fullName}'s team at`} onChange={(e) => setSize(e.target.value)} />
      <button className="console-btn small" disabled={!valid || n === floor.teamSize}>
        Hold
      </button>
      {floor.teamSize !== null && (
        <button type="button" className="console-btn small ghost" onClick={() => void run('PATCH', `/api/floors/${fp}`, { teamSize: null })}>
          Back to the rules
        </button>
      )}
    </form>
  );
}

function WorkerRow({ w }: { w: Worker }) {
  const defaultModel = useStore((s) => s.settings.defaultModel);
  const defaultEffort = useStore((s) => s.settings.defaultEffort);
  const keySet = useStore((s) => s.cloud.keySet);
  const [signing, go] = useBusy();
  const busy = isBusy(w.status);
  const signIn = () => void go(run('POST', `/api/workers/${w.id}/sign-in`)).then((ok) => ok && act({ kind: 'terminal', workerId: w.id }));
  const toBox = w.host !== 'box';
  const moveWhy = busy || w.status === 'stopped' ? `${w.name} is on a task: move them once it's done` : toBox && !keySet ? 'Save an Upstash Box API key first (Settings → Cloud workers)' : undefined;
  return (
    <tr>
      <th scope="row">
        {w.name}
        {w.host === 'box' && <span title={`Works in an Upstash Box (${w.cloud ?? 'cloud'})`}> ☁</span>}
        {w.leaving && <span title="Leaves once this task is done"> 🧳</span>}
      </th>
      <td>
        <StatusPill status={w.status} />
      </td>
      <td className="console-task">
        {taskText(w.task) || <span className="console-hint">—</span>}
        {w.status === 'error' && w.lastError && <div className="console-bad">{w.lastError}</div>}
      </td>
      <td>
        <ModelInput value={w.model} placeholder={defaultModel} label={`${w.name}'s model`} onCommit={(model) => patchWorker(w.id, { model })} />
      </td>
      <td>
        <EffortSelect value={w.effort} fallback={defaultEffort} label={`${w.name}'s effort`} onChange={(effort) => void patchWorker(w.id, { effort })} />
      </td>
      <td className="console-actions">
        {w.needsSignIn && (
          <button className="console-btn good" disabled={signing || busy} title={`${w.name}'s Claude Code waits for you to sign it in, in their terminal`} onClick={signIn}>
            {signing ? 'Starting…' : '🔑 Sign in'}
          </button>
        )}
        <button className="console-btn" onClick={() => act({ kind: 'terminal', workerId: w.id })}>
          Terminal
        </button>
        <button className="console-btn" disabled={!!moveWhy} title={moveWhy ?? (toBox ? 'Move to a cloud machine (an Upstash Box)' : 'Move to this computer')} onClick={() => void run('POST', `/api/workers/${w.id}/move`, { host: toBox ? 'box' : 'local' })}>
          {toBox ? '☁ Move' : '🖥 Move here'}
        </button>
        <button className="console-btn" disabled={!busy} title="Stop their session" onClick={() => void run('POST', `/api/workers/${w.id}/stop`)}>
          Stop
        </button>
        <button className="console-btn" disabled={w.status === 'idle' && !w.task} title="Drop their task and make them free" onClick={() => void run('POST', `/api/workers/${w.id}/reset`)}>
          Reset
        </button>
        <ConfirmButton question={`Let ${w.name} go?`} confirm="Let go" title={busy ? 'They finish their task first' : undefined} onConfirm={() => void run('DELETE', `/api/workers/${w.id}`)}>
          Let go
        </ConfirmButton>
      </td>
    </tr>
  );
}

function FloorTeam({ floor, focused }: { floor: Floor; focused: boolean }) {
  const workers = useStore((s) => s.workers);
  const max = useStore((s) => s.settings.maxWorkers);
  const [hiring, go] = useBusy();
  const team = Object.values(workers)
    .filter((w) => w.floorId === floor.id && w.role !== 'ceo')
    .sort((a, b) => a.desk - b.desk);
  const full = team.length >= max;
  return (
    <article className={`console-card console-floor${focused ? ' on' : ''}`} style={{ borderColor: floor.color }}>
      <header className="console-row wrap">
        <FloorBadge floor={floor.floor} color={floor.color} />
        <strong className="console-grow">{floor.fullName}</strong>
        <span className="console-hint">
          {team.length} of {max} workers
        </span>
        <TeamSize floor={floor} max={max} />
        <button
          className="console-btn good"
          disabled={hiring || full}
          title={full ? `The floor has its most workers (${max}): raise that on the Settings tab` : 'A new worker at the next free desk. Hiring by hand holds the floor at its new size.'}
          onClick={() => void go(run('POST', `/api/floors/${floorPath(floor.id)}/workers`))}
        >
          {hiring ? 'Hiring…' : '+ Hire'}
        </button>
      </header>
      {team.length === 0 ? (
        <p className="console-hint">Nobody works here yet.</p>
      ) : (
        <div className="console-scroll">
          <table className="console-team">
            <tbody>
              {team.map((w) => (
                <WorkerRow key={w.id} w={w} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export function TeamTab({ floorId }: { floorId?: string }) {
  const floors = useStore((s) => s.floors);
  return (
    <div>
      <CeoCard />
      {floors.length === 0 ? (
        <p className="console-hint">Connect a repository on the Floors tab first: workers need a floor to sit on.</p>
      ) : (
        floors.map((f) => <FloorTeam key={f.id} floor={f} focused={f.id === floorId} />)
      )}
    </div>
  );
}
