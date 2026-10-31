// Adapted from cubefarm client/src/perf.tsx (MIT): the adaptive resolution and its frame-rate sampler; the graphics
// tiers and the hitch recorder are cut.
import { useCallback, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DPR, dprSample, newDpr } from './dprControl';

/** The sharpest the view draws: past this the cost outruns what anyone can see. */
export const MAX_DPR = DPR.max;

const dprState = newDpr(typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, MAX_DPR));

/** The pixel ratio the view draws at now. Game passes it to the Canvas, so a re-render never resets a step. */
export const currentDpr = () => Math.min(dprState.dpr, typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1));

/**
 * Lives inside the Canvas. Steps the pixel ratio down toward 1 after sustained slow frames and back up after sustained
 * headroom, waiting longer after every step up that didn't hold (dprControl.ts).
 */
export function AdaptiveResolution() {
  const setDpr = useThree((s) => s.setDpr);
  const onSample = useCallback(
    (fps: number, ms: number) => {
      const from = dprState.dpr;
      const next = dprSample(dprState, fps, ms, { ...DPR, max: Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1)) });
      if (next !== null && next !== from) setDpr(next);
    },
    [setDpr],
  );
  return <FrameRateSampler onSample={onSample} />;
}

/** Every half second of drawing, `onSample` gets the average fps over it. */
function FrameRateSampler({ onSample }: { onSample: (fps: number, ms: number) => void }) {
  const acc = useRef({ start: 0, frames: 0 });
  useFrame(() => {
    const now = performance.now();
    const a = acc.current;
    if (!a.start || now - a.start > 2000) {
      // the first frame, or back from a hidden tab: a fresh window, so time not drawing never counts as slow frames
      a.start = now;
      a.frames = 0;
      return;
    }
    a.frames++;
    const elapsed = now - a.start;
    if (elapsed < 500) return;
    onSample((a.frames * 1000) / elapsed, elapsed);
    a.start = now;
    a.frames = 0;
  });
  return null;
}
