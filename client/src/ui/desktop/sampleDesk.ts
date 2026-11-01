// A sample desk for window.__mmDesk (probe.ts): chats with project cards in every state (pending, starting, started,
// failed, declined, replaced), discussions waiting on you, open and resolved, and the workers' questions as issue
// threads, one waiting and one answered. Loaded only when the probe asks for it. New in Marshmallow.
import type { ChatView, DeskMessage, DeskView, DiscussionView, OfficeMessage, ProjectProposal, Question } from '../../../../shared/types';

const MIN = 60_000;

export function sampleDesk(now: number, floors: string[]): DeskView {
  const f1 = floors[0] ?? 'demo-co/pixel-todo';
  const f2 = floors[1] ?? f1;
  let id = 9000;
  const msg = (from: DeskMessage['from'], text: string, ago: number, proposalId: number | null = null): DeskMessage => ({ id: ++id, at: now - ago * MIN, from, text, proposalId });
  const chat = (cid: number, title: string, messages: DeskMessage[], replying = false): ChatView => ({
    id: cid,
    title,
    createdAt: messages[0]?.at ?? now,
    updatedAt: messages.at(-1)?.at ?? now,
    replying,
    messages,
  });
  const base = { at: now, step: null, floorId: null, issueNumbers: [], error: null, decidedAt: null } satisfies Partial<ProjectProposal>;
  const recipeTasks = [
    { title: 'Set up the app: Vite, React and a first page', body: 'Scaffold the project with Vite + React + TypeScript. A home page that says hello, and npm test running Vitest.', dependsOn: [] },
    { title: 'Recipes: add, edit and list them', body: 'A recipe has a title, servings, ingredients (amount, unit, name) and steps. Keep them in localStorage for now.', dependsOn: [0] },
    { title: 'The shopping list from the recipes you pick', body: 'Pick recipes for the week; the list adds up the same ingredients and groups them by aisle.', dependsOn: [1] },
    { title: 'Search and tags', body: 'Find a recipe by name or ingredient; tag recipes (quick, veggie, batch).', dependsOn: [1] },
    { title: 'Print the list', body: 'A print view of the shopping list, ticked items left out.', dependsOn: [2] },
  ];
  const proposals: ProjectProposal[] = [
    {
      ...base,
      id: 501,
      chatId: 1,
      at: now - 3 * MIN,
      status: 'pending',
      repo: { kind: 'new', owner: 'demo-manager', name: 'recipe-box', description: 'Recipes with a shopping list that adds itself up', private: true },
      brief:
        'A small web app for keeping recipes and planning the week’s cooking.\n\nYou add recipes (ingredients and steps), pick a few for the week, and the app builds one shopping list, adding up what’s the same and grouping it by aisle.\n\nNo accounts for now: everything lives in the browser. It should feel quick on a phone in the shop.',
      teamSize: 3,
      tasks: recipeTasks,
    },
    {
      ...base,
      id: 502,
      chatId: 2,
      at: now - 2 * MIN,
      status: 'starting',
      step: 'Filing the tasks (2 of 4)…',
      repo: { kind: 'new', owner: 'demo-co', name: 'city-weather', description: 'A tiny weather dashboard', private: false },
      brief: 'A one-page dashboard for one city: now, the next 24 hours and the week, from Open-Meteo. No key needed.',
      teamSize: 2,
      tasks: [
        { title: 'Scaffold the dashboard', body: '', dependsOn: [] },
        { title: 'Today and the next 24 hours', body: '', dependsOn: [0] },
        { title: 'The week ahead', body: '', dependsOn: [0] },
        { title: 'Pick your city', body: '', dependsOn: [1, 2] },
      ],
      decidedAt: now - 2 * MIN,
    },
    {
      ...base,
      id: 503,
      chatId: 3,
      at: now - 300 * MIN,
      status: 'started',
      repo: { kind: 'existing', fullName: f1 },
      brief: 'Polish the todo app: drag to reorder, due dates and a dark theme.',
      teamSize: 4,
      tasks: [
        { title: 'Drag to reorder todos', body: 'Keyboard too: Alt+↑/↓.', dependsOn: [] },
        { title: 'Due dates, with overdue ones in red', body: '', dependsOn: [] },
        { title: 'A dark theme that follows the system', body: '', dependsOn: [] },
      ],
      floorId: f1,
      issueNumbers: [14, 15, 16],
      decidedAt: now - 290 * MIN,
    },
    {
      ...base,
      id: 504,
      chatId: 4,
      at: now - 1500 * MIN,
      status: 'declined',
      repo: { kind: 'new', owner: 'demo-manager', name: 'habits', description: '', private: true },
      brief: 'A habit tracker with streaks, accounts and a mobile app.',
      teamSize: 6,
      tasks: [
        { title: 'Accounts and sign-in', body: '', dependsOn: [] },
        { title: 'Habits and streaks', body: '', dependsOn: [0] },
      ],
      decidedAt: now - 1490 * MIN,
    },
    {
      ...base,
      id: 505,
      chatId: 4,
      at: now - 1400 * MIN,
      status: 'failed',
      repo: { kind: 'new', owner: 'demo-manager', name: 'habit-streaks', description: 'Streaks for your habits', private: true },
      brief: 'A habit tracker, browser only: habits, a tick per day and streaks.',
      teamSize: 2,
      tasks: [
        { title: 'Scaffold the app', body: '', dependsOn: [] },
        { title: 'Habits and daily ticks', body: '', dependsOn: [0] },
        { title: 'Streaks and a calendar view', body: '', dependsOn: [1] },
      ],
      error: 'GitHub refused to create demo-manager/habit-streaks: name already exists on this account. Nothing else was done.',
      decidedAt: now - 1395 * MIN,
    },
    {
      ...base,
      id: 506,
      chatId: 5,
      at: now - 50 * MIN,
      status: 'replaced',
      repo: { kind: 'new', owner: 'demo-manager', name: 'marks', description: '', private: true },
      brief: 'Bookmarks with tags.',
      teamSize: 2,
      tasks: [{ title: 'Everything', body: '', dependsOn: [] }],
    },
  ];
  const chats: ChatView[] = [
    chat(1, 'Recipe box', [
      msg('manager', 'I want an app for my recipes that also makes the shopping list for the week.', 12),
      msg('ceo', 'Nice. A few questions first: just you, or shared with family? On a phone in the shop, or at a desk? And should the list group things by aisle?', 11),
      msg('manager', 'Just me for now, mostly on my phone. Yes, by aisle would be great.', 6),
      msg('ceo', 'Here’s the plan: a browser-only app (no accounts yet), recipes in, a week’s picks out, and one list that adds itself up. Three workers is plenty to start.', 3, 501),
    ]),
    chat(
      2,
      'Weather dashboard',
      [msg('manager', 'A tiny weather page for my city?', 9), msg('ceo', 'Easy one: Open-Meteo needs no key. Here’s a plan.', 8, 502), msg('office', 'Creating the repository demo-co/city-weather…', 2)],
      false,
    ),
    chat(3, 'Todo app polish', [
      msg('manager', 'The todo app needs some love: reordering, due dates, a dark theme.', 320),
      msg('ceo', 'On the existing floor, then. Three tasks, four workers so they go side by side.', 300, 503),
      msg('office', `Started: ${f1} has its brief, a team of 4 and issues #14, #15 and #16.`, 289),
    ]),
    chat(4, 'Habit tracker', [
      msg('manager', 'Habit tracker with streaks?', 1520),
      msg('ceo', 'Here’s a full version, with accounts and a mobile app.', 1500, 504),
      msg('manager', 'Too big. Browser only please.', 1491),
      msg('ceo', 'Smaller then: browser only, three tasks.', 1400, 505),
      msg('office', 'Couldn’t start it: GitHub refused to create demo-manager/habit-streaks (the name is taken). Nothing else was done.', 1395),
    ]),
    chat(
      5,
      'Bookmarks, maybe',
      [
        msg('manager', 'Something for bookmarks?', 60),
        msg('ceo', 'One task to start.', 50, 506),
        msg('manager', 'Split it up more, and I’d like tags and a browser extension later.', 2),
      ],
      true,
    ),
  ];
  const discussion = (d: Omit<DiscussionView, 'openedAt' | 'updatedAt'>): DiscussionView => ({ ...d, openedAt: d.messages[0].at, updatedAt: d.messages.at(-1)!.at });
  const discussions: DiscussionView[] = [
    discussion({
      id: 71,
      title: 'Which charting library for the dashboard?',
      floorId: f2,
      status: 'open',
      outcome: null,
      replying: false,
      messages: [
        msg('ceo', 'Before I plan the charts: Chart.js is small and quick to start; Recharts fits React better but is heavier. Any preference? Or should I pick?', 25),
        msg('manager', 'What would you pick?', 20),
        msg('ceo', 'Chart.js: two charts don’t need more, and it keeps the page light. Shall I go with it?', 4),
      ],
    }),
    discussion({
      id: 72,
      title: 'A bigger team for floor 2?',
      floorId: f2,
      status: 'open',
      outcome: null,
      replying: true,
      messages: [msg('ceo', 'Floor 2 has 9 ready issues and one worker. Grow it to 3?', 40), msg('manager', 'Make it 4, there’s a deadline.', 1)],
    }),
    discussion({
      id: 73,
      title: 'Dark mode first, or later?',
      floorId: f1,
      status: 'resolved',
      outcome: 'Later: reordering and due dates go first; dark mode after the release.',
      replying: false,
      messages: [msg('ceo', 'Dark mode touches every component. Before or after the release?', 600), msg('manager', 'After. Ship the features first.', 590)],
    }),
  ];
  return { chats, proposals, discussions, owners: ['demo-manager', 'demo-co', 'acme-labs'] };
}

export function sampleQuestions(now: number, floors: string[]): Question[] {
  const f1 = floors[0] ?? 'demo-co/pixel-todo';
  const f2 = floors[1] ?? f1;
  return [
    { id: 9101, floorId: f2, issueNumber: 3, from: 'Grace', text: 'Should temperatures be in °C or °F? The issue doesn’t say.', askedAt: now - 200 * MIN, url: null, answer: '°C, with a toggle for °F later.', answeredAt: now - 180 * MIN },
    { id: 9102, floorId: f1, issueNumber: 7, from: 'Ada', text: 'The issue says “make the button nicer”. Bigger, a new colour, or an icon? I can do all three, but they change the layout differently.', askedAt: now - 30 * MIN, url: null, answer: 'Bigger, with an icon. Keep the colour.', answeredAt: now - 25 * MIN },
    { id: 9103, floorId: f1, issueNumber: 7, from: 'Ada', text: 'Which icon set? The repo has none yet: Lucide or Heroicons?', askedAt: now - 6 * MIN, url: null, answer: null, answeredAt: null },
  ];
}

export function sampleNotices(now: number, floors: string[]): OfficeMessage[] {
  const f1 = floors[0] ?? null;
  return [
    { id: 9201, at: now - 90 * MIN, from: 'office', text: 'PR #12 needs you: QA failed it three rounds running.', floorId: f1 },
    { id: 9202, at: now - 45 * MIN, from: 'ceo', text: 'Onboarded the floor: a React + Vite todo app. QA should run it in a browser; 3 workers fit the backlog.', floorId: f1 },
    { id: 9203, at: now - 5 * MIN, from: 'office', text: 'GitHub refused to merge PR #13: a required check is failing.', floorId: f1 },
  ];
}
