// The shop's kiosk in the lobby, east of the elevator across from the floor directory: a toon stand with a big coin on
// top and a screen listing every floor's coins (repainted only when they change). E on it opens the shop (the overlay
// ui/ builds). Draws: the stand, its ink and the screen.
// Adapted from cubefarm client/src/world/decor/RewardsCorner.tsx (MIT): the kiosk; the trophy shelf is cut (the lobby has
// its trophy cabinet).
import { memo } from 'react';
import type * as THREE from 'three';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { useCanvasTexture } from '../canvasTexture';
import { roundRect, SANS } from '../draw';
import { useInteractable } from '../interact';
import { SHOP_KIOSK } from '../layout';
import { INK, Outlines } from '../Outlines';
import { kioskModel, KIOSK_SCREEN } from './models';
import { vertexToon } from './parts';
import { shortName } from './poster';

const PX = { w: 640, h: 432 };

/** The screen: the shop's name, a row per floor (its number in its colour, its name, its coins), and what E does. */
function paintScreen(ctx: CanvasRenderingContext2D, rows: string[]) {
  const { w, h } = PX;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2b1055');
  g.addColorStop(1, '#4a1a7a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd43b';
  ctx.font = `700 58px ${SANS}`;
  ctx.fillText('🪙 Shop', 34, 52);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#c9c3e6';
  ctx.font = `500 24px ${SANS}`;
  ctx.fillText('coins per floor', w - 34, 56);
  const shown = rows.slice(0, 5);
  if (!shown.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 34px ${SANS}`;
    ctx.fillText('Connect a repo: its merges earn coins', w / 2, h / 2);
  }
  const rh = Math.min(62, 280 / Math.max(1, shown.length));
  shown.forEach((r, i) => {
    const [no, name, color, coins] = r.split('|');
    const y = 112 + i * rh + rh / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, 24, y - rh / 2 + 4, w - 48, rh - 8, 16);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(60, y, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `700 22px ${SANS}`;
    ctx.fillText(no, 60, y + 1);
    ctx.textAlign = 'left';
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, 96, y + 1);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe066';
    ctx.font = `700 32px ${SANS}`;
    ctx.fillText(`${coins} 🪙`, w - 44, y + 1);
  });
  if (rows.length > shown.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c9c3e6';
    ctx.font = `500 22px ${SANS}`;
    ctx.fillText(`and ${rows.length - shown.length} more`, 34, h - 34);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#7CFFB2';
  ctx.font = `600 24px ${SANS}`;
  ctx.fillText('E to shop', w - 34, h - 34);
}

export const ShopKiosk = memo(function ShopKiosk() {
  const ref = useInteractable<THREE.Group>({ id: 'shop-kiosk', label: 'Open the shop', action: { kind: 'shop' } }, 3.2);
  const rows = useStore(useShallow((s) => s.floors.map((f) => `${f.floor}|${shortName(f.fullName)}|${f.color}|${s.coins.floors[f.id]?.coins ?? 0}`)));
  const key = rows.join('\n');
  const tex = useCanvasTexture(PX.w, PX.h, (ctx) => paintScreen(ctx, rows), [key]);
  const s = KIOSK_SCREEN;
  return (
    // against the south wall, its screen facing north into the lobby
    <group ref={ref} position={[SHOP_KIOSK.x, 0, SHOP_KIOSK.z]} rotation={[0, Math.PI, 0]}>
      <mesh geometry={kioskModel()} material={vertexToon} castShadow receiveShadow>
        <Outlines thickness={0.018} color={INK} />
      </mesh>
      <group position={[0, s.y, s.z]} rotation={[s.tilt, 0, 0]}>
        <mesh position={[0, 0, 0.002]}>
          <planeGeometry args={[s.w, s.h]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
});
