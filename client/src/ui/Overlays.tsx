// The panel open over the 3D view (view.ts overlay): a worker's panel, a floor's board, the elevator's buttons, your
// look, the front desk, the manager's console, the phone, the help screen, the first-run setup, the trophies or a
// floor's running app.
// Adapted from cubefarm client/src/ui/Overlays.tsx (MIT).
import { useView } from '../world/view';
import { AppViewer } from './AppViewer';
import { ElevatorPanel } from './ElevatorPanel';
import { FrontDeskPanel } from './FrontDeskPanel';
import { HelpPanel } from './HelpPanel';
import { KanbanView } from './KanbanView';
import { LookPanel } from './LookPanel';
import { ManagerConsole } from './ManagerConsole';
import { Phone } from './Phone';
import { SetupWizard } from './SetupWizard';
import { TrophiesPanel } from './TrophiesPanel';
import { WorkerPanel } from './WorkerPanel';

export function Overlays() {
  const overlay = useView((s) => s.overlay);
  switch (overlay?.kind) {
    case 'terminal':
      return <WorkerPanel workerId={overlay.workerId} />;
    case 'kanban':
      return <KanbanView floorId={overlay.floorId} />;
    case 'elevator':
      return <ElevatorPanel />;
    case 'look':
      return <LookPanel />;
    case 'frontdesk':
      return <FrontDeskPanel />;
    case 'console':
      return <ManagerConsole tab={overlay.tab} floorId={overlay.floorId} />;
    case 'phone':
      return <Phone />;
    case 'help':
      return <HelpPanel />;
    case 'setup':
      return <SetupWizard />;
    case 'trophies':
      return <TrophiesPanel />;
    case 'app':
      return <AppViewer floorId={overlay.floorId} />;
    default:
      return null;
  }
}
