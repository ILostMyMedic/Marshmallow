// What sits on top of the 3D view: in first person the crosshair, what E does with what it's on, and how to look round;
// in the overview, how to get about. Adapted from cubefarm client/src/ui/HUD.tsx (MIT).
import { useView } from '../world/view';

export function HUD() {
  const mode = useView((s) => s.mode);
  const focus = useView((s) => s.focus);
  const locked = useView((s) => s.locked);
  const overlay = useView((s) => s.overlay);
  if (overlay) return null;
  if (mode === 'overview') return <div className="hud-hint">Tab: walk the floor · drag to turn · wheel to zoom · right-drag or WASD to move</div>;
  return (
    <>
      {locked && <div className={`crosshair${focus ? ' on' : ''}`} />}
      {focus && locked && <div className="hud-use">E / Click: {focus.label}</div>}
      {!locked && <div className="hud-hint">Click to look around · WASD to walk, Shift to run · Tab: overview</div>}
    </>
  );
}
