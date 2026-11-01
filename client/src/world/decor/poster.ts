// A repo poster's design, decided from the floor's repository (pure, so it's tested): the seed is the floor and the spot,
// so the same poster looks the same every time, two posters on one floor differ (each wall spot takes the next style)
// and no two floors look alike (their colour, name and languages). It picks an art style, a palette from the floor's
// colour and its languages' GitHub colours, the repo's short name for the title and a legend of its languages.
// posterPaint.ts paints it. New in Marshmallow.
import type { RepoLanguage } from '../../../../shared/types';

export type PosterStyle = 'bauhaus' | 'waves' | 'sunburst' | 'pixels' | 'blocks' | 'topo' | 'rainbow' | 'dots';
export const POSTER_STYLES: readonly PosterStyle[] = ['bauhaus', 'waves', 'sunburst', 'pixels', 'blocks', 'topo', 'rainbow', 'dots'];

/** FNV-1a: a string's 32-bit hash. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** A small seeded random number generator (mulberry32): numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- colours ----------

/** GitHub's colours for the languages a repository is likely to have (github-linguist's languages.yml). */
export const LANGUAGE_COLORS: Readonly<Record<string, string>> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572a5',
  Go: '#00add8',
  Rust: '#dea584',
  Java: '#b07219',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#555555',
  Ruby: '#701516',
  PHP: '#4f5d95',
  Dart: '#00b4ab',
  Scala: '#c22d40',
  Elixir: '#6e4a7e',
  Haskell: '#5e5086',
  Lua: '#000080',
  Zig: '#ec915c',
  HTML: '#e34c26',
  CSS: '#663399',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  MDX: '#fcb32c',
  Shell: '#89e051',
  PowerShell: '#012456',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  Nix: '#7e7eff',
  HCL: '#844fba',
  'Jupyter Notebook': '#da5b0b',
  R: '#198ce7',
  Julia: '#a270ba',
  Clojure: '#db5855',
  OCaml: '#ef7a08',
  Erlang: '#b83998',
  Gleam: '#ffaff3',
  Perl: '#0298c3',
  'Objective-C': '#438eff',
  PLpgSQL: '#336790',
  TSQL: '#e38c00',
};

const BY_LOWER = new Map(Object.entries(LANGUAGE_COLORS).map(([k, v]) => [k.toLowerCase(), v]));

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
const toHex = ([r, g, b]: number[]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** A #rrggbb (or #rgb) colour's channels, 0-255; grey for anything else. */
export function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Blends two colours: t = 0 gives a, 1 gives b. */
export function blend(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** A colour's relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** An HSL colour (h in degrees, s and l 0-1) as #rrggbb. */
function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** A language's GitHub colour; one made from its name's hash for a language the map doesn't know. */
export function languageColor(name: string): string {
  return BY_LOWER.get(name.trim().toLowerCase()) ?? hsl(hashString(name.trim().toLowerCase()) % 360, 0.62, 0.55);
}

// ---------- the legend ----------

export interface LegendRow {
  name: string;
  /** Its share of the code, 0-1, and as a whole percentage (the rows' add up to 100). */
  share: number;
  pct: number;
  color: string;
}

const OTHER = '#8b949e';

/**
 * The languages to show: the biggest `max` (shares normalised, nothing at 0), the rest as "Other", each with a whole
 * percentage (largest remainders, so they add up to 100). An empty list for a repository GitHub knows no languages of.
 */
export function legendOf(languages: readonly RepoLanguage[] | undefined, max = 4): LegendRow[] {
  const langs = (languages ?? []).filter((l) => l.share > 0 && l.name).sort((a, b) => b.share - a.share);
  const total = langs.reduce((n, l) => n + l.share, 0);
  if (!total) return [];
  const top = langs.slice(0, langs.length > max ? max - 1 : max).map((l) => ({ name: l.name, share: l.share / total, color: languageColor(l.name) }));
  const rest = langs.slice(top.length).reduce((n, l) => n + l.share, 0) / total;
  if (rest > 0) top.push({ name: 'Other', share: rest, color: OTHER });
  const raw = top.map((r) => r.share * 100);
  const pct = raw.map(Math.floor);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  const missing = 100 - pct.reduce((n, v) => n + v, 0);
  for (let k = 0; k < missing; k++) pct[order[k % order.length][1]]++;
  return top.map((r, i) => ({ ...r, pct: pct[i] }));
}

// ---------- the plan ----------

/** The repo's name without its owner. */
export const shortName = (fullName: string) => fullName.split('/').pop() || fullName;

export interface PosterInput {
  floorId: string;
  spot: string;
  fullName: string;
  /** The floor's colour. */
  color: string;
  floor: number;
  languages?: readonly RepoLanguage[];
}

export interface PosterPalette {
  /** The paper behind it all, the type on it, and the art's colours (the floor's first). */
  bg: string;
  ink: string;
  accents: string[];
}

export interface PosterPlan {
  seed: number;
  style: PosterStyle;
  title: string;
  owner: string;
  floor: number;
  palette: PosterPalette;
  legend: LegendRow[];
  /** A dark poster or a light one. */
  dark: boolean;
  /** Seeded knobs the styles read: a turn (radians), a count and a shift, each the same every time. */
  turn: number;
  count: number;
  shift: number;
}

/** Which wall spot it is (wall-1 is 0), so the spots on one floor take styles in turn. */
const wallIndex = (spot: string) => {
  const m = /(\d+)$/.exec(spot);
  return m ? Number(m[1]) - 1 : hashString(spot);
};

/** The style for a floor's poster in `spot`: the floor's own starting style, then the next one for each spot along. */
export const styleOf = (floorId: string, spot: string): PosterStyle => POSTER_STYLES[(hashString(floorId) + wallIndex(spot)) % POSTER_STYLES.length];

/** The palette: the floor's colour and its languages' first, then lighter, darker and a seeded turn of the floor's colour. */
export function paletteOf(color: string, legend: readonly LegendRow[], dark: boolean, rand: () => number): PosterPalette {
  const accents = [color, ...legend.filter((r) => r.name !== 'Other').map((r) => r.color)];
  const extra = [blend(color, '#ffffff', 0.45), blend(color, '#000000', 0.35), hsl(Math.floor(rand() * 360), 0.7, 0.6), '#ffd166'];
  for (const c of extra) if (accents.length < 5 && !accents.includes(c)) accents.push(c);
  const bg = dark ? blend('#16151f', color, 0.18) : blend('#fbf6ec', color, 0.1);
  return { bg, ink: dark ? '#fbf6ec' : '#1f1d2b', accents };
}

/** Everything a poster needs to be painted the same way every time. */
export function posterPlan(p: PosterInput): PosterPlan {
  const seed = hashString(`${p.floorId}|${p.spot}`);
  const rand = rng(seed);
  const legend = legendOf(p.languages);
  const dark = rand() < 0.5;
  return {
    seed,
    style: styleOf(p.floorId, p.spot),
    title: shortName(p.fullName),
    owner: p.fullName.includes('/') ? p.fullName.split('/')[0] : '',
    floor: p.floor,
    palette: paletteOf(p.color, legend, dark, rand),
    legend,
    dark,
    turn: rand() * Math.PI * 2,
    count: 3 + Math.floor(rand() * 4),
    shift: rand(),
  };
}
