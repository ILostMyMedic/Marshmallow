// `npm run dev -- --demo`: the server from source (tsx watch, restarting when server/ or shared/ code changes) plus
// Vite. Arguments go to the server. Ctrl+C, or either one stopping, stops both.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const bin = (...parts) => path.join(root, 'node_modules', ...parts);
const children = [];
let stopping = false;

function start(name, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('exit', (code) => stopAll(code ? `${name} exited with code ${code}` : `${name} stopped`, code ?? 0));
  children.push(child);
}

// tsx and Vite each run children of their own, so the whole tree goes.
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
}

function stopAll(why, code) {
  if (stopping) return;
  stopping = true;
  console.log(`\n  ${why}: stopping the dev server…`);
  for (const child of children) killTree(child);
  process.exit(code);
}

process.once('SIGINT', () => stopAll('Ctrl+C', 0));
process.once('SIGTERM', () => stopAll('SIGTERM', 0));

start('server', [bin('tsx', 'dist', 'cli.mjs'), 'watch', '--clear-screen=false', path.join('server', 'index.ts'), ...process.argv.slice(2)]);
start('client', [bin('vite', 'bin', 'vite.js')]);
