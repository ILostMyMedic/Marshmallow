// Adapted from cubefarm vite.config.ts (MIT).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.MARSHMALLOW_PORT ?? 4600);
// strictPort: a second dev server must fail loudly, not quietly take the next port while proxying to this MARSHMALLOW_PORT.
const clientPort = Number(process.env.MARSHMALLOW_CLIENT_PORT || 5600);

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: clientPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
