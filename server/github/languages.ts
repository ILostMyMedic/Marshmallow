// A repository's languages as the office keeps them on its floor: shares of the code that add up to 1, biggest first,
// the few that matter (a floor's posters are made from them). GitHub counts bytes per language; so does the demo.
import type { RepoLanguage } from '../../shared/types.ts';

/** Languages a floor keeps. */
export const MAX_LANGUAGES = 6;

/** Bytes per language (GitHub's `languages`) as shares, biggest first: at most `max`, rounded to 3 places, adding up to 1. */
export function languageShares(sizes: readonly { name: string; size: number }[], max = MAX_LANGUAGES): RepoLanguage[] {
  const kept = sizes
    .filter((l) => l.name && Number.isFinite(l.size) && l.size > 0)
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
    .slice(0, max);
  const total = kept.reduce((sum, l) => sum + l.size, 0);
  if (!total) return [];
  const out = kept.map((l): RepoLanguage => ({ name: l.name, share: Math.round((l.size / total) * 1000) / 1000 }));
  // Rounding can leave the sum a hair off 1: the biggest takes up the difference.
  const rest = out.slice(1).reduce((sum, l) => sum + l.share, 0);
  out[0].share = Math.round((1 - rest) * 1000) / 1000;
  return out;
}
