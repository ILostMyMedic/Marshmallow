// What the guide at the front desk tells you: today's status in a few numbers, and a tour of the building, a stop per
// floor (each repo floor, then the CEO's office with its milestones and awards wall, and the roof terrace, then back in
// the lobby with what the office has shipped and won), each with a card for your screen and short lines for the
// guide's speech bubbles. Pure: from the office's state, so it's tested; TourGuide.tsx runs the tour.
import type { Floor, QaRecord, RecordsView, Worker } from '../../../shared/types';
import { isCompanyMilestone, wonOf } from '../ui/awards/awards';
import { CEO_FLOOR, LOBBY, ROOF } from './floors';

export interface Office {
  floors: readonly Floor[];
  workers: Record<string, Worker>;
  qa: Record<string, QaRecord>;
  /** From the office database: the company's total and the trophies, for the lobby. */
  records?: Pick<RecordsView, 'total' | 'trophies'>;
}

export interface Today {
  merged: number;
  opened: number;
  /** Open issues filed today. */
  filed: number;
  inQa: number;
  working: number;
  team: number;
  floors: number;
}

const busy = (w: Worker) => w.status === 'working' || w.status === 'preparing';
const sameDay = (iso: string | null | undefined, dayStart: number) => !!iso && Date.parse(iso) >= dayStart;
/** Midnight before `now`, local time. */
export const dayStart = (now: number) => new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();

/** Today in numbers, from the floors' PRs and issues, the QA records and who's busy. */
export function todayStatus(o: Office, now: number): Today {
  const start = dayStart(now);
  const team = Object.values(o.workers).filter((w) => w.role !== 'ceo');
  let merged = 0;
  let opened = 0;
  let filed = 0;
  for (const f of o.floors) {
    for (const p of f.pulls) {
      if (p.state === 'MERGED' && sameDay(p.mergedAt, start)) merged++;
      if (sameDay(p.createdAt, start)) opened++;
    }
    for (const i of f.issues) if (sameDay(i.createdAt, start)) filed++;
  }
  const inQa = Object.values(o.qa).filter((q) => q.status === 'queued' || q.status === 'testing').length;
  return { merged, opened, filed, inQa, working: team.filter(busy).length, team: team.length, floors: o.floors.length };
}

export interface TourStop {
  floor: number;
  title: string;
  /** Sentences for your screen while you're there. */
  card: string[];
  /** Short lines for the guide's speech bubbles, said one after another. */
  say: string[];
}

/** At most `n` characters, cut at a word with an ellipsis. */
export function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/** "Ada", "Ada and Grace", "Ada, Grace and Linus", "Ada, Grace and 3 more". */
export function names(list: readonly string[], max = 3): string {
  if (list.length <= 1) return list[0] ?? '';
  if (list.length > max) return `${list.slice(0, max - 1).join(', ')} and ${list.length - max + 1} more`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const shortName = (f: Floor) => f.fullName.split('/').pop() ?? f.fullName;

function floorStop(f: Floor, o: Office, now: number): TourStop {
  const start = dayStart(now);
  const team = Object.values(o.workers).filter((w) => w.role !== 'ceo' && w.floorId === f.id);
  const working = team.filter(busy);
  const merged = f.pulls.filter((p) => p.state === 'MERGED' && sameDay(p.mergedAt, start)).length;
  const inQa = Object.values(o.qa).filter((q) => q.floorId === f.id && (q.status === 'queued' || q.status === 'testing')).length;
  const what = f.summary || f.description || f.mission;
  const first = working[0];
  const doing = first?.task ? (first.task.kind === 'qa' ? `testing PR #${first.task.prNumber}` : first.task.kind === 'fix' ? `fixing PR #${first.task.prNumber}` : `on #${first.task.issueNumber}`) : null;
  const card = [
    what ? clip(what, 160) : 'One of our projects.',
    team.length ? `The team: ${names(team.map((w) => w.name), 5)}${working.length ? ` (${working.length} at work)` : ', all free right now'}.` : 'Nobody works on this floor yet.',
    `${f.issues.length} open issue${f.issues.length === 1 ? '' : 's'} · ${inQa} PR${inQa === 1 ? '' : 's'} in QA · ${merged} merged today.`,
  ];
  const say = [
    `This is ${shortName(f)}!`,
    what ? clip(what, 52) : 'One of our projects.',
    team.length ? `Meet ${names(team.map((w) => w.name))}.` : 'No team here yet.',
    first && doing ? clip(`${first.name} is ${doing} right now`, 52) : merged ? `${merged} merged today! 🎉` : `${f.issues.length} issues on the board`,
  ];
  return { floor: f.floor, title: `Floor ${f.floor} · ${shortName(f)}`, card, say };
}

/** The tour: every repo floor from the bottom up, then the CEO's office and the roof terrace, then back to the lobby. */
export function tourStops(o: Office, now: number): TourStop[] {
  const ceo = Object.values(o.workers).find((w) => w.role === 'ceo');
  const floors = [...o.floors].sort((a, b) => a.floor - b.floor).map((f) => floorStop(f, o, now));
  const today = todayStatus(o, now);
  const total = o.records?.total ?? 0;
  const newest = o.records?.trophies.at(-1);
  const company = o.records?.trophies.filter(isCompanyMilestone).length ?? 0;
  const awards = wonOf(o.records?.trophies ?? [], o.floors.map((f) => f.id));
  return [
    ...floors,
    {
      floor: CEO_FLOOR,
      title: "The CEO's office",
      card: [
        ...(ceo
          ? [`${ceo.name} runs the company from up here: onboarding new floors, turning briefs into issues and sizing the teams.`, busy(ceo) ? `${ceo.name} is busy right now.` : `${ceo.name} has a moment, if you want to say hi.`]
          : ["The CEO's office, waiting for a CEO. Hire one in the manager's console (O) and they'll plan the floors' work."]),
        'Have a look round: the library and its reading nook, the lounge, a putting green, the pool table, the coffee bar and the fish tank.',
        ...(company ? [`By the meeting table: the company's milestones, and its ${company} troph${company === 1 ? 'y' : 'ies'} on the cabinet under them.`] : []),
        `By the elevator: the awards wall, ${awards.won} of ${awards.total} won. Each award pays coins; E on the wall shows what every one takes.`,
      ],
      say: [...(ceo ? [`The corner office!`, `${ceo.name} runs things from here.`] : ['The corner office…', "We haven't hired a CEO yet."]), 'Putting green, pool table, fish tank… ⛳', 'And our awards wall! 🏅'],
    },
    {
      floor: ROOF,
      title: 'The roof terrace',
      card: ['The best view in town: lookouts over the city, a fireplace, deck chairs and the garden.', 'Anyone with nothing to do comes up here for a break.'],
      say: ['And the roof terrace!', 'Best view in town. 🌇', 'Breaks happen up here.'],
    },
    {
      floor: LOBBY,
      title: "That's the tour!",
      card: [
        `${today.floors} floor${today.floors === 1 ? '' : 's'}, ${today.team} on the team, ${today.working} at work right now.`,
        `Today: ${today.merged} merged, ${today.opened} PRs opened, ${today.filed} issues filed.`,
        total
          ? `${total} PR${total === 1 ? '' : 's'} shipped in all (the shipped wall lists the latest)${newest ? `, and the newest trophy in the cabinet: ${newest.icon} ${newest.title}` : ''}.`
          : 'Nothing shipped yet: the first merge puts the first trophy in the cabinet.',
        'Come back to the front desk any time.',
      ],
      say: [
        "That's the tour!",
        ...(total ? [`${total} PR${total === 1 ? '' : 's'} shipped so far! 🚢`] : []),
        ...(newest ? [clip(`Our newest trophy: ${newest.icon} ${newest.title}`, 52)] : []),
        'Come back any time. 👋',
      ],
    },
  ];
}
