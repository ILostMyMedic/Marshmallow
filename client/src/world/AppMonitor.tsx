// The app monitor: a big screen on the north wall of every office floor showing the floor's app (server/previews.ts):
// "▶ Start the app" while it's stopped, the steps while it comes up, why it failed, and where it runs, with a live look
// at it while you stand near. E on it, or a click on it in the overview, opens the app viewer (ui/AppViewer.tsx).
// Adapted from cubefarm client/src/world/AppMonitor.tsx (MIT): the PR channels, the agents' screenshots and the glow
// pool are cut; the live look is new.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Floor } from '../../../shared/types';
import { monitorCaption, stoppedPreview, type MonitorTone } from '../preview';
import { useStore } from '../store';
import { useCanvasTexture } from './canvasTexture';
import { CUT_PLANES } from './cutaway';
import { drawAppScreen } from './draw';
import { useInteractable } from './interact';
import { APP_SCREEN, HALF_D } from './layout';
import { glow, mix, toon } from './materials';
import { INK, Outlines } from './Outlines';
import { playerAt, rigOwnsCamera } from './rig';
import { useView } from './view';

const S = APP_SCREEN;
/** The screen's canvas, and the size the live look lays the app out at: a small desktop, the picture's shape. */
const PX = { w: 1280, h: 720 };
const OUTER: [number, number, number] = [S.w + S.bezel * 2, S.h + S.bezel * 2, S.depth];
const FACE_Z = S.depth + 0.002;
// On the north wall, so cut away with it in the overview (cutaway.ts).
const BEZEL = toon('#2b2d42', { cut: 'room' });
/** A soft halo round the bezel while the app runs, blended toward the wall so it stays subtle. */
const LIVE_GLOW = glow(mix('#7CFFB2', '#fbf3e4', 0.55), 'room');
const LED: Record<MonitorTone, string> = { off: '#6c7086', busy: '#ffd166', live: '#7CFFB2', bad: '#ff6b6b' };

// ---------- the live look ----------

/** The live look comes on within LOOK_ON metres of the screen and goes off past LOOK_OFF. */
const LOOK_ON = 7;
const LOOK_OFF = 8.5;
/** drei's Html shows 400 / distanceFactor CSS pixels a metre: this lays PX.w across the picture. */
const LOOK_FACTOR = (400 * S.w) / PX.w;

/**
 * Punches the picture out of the canvas (alpha 0, depth kept), so the frame behind the canvas shows through there and
 * whatever stands in front of the screen (a worker, you in third person) still hides it.
 */
const HOLE = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    #include <clipping_planes_pars_vertex>
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
    }`,
  fragmentShader: /* glsl */ `
    #include <clipping_planes_pars_fragment>
    void main() {
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(0.0);
    }`,
  clipping: true,
  clippingPlanes: CUT_PLANES.room,
});

/** Whether you're on foot near the screen with the app viewer shut (it has the app then), checked a few times a second. */
function useNear() {
  const [near, setNear] = useState(false);
  const was = useRef(false);
  const frame = useRef(0);
  useFrame(() => {
    if (++frame.current % 10) return;
    const v = useView.getState();
    const d = Math.hypot(playerAt.x - S.x, playerAt.z + HALF_D);
    const now = v.mode === 'first' && !rigOwnsCamera() && v.overlay?.kind !== 'app' && d < (was.current ? LOOK_OFF : LOOK_ON);
    if (now === was.current) return;
    was.current = now;
    setNear(now);
  });
  return near;
}

/**
 * The running app itself on the screen: a frame laid out at PX behind the canvas (z-index -1 in .game's stacking
 * context, under the canvas; .app-look holds it there before drei's first frame sets it), seen through the hole once
 * it has loaded. Look only: inert, so it never takes a click, a key or focus.
 */
function LiveLook({ url, name }: { url: string; name: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <group position={[0, 0, FACE_Z + 0.001]}>
      <Html transform distanceFactor={LOOK_FACTOR} zIndexRange={[-1, -1]} wrapperClass="app-look" pointerEvents="none">
        <div inert>
          <iframe
            src={url}
            title={`${name}, live`}
            sandbox="allow-scripts allow-same-origin allow-forms"
            tabIndex={-1}
            style={{ display: 'block', width: PX.w, height: PX.h, border: 0, background: '#ffffff' }}
            onLoad={() => setLoaded(true)}
          />
        </div>
      </Html>
      {loaded && (
        <mesh material={HOLE}>
          <planeGeometry args={[S.w, S.h]} />
        </mesh>
      )}
    </group>
  );
}

// ---------- the monitor ----------

export const AppMonitor = memo(function AppMonitor({ floor }: { floor: Floor }) {
  const p = useStore((s) => s.previews[floor.id]) ?? stoppedPreview(floor.id);
  const cap = monitorCaption(p, floor.defaultBranch);
  const name = floor.fullName.split('/')[1] ?? floor.fullName;
  const since = p.startedAt ? new Date(p.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const tex = useCanvasTexture(PX.w, PX.h, (ctx) => drawAppScreen(ctx, PX.w, PX.h, { floor: floor.floor, name, color: floor.color, caption: cap, since }), [floor.floor, name, floor.color, cap.badge, cap.title, cap.detail, cap.footer, cap.step, since]);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, clippingPlanes: CUT_PLANES.room }), []);
  useEffect(() => () => face.dispose(), [face]);
  face.map = tex;
  const ref = useInteractable<THREE.Group>({ id: `app-${floor.id}`, label: cap.aim, action: { kind: 'app', floorId: floor.id } }, 7);
  const near = useNear();
  const live = p.state === 'running' && !!p.url;
  return (
    <group ref={ref} position={[S.x, S.y, -HALF_D]}>
      {live && (
        <mesh position={[0, 0, 0.012]} material={LIVE_GLOW}>
          <planeGeometry args={[OUTER[0] + 0.12, OUTER[1] + 0.12]} />
        </mesh>
      )}
      <mesh position={[0, 0, S.depth / 2]} material={BEZEL} receiveShadow>
        <boxGeometry args={OUTER} />
        <Outlines thickness={0.018} color={INK} cut="room" />
      </mesh>
      <mesh position={[0, 0, FACE_Z]} material={face}>
        <planeGeometry args={[S.w, S.h]} />
      </mesh>
      <mesh position={[S.w / 2 - 0.04, -S.h / 2 - S.bezel / 2, FACE_Z]} material={glow(LED[cap.tone], 'room')}>
        <circleGeometry args={[0.022, 12]} />
      </mesh>
      {live && near && <LiveLook key={`${p.url}|${p.startedAt}`} url={p.url!} name={name} />}
    </group>
  );
});
