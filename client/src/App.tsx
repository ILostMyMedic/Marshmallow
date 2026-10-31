import { lazy, Suspense } from 'react';
import { DebugPage } from './debug/DebugPage';

// The game is the main page; the debug page stays at /debug. The game loads on its own, so the debug page never pulls
// three.js in.
const Game = lazy(() => import('./world/Game').then((m) => ({ default: m.Game })));

export function App() {
  if (location.pathname.startsWith('/debug')) return <DebugPage />;
  return (
    <Suspense fallback={<div className="game-loading">Loading the office…</div>}>
      <Game />
    </Suspense>
  );
}
