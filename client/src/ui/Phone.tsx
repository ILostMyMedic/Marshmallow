// The phone, on the desktop: the CEO's chat (or a way to hire one), the workers' questions to answer, and the office's
// notices. P or the HUD's Phone button takes it out, and again (or Esc) puts it away; tabs with something new carry a
// badge, kept per browser. Adapted from cubefarm client/src/ui/Phone.tsx (MIT); cut: team changes and the lobby nudge
// (no hire requests here), the company tab, mini-games, the voice (replay, hands-free, the mic), the holiday strip and
// Markdown (no new dependency: texts show as written).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { OfficeMessage, Question, Worker } from '../../../shared/types';
import { command } from '../api';
import { useStore } from '../store';
import { useView } from '../world/view';
import { MessageBox } from './MessageBox';
import { useCommand } from './useCommand';

type PhoneTab = 'chat' | 'questions' | 'notices';

/** "14:05" today, "3 Nov 14:05" before. */
function when(t: number) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

/** "floor 2", for a floor id. */
function useFloorLabel() {
  const floors = useStore((s) => s.floors);
  return (floorId: string | null) => {
    const f = floorId ? floors.find((x) => x.id === floorId) : undefined;
    return f ? `floor ${f.floor}` : '';
  };
}

// ---------- what's new, per browser ----------

const SEEN_KEY = 'marshmallow:phoneSeen';
type Seen = { chat: number; notices: number }; // the newest message seen on each tab (its `at`)

function loadSeen(): Seen {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Partial<Seen>;
    return { chat: Number(v.chat) || 0, notices: Number(v.notices) || 0 };
  } catch {
    return { chat: 0, notices: 0 };
  }
}

/** What you've seen, shared with the HUD's badge (usePhoneNews), so it drops as soon as a tab is read. */
const useSeen = create<{ seen: Seen; mark(tab: keyof Seen, at: number): void }>()((set, get) => ({
  seen: typeof window === 'undefined' ? { chat: 0, notices: 0 } : loadSeen(),
  mark(tab, at) {
    if (at <= get().seen[tab]) return;
    const seen = { ...get().seen, [tab]: at };
    set({ seen });
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch {
      // not saved: the badges come back on the next visit
    }
  },
}));

const count = (messages: OfficeMessage[], from: OfficeMessage['from'], since: number) => messages.filter((m) => m.from === from && m.at > since).length;

/** The CEO's texts and the office's notices you haven't seen on their tab; the open tab counts as seen. */
function useUnread(tab: PhoneTab) {
  const messages = useStore((s) => s.messages);
  const seen = useSeen((s) => s.seen);
  const mark = useSeen((s) => s.mark);
  useEffect(() => {
    if (tab === 'questions') return;
    const from = tab === 'chat' ? 'ceo' : 'office';
    mark(tab, messages.reduce((t, m) => (m.from === from && m.at > t ? m.at : t), 0));
  }, [tab, messages, mark]);
  return { chat: tab === 'chat' ? 0 : count(messages, 'ceo', seen.chat), notices: tab === 'notices' ? 0 : count(messages, 'office', seen.notices) };
}

/** What's new on the phone, for the HUD's badge: the questions waiting, and the CEO's texts and notices not yet read. */
export function usePhoneNews() {
  const messages = useStore((s) => s.messages);
  const questions = useStore((s) => s.questions.filter((q) => q.answer === null).length);
  const seen = useSeen((s) => s.seen);
  const chat = count(messages, 'ceo', seen.chat);
  const notices = count(messages, 'office', seen.notices);
  return { questions, chat, notices, total: questions + chat + notices };
}

// ---------- the CEO's chat ----------

const QUICK = ["What's everyone working on?", 'Should a team grow or shrink?'];

/** Where the CEO is, as a chat app would put it. */
function presence(ceo: Worker, replying: boolean) {
  if (ceo.status === 'working') return replying ? 'typing…' : `busy: ${ceo.activity?.detail || 'on a job'}`;
  if (ceo.status === 'preparing') return 'getting ready…';
  if (ceo.status === 'stopped') return 'stopped: reset them at their desk to hear back';
  if (ceo.status === 'error') return `needs help: ${ceo.lastError ?? 'their last job failed'}`;
  return 'available';
}

function Bubble({ m, ceoName }: { m: OfficeMessage; ceoName: string }) {
  const floorLabel = useFloorLabel();
  const mine = m.from === 'manager';
  const where = floorLabel(m.floorId);
  return (
    <div className={`phone-row${mine ? ' phone-row-me' : ''}`}>
      <div className={`phone-bubble ${mine ? 'phone-bubble-me' : 'phone-bubble-them'}`}>
        {!mine && <div className="phone-bubble-from">{ceoName}</div>}
        <div className="phone-bubble-text">{m.text}</div>
        <div className="phone-bubble-time">
          {where && `${where} · `}
          {when(m.at)}
        </div>
      </div>
    </div>
  );
}

function HireCeo() {
  const { busy, error, run } = useCommand();
  return (
    <div className="phone-hire">
      <p>
        <b>The corner office is empty.</b> A CEO answers your messages here, onboards new floors, plans your briefs into issues and sizes the teams. Each job is a Claude session.
      </p>
      <button className="phone-send" disabled={busy} onClick={() => void run(() => command('POST', '/api/ceo'))}>
        🧑‍💼 Hire a CEO
      </button>
      {error && (
        <p className="phone-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Chat() {
  const messages = useStore((s) => s.messages);
  const ceo = useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo'));
  const open = useView((s) => s.openOverlay);
  const { busy, error, run } = useCommand();
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const thread = messages.filter((m) => m.from !== 'office');
  // Working on what you last wrote: the dots, as if they were typing.
  const replying = ceo?.status === 'working' && thread.at(-1)?.from === 'manager';
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, replying]);

  const send = async (t: string) => {
    const body = t.trim();
    if (!body) return;
    if (await run(() => command('POST', '/api/ceo/message', { text: body }))) setText('');
  };
  const name = ceo?.name ?? 'CEO';
  return (
    <div className="phone-chat">
      <div className="phone-chat-head">
        <span className="phone-avatar">{ceo ? name[0] : '?'}</span>
        <div className="phone-grow">
          <b>{ceo ? name : 'No CEO'}</b> {ceo && <span className="phone-muted">CEO</span>}
          {ceo && <div className={ceo.status === 'working' ? 'phone-busy' : 'phone-muted'}>{presence(ceo, replying)}</div>}
        </div>
        {ceo && (
          <button className="phone-link" title={`${name}'s desk: their terminal and setup`} onClick={() => open({ kind: 'terminal', workerId: ceo.id })}>
            🖥 Desk
          </button>
        )}
      </div>
      <div className="phone-log" ref={scroller} tabIndex={0} aria-label={`Messages with ${name}`}>
        {thread.length === 0 && ceo && <p className="phone-empty">Say hi to {name}. Ask how things are going, ask them to close an issue, or whether a floor's team should grow. Replies land here.</p>}
        {thread.map((m) => (
          <Bubble key={m.id} m={m} ceoName={name} />
        ))}
        {replying && (
          <div className="phone-row">
            <div className="phone-bubble phone-bubble-them phone-typing" aria-label={`${name} is typing`}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
      {!ceo ? (
        <HireCeo />
      ) : (
        <>
          <div className="phone-quick">
            {QUICK.map((q) => (
              <button key={q} className="phone-chip" disabled={busy} onClick={() => void send(q)}>
                {q}
              </button>
            ))}
          </div>
          <form
            className="phone-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <MessageBox value={text} onChange={setText} placeholder={`Message ${name}…`} aria-label={`Message ${name}`} title="Enter sends · Shift+Enter adds a line" />
            <button className="phone-send" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
          {error && (
            <p className="phone-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- the workers' questions ----------

function QuestionCard({ q }: { q: Question }) {
  const floor = useStore((s) => s.floors.find((f) => f.id === q.floorId));
  const { busy, error, run } = useCommand();
  const [text, setText] = useState('');
  const url = q.url ?? (floor ? `${floor.url}/issues/${q.issueNumber}` : null);
  const answer = async () => {
    const body = text.trim();
    if (body && (await run(() => command('POST', `/api/questions/${q.id}/answer`, { text: body })))) setText('');
  };
  return (
    <article className="phone-card">
      <div className="phone-card-head">
        <b>{q.from}</b>
        <span className="phone-muted">
          {floor ? `floor ${floor.floor}` : q.floorId} · #{q.issueNumber} · {when(q.askedAt)}
        </span>
      </div>
      <p className="phone-quote">{q.text}</p>
      {q.answer === null ? (
        <form
          className="phone-input phone-input-card"
          onSubmit={(e) => {
            e.preventDefault();
            void answer();
          }}
        >
          <MessageBox value={text} onChange={setText} placeholder="Your answer (posted on the issue, as you)" aria-label={`Answer ${q.from}`} title="Enter sends · Shift+Enter adds a line" />
          <button className="phone-send" disabled={busy || !text.trim()}>
            Answer
          </button>
        </form>
      ) : (
        <p className="phone-answer">
          <span className="phone-muted">You{q.answeredAt ? `, ${when(q.answeredAt)}` : ''}:</span> {q.answer}
        </p>
      )}
      {error && (
        <p className="phone-error" role="alert">
          {error}
        </p>
      )}
      {url && (
        <a className="phone-muted" href={url} target="_blank" rel="noreferrer">
          On GitHub ↗
        </a>
      )}
    </article>
  );
}

function Questions() {
  const questions = useStore((s) => s.questions);
  const open = questions.filter((q) => q.answer === null);
  const answered = questions.filter((q) => q.answer !== null).reverse();
  return (
    <div className="phone-scroll">
      <h3 className="phone-h">❓ Waiting on you</h3>
      {open.length === 0 && <p className="phone-empty">Nothing waiting. When a worker can't go on without you, they ask on the issue, and the question comes here for your answer.</p>}
      {open.map((q) => (
        <QuestionCard key={q.id} q={q} />
      ))}
      {answered.length > 0 && <h3 className="phone-h">Answered</h3>}
      {answered.map((q) => (
        <QuestionCard key={q.id} q={q} />
      ))}
    </div>
  );
}

// ---------- the office's notices ----------

function Notices() {
  const messages = useStore((s) => s.messages);
  const floorLabel = useFloorLabel();
  const notices = messages.filter((m) => m.from === 'office').reverse();
  return (
    <div className="phone-scroll">
      <h3 className="phone-h">🔔 From the office</h3>
      {notices.length === 0 && <p className="phone-empty">Nothing yet. PRs that need you, merges GitHub refuses and Claude's usage warnings come here.</p>}
      <ul className="phone-notices">
        {notices.map((m) => (
          <li key={m.id}>
            <span className="phone-muted">
              {when(m.at)}
              {m.floorId && ` · ${floorLabel(m.floorId) || m.floorId}`}
            </span>
            <div className="phone-bubble-text">{m.text}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- the phone ----------

export function Phone() {
  const close = useView((s) => s.closeOverlay);
  const waiting = useStore((s) => s.questions.filter((q) => q.answer === null).length);
  // Questions waiting are why you'd take it out: it opens on them.
  const [tab, setTab] = useState<PhoneTab>(() => (useStore.getState().questions.some((q) => q.answer === null) ? 'questions' : 'chat'));
  const unread = useUnread(tab);
  const ceoName = useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo')?.name ?? 'CEO');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  // Esc puts it away from anywhere, a text box included (P does too, through OfficeKeys, outside one).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const tabs: [PhoneTab, string, string, number][] = [
    ['chat', '💬', ceoName, unread.chat],
    ['questions', '❓', 'Questions', waiting],
    ['notices', '🔔', 'Notices', unread.notices],
  ];
  return (
    <div className="panel-backdrop phone-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="phone" role="dialog" aria-modal="true" aria-label="Your phone">
        <div className="phone-status" aria-hidden>
          <span>{when(now)}</span>
          <span className="phone-notch" />
          <span>📶 🔋</span>
        </div>
        <div className="phone-screen">
          {tab === 'chat' && <Chat />}
          {tab === 'questions' && <Questions />}
          {tab === 'notices' && <Notices />}
        </div>
        <nav className="phone-tabs" role="tablist" aria-label="Phone">
          {tabs.map(([k, icon, label, badge]) => (
            <button key={k} role="tab" aria-selected={tab === k} aria-label={badge > 0 ? `${label}, ${badge} new` : label} className={`phone-tab${tab === k ? ' phone-tab-on' : ''}`} onClick={() => setTab(k)}>
              <span className="phone-tab-icon" aria-hidden>
                {icon}
                {badge > 0 && <span className="phone-badge">{badge}</span>}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="phone-hint">
          <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>P</kbd> or <kbd>Esc</kbd> to put it away
        </div>
      </section>
    </div>
  );
}
