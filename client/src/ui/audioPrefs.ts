// The saved sound settings (localStorage `marshmallow:audio`): the master volume and mute. Pure, so loading old or
// corrupt values is tested without a browser.
// Adapted from cubefarm client/src/ui/audioPrefs.ts (MIT): the per-group levels, the chatter level, the silent bubbles
// and the soundtrack are cut.

export interface AudioPrefs {
  /** 0-100. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { volume: 70, muted: false };

/** A 0-100 percentage, or the fallback when it's missing, not a number or out of range. */
function percent(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : fallback;
}

/** Any saved value as complete, in-range prefs. */
export function normalizeAudioPrefs(raw: unknown): AudioPrefs {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { volume: percent(p.volume, DEFAULT_AUDIO_PREFS.volume), muted: p.muted === true };
}

/** The prefs saved as JSON text (null when nothing is saved). */
export function parseAudioPrefs(text: string | null): AudioPrefs {
  try {
    return normalizeAudioPrefs(JSON.parse(text ?? 'null'));
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

/** Perceived loudness is roughly logarithmic, so a 0-100 slider maps to a squared 0-1 gain. */
export const sliderGain = (pct: number) => (pct / 100) ** 2;
