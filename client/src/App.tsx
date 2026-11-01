import { lazy, Suspense } from 'react';
import { DebugPage } from './debug/DebugPage';

// The game is the main page; the debug page stays at /debug. The game loads on its own, so the debug page never pulls
// three.js in.
const Game = lazy(() => import('./world/Game').then((m) => ({ default: m.Game })));
// The character lab: designs for the people compared on one rig, apart from the game.
const LabPage = lazy(() => import('./lab/LabPage').then((m) => ({ default: m.LabPage })));

export function App() {
  if (location.pathname.startsWith('/debug')) return <DebugPage />;
  if (location.pathname.startsWith('/lab'))
    return (
      <Suspense fallback={<div className="game-loading">Loading the character lab…</div>}>
        <LabPage />
      </Suspense>
    );
  return (
    <Suspense fallback={<div className="game-loading">Loading the office…</div>}>
      <Game />
    </Suspense>
  );
}
