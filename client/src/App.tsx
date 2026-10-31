// Phase 0's page: shows that the snapshot arrives. Phase 1 replaces it with net.ts, the store and the debug page.
import { useEffect, useState } from 'react';
import type { ServerEvent, Snapshot } from '../../shared/types';

export function App() {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (msg) => {
      const ev = JSON.parse(String(msg.data)) as ServerEvent;
      if (ev.type === 'snapshot') setSnapshot(ev.data);
    };
    return () => ws.close();
  }, []);

  return (
    <main>
      <h1>Marshmallow</h1>
      <p>
        {connected ? 'Connected' : 'Not connected'}
        {snapshot?.demo && ' · DEMO MODE'}
      </p>
      <pre>{snapshot ? JSON.stringify(snapshot, null, 2) : 'Waiting for the snapshot…'}</pre>
    </main>
  );
}
