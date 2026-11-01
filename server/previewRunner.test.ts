import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appScript, defaultCommand, fillPort, lastCommand, portFlags, previewEnv, RunningApps, scriptCommand, urlFromOutput } from './previewRunner.ts';

const P = 6601;
const VITE = `--port ${P} --strictPort --host 127.0.0.1`;

describe('how a floor app is run with no command set', () => {
  it('takes dev, else start, else preview, and tells Vite and Next the port and 127.0.0.1', () => {
    expect(defaultCommand({ scripts: { start: 'node server.js', dev: 'vite' } }, P)).toBe(`npm run dev -- ${VITE}`);
    expect(defaultCommand({ scripts: { start: 'node server.js', build: 'tsc' } }, P)).toBe('npm run start');
    expect(defaultCommand({ scripts: { preview: 'vite preview' } }, P)).toBe(`npm run preview -- ${VITE}`);
    expect(defaultCommand({ scripts: { dev: 'next dev --turbopack' } }, P)).toBe(`npm run dev -- -p ${P} -H 127.0.0.1`);
    expect(defaultCommand({ scripts: { dev: '   ', start: 'node .' } }, P)).toBe('npm run start');
  });

  it('names the script as a person would say it, without the flags', () => {
    const found = appScript({ scripts: { dev: 'vite', start: 'node server.js' } });
    expect(found).toEqual({ name: 'dev', script: 'vite' });
    expect(scriptCommand(found!.name)).toBe('npm run dev');
  });

  it('finds nothing to run without one of those scripts', () => {
    expect(defaultCommand({ scripts: { build: 'tsc', test: 'vitest' } }, P)).toBeNull();
    expect(defaultCommand({ scripts: 'vite' }, P)).toBeNull();
    expect(defaultCommand({ name: 'x' }, P)).toBeNull();
    expect(defaultCommand(null, P)).toBeNull();
  });

  it('passes the port flags of the common dev servers to the command that runs last', () => {
    expect(portFlags('vite build && vite preview', P)).toBe(VITE);
    expect(portFlags('cross-env NODE_ENV=development npx vite', P)).toBe(VITE);
    expect(portFlags('astro dev', P)).toBe(`--port ${P} --host 127.0.0.1`);
    expect(portFlags('ng serve', P)).toBe(`--port ${P} --host 127.0.0.1`);
    expect(portFlags('parcel index.html', P)).toBe(`--port ${P} --host 127.0.0.1`);
    expect(portFlags('http-server dist', P)).toBe(`-p ${P} -a 127.0.0.1`);
    expect(portFlags('serve -s dist', P)).toBe(`-l tcp://127.0.0.1:${P}`);
  });

  it('leaves the port to PORT when the script reads it, names its own, or runs several programs', () => {
    for (const script of ['node server.js', 'react-scripts start', 'vite build && node server.js', 'vite build', 'parcel build index.html', 'vite --port 3000', 'next dev -p 3000', 'concurrently "vite" "node api.js"', 'vite | tee out.log']) {
      expect(portFlags(script, P), script).toBe('');
    }
  });

  it("reads the last command without what's in front of it", () => {
    expect(lastCommand('NODE_ENV=dev PORT=1 node server.js')).toBe('node server.js');
    expect(lastCommand('npm run build; cross-env FOO=1 yarn vite')).toBe('vite');
  });

  it("fills {port} in the manager's command", () => {
    expect(fillPort('python -m http.server {port} --bind 127.0.0.1', P)).toBe(`python -m http.server ${P} --bind 127.0.0.1`);
  });
});

describe('where the app says it answers', () => {
  it("reads Vite's and Next's banners, colours and all", () => {
    expect(urlFromOutput(['  VITE v6.3.5  ready in 312 ms', `  ➜  Local:   http://127.0.0.1:${P}/`, '  ➜  Network: use --host to expose'])).toEqual({ url: `http://127.0.0.1:${P}/`, port: P, path: '/' });
    expect(urlFromOutput(['  ➜  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m'])).toMatchObject({ port: 5173, path: '/' });
    expect(urlFromOutput(['   ▲ Next.js 15.3.0', '   - Local:        http://localhost:3000'])).toEqual({ url: 'http://localhost:3000', port: 3000, path: '/' });
  });

  it('keeps a base path, drops trailing punctuation, and prefers the port it was given', () => {
    expect(urlFromOutput([`Local: http://127.0.0.1:${P}/app/`])?.path).toBe('/app/');
    expect(urlFromOutput(['Server running at http://localhost:8080.'])).toEqual({ url: 'http://localhost:8080', port: 8080, path: '/' });
    const lines = ['API on http://localhost:3000', `App on http://127.0.0.1:${P}/`];
    expect(urlFromOutput(lines, P)?.port).toBe(P);
    expect(urlFromOutput(lines)?.port).toBe(3000);
  });

  it('ignores addresses that are not this computer', () => {
    expect(urlFromOutput(['Network: http://192.168.1.5:6601/', 'Docs: https://vite.dev/guide'])).toBeNull();
  });
});

describe('the apps the office runs', () => {
  it('records their ports, so the next office clears what a hard stop left, then forgets them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-running-'));
    try {
      const file = path.join(dir, 'previews-running.json');
      expect(new RunningApps(file).left).toEqual({});
      const first = new RunningApps(file);
      first.set('acme/app', 6601);
      first.set('acme/api', 6602);
      first.set('acme/api', null);
      await first.save();
      const next = new RunningApps(file);
      expect(next.left).toEqual({ 'acme/app': 6601 });
      await next.save();
      expect(new RunningApps(file).left).toEqual({});
      fs.writeFileSync(file, '{"acme/app": "6601", "acme/web": 6603}');
      expect(new RunningApps(file).left).toEqual({ 'acme/web': 6603 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

describe("a preview's environment", () => {
  it("drops Claude's credentials and the office's settings, and sets the port and 127.0.0.1", () => {
    const env = previewEnv(P, { ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: 'c', CLAUDECODE: '1', MARSHMALLOW_HOME: 'h', MARSHMALLOW_PORT: '4600', PATH: '/bin', PORT: '1' });
    expect(env).toEqual({ PATH: '/bin', PORT: String(P), HOST: '127.0.0.1', BROWSER: 'none' });
  });
});
