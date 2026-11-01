// What the desktop's apps share: times, the CEO and where they are, chat bubbles, the typing dots, a message box with
// its Send button, and the hire-a-CEO card. Adapted from cubefarm client/src/ui/Phone.tsx (MIT).
import { useEffect, useState, type ReactNode } from 'react';
import type { Worker } from '../../../../shared/types';
import { command } from '../../api';
import { useStore } from '../../store';
import { MessageBox } from '../MessageBox';
import { useCommand } from '../useCommand';

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "14:05" today, "3 Nov 14:05" before. */
export function when(t: number) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay(d, new Date()) ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

/** "14:05" today, "3 Nov" before: for lists. */
export function shortWhen(t: number) {
  const d = new Date(t);
  return sameDay(d, new Date()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Where desktop.css shows one pane at a time (keep the two in step). */
const NARROW = '(max-width: 760px)';

/** Whether the screen is narrow enough for one pane at a time: the hidden one then isn't drawn (or read) at all. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** The office's CEO, if it has one. */
export const useCeo = () => useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo'));

/** "floor 2 · pixel-todo", for a floor id ('' when there's none). */
export function useFloorLabel() {
  const floors = useStore((s) => s.floors);
  return (floorId: string | null) => {
    if (!floorId) return '';
    const f = floors.find((x) => x.id === floorId);
    return f ? `floor ${f.floor} · ${f.fullName.split('/').pop()}` : floorId;
  };
}

/** Where the CEO is, as a chat app would put it; `replying`: they have a job for this conversation. */
export function presence(ceo: Worker, replying: boolean) {
  if (replying) return ceo.status === 'stopped' || ceo.status === 'error' ? 'will reply once they’re back' : 'typing…';
  if (ceo.status === 'working') return `busy: ${ceo.activity?.detail || 'on a job'}`;
  if (ceo.status === 'preparing') return 'getting ready…';
  if (ceo.status === 'stopped') return 'stopped: reset them at their desk to hear back';
  if (ceo.status === 'error') return `needs help: ${ceo.lastError ?? 'their last job failed'}`;
  return 'available';
}

export function Avatar({ name, tone = 'ceo' }: { name: string; tone?: 'ceo' | 'worker' | 'me' }) {
  return (
    <span className={`dt-avatar dt-avatar-${tone}`} aria-hidden>
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

/** One message: yours on the right, the CEO's (or a worker's) on the left, the office's own lines in the middle. */
export function Bubble({ from, who, text, at, children }: { from: 'manager' | 'ceo' | 'office' | 'asker'; who: string; text: string; at: number; children?: ReactNode }) {
  if (from === 'office')
    return (
      <div className="dt-row dt-row-office">
        <div className="dt-office-line">
          <span aria-hidden>🏢</span> <span className="dt-text">{text}</span> <time>{when(at)}</time>
        </div>
        {children}
      </div>
    );
  const mine = from === 'manager';
  return (
    <div className={`dt-row${mine ? ' dt-row-me' : ''}`}>
      {!mine && <Avatar name={who} tone={from === 'ceo' ? 'ceo' : 'worker'} />}
      <div className="dt-row-col">
        {text && (
          <div className={`dt-bubble ${mine ? 'dt-bubble-me' : 'dt-bubble-them'}`}>
            {!mine && <div className="dt-bubble-from">{who}</div>}
            <div className="dt-text">{text}</div>
            <time className="dt-bubble-time">{when(at)}</time>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function TypingDots({ name }: { name: string }) {
  return (
    <div className="dt-row">
      <Avatar name={name} />
      <div className="dt-bubble dt-bubble-them dt-typing" role="status" aria-label={`${name} is typing`}>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/**
 * A message box and its button: Enter sends, Shift+Enter adds a line. `send` gets the trimmed text; the box empties
 * once the server takes it, and a refusal shows under it. Pass `value`/`onChange` to hold the text outside.
 */
export function Composer({
  send,
  placeholder,
  label,
  button = 'Send',
  disabled = false,
  value,
  onChange,
  note,
}: {
  send: (text: string) => Promise<unknown>;
  placeholder: string;
  label: string;
  button?: string;
  disabled?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  note?: ReactNode;
}) {
  const { busy, error, run } = useCommand();
  const [own, setOwn] = useState('');
  const text = value ?? own;
  const setText = onChange ?? setOwn;
  return (
    <div className="dt-compose">
      {note && <div className="dt-compose-note">{note}</div>}
      <form
        className="dt-compose-row"
        onSubmit={(e) => {
          e.preventDefault();
          const body = text.trim();
          if (body) void run(() => send(body)).then((ok) => ok && setText(''));
        }}
      >
        <MessageBox value={text} onChange={setText} placeholder={placeholder} aria-label={label} title="Enter sends · Shift+Enter adds a line" disabled={disabled} />
        <button className="dt-send" disabled={disabled || busy || !text.trim()}>
          {button}
        </button>
      </form>
      {error && (
        <p className="dt-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function HireCeo({ what }: { what: string }) {
  const { busy, error, run } = useCommand();
  return (
    <div className="dt-hire">
      <div className="dt-hire-icon" aria-hidden>
        🧑‍💼
      </div>
      <div>
        <p>
          <b>The corner office is empty.</b> {what} Each job is a Claude session.
        </p>
        <button className="dt-send" disabled={busy} onClick={() => void run(() => command('POST', '/api/ceo'))}>
          Hire a CEO
        </button>
        {error && (
          <p className="dt-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** A list's empty state, or an app's. */
export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="dt-empty">
      <div className="dt-empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
