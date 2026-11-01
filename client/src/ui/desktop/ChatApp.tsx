// The desktop's Chat app: a conversation with the CEO per idea, each with its own context. The sidebar lists them,
// the most recent first; "New chat" starts one with your first message. The CEO helps shape the idea, and when the plan
// is ready it puts a project card in the chat (ProjectCard.tsx). Adapted from cubefarm client/src/ui/Phone.tsx's chat
// (MIT): one chat became many, and the quick questions became idea starters.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatView } from '../../../../shared/types';
import { command } from '../../api';
import { useStore } from '../../store';
import { useView } from '../../world/view';
import { ConfirmButton } from '../console/fields';
import { useCommand } from '../useCommand';
import { chatLaunched, chatUnread, lastCeoAt, lastLine, proposalOf, sortChats } from './desk';
import { ProjectCard, proposalKey } from './ProjectCard';
import { Avatar, Bubble, Composer, Empty, HireCeo, presence, shortWhen, TypingDots, useCeo, useNarrow } from './parts';
import { useDeskSeen } from './seen';

const STARTERS = ['A recipe box with a shopping list', 'A pixel-art todo app', 'A tiny weather dashboard for my city'];
const HIRE_WHAT = 'A CEO talks your ideas through here, proposes them as projects, plans briefs into issues and sizes the teams.';

/** The chat's title, renamed in place: click it, type, Enter (or click away) saves, Esc keeps the old one. */
function Title({ chat }: { chat: ChatView }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(chat.title);
  const { busy, error, run } = useCommand();
  // Enter, Esc or a click away settles an edit once: the blur that follows Enter or Esc doesn't save it again.
  const settled = useRef(false);
  useEffect(() => {
    if (!editing) setText(chat.title);
  }, [chat.title, editing]);
  const save = async () => {
    if (settled.current) return;
    settled.current = true;
    const title = text.trim();
    if (!title || title === chat.title) return setEditing(false);
    if (await run(() => command('PATCH', `/api/chats/${chat.id}`, { title }))) setEditing(false);
    else settled.current = false; // refused: the box stays, with why
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // not the desktop's Esc
      settled.current = true;
      setEditing(false);
    }
  };
  if (editing)
    return (
      <span className="dt-title-edit">
        <input autoFocus value={text} maxLength={120} readOnly={busy} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => void save()} aria-label="The chat's title" />
        {error && <small className="dt-bad">{error}</small>}
      </span>
    );
  return (
    <button
      className="dt-title"
      title="Rename it"
      onClick={() => {
        settled.current = false;
        setEditing(true);
      }}
    >
      {chat.title || 'Untitled chat'} <span aria-hidden>✏️</span>
    </button>
  );
}

function Conversation({ chat, onBack, onDeleted }: { chat: ChatView; onBack: () => void; onDeleted: () => void }) {
  const ceo = useCeo();
  const proposals = useStore((s) => s.desk.proposals);
  const open = useView((s) => s.openOverlay);
  const markChat = useDeskSeen((s) => s.markChat);
  const del = useCommand();
  const scroller = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const name = ceo?.name ?? 'CEO';
  const seenAt = lastCeoAt(chat);
  useEffect(() => markChat(chat.id, seenAt), [chat.id, seenAt, markChat]);
  // The end of the conversation, as chats go; but a project card waiting for you shows from its top: when the chat
  // opens, or when the CEO has just put one down.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const card = opened.current ? chat.messages.at(-1)?.proposalId : proposals.find((p) => p.chatId === chat.id && p.status === 'pending')?.id;
    opened.current = true;
    const top = card == null ? null : el.querySelector<HTMLElement>(`[data-proposal="${card}"]`)?.offsetTop;
    if (top != null && top < el.scrollTop) el.scrollTop = top - 12;
  }, [chat.id, chat.messages.length, chat.replying]);
  return (
    <section className="dt-main" aria-label={chat.title}>
      <header className="dt-main-head">
        <button className="dt-back" onClick={onBack} aria-label="Back to the chats">
          ←
        </button>
        <Avatar name={name} />
        <div className="dt-grow">
          <Title chat={chat} />
          <div className={ceo && chat.replying ? 'dt-busy' : 'dt-muted'}>{ceo ? `${name} · ${presence(ceo, chat.replying)}` : 'No CEO: hire one to carry on'}</div>
        </div>
        {ceo && (
          <button className="dt-btn dt-btn-ghost" title={`${name}'s desk: their terminal and setup`} onClick={() => open({ kind: 'terminal', workerId: ceo.id })}>
            🖥 Desk
          </button>
        )}
        <ConfirmButton question="Delete this chat?" confirm="Delete" disabled={del.busy} title="Delete the chat and its context" onConfirm={() => void del.run(() => command('DELETE', `/api/chats/${chat.id}`)).then((ok) => ok && onDeleted())}>
          🗑
        </ConfirmButton>
      </header>
      {del.error && (
        <p className="dt-error dt-pad" role="alert">
          {del.error}
        </p>
      )}
      <div className="dt-log" ref={scroller} tabIndex={0} aria-label={`Messages in ${chat.title}`}>
        {chat.messages.length === 0 && <p className="dt-log-empty">Nothing here yet. Tell {name} what you have in mind.</p>}
        {chat.messages.map((m) => {
          const p = proposalOf(m, proposals);
          return (
            <Bubble key={m.id} from={m.from} who={m.from === 'ceo' ? name : 'You'} text={m.text} at={m.at}>
              {p && <ProjectCard key={proposalKey(p)} p={p} />}
            </Bubble>
          );
        })}
        {chat.replying && <TypingDots name={name} />}
      </div>
      {ceo ? (
        <Composer key={chat.id} send={(text) => command('POST', `/api/chats/${chat.id}/messages`, { text })} placeholder={`Message ${name}…`} label={`Message ${name}`} />
      ) : (
        <HireCeo what={HIRE_WHAT} />
      )}
    </section>
  );
}

/** A new chat: nothing is made until you send the first message. */
function NewChat({ onCreated, onBack, hasChats }: { onCreated: (id: number) => void; onBack: () => void; hasChats: boolean }) {
  const ceo = useCeo();
  const [text, setText] = useState('');
  const name = ceo?.name ?? 'your CEO';
  return (
    <section className="dt-main dt-main-new" aria-label="New chat">
      {hasChats && (
        <header className="dt-main-head dt-main-head-bare">
          <button className="dt-back" onClick={onBack} aria-label="Back to the chats">
            ←
          </button>
        </header>
      )}
      <div className="dt-new">
        <Empty icon="💡" title="What are we building next?">
          Tell {name} about an idea. They’ll ask what they need to know, and when the plan is ready they’ll put a project card here: the repository, the brief, the team and the first
          tasks. Nothing starts until you approve it.
        </Empty>
        {ceo ? (
          <>
            <div className="dt-starters">
              {STARTERS.map((s) => (
                <button key={s} className="dt-chip-btn" onClick={() => setText(s)}>
                  {s}
                </button>
              ))}
            </div>
            <Composer
              value={text}
              onChange={setText}
              button="Start chat"
              placeholder={`Describe your idea to ${name}…`}
              label="Your idea"
              send={async (t) => {
                const chat = (await command('POST', '/api/chats', { text: t })) as Partial<ChatView> | undefined;
                if (typeof chat?.id === 'number') onCreated(chat.id);
              }}
            />
          </>
        ) : (
          <HireCeo what={HIRE_WHAT} />
        )}
      </div>
    </section>
  );
}

export function ChatApp() {
  const desk = useStore((s) => s.desk);
  const seen = useDeskSeen((s) => s.seen.chats);
  const chats = sortChats(desk.chats);
  // Opens on the first chat with a reply you haven't read, else the latest; a new one when there are none.
  const [selected, setSelected] = useState<number | 'new'>(() => {
    const all = sortChats(useStore.getState().desk.chats);
    const s = useDeskSeen.getState().seen.chats;
    return (all.find((c) => chatUnread(c, s[c.id])) ?? all[0])?.id ?? 'new';
  });
  // On a narrow screen one pane shows at a time: the list, or the conversation.
  const [pane, setPane] = useState<'list' | 'main'>(() => (useStore.getState().desk.chats.length ? 'list' : 'main'));
  const narrow = useNarrow();
  const chat = selected === 'new' ? undefined : chats.find((c) => c.id === selected);
  const pick = (id: number | 'new') => {
    setSelected(id);
    setPane('main');
  };
  return (
    <div className="dt-split" data-pane={pane}>
      <aside className="dt-side" aria-label="Chats">
        <button className={`dt-new-btn${!chat ? ' on' : ''}`} onClick={() => pick('new')}>
          ✏️ New chat
        </button>
        {chats.length === 0 ? (
          <p className="dt-side-empty">Your chats with the CEO land here, one per idea.</p>
        ) : (
          <ul className="dt-list">
            {chats.map((c) => {
              const unread = c.id !== chat?.id && chatUnread(c, seen[c.id]);
              return (
                <li key={c.id}>
                  <button className={`dt-item${c.id === chat?.id ? ' on' : ''}${unread ? ' unread' : ''}`} onClick={() => pick(c.id)} aria-current={c.id === chat?.id}>
                    <span className="dt-item-top">
                      <span className="dt-item-title">
                        {chatLaunched(c, desk.proposals) && (
                          <span title="Started a floor" aria-label="Started a floor">
                            🚀{' '}
                          </span>
                        )}
                        {c.title || 'Untitled chat'}
                      </span>
                      <time>{shortWhen(c.updatedAt)}</time>
                    </span>
                    <span className="dt-item-sub">
                      <span className="dt-item-line">{c.replying ? <i>typing…</i> : lastLine(c)}</span>
                      {unread && <span className="dt-dot" aria-label="New reply" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      {narrow && pane === 'list' ? null : chat ? (
        <Conversation key={chat.id} chat={chat} onBack={() => setPane('list')} onDeleted={() => pick('new')} />
      ) : (
        <NewChat onCreated={pick} onBack={() => setPane('list')} hasChats={chats.length > 0} />
      )}
    </div>
  );
}
