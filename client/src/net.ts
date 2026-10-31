// The /ws connection: every server event goes to the store, and a dropped connection tries again, waiting longer each
// time (up to 8 s). Reconnecting brings a fresh snapshot, so nothing missed while away is lost.
// Adapted from cubefarm client/src/net.ts (MIT).
import type { ServerEvent } from '../../shared/types';
import { useStore } from './store';

let retry = 0;

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    useStore.getState().setConnected(true);
  };
  ws.onmessage = (e) => {
    try {
      useStore.getState().apply(JSON.parse(String(e.data)) as ServerEvent);
    } catch (err) {
      console.error('bad server event', err);
    }
  };
  ws.onclose = () => {
    useStore.getState().setConnected(false);
    setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
