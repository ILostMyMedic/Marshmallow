// Adapted from cubefarm client/src/world/ActivityIcon.tsx (MIT): the sign over a worker's head, following them about
// once they get up.
import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ACTIVITY_ICONS } from '../../../shared/activity';
import { isBusy, type Activity, type Worker } from '../../../shared/types';
import { signHeight, SIGN_SIZE } from './activitySign';
import { roundRect, SANS } from './draw';
import { INK } from './Outlines';
import { bodyState, saying } from './people';

// The little sign over a busy worker's head: an icon for what they're doing (📖 reading, ✏️ editing, 🧪 testing…) and a
// short detail ("store.ts", "npm test"), straight from the server's redacted activity (shared/activity.ts). It looks
// for a change at most twice a second and fades between signs. Each sign's texture is drawn once and shared.

const SIGN = { ...SIGN_SIZE, px: 640, py: 120 };
const CHECK_MS = 500;
const FADE_S = 0.16;
const KEEP = 64; // sign textures kept; the least recently shown go first
/** Over a seated worker's head, in their desk's frame (the chair is at z 0.8), until their body is tracked. */
const SEATED_AT = { z: 0.8 };

const geometry = new THREE.PlaneGeometry(SIGN.w, SIGN.h);
const textures = new Map<string, THREE.CanvasTexture>();
const keyOf = (a: Activity | null) => (a ? `${a.kind}|${a.detail}` : '');

function drawSign(ctx: CanvasRenderingContext2D, icon: string, detail: string) {
  const { px: w, py: h } = SIGN;
  const font = `600 44px ${SANS}`;
  ctx.clearRect(0, 0, w, h);
  ctx.font = font;
  const room = w - 130;
  const text = detail ? Math.min(ctx.measureText(detail).width, room) : 0;
  const bw = 92 + (detail ? text + 26 : 0);
  const x0 = (w - bw) / 2;
  roundRect(ctx, x0, 8, bw, h - 16, (h - 16) / 2);
  ctx.fillStyle = 'rgba(255,253,245,0.96)';
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `54px ${SANS}`;
  ctx.fillText(icon, x0 + 49, h / 2 + 3);
  if (!detail) return;
  ctx.textAlign = 'left';
  ctx.font = font;
  ctx.fillStyle = INK;
  ctx.fillText(detail, x0 + 88, h / 2 + 3, room);
}

/** The texture for a sign, drawn on first use. */
function signTexture(a: Activity) {
  const key = keyOf(a);
  let tex = textures.get(key);
  if (tex) {
    textures.delete(key); // most recently used last
    textures.set(key, tex);
    return tex;
  }
  const canvas = document.createElement('canvas');
  canvas.width = SIGN.px;
  canvas.height = SIGN.py;
  drawSign(canvas.getContext('2d')!, ACTIVITY_ICONS[a.kind], a.detail);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(key, tex);
  if (textures.size > KEEP) {
    const [oldest, old] = textures.entries().next().value!;
    textures.delete(oldest);
    old.dispose();
  }
  return tex;
}

/** Mounted in the worker's desk's frame, over their chair. */
export const ActivityIcon = memo(function ActivityIcon({ worker }: { worker: Worker }) {
  const g = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }), []);
  useEffect(() => () => material.dispose(), [material]);
  // What the server says now; the frame loop picks it up at its next check.
  const wanted = useRef<Activity | null>(null);
  wanted.current = isBusy(worker.status) ? worker.activity : null;
  const st = useMemo(() => ({ shown: '', next: null as Activity | null, nextKey: '', checked: -1e9, fade: 0, y: 0, at: new THREE.Vector3() }), []);
  const parentTurn = useMemo(() => new THREE.Quaternion(), []);

  useFrame((_, delta) => {
    const grp = g.current;
    if (!grp) return;
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    if (now - st.checked >= CHECK_MS) {
      st.checked = now;
      st.next = wanted.current;
      st.nextKey = keyOf(st.next);
      if (st.shown && st.nextKey === st.shown) signTexture(st.next!); // still on show: keep its texture
    }
    // Fade the old sign out before the new one fades in.
    if (st.shown !== st.nextKey) {
      st.fade = Math.max(0, st.fade - dt / FADE_S);
      if (st.fade === 0) {
        st.shown = st.nextKey;
        if (st.next) {
          material.map = signTexture(st.next);
          material.needsUpdate = true;
        }
      }
    } else if (st.shown) st.fade = Math.min(1, st.fade + dt / FADE_S);
    grp.visible = st.fade > 0;
    if (!grp.visible) return;
    // over their head, seated or up and about (in the desk's frame), and above a speech bubble
    const body = bodyState(worker.id);
    const target = signHeight(body?.sit ?? 1, !!saying(worker.id));
    st.y = st.y === 0 ? target : st.y + (target - st.y) * Math.min(1, dt * 10);
    if (body && grp.parent) grp.parent.worldToLocal(st.at.set(body.x, 0, body.z));
    else st.at.set(0, 0, SEATED_AT.z);
    grp.position.set(st.at.x, st.y + Math.sin(now / 600) * 0.012, st.at.z);
    // face the camera, whichever way the desk is turned
    grp.parent?.getWorldQuaternion(parentTurn);
    grp.quaternion.copy(parentTurn.invert().multiply(camera.quaternion));
    grp.scale.setScalar(0.8 + 0.2 * st.fade);
    material.opacity = st.fade;
  });

  return (
    <group ref={g} visible={false}>
      <mesh geometry={geometry} material={material} renderOrder={3} />
    </group>
  );
});
