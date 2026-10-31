// The manager's console: the floors, the team, the issues and the office's settings, everything the debug page does,
// over the game. O, the HUD's Office button or the front desk opens it; the tab and floor live in its overlay
// (console/nav.ts), and a refused command shows at the top. Adapted from cubefarm client/src/ui/ManagerConsole.tsx (MIT).
// Cut: mission control, the CEO's own tab (the CEO is on Team, their chat on the phone), the time-lapse and the
// accessibility tab.
import { useEffect } from 'react';
import { useStore } from '../store';
import type { ConsoleTab } from '../world/view';
import { useView } from '../world/view';
import { FloorsTab } from './console/FloorsTab';
import { IssuesTab } from './console/IssuesTab';
import { lastTab, rememberTab, showTab } from './console/nav';
import { clearProblem, useProblem } from './console/run';
import { SettingsTab } from './console/SettingsTab';
import { TeamTab } from './console/TeamTab';
import { Panel } from './Panel';

const TABS: [ConsoleTab, string][] = [
  ['floors', '🏢 Floors'],
  ['team', '👥 Team'],
  ['issues', '📋 Issues'],
  ['settings', '⚙️ Settings'],
];

export function ManagerConsole({ tab, floorId }: { tab?: ConsoleTab; floorId?: string }) {
  const close = useView((s) => s.closeOverlay);
  const problem = useProblem((s) => s.text);
  const waiting = useStore((s) => s.questions.filter((q) => q.answer === null).length);
  const demo = useStore((s) => s.demo);
  const current = tab ?? lastTab();
  useEffect(() => rememberTab(current), [current]);
  // A refusal belongs to the tab it happened on.
  useEffect(() => clearProblem, [current]);
  return (
    <Panel
      wide
      onClose={close}
      title={
        <>
          🗂 Manager's console{demo && <span className="panel-sub"> · demo</span>}
        </>
      }
    >
      <div className="console">
        <div className="console-tabs" role="tablist" aria-label="Console">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={current === k} className={`console-tab${current === k ? ' on' : ''}`} onClick={() => showTab(k, floorId)}>
              {label}
              {k === 'issues' && waiting > 0 && <span className="console-count">{waiting}</span>}
            </button>
          ))}
        </div>
        {problem && (
          <p className="console-problem" role="alert">
            <span>{problem}</span>
            <button className="panel-close" aria-label="Dismiss" onClick={clearProblem}>
              ✕
            </button>
          </p>
        )}
        <div role="tabpanel" aria-label={TABS.find(([k]) => k === current)?.[1]}>
          {current === 'floors' && <FloorsTab floorId={floorId} />}
          {current === 'team' && <TeamTab floorId={floorId} />}
          {current === 'issues' && <IssuesTab floorId={floorId} />}
          {current === 'settings' && <SettingsTab />}
        </div>
      </div>
    </Panel>
  );
}
