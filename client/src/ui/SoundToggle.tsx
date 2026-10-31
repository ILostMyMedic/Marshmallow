// The sound button over the 3D view: a click mutes and unmutes (so does M), and the slider that opens beside it sets
// the volume; both are kept in this browser (ui/sfx.ts). New in Marshmallow: cubefarm keeps these in a settings panel.
import { useSyncExternalStore } from 'react';
import { getAudioPrefs, setAudioPrefs, subscribeAudio, toggleMute } from './sfx';

export function SoundToggle() {
  const prefs = useSyncExternalStore(subscribeAudio, getAudioPrefs);
  const silent = prefs.muted || prefs.volume === 0;
  return (
    <div className={`sound-toggle${silent ? ' muted' : ''}`}>
      {/* blurred after a click, so the game's keys (Space, Tab) don't land on the button */}
      <button
        onClick={(e) => {
          toggleMute();
          e.currentTarget.blur();
        }}
        title={prefs.muted ? 'Sound off: click or M to turn it on' : 'Sound on: click or M to mute'} aria-label={prefs.muted ? 'Unmute' : 'Mute'} aria-pressed={prefs.muted}>
        {silent ? '🔇' : prefs.volume < 40 ? '🔉' : '🔊'}
      </button>
      <input type="range" min={0} max={100} step={1} value={prefs.volume} onChange={(e) => setAudioPrefs({ volume: Number(e.target.value), muted: false })} onPointerUp={(e) => e.currentTarget.blur()} aria-label="Volume" title={`Volume ${prefs.volume}%`} />
    </div>
  );
}
