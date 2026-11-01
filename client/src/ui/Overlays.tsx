// The panel open over the 3D view (view.ts overlay): a worker's panel, a floor's board, the elevator's buttons, your
// look, the front desk, the manager's console, the desktop, the help screen, the first-run setup, the trophies, a
// floor's running app, the shop or the awards.
// Adapted from cubefarm client/src/ui/Overlays.tsx (MIT).
import { useView } from '../world/view';
import { AppViewer } from './AppViewer';
import { AwardsPanel } from './awards/AwardsPanel';
import { ElevatorPanel } from './ElevatorPanel';
import { FrontDeskPanel } from './FrontDeskPanel';
import { HelpPanel } from './HelpPanel';
import { KanbanView } from './KanbanView';
import { LookPanel } from './LookPanel';
import { Desktop } from './desktop/Desktop';
import { ManagerConsole } from './ManagerConsole';
import { SetupWizard } from './SetupWizard';
import { ShopPanel } from './shop/ShopPanel';
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
    case 'desktop':
      return <Desktop app={overlay.app} />;
    case 'help':
      return <HelpPanel />;
    case 'setup':
      return <SetupWizard />;
    case 'trophies':
      return <TrophiesPanel />;
    case 'app':
      return <AppViewer floorId={overlay.floorId} />;
    case 'shop':
      return <ShopPanel floorId={overlay.floorId} />;
    case 'awards':
      return <AwardsPanel floorId={overlay.floorId} />;
    default:
      return null;
  }
}
