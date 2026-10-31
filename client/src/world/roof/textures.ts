// The roof's painted surfaces, drawn once on canvases: the paving, the decking's boards, the deck chairs' striped
// canvas, and the soft round glow the fire and the binoculars' lenses use. Made on first use and kept (the roof comes
// and goes; its textures are small).
// Adapted from cubefarm client/src/world/roof/textures.ts (MIT): the helipad and the windsock are cut, the glow is new.
import * as THREE from 'three';

const made = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = true) {
  let t = made.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  made.set(key, t);
  return t;
}

/** A seeded wobble, so the boards and pavers vary the same way every time. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** One 1.2 m paving slab, grout on two edges: tiles seamlessly. */
export const pavingTexture = () =>
  canvasTexture('paving', 256, 256, (ctx) => {
    ctx.fillStyle = '#d6d0c4';
    ctx.fillRect(0, 0, 256, 256);
    const r = rand(3);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(90,80,70,0.08)';
      ctx.fillRect(r() * 256, r() * 256, 2 + r() * 3, 2 + r() * 3);
    }
    ctx.fillStyle = '#b3ab9d';
    ctx.fillRect(0, 0, 256, 4);
    ctx.fillRect(0, 0, 4, 256);
  });

/** 1.2 m of decking: boards along x, 15 cm wide, with gaps, grain and staggered ends. */
export const deckingTexture = () =>
  canvasTexture('decking', 512, 512, (ctx) => {
    const r = rand(7);
    const board = 512 / 8;
    for (let i = 0; i < 8; i++) {
      const y = i * board;
      const shade = 150 + Math.floor(r() * 30);
      ctx.fillStyle = `rgb(${shade + 40},${shade - 20},${shade - 75})`;
      ctx.fillRect(0, y, 512, board);
      ctx.strokeStyle = 'rgba(80,40,10,0.18)';
      ctx.lineWidth = 2;
      for (let g = 0; g < 4; g++) {
        const gy = y + 8 + r() * (board - 16);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(170, gy + (r() - 0.5) * 8, 340, gy + (r() - 0.5) * 8, 512, gy);
        ctx.stroke();
      }
      ctx.fillStyle = '#5b3a24';
      ctx.fillRect(0, y, 512, 4); // the gap between boards
      const seam = (i % 2 ? 0.3 : 0.75) * 512;
      ctx.fillRect(seam, y, 4, board);
    }
  });

/** A deck chair's canvas: wide white stripes (the chair's colour comes from its vertex colours). */
export const stripeTexture = () =>
  canvasTexture('stripes', 128, 8, (ctx) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#c9c9c9';
      ctx.fillRect(i * 32, 0, 32, 8);
    }
  });

/** A soft white disc fading to nothing at its edge: a glow, tinted by its material. */
export const glowTexture = () =>
  canvasTexture(
    'glow',
    64,
    64,
    (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    },
    false,
  );

/** The lens mask's width to its height (the view's sides beyond it are plain black). */
export const LENS_ASPECT = 1.6;

/** What you see of the binoculars round the view: black, with two overlapping round lenses cut out of it, soft-edged. */
export const lensMaskTexture = () =>
  canvasTexture(
    'lens-mask',
    512,
    320,
    (ctx) => {
      const h = 320;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 512, h);
      ctx.globalCompositeOperation = 'destination-out';
      const r = h * 0.47;
      for (const cx of [256 - 0.31 * h, 256 + 0.31 * h]) {
        const g = ctx.createRadialGradient(cx, h / 2, r * 0.84, cx, h / 2, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, h / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    false,
  );
