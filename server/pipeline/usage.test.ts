import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../store.ts';
import { LIMIT_PAUSE_MS, Usage } from './usage.ts';

const HOUR = 60 * 60_000;
let dir: string;
let store: Store;
let now: number;
let usage: Usage;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-usage-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  now = new Date(2026, 9, 31, 12, 0).getTime();
  usage = new Usage(store, () => now);
});
afterEach(async () => {
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const messages = () => store.snapshot().messages.map((m) => m.text);

describe('Usage', () => {
  it('pauses everything at the limit until it resets, and says so once', () => {
    usage.limited(now + HOUR);
    usage.limited(now + 30 * 60_000); // an earlier reset never shortens the pause
    expect(usage.paused()).toBe(true);
    expect(usage.mayStart('qa', 0)).toBe(false);
    expect(store.snapshot().usage).toMatchObject({ state: 'paused', until: now + HOUR + 30_000 });
    expect(messages()).toHaveLength(1);
    now += HOUR + 30_000;
    expect(usage.paused()).toBe(false);
  });

  it('pauses a while when Claude says nothing about the reset', () => {
    usage.limited(null);
    expect(store.snapshot().usage.until).toBe(now + LIMIT_PAUSE_MS + 30_000);
  });

  it('paces new issues after a warning, while QA and fixes carry on, then returns to full speed', () => {
    store.updateSettings({ pacingSessions: 2 });
    usage.warned({ resetsAt: now + HOUR, rateLimitType: 'five_hour', utilization: 0.9 });
    expect(usage.mayStart('issue', 1)).toBe(true);
    expect(usage.mayStart('issue', 2)).toBe(false);
    expect(usage.mayStart('fix', 9)).toBe(true);
    expect(store.snapshot().usage).toMatchObject({ state: 'pacing', warning: { limit: '5-hour limit', pct: 90 } });
    expect(messages()[0]).toMatch(/at most 2 sessions/);
    now += HOUR;
    usage.tick();
    expect(usage.mayStart('issue', 5)).toBe(true);
    expect(store.snapshot().usage.state).toBe('normal');
    expect(messages().at(-1)).toMatch(/Back to full speed/);
  });
});
