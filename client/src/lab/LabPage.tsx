// The character lab (/lab): alternative designs for the game's people, side by side on one rig and its animations, so
// the manager can judge them before anything in the game changes. It stands on its own: nothing here touches the game's
// characters. URL parameters set it up (for links and screenshots): ?anim=type&view=human&look=me|seed:12|<worker id>
// &cam=full|close|side|feet&t=1.5&paused&turntable&outlines=0&speed=0.5&hide=today,chibi, and the look's own
// &outfit=, &build=, &shape=, &hair= and &hat=.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { seededAppearance, type Appearance } from '../world/appearance';
import { HAIR_STYLES, HEADWEAR } from '../world/looks';
import { useMe } from '../world/myLook';
import { DESIGN_OF, DESIGNS, type DesignId } from './designs';
import { CAMERAS, LabScene, type CameraName } from './LabScene';
import { cellRect, gridFor } from './layout';
import { ANIM_LABELS, ANIM_NAMES, SEATED, type AnimName } from './poses';
import { labClock, randomLook, shownDesigns, useLab, type View } from './state';
import './lab.css';

const FLOOR_SIZE = 15; // the most workers a floor holds
const SAMPLE_SEEDS = [7, 4242, 90210, 31337];

/** Applies the URL's settings once, on the first visit. */
function fromUrl(): CameraName {
  const q = new URLSearchParams(location.search);
  const lab = useLab.getState();
  const anim = q.get('anim') as AnimName | null;
  if (anim && ANIM_NAMES.includes(anim)) lab.play(anim);
  const view = q.get('view');
  if (view && (view === 'all' || DESIGN_OF[view as DesignId])) lab.set({ view: view as View });
  const look = q.get('look');
  const seed = look?.startsWith('seed:') ? Number(look.slice(5)) : NaN;
  if (Number.isFinite(seed)) lab.setLook(`seed:${seed}`, randomLook(seed));
  else if (look === 'me') lab.setLook('me', useMe.getState().look);
  const outfit = q.get('outfit') as Appearance['outfit'] | null;
  const build = q.get('build') as Appearance['build'] | null;
  const shape = q.get('shape') as Appearance['look'] | null;
  const hair = q.get('hair') as Appearance['hair'] | null;
  const hat = q.get('hat') as Appearance['headwear'] | null;
  const cur = useLab.getState();
  cur.setLook(cur.lookKey, {
    ...cur.look,
    ...(outfit && (OUTFIT_CHOICES as readonly string[]).includes(outfit) ? { outfit } : {}),
    ...(build && ['slim', 'average', 'broad'].includes(build) ? { build } : {}),
    ...(shape && ['feminine', 'masculine'].includes(shape) ? { look: shape } : {}),
    ...(hair && HAIR_STYLES.includes(hair) ? { hair } : {}),
    ...(hat && HEADWEAR.includes(hat) ? { headwear: hat, headphones: false } : {}),
  });
  const t = Number(q.get('t'));
  // the animation started at 0 on the clock: start the clock at t
  if (q.has('t') && Number.isFinite(t)) labClock.t = t;
  lab.set({
    paused: q.has('paused'),
    turntable: q.has('turntable'),
    outlines: q.get('outlines') !== '0',
    speed: Number(q.get('speed')) > 0 ? Number(q.get('speed')) : 1,
  });
  for (const id of (q.get('hide') ?? '').split(',')) if (DESIGN_OF[id as DesignId]) lab.toggle(id as DesignId);
  const cam = q.get('cam') as CameraName | null;
  return cam && cam in CAMERAS ? cam : 'full';
}

/** A one-line summary of a look. */
const describe = (l: Appearance) => [l.look, l.build, l.outfit, l.hair, l.glasses !== 'none' && `${l.glasses} glasses`, l.headwear !== 'none' && l.headwear, l.headphones && 'headphones', l.facialHair !== 'none' && l.facialHair].filter(Boolean).join(' · ');

function Swatch({ color }: { color: string }) {
  return <span className="lab-swatch" style={{ background: color }} />;
}

function LookPicker() {
  const lookKey = useLab((s) => s.lookKey);
  const look = useLab((s) => s.look);
  const setLook = useLab((s) => s.setLook);
  const me = useMe((s) => s.look);
  const workers = useStore((s) => s.workers);
  const staff = useMemo(() => Object.values(workers).slice(0, 8), [workers]);
  // follow your own look if it changes while picked
  useEffect(() => {
    if (lookKey === 'me') setLook('me', me);
  }, [lookKey, me, setLook]);
  return (
    <section>
      <h2>Look</h2>
      <div className="lab-buttons">
        <button className={lookKey === 'me' ? 'on' : ''} onClick={() => setLook('me', me)}>
          My look
        </button>
        {staff.map((w) => (
          <button key={w.id} className={lookKey === w.id ? 'on' : ''} onClick={() => setLook(w.id, seededAppearance({ seed: w.seed, role: w.role }))}>
            {w.name}
          </button>
        ))}
        {SAMPLE_SEEDS.map((seed, i) => (
          <button key={seed} className={lookKey === `seed:${seed}` ? 'on' : ''} onClick={() => setLook(`seed:${seed}`, randomLook(seed))}>
            Worker {String.fromCharCode(65 + i)}
          </button>
        ))}
        <button
          onClick={() => {
            const seed = Math.floor(Math.random() * 1e9);
            setLook(`seed:${seed}`, randomLook(seed));
          }}
        >
          🎲 Surprise me
        </button>
      </div>
      <p className="lab-look">
        <Swatch color={look.skin} />
        <Swatch color={look.shirt} />
        <Swatch color={look.hairColor} />
        {describe(look)}
      </p>
      <LookTweaks />
    </section>
  );
}

function AnimPicker() {
  const anim = useLab((s) => s.anim);
  const inTurn = useLab((s) => s.inTurn);
  const paused = useLab((s) => s.paused);
  const speed = useLab((s) => s.speed);
  const { play, set } = useLab.getState();
  return (
    <section>
      <h2>Animation</h2>
      <div className="lab-buttons">
        {ANIM_NAMES.map((a) => (
          <button key={a} className={anim === a ? 'on' : ''} onClick={() => (set({ inTurn: false }), play(a))}>
            {ANIM_LABELS[a]}
            {SEATED.has(a) && <small> 🪑</small>}
          </button>
        ))}
      </div>
      <div className="lab-buttons">
        <button className={inTurn ? 'on' : ''} onClick={() => set({ inTurn: !inTurn })}>
          🔁 Play them in turn
        </button>
        <button onClick={() => set({ paused: !paused })}>{paused ? '▶ Play' : '⏸ Pause'}</button>
      </div>
      <label className="lab-range">
        Speed <input type="range" min={0.1} max={2} step={0.05} value={speed} onChange={(e) => set({ speed: Number(e.target.value) })} />
        <span>{speed.toFixed(2)}×</span>
      </label>
    </section>
  );
}

const CAMERA_LABELS: Record<CameraName, string> = { full: 'Full body', close: 'Close-up', side: 'Side', feet: 'Shoes', head: 'Head' };

function ViewPicker({ cam, setCam }: { cam: CameraName; setCam: (c: CameraName) => void }) {
  const view = useLab((s) => s.view);
  const hidden = useLab((s) => s.hidden);
  const turntable = useLab((s) => s.turntable);
  const outlines = useLab((s) => s.outlines);
  const { set, toggle } = useLab.getState();
  return (
    <section>
      <h2>View</h2>
      <div className="lab-buttons">
        <button className={view === 'all' ? 'on' : ''} onClick={() => set({ view: 'all' })}>
          Side by side
        </button>
        {DESIGNS.map((d) => (
          <button key={d.id} className={view === d.id ? 'on' : ''} onClick={() => set({ view: d.id })}>
            {d.name}
          </button>
        ))}
      </div>
      {view === 'all' && (
        <div className="lab-checks">
          {DESIGNS.map((d) => (
            <label key={d.id}>
              <input type="checkbox" checked={!hidden.includes(d.id)} onChange={() => toggle(d.id)} /> {d.name}
            </label>
          ))}
        </div>
      )}
      <div className="lab-buttons">
        <button className={turntable ? 'on' : ''} onClick={() => set({ turntable: !turntable })}>
          ⟳ Turntable
        </button>
        <button className={outlines ? 'on' : ''} onClick={() => set({ outlines: !outlines })}>
          ✒ Outlines
        </button>
      </div>
      <div className="lab-buttons">
        {(Object.keys(CAMERAS) as CameraName[]).map((c) => (
          <button key={c} className={cam === c ? 'on' : ''} onClick={() => setCam(c)}>
            {CAMERA_LABELS[c]}
          </button>
        ))}
      </div>
      <p className="lab-hint">Drag to turn the camera, the wheel zooms, a right-drag pans.</p>
    </section>
  );
}

const k = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());

function Costs() {
  const stats = useLab((s) => s.stats);
  return (
    <section>
      <h2>Cost per figure</h2>
      <table className="lab-costs">
        <thead>
          <tr>
            <th />
            <th title="The body: draw calls (its mesh, its ink, its unlined details) and triangles, ink included">body</th>
            <th title="The game's head, hair and face, the same parts in every design">head</th>
            <th title={`Draw calls (shadow-pass draws in brackets) and triangles for a full floor of ${FLOOR_SIZE}`}>×{FLOOR_SIZE}</th>
          </tr>
        </thead>
        <tbody>
          {DESIGNS.map((d) => {
            const s = stats[d.id];
            return (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{s ? `${s.draws - s.headDraws} · ${k(s.triangles - s.headTriangles)}` : '–'}</td>
                <td>{s ? `${s.headDraws} · ${k(s.headTriangles)}` : '–'}</td>
                <td>{s ? `${s.draws * FLOOR_SIZE} (${s.shadows * FLOOR_SIZE}) · ${k(s.triangles * FLOOR_SIZE)}` : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="lab-hint">Draw calls · triangles, for the designs on show and this look (hair and hats change the head's share). The mug and the Zzz aren't counted.</p>
    </section>
  );
}

const OUTFIT_CHOICES = ['tee', 'hoodie', 'stripe', 'sweater', 'cardigan', 'turtleneck'] as const;

/** Tries the look in another outfit, build or shape, keeping the rest of it. */
function LookTweaks() {
  const look = useLab((s) => s.look);
  const lookKey = useLab((s) => s.lookKey);
  const setLook = useLab((s) => s.setLook);
  const tweak = (patch: Partial<Appearance>) => setLook(lookKey.endsWith('*') ? lookKey : `${lookKey}*`, { ...look, ...patch });
  return (
    <div className="lab-tweaks">
      <label>
        Outfit
        <select value={look.outfit} onChange={(e) => tweak({ outfit: e.target.value as Appearance['outfit'] })}>
          {OUTFIT_CHOICES.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
      <label>
        Build
        <select value={look.build} onChange={(e) => tweak({ build: e.target.value as Appearance['build'] })}>
          <option>slim</option>
          <option>average</option>
          <option>broad</option>
        </select>
      </label>
      <label>
        Shape
        <select value={look.look} onChange={(e) => tweak({ look: e.target.value as Appearance['look'] })}>
          <option>feminine</option>
          <option>masculine</option>
        </select>
      </label>
      <label>
        Hair
        <select value={look.hair} onChange={(e) => tweak({ hair: e.target.value as Appearance['hair'] })}>
          {HAIR_STYLES.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </label>
      <label>
        Hat
        <select value={look.headwear} onChange={(e) => tweak({ headwear: e.target.value as Appearance['headwear'], headphones: false })}>
          {HEADWEAR.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** The design's name and cost over each cell. */
function CellLabels({ width, height }: { width: number; height: number }) {
  const view = useLab((s) => s.view);
  const hidden = useLab((s) => s.hidden);
  const stats = useLab((s) => s.stats);
  const set = useLab((s) => s.set);
  const ids = shownDesigns(view, hidden);
  const grid = gridFor(ids.length, width, height);
  return (
    <>
      {ids.map((id, i) => {
        const r = cellRect(i, grid, width, height);
        const s = stats[id];
        return (
          <div key={id} className="lab-cell" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
            <button className="lab-cell-name" title={view === 'all' ? 'Show this one big' : 'Back to side by side'} onClick={() => set({ view: view === 'all' ? id : 'all' })}>
              {DESIGN_OF[id].name}
              {s && (
                <small>
                  body {s.draws - s.headDraws} draws · {k(s.triangles - s.headTriangles)} tris · with head {s.draws}
                </small>
              )}
            </button>
            {view !== 'all' && <p className="lab-blurb">{DESIGN_OF[id].blurb}</p>}
          </div>
        );
      })}
    </>
  );
}

// fromUrl toggles what it hides, so it runs once per page load, not once per render (StrictMode renders twice)
let urlCam: CameraName | null = null;
const startCam = () => (urlCam ??= fromUrl());

export function LabPage() {
  const [cam, setCam] = useState<CameraName>(startCam);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="lab">
      <aside className="lab-panel">
        <header>
          <h1>Character lab</h1>
          <p>
            Designs for the office's people on one shared rig. Nothing here changes the game. <a href="/">Office</a> · <a href="/debug">Debug page</a>
          </p>
        </header>
        <AnimPicker />
        <ViewPicker cam={cam} setCam={setCam} />
        <LookPicker />
        <Costs />
      </aside>
      <main className="lab-stage" ref={stage}>
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          camera={{ fov: 30, near: 0.05, far: 60, position: [...CAMERAS.full.position] }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.shadowMap.type = THREE.PCFShadowMap;
            gl.setClearColor(0x000000, 0);
          }}
        >
          <LabScene cam={cam} />
        </Canvas>
        <CellLabels width={size.width} height={size.height} />
      </main>
    </div>
  );
}
