// The desktop's Discussions app: threads the CEO opens to settle something with you before it plans or acts, and the
// workers' (and the CEO's) questions on GitHub issues, one thread per issue. The list puts what waits on you first;
// a thread shows its messages and a reply box. You resolve the CEO's threads (with how it was settled), and a reply to
// an issue thread answers its question on GitHub, as you; a playbook change the CEO proposes in a thread shows there as
// a card (PlaybookCard.tsx). Adapted from cubefarm client/src/ui/Phone.tsx's questions
// (MIT); the CEO's threads are new in Marshmallow.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DiscussionView } from '../../../../shared/types';
import { command } from '../../api';
import { useStore } from '../../store';
import { useCommand } from '../useCommand';
import { issueLines, issueThreads, itemWaiting, threadSections, withPlaybookCards, type IssueThread, type ThreadItem } from './desk';
import { PlaybookCard, playbookCardKey } from './PlaybookCard';
import { Bubble, Composer, Empty, shortWhen, TypingDots, useCeo, useFloorLabel, useNarrow, when } from './parts';

const oneLine = (s: string, n = 90) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** An issue's title, from its floor's open issues, else its number. */
function useIssueTitle() {
  const floors = useStore((s) => s.floors);
  return (t: IssueThread) => floors.find((f) => f.id === t.floorId)?.issues.find((i) => i.number === t.issueNumber)?.title ?? null;
}

function Item({ item, on, onPick }: { item: ThreadItem; on: boolean; onPick: () => void }) {
  const floorLabel = useFloorLabel();
  const issueTitle = useIssueTitle();
  const waiting = itemWaiting(item);
  let icon: string, title: string, sub: string, tag: string;
  if (item.kind === 'discussion') {
    const d = item.discussion;
    icon = d.status === 'resolved' ? '✅' : '🗣';
    title = d.title;
    const last = d.messages.at(-1);
    sub = d.replying ? 'typing…' : d.status === 'resolved' && d.outcome ? `Settled: ${oneLine(d.outcome)}` : last ? `${last.from === 'manager' ? 'You: ' : ''}${oneLine(last.text)}` : '';
    tag = floorLabel(d.floorId) || 'The office';
  } else {
    const t = item.thread;
    const last = t.questions.at(-1)!;
    const known = issueTitle(t);
    icon = t.pending ? '❓' : '✅';
    title = known ?? `Issue #${t.issueNumber}`;
    sub = t.pending ? `${t.pending.from}: ${oneLine(t.pending.text)}` : `You: ${oneLine(last.answer ?? '')}`;
    tag = known ? `#${t.issueNumber} · ${floorLabel(t.floorId)}` : floorLabel(t.floorId);
  }
  return (
    <li>
      <button className={`dt-item${on ? ' on' : ''}${waiting ? ' unread' : ''}`} onClick={onPick} aria-current={on}>
        <span className="dt-item-top">
          <span className="dt-item-title">
            <span aria-hidden>{icon} </span>
            {title}
          </span>
          <time>{shortWhen(item.at)}</time>
        </span>
        <span className="dt-item-tag">{tag}</span>
        <span className="dt-item-sub">
          <span className="dt-item-line">{sub}</span>
          {waiting && <span className="dt-dot" aria-label="Waiting on you" />}
        </span>
      </button>
    </li>
  );
}

function Section({ title, items, selected, onPick, hint }: { title: string; items: ThreadItem[]; selected: string | null; onPick: (k: string) => void; hint?: string }) {
  if (!items.length && !hint) return null;
  return (
    <>
      <h3 className="dt-side-h">
        {title} {items.length > 0 && <span className="dt-side-count">{items.length}</span>}
      </h3>
      {items.length ? (
        <ul className="dt-list">
          {items.map((i) => (
            <Item key={i.key} item={i} on={i.key === selected} onPick={() => onPick(i.key)} />
          ))}
        </ul>
      ) : (
        <p className="dt-side-empty">{hint}</p>
      )}
    </>
  );
}

function Resolve({ d }: { d: DiscussionView }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const { busy, error, run } = useCommand();
  if (!open)
    return (
      <button className="dt-btn" onClick={() => setOpen(true)} title="Mark it settled">
        ✅ Resolve
      </button>
    );
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation(); // not the desktop's Esc
    setOpen(false);
  };
  return (
    <form
      className="dt-resolve"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => command('POST', `/api/discussions/${d.id}/resolve`, outcome.trim() ? { outcome: outcome.trim() } : {})).then((ok) => ok && setOpen(false));
      }}
    >
      <input autoFocus value={outcome} onChange={(e) => setOutcome(e.target.value)} onKeyDown={onKey} placeholder="How was it settled? (optional)" aria-label="The outcome" />
      <button className="dt-btn dt-btn-go" disabled={busy}>
        Resolve
      </button>
      <button type="button" className="dt-btn dt-btn-ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <small className="dt-bad">{error}</small>}
    </form>
  );
}

/** A log that scrolls to its end whenever `deps` change (a new message, the typing dots). */
function useScrollToEnd(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, deps);
  return ref;
}

function DiscussionThread({ d, onBack }: { d: DiscussionView; onBack: () => void }) {
  const ceo = useCeo();
  const floorLabel = useFloorLabel();
  const name = ceo?.name ?? 'The CEO';
  const waiting = d.status === 'open' && d.messages.at(-1)?.from === 'ceo';
  const playbookCards = useStore((s) => s.playbook.proposals);
  const log = useScrollToEnd([d.id, d.messages.length, d.replying, d.status]);
  return (
    <section className="dt-main" aria-label={d.title}>
      <header className="dt-main-head">
        <button className="dt-back" onClick={onBack} aria-label="Back to the threads">
          ←
        </button>
        <div className="dt-grow">
          <h3 className="dt-main-title">🗣 {d.title}</h3>
          <div className="dt-muted">
            {name} opened it {when(d.openedAt)}
            {d.floorId && ` · ${floorLabel(d.floorId)}`}
          </div>
        </div>
        <span className={`dt-pill ${d.status === 'resolved' ? 'dt-pill-good' : waiting ? 'dt-pill-warn' : ''}`}>{d.status === 'resolved' ? 'Resolved' : waiting ? 'Waiting on you' : d.replying ? `${name} is replying` : 'Open'}</span>
        {d.status === 'open' && <Resolve key={d.id} d={d} />}
      </header>
      <div className="dt-log" ref={log} tabIndex={0} aria-label={`Messages in ${d.title}`}>
        {withPlaybookCards(d.messages, playbookCards, { kind: 'discussion', id: d.id }).map((e) =>
          e.kind === 'playbook' ? (
            <Bubble key={playbookCardKey(e.proposal)} from="ceo" who={name} text="" at={e.proposal.at}>
              <PlaybookCard p={e.proposal} />
            </Bubble>
          ) : (
            <Bubble key={e.message.id} from={e.message.from} who={e.message.from === 'ceo' ? name : 'You'} text={e.message.text} at={e.message.at} />
          ),
        )}
        {d.replying && <TypingDots name={name} />}
        {d.status === 'resolved' && (
          <div className="dt-outcome" role="note">
            <b>✅ Resolved</b>
            {d.outcome ? `: ${d.outcome}` : ''}
          </div>
        )}
      </div>
      <Composer
        key={d.id}
        send={(text) => command('POST', `/api/discussions/${d.id}/messages`, { text })}
        placeholder={`Reply to ${name}…`}
        label={`Reply to ${name}`}
        note={d.status === 'resolved' ? 'Settled. A reply opens it again.' : undefined}
      />
    </section>
  );
}

function IssueThreadView({ t, onBack }: { t: IssueThread; onBack: () => void }) {
  const floor = useStore((s) => s.floors.find((f) => f.id === t.floorId));
  const floorLabel = useFloorLabel();
  const title = useIssueTitle()(t);
  const url = t.url ?? (floor ? `${floor.url}/issues/${t.issueNumber}` : null);
  const lines = issueLines(t);
  const log = useScrollToEnd([t.key, lines.length]);
  return (
    <section className="dt-main" aria-label={`Issue #${t.issueNumber}`}>
      <header className="dt-main-head">
        <button className="dt-back" onClick={onBack} aria-label="Back to the threads">
          ←
        </button>
        <div className="dt-grow">
          <h3 className="dt-main-title">
            ❓ #{t.issueNumber}
            {title ? ` · ${title}` : ''}
          </h3>
          <div className="dt-muted">
            {floorLabel(t.floorId)} · {t.pending ? 'the issue waits on GitHub for your answer' : 'answered: the issue is back with the team'}
          </div>
        </div>
        <span className={`dt-pill ${t.pending ? 'dt-pill-warn' : 'dt-pill-good'}`}>{t.pending ? 'Waiting on you' : 'Answered'}</span>
        {url && (
          <a className="dt-btn dt-btn-ghost" href={url} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        )}
      </header>
      <div className="dt-log" ref={log} tabIndex={0} aria-label={`Questions on #${t.issueNumber}`}>
        {lines.map((l) => (
          <Bubble key={l.key} from={l.from} who={l.who} text={l.text} at={l.at} />
        ))}
      </div>
      {t.pending ? (
        <Composer
          key={t.pending.id}
          button="Answer"
          send={(text) => command('POST', `/api/questions/${t.pending!.id}/answer`, { text })}
          placeholder={`Answer ${t.pending.from}…`}
          label={`Answer ${t.pending.from}`}
          note={`Posted on #${t.issueNumber} as you; the issue goes back to the team with your answer.`}
        />
      ) : (
        <p className="dt-compose-done">All answered. New questions on this issue show up here.</p>
      )}
    </section>
  );
}

export function DiscussionsApp() {
  const discussions = useStore((s) => s.desk.discussions);
  const questions = useStore((s) => s.questions);
  const sections = threadSections(discussions, issueThreads(questions));
  const all = [...sections.waiting, ...sections.open, ...sections.resolved];
  // Opens on what waits on you, else the latest.
  const [selected, setSelected] = useState<string | null>(() => all[0]?.key ?? null);
  const [pane, setPane] = useState<'list' | 'main'>('list');
  const narrow = useNarrow();
  const item = all.find((i) => i.key === selected) ?? all[0];
  const pick = (k: string) => {
    setSelected(k);
    setPane('main');
  };
  if (!all.length)
    return (
      <div className="dt-solo">
        <Empty icon="🗣" title="Nothing to settle">
          When the CEO needs your call before it plans or acts, it opens a thread here. A worker who gets stuck on an issue asks on GitHub, and the question shows up here too, for you to
          answer.
        </Empty>
      </div>
    );
  return (
    <div className="dt-split dt-split-wide" data-pane={pane}>
      <aside className="dt-side" aria-label="Threads">
        <Section title="Waiting on you" items={sections.waiting} selected={item?.key ?? null} onPick={pick} hint="Nothing waits on you. 🎉" />
        <Section title="Open" items={sections.open} selected={item?.key ?? null} onPick={pick} />
        <Section title="Resolved" items={sections.resolved} selected={item?.key ?? null} onPick={pick} />
      </aside>
      {narrow && pane === 'list' ? null : item?.kind === 'discussion' ? (
        <DiscussionThread key={item.key} d={item.discussion} onBack={() => setPane('list')} />
      ) : item?.kind === 'issue' ? (
        <IssueThreadView key={item.key} t={item.thread} onBack={() => setPane('list')} />
      ) : null}
    </div>
  );
}
