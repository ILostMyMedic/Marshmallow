// An office floor's bought extras (shared/shop.ts), each standing, lying or hanging in its spot (spots.ts), straight from
// the floor's plan in the store: buying puts an item there. The vending machine and the beer fridge are their own
// components (they're used); the rest are merged toon models (a draw call and one for the ink), canvas-painted rugs,
// posters made from the floor's repository (poster.ts) and the repo's name in neon. Wall art is cut away with its wall
// in the overview. The lit machines brighten with the evening, and E on one is handed to playerMachines.ts.
// Adapted from cubefarm client/src/world/decor/Decorations.tsx (MIT): placing, the poster and neon painting and the
// rug; the decor box, slot markers, carrying, instancing, the fish tank and the arcade are cut.
import { memo, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { Floor, FloorItem } from '../../../../shared/types';
import { useStore } from '../../store';
import { onAction } from '../actions';
import { useCanvasTexture } from '../canvasTexture';
import { CUT_PLANES } from '../cutaway';
import { dayTime, nightFactor } from '../dayTime';
import { roundRect, SANS } from '../draw';
import { shade } from '../materials';
import { INK, Outlines } from '../Outlines';
import { BeerFridge } from './BeerFridge';
import { beanbagsModel, figModel, frameModel, neonBackModel, plantModel, sofaModel } from './models';
import { machinesGlow, vertexToon, vertexToonCut } from './parts';
import { blend, hashString, posterPlan, shortName } from './poster';
import { beerAt, leaveMachines, vendAt } from './playerMachines';
import { paintPoster, paintRug, POSTER_PX } from './posterPaint';
import './probe';
import { itemSize, placedItems, placement } from './spots';
import { VendingMachine } from './VendingMachine';

const ROOM_CUT = CUT_PLANES.room;

/** A repo poster in its frame: the picture painted from the floor's repository, the same every time. */
function Poster({ floor, spot }: { floor: Floor; spot: string }) {
  const { w, h } = itemSize('poster');
  const plan = useMemo(
    () => posterPlan({ floorId: floor.id, spot, fullName: floor.fullName, color: floor.color, floor: floor.floor, languages: floor.languages }),
    [floor.id, spot, floor.fullName, floor.color, floor.floor, floor.languages],
  );
  const tex = useCanvasTexture(POSTER_PX.w, POSTER_PX.h, (ctx) => paintPoster(ctx, POSTER_PX.w, POSTER_PX.h, plan), [plan]);
  return (
    <>
      <mesh geometry={frameModel(w, h)} material={vertexToonCut}>
        <Outlines thickness={0.014} color={INK} cut="room" />
      </mesh>
      <mesh position={[0, 0, 0.022]}>
        <planeGeometry args={[w - 0.12, h - 0.12]} />
        <meshToonMaterial map={tex} clippingPlanes={ROOM_CUT} />
      </mesh>
    </>
  );
}

/** The tubes' plane: bigger than the backboard, so their glow spills onto the wall round it. */
const NEON_GLOW = { w: 1.9, h: 0.8 };

/** The repo's short name in glowing tubes of the floor's colour, in a rounded border, on a dark backboard. */
function Neon({ floor }: { floor: Floor }) {
  const { w, h } = itemSize('neon');
  const name = shortName(floor.fullName);
  const px = { w: 1024, h: Math.round((1024 * NEON_GLOW.h) / NEON_GLOW.w) };
  const tex = useCanvasTexture(
    px.w,
    px.h,
    (ctx) => {
      const s = px.w / NEON_GLOW.w; // px per metre
      const bw = w * s;
      const bh = h * s;
      const x0 = (px.w - bw) / 2;
      const y0 = (px.h - bh) / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const rim = blend(floor.color, '#ff5d8f', 0.6);
      roundRect(ctx, x0 + 14, y0 + 14, bw - 28, bh - 28, 40);
      ctx.strokeStyle = rim;
      ctx.lineWidth = 7;
      ctx.shadowColor = rim;
      ctx.shadowBlur = 30;
      ctx.stroke();
      let size = 150;
      ctx.font = `700 ${size}px ${SANS}`;
      while (size > 40 && ctx.measureText(name).width > bw - 110) ctx.font = `700 ${(size -= 6)}px ${SANS}`;
      const tube = blend(floor.color, '#ffffff', 0.15);
      ctx.shadowColor = floor.color;
      ctx.shadowBlur = 46;
      ctx.strokeStyle = tube;
      ctx.lineWidth = 13;
      ctx.strokeText(name, px.w / 2, px.h / 2 + 6);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = blend(floor.color, '#ffffff', 0.8);
      ctx.lineWidth = 4;
      ctx.strokeText(name, px.w / 2, px.h / 2 + 6);
    },
    [name, floor.color],
  );
  return (
    <>
      <mesh geometry={neonBackModel(w, h)} material={vertexToonCut} />
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[NEON_GLOW.w, NEON_GLOW.h]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} clippingPlanes={ROOM_CUT} />
      </mesh>
    </>
  );
}

/** A rug in the floor's colours, its pattern from the floor and the spot. */
function Rug({ floor, spot }: { floor: Floor; spot: string }) {
  const { w, d } = itemSize('rug', spot);
  const px = { w: Math.round(w * 128), h: Math.round(d * 128) };
  const tex = useCanvasTexture(px.w, px.h, (ctx) => paintRug(ctx, px.w, px.h, floor.color, hashString(`${floor.id}|${spot}`)), [floor.color, floor.id, spot]);
  return (
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshToonMaterial map={tex} />
    </mesh>
  );
}

/** A merged toon model with its ink. */
function Model({ geometry, shadow = true }: { geometry: THREE.BufferGeometry; shadow?: boolean }) {
  return (
    <mesh geometry={geometry} material={vertexToon} castShadow={shadow} receiveShadow>
      <Outlines thickness={0.018} color={INK} />
    </mesh>
  );
}

function ItemLook({ item, floor }: { item: FloorItem; floor: Floor }) {
  const color = floor.color;
  switch (item.item) {
    case 'vending-machine':
      return <VendingMachine spot={item.spot} color={color} />;
    case 'beer-fridge':
      return <BeerFridge spot={item.spot} color={color} />;
    case 'sofa':
      return <Model geometry={sofaModel(shade(color, -0.05))} />;
    case 'plant':
      return <Model geometry={plantModel(color)} />;
    case 'fig':
      return <Model geometry={figModel(color)} />;
    case 'beanbags':
      return <Model geometry={beanbagsModel(shade(color, 0.04))} />;
    case 'rug':
      return <Rug floor={floor} spot={item.spot} />;
    case 'poster':
      return <Poster floor={floor} spot={item.spot} />;
    case 'neon':
      return <Neon floor={floor} />;
    default:
      return null;
  }
}

/** One bought item, in its spot. */
const Placed = memo(function Placed({ item, floor }: { item: FloorItem; floor: Floor }) {
  const p = placement(item.spot, item.item);
  if (!p) return null;
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
      <ItemLook item={item} floor={floor} />
    </group>
  );
});

/** The lit machines' glow, from the office clock (only while there's a machine to light). */
function Glow() {
  useFrame(() => machinesGlow(nightFactor(dayTime.t)));
  return null;
}

/** Everything `floor` has bought, in its spots. */
export const Decor = memo(function Decor({ floor }: { floor: Floor }) {
  const plan = useStore((s) => s.floorPlans[floor.id]);
  const items = useMemo(() => placedItems(plan), [plan]);
  const lit = items.some((i) => i.item === 'vending-machine' || i.item === 'beer-fridge');
  useEffect(() => {
    const offVending = onAction('vending', (a) => vendAt(a.spot));
    const offBeer = onAction('beer', (a) => beerAt(a.spot));
    return () => {
      offVending();
      offBeer();
      leaveMachines();
    };
  }, []);
  return (
    <group>
      {items.map((i) => (
        <Placed key={`${i.spot}:${i.item}`} item={i} floor={floor} />
      ))}
      {lit && <Glow />}
    </group>
  );
});
