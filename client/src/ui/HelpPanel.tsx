// The help screen: every control, by where you use it. H or the HUD's Help button opens it. Adapted from cubefarm
// client/src/ui/Overlays.tsx's help (MIT): the keys are fixed (rebinding is unchecked), and the toys', blasters',
// photo mode's and emotes' rows are cut.
import { useView } from '../world/view';
import { Panel } from './Panel';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      ['Tab', 'Walk the floor, or look down on it'],
      ['O', "The manager's console: floors, team, issues, the shop, the playbook, settings"],
      ['P', 'Your desktop: chats with the CEO, discussions to settle, the office’s notices'],
      ['H', 'This help'],
      ['M', 'Mute or unmute the sounds'],
      ['Esc', 'Close a panel'],
    ],
  },
  {
    title: 'On foot',
    rows: [
      ['Click', 'Look around (the mouse turns you)'],
      ['W A S D', 'Walk, Shift to run'],
      ['E or click', 'Use what you aim at: a desk’s terminal, the board, the elevator, the coffee machine, a lookout, a worker to say hi'],
      ['E on the big screen', 'The app monitor: start the floor’s app and try what the team shipped, in the app viewer'],
      ['E', 'Sip or bite what you hold'],
      ['G', 'Put down what you hold'],
      ['V', 'First or third person'],
      ['C', 'Your look'],
    ],
  },
  {
    title: 'Looking down (the overview)',
    rows: [
      ['Drag', 'Turn round the floor'],
      ['Right-drag or W A S D', 'Move'],
      ['Wheel', 'Zoom'],
      ['Click', 'Open what’s under the mouse: a person’s chip, the board, the app monitor'],
    ],
  },
  {
    title: 'The playbook',
    rows: [
      ['📘 Playbook tab', 'In the console (O): rules, skills, subagents and commands for the office and each floor, which every worker session gets without anything committed to the repo. Start from a template, switch docs on and off, and see what a worker on a floor gets'],
      ['Rules', 'Go into every session’s system prompt, paid for on every turn: the tab shows their size, so keep them short'],
      ['CEO’s cards', 'The CEO can propose a playbook change in a chat or discussion: approve it, edit it first, or decline it on the card'],
    ],
  },
  {
    title: 'Coins and the shop',
    rows: [
      ['Coins', 'Each floor earns its own: every merge pays, and a clean first QA pass or a fix after a failed one pays a bit more'],
      ['E on the kiosk', 'The shop, in the lobby: buy a floor things for its spots (a vending machine, plants, posters…) and upgrades, with its coins'],
      ['🪙 button', 'The coins of the floor you’re on, under the office’s buttons: a click opens its shop (so does the console’s Shop tab)'],
      ['E on a vending machine', 'A can or a bar in your hands, once someone else has finished at it'],
      ['E on a beer fridge', 'A bottle, after hours (it’s shut in the daytime)'],
    ],
  },
  {
    title: 'Awards',
    rows: [
      ['Awards', 'The company and each floor win them for merges, clean QA passes, comebacks, streaks, a full team, shopping and more: each one a trophy that pays coins, a floor’s to that floor and the company’s to every floor'],
      ['E on the awards wall', 'In the CEO’s office: every award, won or not, how far along each one is and what it pays (the trophies panel’s 🏅 Every award opens it too)'],
    ],
  },
  {
    title: 'On the tour and at the table',
    rows: [
      ['N / X', 'The tour’s next stop / end the tour'],
      ['Mouse', 'Your paddle at the ping-pong table; click to serve'],
    ],
  },
];

export function HelpPanel() {
  const close = useView((s) => s.closeOverlay);
  return (
    <Panel onClose={close} title="❔ Help">
      {GROUPS.map((g) => (
        <section key={g.title} className="help-group">
          <h3>{g.title}</h3>
          <dl className="help-keys">
            {g.rows.map(([key, what]) => (
              <div key={key + what} className="help-row">
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Panel>
  );
}
