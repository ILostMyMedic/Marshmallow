// The app viewer: a floor's app, running (server/previews.ts), in a frame over the game, with its address line, reload,
// phone, tablet and desktop widths, a new tab, start, stop and restart, and its output as it comes. The floor's app
// monitor, its card in the console or a click in the overview opens it. Adapted from cubefarm
// client/src/ui/AppViewer.tsx (MIT): the PR theatre (channels, compare, QA), the run settings (the command and port are
// on the console's Floors tab), the environment and the sync proxy are cut; the address line and the tablet width are new.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Floor, PreviewState, PreviewView } from '../../../shared/types';
import { command, floorPath } from '../api';
import { atPath, FRAME_WIDTHS, isOn, loadWidth, pathFrom, saveWidth, shortSha, shortUrl, STATE_WORDS, stepOf, STEPS, stoppedPreview, widthPx, type FrameWidth } from '../preview';
import { useStore } from '../store';
import { useView } from '../world/view';
import { showTab } from './console/nav';
import { Panel } from './Panel';
import { useCommand } from './useCommand';

// A local dev app gets what a page in a tab gets, except taking over the office's tab (no top navigation).
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
// A frame never says it was refused (X-Frame-Options, frame-ancestors), so this only catches one that doesn't load.
const SLOW_LOAD_MS = 12_000;

type Verb = 'start' | 'stop' | 'restart';

/** A floor's preview commands: which one is on its way, and the server's refusal. */
function usePreviewCommands(floorId: string) {
  const { error, run } = useCommand();
  const [doing, setDoing] = useState<Verb | null>(null);
  const send = (verb: Verb) => {
    setDoing(verb);
    void run(() => command('POST', `/api/floors/${floorPath(floorId)}/preview/${verb}`)).finally(() => setDoing(null));
  };
  return { doing, error, send };
}

export function PreviewPill({ state }: { state: PreviewState }) {
  return <span className={`app-pill app-pill-${state}`}>{STATE_WORDS[state]}</span>;
}

/** The app's origin, and the path in it to open; Enter (or Go) loads it, a whole address on the app too. */
function AddressLine({ url, path, onGo }: { url: string | null; path: string; onGo: (path: string) => void }) {
  const [draft, setDraft] = useState(path);
  const [problem, setProblem] = useState('');
  // a new path, or the app stopping or coming up somewhere else, drops what was typed
  useEffect(() => {
    setDraft(path);
    setProblem('');
  }, [path, url]);
  return (
    <form
      className="app-address"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url) return;
        const next = pathFrom(draft, url);
        if (next === null) return setProblem("That's not this floor's app: the viewer shows only that. Open it in a tab of its own.");
        setProblem('');
        setDraft(next);
        onGo(next);
      }}
    >
      <span className="app-origin" title={url ?? undefined}>
        {shortUrl(url) ?? 'not running'}
      </span>
      <input value={draft} disabled={!url} aria-label="Path in the app" spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
      <button className="console-btn small" disabled={!url}>
        Go
      </button>
      {problem && <small className="console-bad app-address-problem">{problem}</small>}
    </form>
  );
}

/** What it runs, from where and on which port, in a sentence. */
function runs(floor: Floor, p: PreviewView) {
  const what = p.command ? <code>{p.command}</code> : "the package.json's dev, start or preview script";
  return (
    <>
      It runs {what} from {floor.defaultBranch}'s latest commit, in a checkout of its own{p.port ? ` on port ${p.port}` : ''}, on this computer only.
    </>
  );
}

/** The app in its frame while it runs, else how it's coming up, why it didn't run, or a big start button. */
function Stage({ floor, p, src, width, frameKey, doing, onStart }: { floor: Floor; p: PreviewView; src: string | null; width: FrameWidth; frameKey: string; doing: Verb | null; onStart: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const running = p.state === 'running' && !!src;
  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    if (!running) return;
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(t);
  }, [frameKey, running]);
  const toConsole = (
    <button className="link" onClick={() => showTab('floors', floor.id)}>
      the console's Floors tab
    </button>
  );

  if (running) {
    const px = widthPx(width);
    return (
      <div className={`app-stage${px ? ' app-stage-device' : ''}`}>
        <iframe
          key={frameKey}
          className="app-frame"
          style={px ? { width: px } : undefined}
          src={src}
          title={`${floor.fullName}, running`}
          sandbox={SANDBOX}
          allow="clipboard-read; clipboard-write; fullscreen; autoplay"
          onLoad={() => setLoaded(true)}
          onError={() => setSlow(true)}
        />
        {slow && !loaded && (
          <div className="app-frame-hint" role="status">
            <b>The app isn't showing up here.</b> It may refuse to be shown inside another page.{' '}
            <a href={src} target="_blank" rel="noreferrer">
              Open it in a new tab ↗
            </a>
          </div>
        )}
      </div>
    );
  }
  const step = stepOf(p.state);
  if (step >= 0) {
    return (
      <div className="app-stage app-state" role="status">
        <div className="app-state-icon app-spin">⚙️</div>
        <h3>Starting the app…</h3>
        <ol className="app-steps">
          {STEPS.map((s, i) => (
            <li key={s.state} className={i < step ? 'done' : i === step ? 'now' : ''}>
              {i < step ? '✓' : i === step ? '●' : '○'} {s.label}
              {s.state === 'starting' && p.port ? ` on port ${p.port}` : ''}
            </li>
          ))}
        </ol>
        <p className="console-hint">A first start installs its dependencies, which can take a minute. Its output follows below.</p>
      </div>
    );
  }
  if (p.state === 'error') {
    return (
      <div className="app-stage app-state app-state-left">
        <h3>⚠️ The app didn't start</h3>
        <pre className="app-error">{p.error ?? 'It stopped unexpectedly.'}</pre>
        <div className="console-row">
          <button className="console-btn good" disabled={!!doing} onClick={onStart}>
            {doing === 'start' ? 'Starting…' : '↻ Try again'}
          </button>
          <span className="console-hint">Its output is below; the command and port are on {toConsole}.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="app-stage app-state">
      <div className="app-state-icon">🖥️</div>
      <h3>The app isn't running</h3>
      <p className="console-hint app-runs">
        Start it to try what the team shipped, right here. {runs(floor, p)} Another command or port: {toConsole}.
      </p>
      <button className="console-btn good app-start" disabled={!!doing} onClick={onStart}>
        {doing === 'start' ? 'Starting…' : '▶ Start the app'}
      </button>
    </div>
  );
}

// Remembered while the page is open, like cubefarm's width.
let outputOpen = true;

/** The last lines of the app's output, following as they come unless you've scrolled up to read. */
function Output({ log }: { log: string[] }) {
  const [open, setOpen] = useState(outputOpen);
  const pre = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = pre.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log, open]);
  return (
    <details
      className="app-output"
      open={open}
      onToggle={(e) => {
        outputOpen = e.currentTarget.open;
        setOpen(outputOpen);
      }}
    >
      <summary>
        Output <span className="console-hint">· {log.length ? `the last ${log.length} line${log.length === 1 ? '' : 's'}` : 'nothing yet'}</span>
      </summary>
      {log.length > 0 && (
        <pre
          ref={pre}
          className="app-log"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
          }}
        >
          {log.join('\n')}
        </pre>
      )}
    </details>
  );
}

export function AppViewer({ floorId }: { floorId: string }) {
  const close = useView((s) => s.closeOverlay);
  const floor = useStore((s) => s.floors.find((f) => f.id === floorId));
  const p = useStore((s) => s.previews[floorId]) ?? stoppedPreview(floorId);
  const { doing, error, send } = usePreviewCommands(floorId);
  const [width, setWidth] = useState<FrameWidth>(() => loadWidth());
  const [path, setPath] = useState('/');
  const [reloads, setReloads] = useState(0);

  if (!floor) {
    return (
      <Panel onClose={close} title="🖥 App">
        <p className="panel-note">This floor no longer exists.</p>
      </Panel>
    );
  }
  const name = floor.fullName.split('/')[1] ?? floor.fullName;
  const running = p.state === 'running' && !!p.url;
  const src = running ? atPath(p.url!, path) : null;
  const sha = shortSha(p.sha);
  const pick = (w: FrameWidth) => {
    saveWidth(w);
    setWidth(w);
  };
  return (
    <Panel
      wide
      onClose={close}
      title={
        <span className="app-title">
          🖥 {name} <PreviewPill state={p.state} />
          {running && (
            <span className="panel-sub">
              {floor.defaultBranch}
              {sha && ` · ${sha}`}
              {p.startedAt && ` · up since ${new Date(p.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          )}
        </span>
      }
    >
      <div className="app-viewer">
        <div className="app-bar" role="toolbar" aria-label="App controls">
          {isOn(p.state) ? (
            <>
              <button className="console-btn" disabled={!!doing} title="Stop it and start it again, from the latest commit" onClick={() => send('restart')}>
                {doing === 'restart' ? 'Restarting…' : '↻ Restart'}
              </button>
              <button className="console-btn bad" disabled={!!doing} onClick={() => send('stop')}>
                {doing === 'stop' ? 'Stopping…' : '■ Stop'}
              </button>
            </>
          ) : (
            <button className="console-btn good" disabled={!!doing} onClick={() => send('start')}>
              {doing === 'start' ? 'Starting…' : p.state === 'error' ? '↻ Try again' : '▶ Start'}
            </button>
          )}
          <button className="console-btn" disabled={!running} title="Load the app again" onClick={() => setReloads((n) => n + 1)}>
            ⟳ Reload
          </button>
          <div className="app-seg" role="group" aria-label="Width">
            {FRAME_WIDTHS.map((w) => (
              <button key={w.id} className={`app-seg-btn${width === w.id ? ' on' : ''}`} aria-pressed={width === w.id} title={w.px ? `${w.px} px wide` : 'As wide as the viewer'} onClick={() => pick(w.id)}>
                {w.label}
              </button>
            ))}
          </div>
          <span className="console-grow" />
          {src ? (
            <a className="console-btn" href={src} target="_blank" rel="noreferrer">
              Open in a new tab ↗
            </a>
          ) : (
            <button className="console-btn" disabled>
              Open in a new tab ↗
            </button>
          )}
        </div>
        <AddressLine
          url={running ? p.url : null}
          path={path}
          onGo={(next) => {
            setPath(next);
            setReloads((n) => n + 1);
          }}
        />
        {error && (
          <p className="console-bad" role="alert">
            {error}
          </p>
        )}
        <Stage floor={floor} p={p} src={src} width={width} frameKey={`${src}|${p.startedAt}|${reloads}`} doing={doing} onStart={() => send('start')} />
        <Output log={p.log} />
        {running && (
          <p className="app-foot">
            Blank, or “refused to connect”? The app may not let itself be framed: open it in a new tab. Keys typed in the app stay there, so <kbd>Esc</kbd> closes this only from outside it;
            ✕ always does. The address line shows where you sent the frame, not where you've clicked to in it.
          </p>
        )}
      </div>
    </Panel>
  );
}
