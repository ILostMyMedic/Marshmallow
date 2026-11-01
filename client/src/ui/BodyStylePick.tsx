// The setup's choice of body style (Settings.bodyStyle): the character lab's chibi and stylized human side by side, you
// and a colleague in each, turning slowly, with each half a card to pick it. The setup saves the pick at once, so the
// office behind it changes too.
import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { BODY_STYLES, type BodyStyle } from '../../../shared/types';
import { seededAppearance, type Appearance } from '../world/appearance';
import { STYLE_BLURBS, STYLE_NAMES } from '../world/bodyStyle';
import { MeFigure } from '../world/Me';
import { useMe } from '../world/myLook';

/** The colleague beside you: Mia from the front desk (TourGuide.tsx's seed). */
const COLLEAGUE = seededAppearance({ seed: 271828, role: 'worker' });

/** One figure turning slowly round, `phase` ahead of the others so they don't turn in step. */
function Turning({ style, look, x, phase }: { style: BodyStyle; look: Appearance; x: number; phase: number }) {
  const spin = useRef(Math.PI - 0.6 + phase);
  useFrame((_, dt) => {
    spin.current += Math.min(dt, 0.1) * 0.45;
  });
  return (
    <group position={[x, 0, 0]}>
      <MeFigure look={look} preview spin={spin} style={style} />
    </group>
  );
}

export function BodyStylePick({ value, onPick }: { value: BodyStyle; onPick: (s: BodyStyle) => void }) {
  const me = useMe((s) => s.look);
  return (
    <div className="style-pick">
      <Canvas className="style-pick-view" dpr={[1, 2]} camera={{ position: [0, 1.05, 6.2], fov: 26 }} onCreated={({ camera }) => camera.lookAt(0, 0.9, 0)}>
        <hemisphereLight args={['#ffffff', '#c9b8a0', 1.6]} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <Turning style="chibi" look={me} x={-1.85} phase={0} />
        <Turning style="chibi" look={COLLEAGUE} x={-0.95} phase={0.9} />
        <Turning style="human" look={me} x={0.95} phase={0.4} />
        <Turning style="human" look={COLLEAGUE} x={1.85} phase={1.3} />
      </Canvas>
      <div className="style-pick-cards" role="radiogroup" aria-label="Body style">
        {BODY_STYLES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={value === s} className={`style-pick-card${value === s ? ' on' : ''}`} onClick={() => onPick(s)}>
            <strong>
              {value === s ? '● ' : '○ '}
              {STYLE_NAMES[s]}
            </strong>
            <small>{STYLE_BLURBS[s]}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
