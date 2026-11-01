import { describe, expect, it } from 'vitest';
import type { Floor, PullInfo, QaRecord, Task, Worker } from '../../../shared/types';
import { CEO_FLOOR, LOBBY, ROOF } from './floors';
import { clip, names, todayStatus, tourStops, type Office } from './tour';

const NOW = new Date(2026, 9, 31, 15, 0).getTime();
const today = new Date(2026, 9, 31, 10, 0).toISOString();
const yesterday = new Date(2026, 9, 30, 10, 0).toISOString();

const worker = (id: string, over: Partial<Worker> = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), role: 'worker', floorId: 'o/app', status: 'idle', task: null, ...over }) as Worker;
const pull = (number: number, over: Partial<PullInfo> = {}) => ({ number, state: 'OPEN', createdAt: yesterday, mergedAt: null, ...over }) as PullInfo;
const floor = (over: Partial<Floor> = {}) => ({ id: 'o/app', fullName: 'o/app', floor: 1, description: '', summary: '', mission: '', issues: [], pulls: [], ...over }) as Floor;
const office = (floors: Floor[], workers: Worker[], qa: QaRecord[] = []): Office => ({
  floors,
  workers: Object.fromEntries(workers.map((w) => [w.id, w])),
  qa: Object.fromEntries(qa.map((q) => [`${q.floorId}#${q.prNumber}`, q])),
});

describe('today', () => {
  it("counts today's merges, new PRs and issues, QA and who's at work", () => {
    const f = floor({
      pulls: [pull(1, { state: 'MERGED', mergedAt: today, createdAt: today }), pull(2, { state: 'MERGED', mergedAt: yesterday }), pull(3)],
      issues: [{ number: 9, createdAt: today } as Floor['issues'][number], { number: 8, createdAt: yesterday } as Floor['issues'][number]],
    });
    const o = office([f], [worker('ada', { status: 'working' }), worker('grace'), worker('boss', { role: 'ceo' })], [{ floorId: 'o/app', prNumber: 3, status: 'testing' } as QaRecord]);
    expect(todayStatus(o, NOW)).toEqual({ merged: 1, opened: 1, filed: 1, inQa: 1, working: 1, team: 2, floors: 1 });
  });
});

describe('the tour', () => {
  it('stops on every floor from the bottom up, then the CEO, the roof and back to the lobby', () => {
    const o = office([floor({ id: 'o/b', fullName: 'o/b', floor: 2 }), floor()], []);
    expect(tourStops(o, NOW).map((s) => s.floor)).toEqual([1, 2, CEO_FLOOR, ROOF, LOBBY]);
  });

  it("tells a floor's project, team and what's going on, in short lines for the bubbles", () => {
    const task = { kind: 'issue', issueNumber: 14, prNumber: null } as Task;
    const o = office([floor({ summary: 'A tiny todo app · React + Vite' })], [worker('ada', { status: 'working', task }), worker('grace')]);
    const stop = tourStops(o, NOW)[0];
    expect(stop.title).toBe('Floor 1 · app');
    expect(stop.say).toEqual(['This is app!', 'A tiny todo app · React + Vite', 'Meet Ada and Grace.', 'Ada is on #14 right now']);
    expect(stop.card[1]).toBe('The team: Ada and Grace (1 at work).');
    for (const line of stop.say) expect(line.length).toBeLessThanOrEqual(52);
  });

  it('says so when there is no CEO yet', () => {
    expect(tourStops(office([], []), NOW).find((s) => s.floor === CEO_FLOOR)!.say[1]).toBe("We haven't hired a CEO yet.");
  });

  it('ends in the lobby with how much the office has shipped and its newest trophy', () => {
    const trophies = [
      { id: 'company:1', floorId: null, icon: '🚀', title: 'First ship', detail: '', earnedAt: 1, reward: 25 },
      { id: 'floor:o/app:10', floorId: 'o/app', icon: '⭐', title: 'app: 10 merged', detail: '', earnedAt: 2, reward: 40 },
    ];
    const stops = tourStops({ ...office([floor()], []), records: { total: 12, trophies } }, NOW);
    const lobby = stops.at(-1)!;
    expect(lobby.say).toEqual(["That's the tour!", '12 PRs shipped so far! 🚢', 'Our newest trophy: ⭐ app: 10 merged', 'Come back any time. 👋']);
    expect(lobby.card[2]).toBe('12 PRs shipped in all (the shipped wall lists the latest), and the newest trophy in the cabinet: ⭐ app: 10 merged.');
    const ceo = stops.find((s) => s.floor === CEO_FLOOR)!;
    expect(ceo.card.at(-2)).toContain('its 1 trophy on the cabinet');
    expect(ceo.card.at(-1)).toBe('By the elevator: the awards wall, 2 of 40 won. Each award pays coins; E on the wall shows what every one takes.');
    expect(ceo.say.at(-1)).toBe('And our awards wall! 🏅');
    expect(ceo.card.some((c) => c.includes('putting green') && c.includes('fish tank'))).toBe(true);
    expect(tourStops(office([], []), NOW).at(-1)!.say).toEqual(["That's the tour!", 'Come back any time. 👋']);
  });
});

describe('words', () => {
  it('clips at a word and lists names', () => {
    expect(clip('a tiny todo app with dark mode and search', 20)).toBe('a tiny todo app…');
    expect(names(['Ada'])).toBe('Ada');
    expect(names(['Ada', 'Grace', 'Linus'])).toBe('Ada, Grace and Linus');
    expect(names(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 more');
  });
});
