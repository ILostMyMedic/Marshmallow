// The demo's Claude Code sessions: scripted log lines and tool calls, a step every second or so, that end by opening
// a (fake) pull request, giving a QA verdict or pushing a fix. A build takes about 20 seconds.
// Adapted from cubefarm server/demo.ts (MIT).
import crypto from 'node:crypto';
import type { LogEntry } from '../../shared/types.ts';
import { ANSWER_LEAD } from '../pipeline/questions.ts';
import { describeOfficeTool } from '../sessions/format.ts';
import type { SessionCallbacks, SessionHandle, SessionOptions } from '../sessions/session.ts';
import type { FakeGitHub } from './demoGithub.ts';

/** The seeded issue (demoGithub.ts) that's too vague to build without asking. */
export const VAGUE_ISSUE = 'Make it pop';

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
  if (opts.role === 'ceo' && opts.office) return ceoSession(opts, cb, ctx);
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
  // The seeded vague issue: without the manager's answer in the prompt, its worker asks instead of guessing.
  const vague = kind === 'issue' && subject.title === VAGUE_ISSUE && !opts.prompt.includes(ANSWER_LEAD);
  const body =
    kind === 'qa'
      ? qaScript(cb, subject.prNumber ?? 0, subject.title, round)
      : kind === 'fix'
        ? fixScript(subject.prNumber ?? 0, pushes)
        : vague
          ? [say(`Reading "${subject.title}".`), tool('Read', 'Read src/App.tsx', 'Read 184 lines'), [{ kind: 'thinking', text: '✻ Thinking…' }] as LogEntry[]]
          : issueScript(cb, subject.issueNumber ?? 0, subject.title, ctx.desk?.branch ?? 'HEAD');
  const script = [header, ...body];

  const finish = () => {
    const costUsd = 0.3 + ctx.rand();
    const turns = 15 + Math.floor(ctx.rand() * 20);
    cb.tool(null);
    if (vague) {
      const text = `"More fun" could mean several things here, and each is a different change.\nQUESTION FOR THE MANAGER: What should "pop" mean for this app: playful animations, a brighter colour scheme, or sound effects?`;
      cb.log(say(text));
      cb.finished({ ok: true, text, costUsd, turns, errors: [] });
      return;
    }
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

interface DemoStatus {
  floors: { floor: number; repo: string; brief: string | null; issues: unknown[]; team: unknown[] }[];
}

/**
 * A scripted CEO that calls the real office tools, so profiles, team changes and filed issues behave as in the real
 * thing. Onboarding writes a profile and sizes the team; a plan files three issues; a chat closes an issue ("close #4
 * on floor 1"), sizes a floor ("floor 1 to 3") or sums the company up.
 * Adapted from cubefarm server/demo.ts (MIT): ceoSession.
 */
function ceoSession(opts: SessionOptions, cb: SessionCallbacks, ctx: FakeSessionContext): SessionHandle {
  const office = opts.office!;
  const job = opts.ceoJob ?? { kind: 'chat' as const, floorId: null, text: '' };
  let stopped = false;
  let turns = 0;
  let timer: NodeJS.Timeout | undefined;
  const wait = () => new Promise<void>((resolve) => (timer = setTimeout(resolve, ctx.stepMs())));
  const use = async (name: string, args: Record<string, unknown>) => {
    await wait();
    if (stopped) throw new Error('stopped');
    turns++;
    cb.tool(`mcp__office__${name}`);
    cb.log(tool(`mcp__office__${name}`, describeOfficeTool(name, args)));
    const out = await office.call(name, args);
    cb.log([{ kind: out.startsWith('Refused:') ? 'error' : 'result', text: `  ⎿ ${out.split('\n')[0].slice(0, 160)}` }]);
    return out;
  };
  const filed = (out: string) => Number(out.match(/Filed #(\d+)/)?.[1] ?? 0);

  const script = async (): Promise<string> => {
    cb.log([{ kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · CEO` }]);
    const status = JSON.parse(await use('company_status', {})) as DemoStatus;
    const floor = status.floors.find((f) => f.repo === job.floorId) ?? status.floors[0];
    if (job.kind === 'onboard' && floor) {
      await wait();
      cb.log(tool('Read', `Read ${floor.repo}/README.md`, 'Read 42 lines'));
      const name = floor.repo.split('/')[1] ?? floor.repo;
      await use('set_floor_profile', { floor: floor.floor, summary: `${name} · demo project`, qa_brief: '- The app loads without console errors\n- The change works on desktop and at 375px\n- Tests and the build pass' });
      const size = Math.min(3, Math.max(1, Math.ceil(floor.issues.length / 3)));
      await use('scale_team', { floor: floor.floor, size, reason: `${floor.issues.length} open issues: ${size} workers can take them side by side.` });
      return `Floor ${floor.floor} (${floor.repo}) is a small demo project with ${floor.issues.length} open issues. I wrote its QA brief and set its team to ${size}.`;
    }
    if (job.kind === 'plan' && floor) {
      const brief = floor.brief ?? 'the brief';
      const base = filed(await use('file_issue', { floor: floor.floor, title: `Groundwork for: ${brief}`.slice(0, 120), body: `The shared pieces the rest of "${brief}" builds on.\n\nAcceptance: tests cover them.` }));
      const a = filed(await use('file_issue', { floor: floor.floor, title: `${brief}: the main flow`.slice(0, 120), body: `Depends on #${base}\n\nThe main flow of "${brief}", end to end.` }));
      const b = filed(await use('file_issue', { floor: floor.floor, title: `${brief}: settings and polish`.slice(0, 120), body: `Depends on #${base}\n\nSettings, empty states and phone layout for "${brief}".` }));
      await use('scale_team', { floor: floor.floor, size: Math.max(2, floor.team.length), reason: 'Two of the new issues can be built side by side once the groundwork lands.' });
      return `Planned "${brief}" as #${base}, #${a} and #${b}: #${base} first, then the other two side by side.`;
    }
    const text = job.text.toLowerCase();
    const onFloor = Number(text.match(/floor (\d+)/)?.[1] ?? floor?.floor ?? 1);
    const close = text.match(/close #(\d+)/);
    if (close) {
      const out = await use('close_issue', { floor: onFloor, number: Number(close[1]), reason: 'The manager asked to close it.' });
      return out.startsWith('Refused:') ? `I couldn't close #${close[1]}: ${out.slice(9)}` : `Done: #${close[1]} on floor ${onFloor} is closed.`;
    }
    const size = text.match(/floor (\d+) to (\d+)/);
    if (size) {
      await use('scale_team', { floor: Number(size[1]), size: Number(size[2]), reason: 'The manager asked for it.' });
      return `Floor ${size[1]} now has ${size[2]} workers, and holds that size.`;
    }
    await wait();
    return `Here's where things stand: ${status.floors.map((f) => `floor ${f.floor} (${f.repo}) has ${f.team.length} workers and ${f.issues.length} open issues`).join('; ') || 'no floors yet'}.`;
  };

  cb.sessionId(opts.resumeSessionId ?? `demo-${crypto.randomUUID()}`);
  void script().then(
    (text) => {
      if (stopped) return;
      cb.tool(null);
      cb.log(say(text));
      cb.finished({ ok: true, text, costUsd: 0, turns, errors: [] });
    },
    (err: Error) => {
      if (stopped) return;
      cb.tool(null);
      cb.finished({ ok: false, text: '', costUsd: 0, turns, errors: [err.message] });
    },
  );
  return {
    send: () => undefined,
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      cb.tool(null);
      cb.finished({ ok: false, text: '', costUsd: 0, turns, errors: ['Stopped by the manager'] });
    },
  };
}
