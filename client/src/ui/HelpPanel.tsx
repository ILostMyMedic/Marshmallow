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
      ['O', "The manager's console: floors, team, issues, settings"],
      ['P', 'Your phone: the CEO and the office’s messages'],
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
