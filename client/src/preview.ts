// A floor's preview (server/previews.ts) as the office shows it: the words for its state, the steps while it comes up,
// what the app monitor says, the app viewer's widths and address line, and the console's command and port boxes.
// Adapted from cubefarm client/src/ui/AppViewer.tsx and world/draw.ts (MIT): STATUS_LABEL, STEPS and the app
// screen's texts; the PR channels are cut.
import type { PreviewConfig, PreviewState, PreviewView } from '../../shared/types';

export const STATE_WORDS: Record<PreviewState, string> = {
  stopped: 'stopped',
  preparing: 'getting the code',
  installing: 'installing',
  starting: 'starting',
  running: 'running',
  error: 'failed',
};

/** How a preview comes up, in order. */
export const STEPS: { state: PreviewState; label: string }[] = [
  { state: 'preparing', label: 'Get the latest code' },
  { state: 'installing', label: 'Install dependencies' },
  { state: 'starting', label: 'Start the app' },
];

/** Which step a coming-up preview is on; -1 when it isn't coming up. */
export const stepOf = (state: PreviewState) => STEPS.findIndex((s) => s.state === state);

/** Coming up or up: what Stop and Restart act on. */
export const isOn = (state: PreviewState) => state !== 'stopped' && state !== 'error';

/** A floor the server has no preview for yet reads as stopped. */
export function stoppedPreview(floorId: string): PreviewView {
  return { floorId, state: 'stopped', url: null, port: 0, command: null, config: { command: null, port: null }, sha: null, startedAt: null, error: null, log: [] };
}

/** The first line of `text` with something on it. */
export const firstLine = (text: string | null | undefined) => (text ?? '').split(/\r?\n/).find((l) => l.trim())?.trim() ?? null;

/** The last line of output with something on it. */
export function lastLine(log: readonly string[]) {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].trim()) return log[i].trim();
  return null;
}

export const shortSha = (sha: string | null) => (sha ? sha.slice(0, 7) : null);

// ---------- the app monitor ----------

export type MonitorTone = 'off' | 'busy' | 'live' | 'bad';

/** What the app monitor says about a preview, and what aiming at it offers. */
export interface MonitorCaption {
  badge: string;
  tone: MonitorTone;
  title: string;
  detail: string;
  footer: string;
  /** The crosshair's hint (E opens the app viewer whatever the state). */
  aim: string;
  /** The step coming up (stepOf), or -1. */
  step: number;
}

export function monitorCaption(p: PreviewView, branch: string): MonitorCaption {
  const port = p.port ? ` on port ${p.port}` : '';
  switch (p.state) {
    case 'stopped':
      return {
        badge: 'OFF',
        tone: 'off',
        title: '▶ Start the app',
        detail: p.command ? `Runs ${p.command}${port}` : `Runs ${branch}'s latest commit${port}`,
        footer: 'Press E to open the app viewer',
        aim: 'Start the app',
        step: -1,
      };
    case 'running':
      return {
        badge: '● LIVE',
        tone: 'live',
        title: shortUrl(p.url) ?? `port ${p.port}`,
        detail: [branch, shortSha(p.sha)].filter(Boolean).join(' · '),
        footer: 'Press E to open the app',
        aim: 'Open the app',
        step: -1,
      };
    case 'error':
      return {
        badge: 'FAILED',
        tone: 'bad',
        title: "The app didn't start",
        detail: firstLine(p.error) ?? 'It stopped unexpectedly.',
        footer: 'Press E to see its output and try again',
        aim: 'See why the app stopped',
        step: -1,
      };
    default: {
      const step = Math.max(0, stepOf(p.state));
      return {
        badge: 'STARTING',
        tone: 'busy',
        title: `${STEPS[step].label}…`,
        detail: `Step ${step + 1} of ${STEPS.length}`,
        footer: lastLine(p.log) ?? 'Press E to watch it come up',
        aim: 'Watch the app start',
        step,
      };
    }
  }
}

// ---------- the app viewer: widths and the address line ----------

export type FrameWidth = 'phone' | 'tablet' | 'desktop';

/** The viewer's widths: px wide, or null for the whole stage. */
export const FRAME_WIDTHS: { id: FrameWidth; label: string; px: number | null }[] = [
  { id: 'phone', label: 'Phone', px: 390 },
  { id: 'tablet', label: 'Tablet', px: 820 },
  { id: 'desktop', label: 'Desktop', px: null },
];

export const parseWidth = (v: string | null | undefined): FrameWidth => (v === 'phone' || v === 'tablet' ? v : 'desktop');

export const widthPx = (w: FrameWidth) => FRAME_WIDTHS.find((x) => x.id === w)?.px ?? null;

const WIDTH_KEY = 'marshmallow:appWidth';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | null => (typeof localStorage === 'undefined' ? null : localStorage);

/** The width picked last in this browser. */
export function loadWidth(store: Store | null = browserStore()): FrameWidth {
  try {
    return parseWidth(store?.getItem(WIDTH_KEY));
  } catch {
    return 'desktop';
  }
}

export function saveWidth(w: FrameWidth, store: Store | null = browserStore()) {
  try {
    store?.setItem(WIDTH_KEY, w);
  } catch {
    // not kept: it holds while the page is open
  }
}

/** An address without its scheme or a trailing slash, as the monitor and the address line show it. */
export function shortUrl(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '') || null;
}

/** The app's root: its origin and the path it's served under (the demo's apps sit under one), without a trailing slash. */
function rootOf(base: string) {
  const u = new URL(base);
  return { origin: u.origin, host: u.host, path: u.pathname.replace(/\/+$/, '') };
}

/** A path, query or fragment as path + search + hash from the root ('about' and '?q' become '/about' and '/?q'). */
function normalise(path: string) {
  const u = new URL(path.startsWith('/') || path.startsWith('?') || path.startsWith('#') ? path : `/${path}`, 'http://app.invalid');
  return `${u.pathname}${u.search}${u.hash}`;
}

/** The app's address at `path`, a path from the app's root. */
export function atPath(base: string, path: string): string {
  const root = rootOf(base);
  return `${root.origin}${root.path}${normalise(path || '/')}`;
}

/**
 * What was typed in the address line, as a path from the app's root: a path, a bare word, or a whole address on the
 * app (with or without its scheme). Null for an address somewhere else: the viewer only shows the floor's app.
 */
export function pathFrom(input: string, base: string): string | null {
  const text = input.trim();
  if (!text) return '/';
  const root = rootOf(base);
  const whole = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : text.toLowerCase().startsWith(root.host.toLowerCase()) ? `${new URL(base).protocol}//${text}` : null;
  if (whole === null) return normalise(text);
  let u: URL;
  try {
    u = new URL(whole);
  } catch {
    return null;
  }
  if (u.origin !== root.origin) return null;
  if (u.pathname !== root.path && !u.pathname.startsWith(`${root.path}/`)) return null;
  return normalise(`${u.pathname.slice(root.path.length) || '/'}${u.search}${u.hash}`);
}

// ---------- the console's command and port ----------

/** The port box: empty is automatic (null), else a whole number from 1 to 65535. */
export function parsePort(text: string): { port: number | null; problem: string } {
  const t = text.trim();
  if (!t) return { port: null, problem: '' };
  if (!/^\d+$/.test(t)) return { port: null, problem: 'A port is a whole number, like 5173.' };
  const port = Number(t);
  if (port < 1 || port > 65535) return { port: null, problem: 'A port is from 1 to 65535.' };
  return { port, problem: '' };
}

/** What the command and port boxes change from what's saved (empty = automatic): only what differs, or null for nothing. */
export function configPatch(saved: PreviewConfig, command: string, port: number | null): { command?: string | null; port?: number | null } | null {
  const out: { command?: string | null; port?: number | null } = {};
  const c = command.trim() || null;
  if (c !== saved.command) out.command = c;
  if (port !== saved.port) out.port = port;
  return Object.keys(out).length ? out : null;
}
