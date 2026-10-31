// The whiteboard on the north wall: the floor's board (kanban.ts) on a big canvas, its frame and the marker tray. E on
// it opens the board's 2D view. Adapted from cubefarm client/src/world/KanbanBoard.tsx (MIT): the sticky notes people
// carry, the dependency strings and the stats corner are cut.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Floor } from '../../../shared/types';
import { kanbanFor, type KanbanCard } from '../kanban';
import { useStore } from '../store';
import { useCanvasTexture } from './canvasTexture';
import { CUT_PLANES } from './cutaway';
import { drawKanban } from './draw';
import { useInteractable } from './interact';
import { BOARD } from './layout';
import { toon } from './materials';
import { INK, Outlines } from './Outlines';

/** The board's canvas: 2560 pixels across, as tall as the board's shape. */
const BOARD_TEX = { w: 2560, h: Math.round((2560 * BOARD.h) / BOARD.w) };
// On the north wall, so it's cut away with it (cutaway.ts).
const FRAME = toon('#aab4c3', { cut: 'room' });
const FRAME_SIZE: [number, number, number] = [BOARD.w + 0.24, BOARD.h + 0.24, 0.06];
const TRAY_SIZE: [number, number, number] = [3.2, 0.05, 0.16];

export function KanbanBoard({ floor }: { floor: Floor }) {
  const workers = useStore((s) => s.workers);
  const qa = useStore((s) => s.qa);
  const usageState = useStore((s) => s.usage.state);
  const cols = useMemo(() => kanbanFor(floor, Object.values(workers), qa, { state: usageState }), [floor, workers, qa, usageState]);
  // Only repaint the big canvas when what's written on it changes.
  const signature = useMemo(
    () =>
      JSON.stringify([
        floor.fullName,
        floor.autoAssign,
        floor.lastSync ? Math.floor(floor.lastSync / 60000) : 0,
        ...(Object.values(cols) as KanbanCard[][]).map((list) => list.map((c) => [c.key, c.title, c.note, c.worker?.name, c.worker?.seed, c.tone])),
      ]),
    [cols, floor],
  );
  const tex = useCanvasTexture(BOARD_TEX.w, BOARD_TEX.h, (ctx) => drawKanban(ctx, BOARD_TEX.w, BOARD_TEX.h, floor, cols), [signature]);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, clippingPlanes: CUT_PLANES.room }), []);
  face.map = tex;
  const ref = useInteractable<THREE.Group>({ id: `board-${floor.id}`, label: 'Open the board', action: { kind: 'kanban', floorId: floor.id } }, 7);
  const cy = BOARD.y + BOARD.h / 2;
  return (
    <group ref={ref} position={[0, 0, BOARD.z]}>
      <mesh position={[0, cy, 0.03]} material={FRAME}>
        <boxGeometry args={FRAME_SIZE} />
        <Outlines thickness={0.018} color={INK} cut="room" />
      </mesh>
      <mesh position={[0, cy, 0.065]} material={face}>
        <planeGeometry args={[BOARD.w, BOARD.h]} />
      </mesh>
      <mesh position={[3.5, BOARD.y - 0.12, 0.1]} material={FRAME}>
        <boxGeometry args={TRAY_SIZE} />
      </mesh>
      {['#e63946', '#1d3557', '#2a9d8f'].map((c, i) => (
        <mesh key={c} position={[2.6 + i * 0.22, BOARD.y - 0.075, 0.12]} rotation={[0, 0, Math.PI / 2]} material={toon(c, { cut: 'room' })}>
          <cylinderGeometry args={[0.018, 0.018, 0.16, 12]} />
        </mesh>
      ))}
    </group>
  );
}
