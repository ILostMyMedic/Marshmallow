// How the lab splits its view into one cell per design: the grid whose cells come closest to the shape that frames a
// figure at its desk. Pure.

/** Width over height of the cell a figure and its desk fill best. */
export const CELL_ASPECT = 0.95;

export interface Grid {
  cols: number;
  rows: number;
}

/** The columns and rows for `n` cells in a `width` × `height` view. */
export function gridFor(n: number, width: number, height: number): Grid {
  if (n <= 1) return { cols: 1, rows: 1 };
  let best: Grid = { cols: n, rows: 1 };
  let score = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // closest to the wanted shape, on a log scale so too wide and too tall weigh the same; empty cells cost a little
    const aspect = width / cols / (height / rows);
    const s = Math.abs(Math.log(aspect / CELL_ASPECT)) + (cols * rows - n) * 0.08;
    if (s < score) {
      score = s;
      best = { cols, rows };
    }
  }
  return best;
}

/** Cell i's rectangle (CSS pixels, from the top left). */
export function cellRect(i: number, g: Grid, width: number, height: number) {
  const w = width / g.cols;
  const h = height / g.rows;
  return { x: (i % g.cols) * w, y: Math.floor(i / g.cols) * h, w, h };
}
