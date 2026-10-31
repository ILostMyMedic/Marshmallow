// The demo's Claude Code sessions: scripted log lines and tool calls, a step every second or so, that end by opening
// a (fake) pull request, giving a QA verdict or pushing a fix. A build takes about 20 seconds.
// Adapted from cubefarm server/demo.ts (MIT).
import crypto from 'node:crypto';
import type { LogEntry } from '../../shared/types.ts';
import type { SessionCallbacks, SessionHandle, SessionOptions } from '../sessions/session.ts';
import type { FakeGitHub } from './demoGithub.ts';

export interface FakeSessionContext {
  github: FakeGitHub;
  /** The repository and branch the session's desk has checked out; null for a desk the demo doesn't know. */
  desk: { fullName: string; branch: string } | null;
  rand: () => number;
  stepMs: () => number;
}

/** A step of a script: log lines (the first tool among them is the one running), or something else that happens. */
type Step = LogEntry[] | (() => void);

const tool = (name: string, text: string, result?: string): LogEntry[] => [{ kind: 'tool', tool: name, text: `⏺ ${text}` }, ...(result ? [{ kind: 'result' as const, text: `  ⎿ ${result}` }] : [])];
const say = (text: string): LogEntry[] => [{ kind: 'text', text: `● ${text}` }];

/** A stand-in for a browser screenshot: the page's title on a coloured card. */
function screenshotSvg(title: string, url: string, hue: number) {
  const safe = title.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="hsl(${hue} 60% 92%)"/><rect width="640" height="36" fill="hsl(${hue} 30% 80%)"/><text x="14" y="24" font-family="sans-serif" font-size="14" fill="#333">${url}</text><text x="40" y="200" font-family="sans-serif" font-size="26" fill="hsl(${hue} 50% 30%)">${safe}</text></svg>`;
}

function issueScript(cb: SessionCallbacks, n: number, title: string, branch: string): Step[] {
  const file = ['src/App.tsx', 'src/components/TodoList.tsx', 'src/api/routes.ts', 'src/styles.css'][n % 4];
  const port = 5200 + (n % 50);
  return [
    say(`I'll start by getting familiar with the codebase for "${title}".`),
    tool('Glob', 'Glob src/**/*.{ts,tsx}', 'Found 23 files'),
    tool('Read', `Read ${file}`, 'Read 184 lines'),
    [{ kind: 'thinking', text: '✻ Thinking…' }],
    tool('Grep', 'Grep "useTodos"', 'Found 6 matches in 4 files'),
    say("The state lives in a single hook. I'll extend it and keep its API as it is."),
    tool('Edit', `Edit ${file}`, 'Updated'),
    tool('Write', 'Write src/__tests__/feature.test.ts', 'Saved'),
    tool('Bash', '$ npm test -- --run', 'Test Files  7 passed (7)'),
    tool('Bash', '$ npm run typecheck', '(no output)'),
    tool('Bash', `$ npm run dev -- --port ${port} &`, 'VITE ready in 412 ms'),
    () => cb.browserUrl(`http://localhost:${port}/`),
    tool('mcp__playwright__browser_navigate', `🌐 navigate http://localhost:${port}/`, `Page URL: http://localhost:${port}/`),
    () => cb.screenshot(Buffer.from(screenshotSvg(title, `localhost:${port}`, (n * 67) % 360)), 'image/svg+xml'),
    tool('mcp__playwright__browser_take_screenshot', '🌐 take_screenshot', 'Took a screenshot of the current page'),
    tool('Bash', `$ git commit -am "feat: ${title.toLowerCase()}"`, `[${branch} 3f2a91c] feat: ${title.toLowerCase()}`),
    tool('Bash', '$ git push -u origin HEAD', 'branch set up to track origin'),
    tool('Bash', `$ gh pr create --title "${title}" --body "Closes #${n}"`),
  ];
}

function qaScript(cb: SessionCallbacks, pr: number, title: string, round: number): Step[] {
  const port = 5600 + (pr % 50);
  const hue = (pr * 41) % 360;
  return [
    say(`Testing PR #${pr} "${title}" (round ${round}). First, the acceptance criteria from the issue.`),
    tool('Bash', '$ git diff origin/main...HEAD --stat', ' 3 files changed, 82 insertions(+), 9 deletions(-)'),
    tool('Bash', '$ npm ci && npm test -- --run', 'Tests  41 passed (41)'),
    tool('Bash', `$ npm run preview -- --port ${port} &`, `Local: http://localhost:${port}/`),
    () => cb.browserUrl(`http://localhost:${port}/`),
    tool('mcp__playwright__browser_navigate', `🌐 navigate http://localhost:${port}/`, `Page URL: http://localhost:${port}/`),
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · ${title}`, `localhost:${port}`, hue)), 'image/svg+xml'),
    tool('mcp__playwright__browser_take_screenshot', '🌐 take_screenshot', 'Took a screenshot of the current page'),
    tool('mcp__playwright__browser_resize', '🌐 resize 375x740', 'Resized'),
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · mobile · ${title}`, `localhost:${port}`, (hue + 40) % 360)), 'image/svg+xml'),
    tool('mcp__playwright__browser_console_messages', '🌐 console_messages', 'No errors'),
  ];
}

function fixScript(pr: number, pushes: boolean): Step[] {
  return [
    say(`Reading the QA report for PR #${pr}. The toolbar overflows on phones; I'll let it wrap.`),
    tool('Read', 'Read src/styles.css', 'Read 212 lines'),
    tool('Edit', 'Edit src/styles.css', 'Updated'),
    tool('Bash', '$ npm test -- --run', 'Test Files  8 passed (8)'),
    pushes ? tool('Bash', '$ git commit -am "fix: wrap toolbar on narrow screens" && git push origin HEAD', 'pushed') : tool('Bash', '$ git status --short', ' M src/styles.css'),
  ];
}

export function fakeSession(opts: SessionOptions, cb: SessionCallbacks, ctx: FakeSessionContext): SessionHandle {
  const kind = opts.task ?? 'issue';
  const subject = opts.subject ?? { issueNumber: null, prNumber: null, title: 'follow-up' };
  const round = subject.round ?? 1;
  // Now and then a fix ends without pushing, so the office's nudge can be seen.
  const pushes = kind !== 'fix' || ctx.rand() > 0.15;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let i = 0;

  cb.sessionId(opts.resumeSessionId ?? `demo-${crypto.randomUUID()}`);
  const header: Step = [
    { kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort` },
    { kind: 'system', text: `  cwd ${opts.cwd}` },
  ];
  const body =
    kind === 'qa'
      ? qaScript(cb, subject.prNumber ?? 0, subject.title, round)
      : kind === 'fix'
        ? fixScript(subject.prNumber ?? 0, pushes)
        : issueScript(cb, subject.issueNumber ?? 0, subject.title, ctx.desk?.branch ?? 'HEAD');
  const script = [header, ...body];

  const finish = () => {
    const costUsd = 0.3 + ctx.rand();
    const turns = 15 + Math.floor(ctx.rand() * 20);
    cb.tool(null);
    if (kind === 'qa') {
      // Most first rounds pass, and later ones nearly always; the failures show the fix loop.
      const pass = ctx.rand() > (round > 1 ? 0.1 : 0.35);
      cb.log(say(pass ? 'Everything checks out. Writing up the report.' : 'The toolbar overflows on a 375px screen. Failing this round.'));
      cb.finished({
        ok: true,
        text: '',
        costUsd,
        turns,
        errors: [],
        structured: {
          verdict: pass ? 'pass' : 'fail',
          summary: pass
            ? 'The change does what the issue asks: it works on desktop and mobile, all 41 tests pass, and the build is clean.'
            : 'It works on desktop, but on a 375px-wide screen the toolbar overflows and the new button is cut off.',
          checks: [
            { name: 'Unit tests', result: 'pass', details: '41 passed, 0 failed' },
            { name: 'Feature works on desktop', result: 'pass', details: 'Clicked through the new flow at 1280x800' },
            { name: 'Mobile layout (375px)', result: pass ? 'pass' : 'fail', details: pass ? 'Layout wraps correctly' : 'Toolbar overflows; button unreachable' },
            { name: 'Console errors', result: 'pass', details: 'None' },
          ],
          commands: [{ command: 'npm test -- --run', result: '41 passed' }],
          screenshots: ['Desktop view after the change', 'Mobile view at 375px'],
          fixInstructions: pass ? undefined : 'Make the toolbar wrap (flex-wrap: wrap) below 480px so every button stays visible.',
        },
      });
      return;
    }
    if (kind === 'fix') {
      if (pushes && ctx.desk && subject.prNumber) ctx.github.push(ctx.desk.fullName, subject.prNumber);
      const text = pushes ? `Fixed PR #${subject.prNumber} and pushed. Ready for another QA round.` : 'The toolbar wraps on narrow screens now. Ready for another QA round.';
      cb.log(say(text));
      cb.finished({ ok: true, text, costUsd, turns, errors: [] });
      return;
    }
    let url = '';
    if (ctx.desk && subject.issueNumber) {
      url = ctx.github.openPull(ctx.desk.fullName, { title: subject.title, branch: ctx.desk.branch, closes: subject.issueNumber }).url;
      cb.log([{ kind: 'result', text: `  ⎿ ${url}` }]);
    }
    const text = `Opened ${url || 'the pull request'}. It closes #${subject.issueNumber} and includes tests.`;
    cb.log(say(text));
    cb.finished({ ok: true, text, costUsd, turns, errors: [] });
  };

  const step = () => {
    if (stopped) return;
    if (i >= script.length) return finish();
    const s = script[i++];
    if (typeof s === 'function') s();
    else {
      cb.tool(s.find((e) => e.kind === 'tool')?.tool ?? null);
      cb.log(s);
    }
    timers.push(setTimeout(step, ctx.stepMs()));
  };
  timers.push(setTimeout(step, ctx.stepMs()));

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (!stopped) cb.log(say(`Got it: "${text.slice(0, 60)}". Adjusting my approach.`));
        }, ctx.stepMs()),
      );
    },
    stop() {
      if (stopped) return;
      stopped = true;
      timers.forEach(clearTimeout);
      cb.tool(null);
      cb.finished({ ok: false, text: '', costUsd: 0.05, turns: i, errors: ['Stopped by the manager'] });
    },
  };
}
