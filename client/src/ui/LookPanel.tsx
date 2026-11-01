// Your look: the same parts the workers are made of, picked one row at a time, with you in a little preview beside
// them that you turn by dragging. Every change is saved straight away (world/myLook.ts), in this browser. Hats are off for hair that would poke
// through them, as they are for the workers.
import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Appearance } from '../world/appearance';
import { hashId, seededAppearance, TALL_HAIR } from '../world/appearance';
import { ACCENT_COLORS, BUILDS, FACIAL_HAIR, GLASSES, HAIR_COLORS, HAIR_STYLES, HEADWEAR, OUTFITS, SHIRT_COLORS, SKIN_TONES } from '../world/looks';
import { useMe } from '../world/myLook';
import { MeFigure } from '../world/Me';
import { useBodyStyle } from '../world/RigBody';
import { useView } from '../world/view';
import { Panel } from './Panel';

const NAMES: Record<string, string> = {
  feminine: 'Feminine',
  masculine: 'Masculine',
  sidePart: 'Side part',
  locs: 'Locs',
  none: 'None',
  tee: 'T-shirt',
  stripe: 'Striped tee',
};
const nameOf = (v: string) => NAMES[v] ?? v[0].toUpperCase() + v.slice(1);

function Choice<T extends string>({ label, options, value, onPick, disabled }: { label: string; options: readonly T[]; value: T; onPick: (v: T) => void; disabled?: (v: T) => string | null }) {
  return (
    <div className="look-row">
      <span className="look-label">{label}</span>
      <div className="look-options">
        {options.map((o) => {
          const why = disabled?.(o) ?? null;
          return (
            <button key={o} className={`look-pill${o === value ? ' on' : ''}`} disabled={!!why} title={why ?? undefined} onClick={() => onPick(o)}>
              {nameOf(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Swatches({ label, colours, value, onPick }: { label: string; colours: readonly string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="look-row">
      <span className="look-label">{label}</span>
      <div className="look-options">
        {colours.map((c) => (
          <button key={c} className={`look-swatch${c.toLowerCase() === value.toLowerCase() ? ' on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => onPick(c)} />
        ))}
      </div>
    </div>
  );
}

/** Where the preview's camera stands and looks, for each body style: the human stands near two metres, the chibi under one and a half. */
const FRAMING = { human: { y: 1.2, z: 4.3, at: 1.0 }, chibi: { y: 0.9, z: 3.4, at: 0.72 } } as const;

/** Radians the preview turns per pixel dragged, and where it starts: three-quarters on (π faces the camera). */
const SPIN_PER_PX = 0.012;
const SPIN_START = Math.PI - 0.5;

/** You, standing still until you drag across the preview to turn yourself round. */
function Preview({ look }: { look: Appearance }) {
  const spin = useRef(SPIN_START);
  const frame = FRAMING[useBodyStyle()];
  const drag = useRef<number | null>(null); // the pointer's last x while dragging
  return (
    <div
      className="look-preview"
      onPointerDown={(e) => {
        drag.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        spin.current += (e.clientX - drag.current) * SPIN_PER_PX;
        drag.current = e.clientX;
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <Canvas key={frame.z} dpr={[1, 2]} camera={{ position: [0, frame.y, frame.z], fov: 30 }} onCreated={({ camera }) => camera.lookAt(0, frame.at, 0)}>
        <hemisphereLight args={['#ffffff', '#c9b8a0', 1.6]} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <MeFigure look={look} preview spin={spin} />
      </Canvas>
      <span className="look-preview-hint">↔ Drag to turn</span>
    </div>
  );
}

export function LookPanel() {
  const look = useMe((s) => s.look);
  const set = useMe((s) => s.setLook);
  const closeOverlay = useView((s) => s.closeOverlay);
  // closing counts as choosing, so the editor doesn't open by itself again
  const close = () => {
    set({});
    closeOverlay();
  };
  const tall = TALL_HAIR.includes(look.hair);
  return (
    <Panel onClose={close} title="🧑 Your look">
      <div className="look">
        <Preview look={look} />
        <div className="look-controls">
          <Choice label="Body" options={['feminine', 'masculine'] as const} value={look.look} onPick={(v) => set({ look: v })} />
          <Choice label="Build" options={BUILDS} value={look.build} onPick={(v) => set({ build: v })} />
          <div className="look-row">
            <span className="look-label">Height</span>
            <input type="range" min={0.9} max={1.1} step={0.01} value={look.height} onChange={(e) => set({ height: Number(e.target.value) })} />
          </div>
          <Swatches label="Skin" colours={SKIN_TONES} value={look.skin} onPick={(c) => set({ skin: c })} />
          <Choice label="Hair" options={HAIR_STYLES} value={look.hair} onPick={(v) => set({ hair: v, headwear: TALL_HAIR.includes(v) ? 'none' : look.headwear })} />
          <Swatches label="Hair colour" colours={HAIR_COLORS} value={look.hairColor} onPick={(c) => set({ hairColor: c })} />
          <Choice label="Facial hair" options={FACIAL_HAIR} value={look.facialHair} onPick={(v) => set({ facialHair: v })} />
          <Choice label="Glasses" options={GLASSES} value={look.glasses} onPick={(v) => set({ glasses: v })} />
          <Choice label="Top" options={OUTFITS} value={look.outfit} onPick={(v) => set({ outfit: v })} />
          <Swatches label="Colour" colours={SHIRT_COLORS} value={look.shirt} onPick={(c) => set({ shirt: c })} />
          <Swatches label="Accent" colours={ACCENT_COLORS} value={ACCENT_COLORS[look.accent]} onPick={(c) => set({ accent: ACCENT_COLORS.indexOf(c as (typeof ACCENT_COLORS)[number]) })} />
          <Choice
            label="Hat"
            options={HEADWEAR}
            value={look.headwear}
            onPick={(v) => set({ headwear: v, headphones: v === 'none' ? look.headphones : false })}
            disabled={(v) => (v !== 'none' && tall ? 'Your hair would poke through it' : null)}
          />
          <Choice label="Headphones" options={['off', 'on'] as const} value={look.headphones ? 'on' : 'off'} onPick={(v) => set({ headphones: v === 'on', headwear: v === 'on' ? 'none' : look.headwear })} />
          <div className="look-actions">
            <button className="look-pill" onClick={() => set(seededAppearance({ seed: hashId(String(Math.random())), role: 'worker' }))}>
              🎲 Surprise me
            </button>
            <button className="look-pill on" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </div>
      <p className="panel-note">Saved in this browser as you go. Press C on the floor to come back here.</p>
    </Panel>
  );
}
