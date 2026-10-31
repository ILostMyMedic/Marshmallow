// Machines as folders on this computer (server/machines/workspace.ts), behind the MachineProvider calls.
// Adapted from cubefarm server/machines.ts (MIT).
import fs from 'node:fs';
import { installDesk } from './deps.ts';
import type { MachineProvider } from './machines.ts';
import * as workspace from './workspace.ts';

/** `keep`: the office's own processes, which releasing a machine never stops. */
export function localMachines(keep: () => workspace.OfficeProcesses): MachineProvider {
  return {
    deskDir: (machine, fullName) => workspace.machineDesk(machine, fullName),
    prepareDesk: (machine, fullName, base, branch, note) => workspace.prepareMachineDesk(machine, fullName, base, branch, note),
    env: (machine) => {
      const tmp = workspace.machineTmp(machine);
      fs.mkdirSync(tmp, { recursive: true });
      return { TMP: tmp, TEMP: tmp, TMPDIR: tmp };
    },
    release: (machine, fullName, port) => workspace.releaseMachine(machine, fullName, port, keep()),
    sweep: (machine, fullName, keepBranches) => workspace.sweepMachine(machine, fullName, keepBranches),
    remove: (machine) => workspace.removeMachine(machine),
    list: () => workspace.listMachines(),
    exists: async (machine, fullName) => fs.existsSync(workspace.machineDesk(machine, fullName)),
    installDeps: (machine, fullName, cb) => installDesk(workspace.machineDesk(machine, fullName), cb),
  };
}
