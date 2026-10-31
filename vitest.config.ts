// Adapted from cubefarm vitest.config.ts (MIT).
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts, whose root is client/, so tests in server/, shared/ and scripts/ are found too.
export default defineConfig({
  test: {
    root: '.',
    include: ['{client,server,shared,scripts}/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Anything a test imports must never see a real home (~/.marshmallow) or the dev server's port.
    env: { MARSHMALLOW_HOME: path.join(os.tmpdir(), `marshmallow-vitest-${process.pid}`), MARSHMALLOW_PORT: '0' },
  },
});
