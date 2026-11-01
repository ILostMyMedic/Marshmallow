// The demo's floor previews: the real steps with short pretend delays (the worktree refreshed, dependencies installed
// the first time, the app starting), then a small app per floor served by the office itself on the floor's port
// (127.0.0.1 only): a page named after the repository with its latest merged PRs and the commit, so the app viewer
// frames something real. No git, no npm; stopping it closes the server, which frees the port.
// Adapted from cubefarm server/demo.ts (MIT): its demo preview. Cut: PR builds, and the "unconfigured" bare repos.
import crypto from 'node:crypto';
import http from 'node:http';
import type { PullInfo } from '../../shared/types.ts';
import { appScript, defaultCommand, LOOPBACK, scriptCommand, type PreviewBackend } from '../previewRunner.ts';
import type { FakeGitHub } from './demoGithub.ts';

/** What the demo's repositories would have in their package.json: a Vite app, a plain Node API, a Next app. */
const PACKAGES: Record<string, { scripts: Record<string, string> }> = {
  'demo-co/pixel-todo': { scripts: { dev: 'vite', build: 'vite build' } },
  'demo-co/weather-api': { scripts: { start: 'node server.js' } },
  'demo-co/recipe-box': { scripts: { dev: 'next dev', build: 'next build', start: 'next start' } },
};
const DEFAULT_PACKAGE = { scripts: { dev: 'vite' } };

/** Programs the demo pretends to have, so a manager's command naming another fails the way it would for real. */
const PROGRAMS = ['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'deno', 'vite', 'next', 'serve', 'http-server', 'python', 'python3', 'py', 'php', 'ruby', 'go', 'cargo', 'dotnet'];

/** The pretend commit on the default branch: a new one with every merge. */
export const demoCommit = (fullName: string, latest: PullInfo | undefined) => crypto.createHash('sha1').update(`${fullName}#${latest?.number ?? 0}`).digest('hex');

/** The demo's previews; `stepMs` paces the pretend steps (the tests make them instant). */
export function demoPreviews(github: FakeGitHub, stepMs: number): PreviewBackend & { reset(): void } {
  const installed = new Set<string>(); // floors whose preview worktree has its node_modules
  return {
    clearOrphans: async () => undefined, // its apps live inside the office, and stopped with it
    reset: () => installed.clear(),
    start(job, cb) {
      let stopped = false;
      let server: http.Server | null = null;
      const timers = new Set<NodeJS.Timeout>();
      const later = (ms: number) =>
        new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            timers.delete(t);
            resolve();
          }, ms);
          timers.add(t);
        });
      const fail = (message: string) => {
        stopped = true;
        cb.failed(message);
      };
      const close = () =>
        new Promise<void>((resolve) => {
          const s = server;
          server = null;
          if (!s) return resolve();
          s.close(() => resolve());
          s.closeAllConnections();
        });

      const run = async () => {
        cb.status('preparing');
        cb.log([`Fetching ${job.defaultBranch} into the preview worktree… (demo)`]);
        await later(stepMs);
        if (stopped) return;
        const [meta, pulls] = await Promise.all([github.repoMeta(job.fullName), github.listPulls(job.fullName)]);
        const shipped = pulls.filter((p) => p.state === 'MERGED').sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''));
        const sha = demoCommit(job.fullName, shipped[0]);
        cb.sha(sha);
        cb.log([`HEAD is now at ${sha.slice(0, 7)} ${shipped[0] ? `${shipped[0].title} (#${shipped[0].number})` : 'Initial commit'}`]);
        const pkg = PACKAGES[job.fullName] ?? DEFAULT_PACKAGE;
        const found = job.command ? null : appScript(pkg);
        const command = job.command ?? defaultCommand(pkg, job.port) ?? 'npm run dev';
        if (found) cb.command(scriptCommand(found.name));
        if (installed.has(job.fullName)) cb.log(['Dependencies unchanged since the last install; skipping it.']);
        else {
          cb.status('installing');
          cb.log(['$ npm ci --no-audit --no-fund']);
          await later(stepMs * 2);
          if (stopped) return;
          cb.log(['added 214 packages in 2s (demo)']);
          installed.add(job.fullName);
        }
        cb.status('starting');
        cb.log([`$ ${command}`]);
        await later(stepMs);
        if (stopped) return;
        const program = command.trim().split(/\s+/)[0].toLowerCase();
        if (!PROGRAMS.includes(program)) {
          cb.log([`'${program}' is not recognized as an internal or external command,`, 'operable program or batch file.']);
          return fail(`The app exited (code 1) before it answered on ${LOOPBACK}:${job.port}.`);
        }
        const page = appPage({ fullName: job.fullName, description: meta.description, branch: job.defaultBranch, sha, shipped: shipped.slice(0, 5), port: job.port });
        const s = http.createServer((req, res) => {
          const at = new URL(req.url ?? '/', 'http://localhost').pathname;
          if (at.includes('.')) return void res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(req.method === 'HEAD' ? undefined : page);
        });
        server = s;
        s.once('error', (err) => {
          if (stopped) return;
          server = null;
          fail(`The app couldn't listen on ${LOOPBACK}:${job.port}: ${err.message}`);
        });
        s.listen(job.port, LOOPBACK, () => {
          if (stopped) return void close();
          cb.log(banner(command, job.port));
          cb.status('running');
        });
      };
      void run().catch((err) => !stopped && fail((err as Error).message));

      return {
        stop: async () => {
          stopped = true;
          for (const t of timers) clearTimeout(t);
          timers.clear();
          await close();
        },
      };
    },
  };
}

/** What the pretend dev server prints once it's up, with its address, as Vite, Next or a plain Node server would. */
function banner(command: string, port: number): string[] {
  const url = `http://${LOOPBACK}:${port}`;
  if (/\bnext\b|-H /.test(command)) return ['   ▲ Next.js 15.3.0 (demo)', `   - Local:        ${url}`, ' ✓ Ready in 1.2s'];
  if (/--strictPort|\bvite\b/.test(command)) return ['  VITE v6.3.5  ready in 312 ms (demo)', `  ➜  Local:   ${url}/`];
  return [`Listening on ${url} (demo)`];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const titleCase = (name: string) => name.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The floor's pretend app: named after the repository, with what it shipped lately, its commit, and a few things to click. */
export function appPage(o: { fullName: string; description: string; branch: string; sha: string; shipped: PullInfo[]; port: number }): string {
  const name = titleCase(o.fullName.split('/')[1] ?? o.fullName);
  const hue = [...o.fullName].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const items = o.shipped.map((p) => `<li><label><input type="checkbox"> <span><b>#${p.number}</b> ${esc(p.title)}</span></label></li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}</title><link rel="icon" href="data:,">
<style>
  :root { --hue: ${hue}; --bg: hsl(var(--hue) 60% 96%); --card: #fff; --ink: #24212b; --muted: #6b6775; --accent: hsl(var(--hue) 65% 52%); }
  body.dark { --bg: hsl(var(--hue) 25% 12%); --card: hsl(var(--hue) 20% 18%); --ink: #f1eef6; --muted: #aba6b6; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--ink); transition: background .3s, color .3s; }
  header { display: flex; align-items: center; gap: 14px; padding: 16px 24px; background: var(--accent); color: #fff; }
  header h1 { margin: 0; font-size: 22px; }
  header p { margin: 2px 0 0; opacity: .9; font-size: 14px; }
  .logo { font-size: 34px; }
  #theme { margin-left: auto; font-size: 20px; background: rgba(255,255,255,.2); color: #fff; border: 0; border-radius: 999px; width: 42px; height: 42px; cursor: pointer; }
  main { max-width: 620px; margin: 24px auto; padding: 0 16px; display: grid; gap: 18px; }
  .card { background: var(--card); border-radius: 18px; padding: 22px 26px; box-shadow: 0 8px 28px hsl(var(--hue) 40% 30% / .14); }
  h2 { margin: 0 0 8px; font-size: 18px; color: var(--accent); }
  p { margin: 0 0 14px; color: var(--muted); line-height: 1.5; }
  .wave { font: inherit; font-size: 16px; padding: 9px 22px; border: 0; border-radius: 999px; background: var(--accent); color: #fff; cursor: pointer; }
  .wave:active { transform: scale(.96); }
  #waves { margin-left: 12px; color: var(--muted); }
  ul { list-style: none; margin: 0 0 12px; padding: 0; }
  li { padding: 8px 0; border-bottom: 1px dashed hsl(var(--hue) 30% 70% / .5); }
  li:last-child { border-bottom: 0; }
  li label { display: flex; gap: 10px; align-items: baseline; cursor: pointer; }
  li input:checked + span { text-decoration: line-through; color: var(--muted); }
  footer { text-align: center; color: var(--muted); font-size: 13px; padding: 8px 16px 28px; }
  code { background: hsl(var(--hue) 40% 50% / .15); padding: 2px 6px; border-radius: 6px; }
</style></head>
<body>
<header><span class="logo">🍡</span><div><h1>${esc(name)}</h1><p>${esc(o.description || o.fullName)}</p></div><button id="theme" type="button" title="Light or dark">🌙</button></header>
<main>
  <section class="card">
    <h2>Hello from ${esc(o.fullName)}!</h2>
    <p>This is the floor's app as the team left it on ${esc(o.branch)}, running on ${LOOPBACK}:${o.port}. The demo office made it up, so there's nothing real behind it.</p>
    <button class="wave" id="wave" type="button">👋 Wave at the team</button><span id="waves">Nobody has waved yet.</span>
  </section>
  <section class="card">
    <h2>Shipped lately</h2>
    ${items ? `<ul id="shipped">${items}</ul><p id="checked">Tick what you've tried: 0 of ${o.shipped.length}.</p>` : '<p>Nothing merged yet. When the team merges a pull request, this app restarts with it.</p>'}
  </section>
</main>
<footer>commit <code>${esc(o.sha.slice(0, 7))}</code> on ${esc(o.branch)}</footer>
<script>
  let waves = 0;
  document.getElementById('wave').addEventListener('click', () => {
    waves++;
    document.getElementById('waves').textContent = waves === 1 ? 'The team waves back!' : 'Waved ' + waves + ' times. They are flattered.';
  });
  document.getElementById('theme').addEventListener('click', (e) => {
    const dark = document.body.classList.toggle('dark');
    e.currentTarget.textContent = dark ? '☀️' : '🌙';
  });
  const list = document.getElementById('shipped');
  if (list) list.addEventListener('change', () => {
    const boxes = list.querySelectorAll('input');
    const done = [...boxes].filter((b) => b.checked).length;
    document.getElementById('checked').textContent = done === boxes.length ? 'All tried. Nice work, everyone! 🎉' : "Tick what you've tried: " + done + ' of ' + boxes.length + '.';
  });
</script>
</body></html>`;
}
