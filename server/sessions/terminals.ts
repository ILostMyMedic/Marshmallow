// Every worker's terminal, made when first needed: the real CLI draws in it, the demo prints its fake sessions' lines
// into it, and browsers watch it over /ws/term. Each is saved to <home>/terminals/<worker>.ansi now and then, so a
// restarted server still shows what the worker did.
// Adapted from cubefarm server/swarm.ts (MIT): terminalFor, attachTerminal and the terminals' saving.
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { WorkerTerminal } from './terminal.ts';

const SAVE_EVERY_MS = 10_000;

export class Terminals {
  private terms = new Map<string, WorkerTerminal>();
  private timer: NodeJS.Timeout;

  constructor(private readonly dir: string) {
    this.timer = setInterval(() => void this.saveAll(), SAVE_EVERY_MS);
    this.timer.unref();
  }

  /** The worker's terminal, loaded from disk the first time. */
  for(workerId: string): WorkerTerminal {
    let term = this.terms.get(workerId);
    if (!term) {
      term = new WorkerTerminal();
      this.terms.set(workerId, term);
      void term.load(this.file(workerId));
    }
    return term;
  }

  /** The worker's terminal if they have one already. */
  existing(workerId: string): WorkerTerminal | null {
    return this.terms.get(workerId) ?? null;
  }

  /** A browser watching a worker's terminal (/ws/term?worker=<id>). */
  attach(workerId: string, ws: WebSocket) {
    this.for(workerId).attach(ws);
  }

  /** The worker left: their terminal goes, with its file. */
  remove(workerId: string) {
    this.terms.get(workerId)?.dispose();
    this.terms.delete(workerId);
    fs.rm(this.file(workerId), { force: true }, () => undefined);
  }

  /** Writes the terminals that changed since they were last saved. */
  async saveAll(): Promise<void> {
    await Promise.all([...this.terms].filter(([, t]) => t.dirty).map(([id, t]) => t.save(this.file(id)).catch(() => undefined)));
  }

  private file(workerId: string) {
    return path.join(this.dir, `${workerId.replace(/[^\w-]/g, '')}.ansi`);
  }
}
