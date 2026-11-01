import { describe, expect, it } from 'vitest';
import type { PreviewView } from '../../shared/types';
import { atPath, configPatch, FRAME_WIDTHS, isOn, lastLine, loadWidth, monitorCaption, parsePort, parseWidth, pathFrom, saveWidth, shortUrl, stepOf, STEPS, stoppedPreview, widthPx } from './preview';

const view = (over: Partial<PreviewView>): PreviewView => ({ ...stoppedPreview('acme/shop'), port: 41001, ...over });

describe('the states', () => {
  it('counts the steps of coming up, and only those', () => {
    expect(STEPS.map((s) => stepOf(s.state))).toEqual([0, 1, 2]);
    expect(stepOf('stopped')).toBe(-1);
    expect(stepOf('running')).toBe(-1);
  });

  it('lets Stop and Restart act while it comes up or runs, not once it stopped or failed', () => {
    expect(['preparing', 'installing', 'starting', 'running'].every((s) => isOn(s as PreviewView['state']))).toBe(true);
    expect(isOn('stopped')).toBe(false);
    expect(isOn('error')).toBe(false);
  });

  it('reads a floor without a preview as stopped, with nothing set', () => {
    const p = stoppedPreview('acme/shop');
    expect(p).toMatchObject({ floorId: 'acme/shop', state: 'stopped', url: null, config: { command: null, port: null }, log: [] });
  });

  it('finds the last line of output with something on it', () => {
    expect(lastLine(['ready', '  VITE ready in 300 ms ', '', '  '])).toBe('VITE ready in 300 ms');
    expect(lastLine([])).toBeNull();
  });
});

describe('monitorCaption', () => {
  it('offers to start a stopped app, saying what it runs', () => {
    const c = monitorCaption(view({ command: 'npm run dev' }), 'main');
    expect(c).toMatchObject({ badge: 'OFF', tone: 'off', title: '▶ Start the app', aim: 'Start the app', step: -1 });
    expect(c.detail).toBe('Runs npm run dev on port 41001');
    expect(monitorCaption(view({}), 'main').detail).toBe("Runs main's latest commit on port 41001");
    expect(monitorCaption(stoppedPreview('acme/shop'), 'main').detail).not.toContain('port');
  });

  it('shows the step it is on while it comes up, and its latest output', () => {
    const c = monitorCaption(view({ state: 'installing', log: ['added 12 packages', ''] }), 'main');
    expect(c).toMatchObject({ badge: 'STARTING', tone: 'busy', title: 'Install dependencies…', detail: 'Step 2 of 3', footer: 'added 12 packages', step: 1 });
    expect(monitorCaption(view({ state: 'preparing' }), 'main').footer).toBe('Press E to watch it come up');
  });

  it('shows where a running app answers and the commit it runs', () => {
    const c = monitorCaption(view({ state: 'running', url: 'http://127.0.0.1:41001/', sha: '0123456789abcdef' }), 'main');
    expect(c).toMatchObject({ badge: '● LIVE', tone: 'live', title: '127.0.0.1:41001', detail: 'main · 0123456', aim: 'Open the app' });
  });

  it("says why an app didn't start, by the first line of its error", () => {
    const c = monitorCaption(view({ state: 'error', error: '\nExited with code 1\nnpm ERR! missing script: dev' }), 'main');
    expect(c).toMatchObject({ badge: 'FAILED', tone: 'bad', detail: 'Exited with code 1' });
    expect(monitorCaption(view({ state: 'error' }), 'main').detail).toBe('It stopped unexpectedly.');
  });
});

describe('the widths', () => {
  it('has phone, tablet and desktop, the desktop as wide as the stage', () => {
    expect(FRAME_WIDTHS.map((w) => w.id)).toEqual(['phone', 'tablet', 'desktop']);
    expect(widthPx('phone')).toBe(390);
    expect(widthPx('tablet')).toBe(820);
    expect(widthPx('desktop')).toBeNull();
  });

  it('reads anything unknown as desktop', () => {
    expect(parseWidth('tablet')).toBe('tablet');
    expect(parseWidth('watch')).toBe('desktop');
    expect(parseWidth(null)).toBe('desktop');
  });

  it('remembers the last one, and copes without storage', () => {
    const kept = new Map<string, string>();
    const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
    expect(loadWidth(store)).toBe('desktop');
    saveWidth('phone', store);
    expect(loadWidth(store)).toBe('phone');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadWidth(broken)).toBe('desktop');
    expect(() => saveWidth('tablet', broken)).not.toThrow();
    expect(loadWidth(null)).toBe('desktop');
  });
});

describe('the address line', () => {
  const base = 'http://127.0.0.1:41001';
  const demo = 'http://localhost:4600/demo-apps/acme%2Fshop/';

  it('shows an address without its scheme or trailing slash', () => {
    expect(shortUrl('http://127.0.0.1:41001/')).toBe('127.0.0.1:41001');
    expect(shortUrl(demo)).toBe('localhost:4600/demo-apps/acme%2Fshop');
    expect(shortUrl(null)).toBeNull();
  });

  it('puts a path on the app, under the path it is served from', () => {
    expect(atPath(base, '/')).toBe('http://127.0.0.1:41001/');
    expect(atPath(`${base}/`, '/cart?item=2#top')).toBe('http://127.0.0.1:41001/cart?item=2#top');
    expect(atPath(demo, '/cart')).toBe('http://localhost:4600/demo-apps/acme%2Fshop/cart');
    expect(atPath(demo, '')).toBe('http://localhost:4600/demo-apps/acme%2Fshop/');
  });

  it('takes a path, a bare word, a query or a fragment as a path from the root', () => {
    expect(pathFrom('', base)).toBe('/');
    expect(pathFrom(' /cart ', base)).toBe('/cart');
    expect(pathFrom('cart/2', base)).toBe('/cart/2');
    expect(pathFrom('?q=shoes', base)).toBe('/?q=shoes');
    expect(pathFrom('#faq', base)).toBe('/#faq');
    expect(pathFrom('/a b', base)).toBe('/a%20b');
  });

  it("takes a whole address on the app, with or without its scheme, and refuses one that isn't", () => {
    expect(pathFrom('http://127.0.0.1:41001/cart?x=1', base)).toBe('/cart?x=1');
    expect(pathFrom('127.0.0.1:41001/cart', base)).toBe('/cart');
    expect(pathFrom('127.0.0.1:41001', base)).toBe('/');
    expect(pathFrom('https://example.com/cart', base)).toBeNull();
    expect(pathFrom('http://127.0.0.1:41002/cart', base)).toBeNull();
    expect(pathFrom('http://localhost:4600/demo-apps/acme%2Fshop/cart', demo)).toBe('/cart');
    expect(pathFrom('http://localhost:4600/demo-apps/acme%2Fshop', demo)).toBe('/');
    expect(pathFrom('http://localhost:4600/demo-apps/other/cart', demo)).toBeNull();
  });

  it('keeps a protocol-relative path on the app', () => {
    expect(atPath(base, '//example.com/x')).toMatch(/^http:\/\/127\.0\.0\.1:41001\//);
    expect(pathFrom('//example.com/x', base)).toBe('/x');
  });
});

describe('the command and port boxes', () => {
  it('reads an empty port as automatic, and refuses what is not a port', () => {
    expect(parsePort('')).toEqual({ port: null, problem: '' });
    expect(parsePort(' 5173 ')).toEqual({ port: 5173, problem: '' });
    expect(parsePort('51.73').problem).not.toBe('');
    expect(parsePort('abc').problem).not.toBe('');
    expect(parsePort('0').problem).not.toBe('');
    expect(parsePort('70000').problem).not.toBe('');
  });

  it('sends only what changed, an emptied box as automatic', () => {
    const saved = { command: 'npm run dev', port: null };
    expect(configPatch(saved, 'npm run dev', null)).toBeNull();
    expect(configPatch(saved, '  npm run dev  ', null)).toBeNull();
    expect(configPatch(saved, '', null)).toEqual({ command: null });
    expect(configPatch(saved, 'npm start', 5173)).toEqual({ command: 'npm start', port: 5173 });
    expect(configPatch({ command: null, port: 5173 }, '', null)).toEqual({ port: null });
  });
});
