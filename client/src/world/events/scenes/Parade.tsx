// A parade marching down the street beside the office: a banner with the company's name carried at the front, a drum
// major twirling his baton, a marching band in red and white (trumpets, snare drums, sousaphones and a bass drum)
// playing a march, all in step, and behind them a giant inflatable marshmallow, beaming and waving, floating over the
// street on four ropes held by its handlers. The cars behind it wait for it to pass (streetTraffic.ts).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../../store';
import { loop, placeAt, play, type Loop } from '../../../ui/eventSfx';
import { SANS } from '../../draw';
import { EVENT_HAZE, hazed, TOON_RAMP } from '../../haze';
import { seeded } from '../../../../../shared/worldEvents';
import { inOut, sign, toonOut, type SceneProps } from '../kit';
import { ball, capsule, cone, Crowd, cyl, model, painted, part, signTexture, SKIN, type Look } from '../streetKit';
import { placeOn, ROAD_Y, routeAt, streetRoute, type Pose } from '../streetPath';
import { holdOf, holdStreet, type Hold } from '../streetTraffic';

type Role = 'carrier' | 'major' | 'horn' | 'snare' | 'tuba' | 'bass' | 'handler';
/** Who marches where: metres behind the front, metres to the column's right. */
const COLUMN: { back: number; lat: number; role: Role }[] = [
  { back: 0, lat: 0, role: 'carrier' },
  { back: 3.4, lat: 0, role: 'carrier' },
  { back: 5.6, lat: 0, role: 'major' },
  ...(['horn', 'horn', 'snare', 'tuba'] as const).flatMap((role, row) =>
    [-1.1, 0, 1.1].map((lat) => ({ back: 7.6 + row * 1.5, lat, role: role === 'tuba' && lat === 0 ? ('bass' as const) : role })),
  ),
  ...[15.5, 20].flatMap((back) => [-1.4, 1.4].map((lat) => ({ back, lat, role: 'handler' as const }))),
];
const BAND = COLUMN.filter((c) => c.role !== 'carrier' && c.role !== 'handler');
/** The balloon floats over the handlers: its middle this far behind the front, its bottom this high. */
const BALLOON = { back: 17.75, y: 7, r: 2.3, h: 4.6, corner: 1.0 };
const STEP_HZ = 1; // left-right, every second: two steps a second, in time with the march
const RED = '#c1121f';
const GOLD = '#e9c46a';
const WHITE = '#f8f9fa';

/** The giant marshmallow: a soft white cylinder with rounded edges, its top a little toasted, beaming, arms up; facing +z. */
function marshmallowModel(): THREE.BufferGeometry {
  const { r, h, corner: c } = BALLOON;
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - c + Math.cos(a) * c, c + Math.sin(a) * c));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - c + Math.cos(a) * c, h - c + Math.sin(a) * c));
  }
  pts.push(new THREE.Vector2(0, h));
  const body = part(new THREE.LatheGeometry(pts, 24), '#fffaf2');
  // toast the top: blend its vertices towards golden brown the higher they are
  const pos = body.attributes.position;
  const col = body.attributes.color;
  const toast = new THREE.Color('#f0c27b');
  const cream = new THREE.Color('#fffaf2');
  const mix = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = THREE.MathUtils.smoothstep(pos.getY(i), h - 0.9, h);
    mix.copy(cream).lerp(toast, k * 0.8);
    col.setXYZ(i, mix.r, mix.g, mix.b);
  }
  const face = r + 0.02;
  const y = h * 0.56;
  return model([
    body,
    ...[-1, 1].flatMap((x) => [
      part(ball(0.26, 12, 8), '#1f1d2b', { at: [x * 0.62, y + 0.35, face - 0.12], scale: [1, 1.25, 0.5] }),
      part(ball(0.08, 8, 6), '#ffffff', { at: [x * 0.62 - 0.07, y + 0.48, face], scale: [1, 1, 0.4] }),
      part(ball(0.3, 12, 8), '#ff9eb5', { at: [x * 1.15, y - 0.25, face - 0.18], scale: [1, 0.6, 0.35] }),
      // arms up, waving at the windows
      part(capsule(0.32, 1.1), '#fffaf2', { at: [x * (r + 0.35), h * 0.62, 0.2], rot: [0, 0, -x * 0.7] }),
    ]),
    part(new THREE.TorusGeometry(0.45, 0.07, 6, 16, Math.PI), '#1f1d2b', { at: [0, y - 0.15, face - 0.06], rot: [0, 0, Math.PI] }),
  ]);
}

/** A band hat: a red shako with a white band, a gold badge and a white plume; its bottom at the origin. */
const shakoModel = () =>
  model([
    part(cyl(0.17, 0.15, 0.34, 12), RED, { at: [0, 0.17, 0] }),
    part(cyl(0.175, 0.175, 0.06, 12), WHITE, { at: [0, 0.04, 0] }),
    part(ball(0.05, 6, 4), GOLD, { at: [0, 0.2, 0.16], scale: [1, 1, 0.4] }),
    part(cone(0.06, 0.28, 8), WHITE, { at: [0, 0.48, 0] }),
    part(cyl(0.18, 0.18, 0.02, 12), '#1f1d2b', { at: [0, 0.0, 0.06], scale: [1, 1, 1.15] }),
  ]);

/** A cap for the handlers and the banner's carriers. */
const capModel = () => model([part(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff'), part(cyl(0.16, 0.16, 0.02, 10), '#ffffff', { at: [0, 0.0, 0.14], scale: [1, 1, 0.8] })]);

/** A trumpet held up to the lips, pointing ahead; its mouthpiece at the origin. */
const hornModel = () => model([part(cyl(0.025, 0.025, 0.5, 6), GOLD, { at: [0, 0, 0.25], rot: [Math.PI / 2, 0, 0] }), part(cone(0.1, 0.18, 10), GOLD, { at: [0, 0, 0.55], rot: [-Math.PI / 2, 0, 0] }), part(cyl(0.05, 0.05, 0.14, 6), GOLD, { at: [0, -0.05, 0.22] })]);

/** A sousaphone: its coil round the body and its bell up over the head, facing ahead; its middle at the origin. */
const tubaModel = () =>
  model([
    part(new THREE.TorusGeometry(0.34, 0.06, 6, 18), GOLD, { rot: [Math.PI / 2 - 0.45, 0, 0] }),
    part(cyl(0.05, 0.08, 0.6, 8), GOLD, { at: [0.0, 0.6, -0.12], rot: [-0.3, 0, 0] }),
    part(cyl(0.42, 0.1, 0.42, 16), GOLD, { at: [0, 1.0, 0.0], rot: [-Math.PI / 2 + 0.25, 0, 0] }),
  ]);

/** A drum, its axis along y, a unit across: scaled per drum (snares upright, the bass drum on its side). */
const drumModel = () => model([part(cyl(0.5, 0.5, 1, 14), WHITE), ...[-1, 1].map((y) => part(cyl(0.52, 0.52, 0.12, 14), RED, { at: [0, y * 0.45, 0] }))]);

const m = new THREE.Matrix4();
const local = new THREE.Matrix4();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const va = new THREE.Vector3();
const vs = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

/** Places instance `i` of `mesh` on marcher `who` of `crowd`: moved, turned (about x, then z) and scaled in their frame. */
function attach(mesh: THREE.InstancedMesh, i: number, crowd: Crowd, who: number, at: [number, number, number], rx = 0, rz = 0, scale: [number, number, number] = [1, 1, 1]) {
  qa.setFromAxisAngle(X, rx).multiply(qb.setFromAxisAngle(Z, rz));
  local.compose(va.set(...at), qa, vs.set(...scale));
  mesh.setMatrixAt(i, m.multiplyMatrices(crowd.frameOf(who, m), local));
}

function paintBanner(text: string) {
  return (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#fffaf2';
    ctx.fillRect(0, 0, 768, 200);
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, 768, 22);
    ctx.fillRect(0, 178, 768, 22);
    ctx.fillStyle = GOLD;
    for (let x = 12; x < 768; x += 48) {
      ctx.beginPath();
      ctx.arc(x, 189, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1f1d2b';
    let size = 92;
    do ctx.font = `900 ${size}px ${SANS}, sans-serif`;
    while (ctx.measureText(text).width > 720 && (size -= 6) > 30);
    ctx.fillText(text, 384, 104);
  };
}

export default function Parade({ run, elevation }: SceneProps) {
  const balloon = useRef<THREE.Mesh>(null);
  const banner = useRef<THREE.Mesh>(null);
  const s = sign(run.side);
  const r = useMemo(() => streetRoute('parade', run.side, seeded(run.seed)()), [run.seed, run.side]);
  const parts = useMemo(() => {
    const rnd = seeded(run.seed + 7);
    const skin = () => SKIN[Math.floor(rnd() * SKIN.length)];
    const lookOf = (role: Role): Look => (role === 'carrier' ? { body: '#2d6a4f', skin: skin(), legs: '#2b2d42' } : role === 'handler' ? { body: '#1d4ed8', skin: skin(), legs: '#2b2d42' } : { body: RED, skin: skin(), legs: WHITE });
    const crowd = new Crowd(COLUMN.length, COLUMN.map((c) => lookOf(c.role)));
    const name = (useStore.getState().settings.companyName || 'Marshmallow').trim().toUpperCase();
    const map = signTexture(768, 200, paintBanner(`${name} PARADE`));
    const inst = (geo: THREE.BufferGeometry, n: number, mat: THREE.Material = painted()) => {
      const x = new THREE.InstancedMesh(geo, mat, n);
      x.frustumCulled = false;
      return x;
    };
    const ropes = new THREE.BufferGeometry();
    ropes.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    const lines = new THREE.LineSegments(ropes, new THREE.LineBasicMaterial({ color: '#495057' }));
    lines.frustumCulled = false; // its ends move every frame: bounds taken once would be wrong
    return {
      crowd,
      shakos: inst(shakoModel(), BAND.length),
      caps: inst(capModel(), COLUMN.length - BAND.length),
      horns: inst(hornModel(), BAND.filter((c) => c.role === 'horn').length),
      tubas: inst(tubaModel(), 2),
      drums: inst(drumModel(), 4),
      sticks: inst(new THREE.CylinderGeometry(0.02, 0.02, 1, 5).translate(0, 0.5, 0), 3, toonOut('#e9ecef')),
      marshmallow: marshmallowModel(),
      banner: { geo: new THREE.PlaneGeometry(3.2, 0.84).rotateY((-s * Math.PI) / 2), map, mat: hazed(new THREE.MeshToonMaterial({ map, gradientMap: TOON_RAMP, side: THREE.DoubleSide }), EVENT_HAZE) },
      ropes: lines,
    };
  }, [run.seed, s]);
  useEffect(
    () => () => {
      parts.crowd.dispose();
      for (const x of [parts.shakos, parts.caps, parts.horns, parts.tubas, parts.drums, parts.sticks]) {
        x.geometry.dispose();
        x.dispose();
      }
      parts.marshmallow.dispose();
      parts.banner.geo.dispose();
      parts.banner.map.dispose();
      parts.banner.mat.dispose();
      parts.ropes.geometry.dispose();
      (parts.ropes.material as THREE.Material).dispose();
    },
    [parts],
  );
  const state = useMemo(() => ({ front: { x: 0, z: 0, yaw: 0, speed: 0, u: 0 } as Pose, at: { x: 0, z: 0, yaw: 0, speed: 0, u: 0 } as Pose, hold: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } as Hold, band: null as Loop | null, crashed: false }), []);
  useEffect(() => {
    state.band = loop('band');
    return () => {
      state.band?.stop(1.5);
      holdStreet(run.key, null);
    };
  }, [state, run.key]);

  useFrame(() => {
    const t = run.t;
    const on = t < r.drive.seconds;
    holdStreet(run.key, on ? holdOf('parade', r, t, state.hold) : null);
    routeAt(r, t, state.front);
    const off = (state.front.x - r.x) * -r.dir; // the column's centre line, right of the street's
    const walk = Math.sin(t * Math.PI * 2 * STEP_HZ);
    const bob = Math.abs(walk) * 0.05;
    const crowd = parts.crowd;
    let horn = 0;
    let cap = 0;
    let drum = 0;
    let tuba = 0;
    COLUMN.forEach((c, i) => {
      const p = placeOn(r, state.front.u - c.back, off + c.lat, 0, state.at);
      if (!on) {
        crowd.hide(i);
        return;
      }
      crowd.set(i, p.x, ROAD_Y, p.z, p.yaw, walk * 0.45, bob);
      const band = i - 2; // the drum major and the band wear shakos, in COLUMN's order
      if (c.role === 'carrier' || c.role === 'handler') attach(parts.caps, cap++, crowd, i, [0, 1.76, 0.02]);
      else attach(parts.shakos, band, crowd, i, [0, 1.76, 0], 0, 0, c.role === 'major' ? [1.1, 1.45, 1.1] : [1, 1, 1]);
      if (c.role === 'horn') attach(parts.horns, horn++, crowd, i, [0.04, 1.5, 0.2], -0.35 + Math.sin(t * 4 + i) * 0.06);
      else if (c.role === 'snare') attach(parts.drums, drum++, crowd, i, [0, 0.95, 0.3], 0, 0, [0.42, 0.2, 0.42]);
      else if (c.role === 'bass') attach(parts.drums, drum++, crowd, i, [0, 1.05, 0.32], 0, Math.PI / 2, [0.78, 0.34, 0.78]);
      else if (c.role === 'tuba') attach(parts.tubas, tuba++, crowd, i, [0, 1.12, 0]);
      else if (c.role === 'major') attach(parts.sticks, 0, crowd, i, [0.3, 1.3, 0.3], t * 7, 0.4, [1, 0.9, 1]);
      else if (c.role === 'carrier') attach(parts.sticks, i + 1, crowd, i, [0.25, 0.75, 0.15], 0, 0, [1, 2.0, 1]);
    });
    crowd.commit();
    for (const x of [parts.shakos, parts.caps, parts.horns, parts.tubas, parts.drums, parts.sticks]) {
      if (!on) for (let i = 0; i < x.count; i++) x.setMatrixAt(i, zero);
      x.instanceMatrix.needsUpdate = true;
    }
    // the banner between its carriers' poles, facing the office
    const b = banner.current;
    if (b) {
      const p = placeOn(r, state.front.u - 1.7, off, 0, state.at);
      b.visible = on;
      b.position.set(p.x, ROAD_Y + 2.15 + bob, p.z);
    }
    // the marshmallow, bobbing on its ropes, turned to beam at the office
    const g = balloon.current;
    if (g) {
      const p = placeOn(r, state.front.u - BALLOON.back, off, 0, state.at);
      const y = ROAD_Y + BALLOON.y + Math.sin(t * 0.9) * 0.35;
      g.visible = on;
      g.position.set(p.x + Math.sin(t * 0.4) * 0.3, y, p.z);
      g.rotation.set(Math.sin(t * 0.6) * 0.06, (-s * Math.PI) / 2 + Math.sin(t * 0.5) * 0.25, Math.sin(t * 0.7) * 0.05);
      const pos = parts.ropes.geometry.attributes.position as THREE.BufferAttribute;
      let k = 0;
      COLUMN.forEach((c, i) => {
        if (c.role !== 'handler') return;
        crowd.frameOf(i, m);
        va.set(0.28, 1.25, 0.2).applyMatrix4(m);
        pos.setXYZ(k * 2, va.x, va.y, va.z);
        const top = placeOn(r, state.front.u - BALLOON.back - Math.sign(c.back - BALLOON.back) * 1.1, off + Math.sign(c.lat) * 1.4, 0, state.at);
        pos.setXYZ(k * 2 + 1, top.x, y + 0.25, top.z);
        k++;
      });
      pos.needsUpdate = true;
      parts.ropes.visible = on;
    }

    const at = placeOn(r, state.front.u - 10, off, 0, state.at);
    const heard = placeAt(at.x, ROAD_Y + 1.6 - elevation, at.z, 35);
    state.band?.set(heard.gain * inOut(t, run.seconds, 3) * (on ? 1 : 0), heard.pan);
    if (!state.crashed && t > 0.5) {
      state.crashed = true;
      play('crash', { gain: heard.gain * 0.6, pan: heard.pan });
    }
  });

  return (
    <group>
      <primitive object={parts.crowd.group} />
      {[parts.shakos, parts.caps, parts.horns, parts.tubas, parts.drums, parts.sticks].map((x) => (
        <primitive key={x.uuid} object={x} />
      ))}
      <mesh ref={banner} geometry={parts.banner.geo} material={parts.banner.mat} />
      <mesh ref={balloon} geometry={parts.marshmallow} material={painted()} />
      <primitive object={parts.ropes} />
    </group>
  );
}
