// The office as this tab knows it: the server's snapshot with its events folded in, plus the connection's state.
// Adapted from cubefarm client/src/store.ts (MIT).
import { create } from 'zustand';
import { EMPTY_CLOUD } from '../../shared/cloud';
import { EMPTY_WORLD, type WorldView } from '../../shared/worldEvents';
import { DEFAULT_SETTINGS, EMPTY_RECORDS, isMoment, type CloudView, type Floor, type FloorItem, type LogLine, type Moment, type OfficeMessage, type PlayerLook, type QaRecord, type PreviewView, type Question, type RecordsView, type ServerEvent, type Settings, type UsageView, type Worker } from '../../shared/types';

/** Log lines a tab keeps per worker. */
const LOG_KEEP = 200;
/** Moments kept for the debug page's feed, newest last. */
const MOMENT_KEEP = 50;

export interface Office {
  loaded: boolean; // the first snapshot has arrived
  version: string;
  demo: boolean;
  settings: Settings;
  floors: Floor[]; // in floor order
  workers: Record<string, Worker>;
  qa: Record<string, QaRecord>; // by qaKey
  logs: Record<string, LogLine[]>;
  moments: Moment[];
  messages: OfficeMessage[]; // oldest first
  questions: Question[]; // oldest first
  usage: UsageView;
  cloud: CloudView;
  // from the office database
  records: RecordsView;
  look: PlayerLook | null;
  floorPlans: Record<string, FloorItem[]>;
  previews: Record<string, PreviewView>; // by floor id (server/previews.ts)
  world: WorldView; // the world events on now
}

export const EMPTY_OFFICE: Office = {
  loaded: false,
  version: '',
  demo: false,
  settings: DEFAULT_SETTINGS,
  floors: [],
  workers: {},
  qa: {},
  logs: {},
  moments: [],
  messages: [],
  questions: [],
  usage: { state: 'normal', until: null, warning: null },
  cloud: EMPTY_CLOUD,
  records: EMPTY_RECORDS,
  look: null,
  floorPlans: {},
  previews: {},
  world: EMPTY_WORLD,
};

/** Office messages a tab keeps. */
const MESSAGE_KEEP = 100;

export const qaKey = (floorId: string, prNumber: number) => `${floorId}#${prNumber}`;

const inFloorOrder = (floors: Floor[]) => floors.sort((a, b) => a.floor - b.floor);

/** The office after one server event. Pure, so tests fold events without a socket. */
export function reduce<O extends Office>(o: O, ev: ServerEvent): O {
  if (isMoment(ev)) return { ...o, moments: [...o.moments, ev].slice(-MOMENT_KEEP) };
  switch (ev.type) {
    case 'snapshot': {
      const d = ev.data;
      return {
        ...o,
        loaded: true,
        version: d.version,
        demo: d.demo,
        settings: d.settings,
        floors: inFloorOrder([...d.floors]),
        workers: Object.fromEntries(d.workers.map((w) => [w.id, w])),
        qa: Object.fromEntries(d.qa.map((q) => [qaKey(q.floorId, q.prNumber), q])),
        logs: d.logs,
        messages: d.messages,
        questions: d.questions,
        usage: d.usage,
        cloud: d.cloud,
        records: d.records ?? EMPTY_RECORDS,
        look: d.look ?? null,
        floorPlans: d.floorPlans ?? {},
        previews: d.previews ?? {},
        world: d.world ?? EMPTY_WORLD,
      };
    }
    case 'settings':
      return { ...o, settings: ev.settings };
    case 'floor':
      return { ...o, floors: inFloorOrder([...o.floors.filter((f) => f.id !== ev.floor.id), ev.floor]) };
    case 'floorRemoved':
      return { ...o, floors: o.floors.filter((f) => f.id !== ev.floorId) };
    case 'worker':
      return { ...o, workers: { ...o.workers, [ev.worker.id]: ev.worker } };
    case 'workerRemoved': {
      const { [ev.workerId]: _worker, ...workers } = o.workers;
      const { [ev.workerId]: _log, ...logs } = o.logs;
      return { ...o, workers, logs };
    }
    case 'log': {
      const log = (o.logs[ev.workerId] ?? []).concat(ev.lines);
      return { ...o, logs: { ...o.logs, [ev.workerId]: log.length > LOG_KEEP ? log.slice(-LOG_KEEP) : log } };
    }
    case 'qa':
      return { ...o, qa: { ...o.qa, [qaKey(ev.qa.floorId, ev.qa.prNumber)]: ev.qa } };
    case 'qaRemoved': {
      const { [qaKey(ev.floorId, ev.prNumber)]: _gone, ...qa } = o.qa;
      return { ...o, qa };
    }
    case 'message':
      return { ...o, messages: [...o.messages, ev.message].slice(-MESSAGE_KEEP) };
    case 'question':
      return { ...o, questions: [...o.questions.filter((q) => q.id !== ev.question.id), ev.question].sort((a, b) => a.id - b.id) };
    case 'questionRemoved':
      return { ...o, questions: o.questions.filter((q) => q.id !== ev.id) };
    case 'usage':
      return { ...o, usage: ev.usage };
    case 'cloud':
      return { ...o, cloud: ev.cloud };
    case 'records':
      return { ...o, records: ev.records };
    case 'look':
      return { ...o, look: ev.look };
    case 'floorPlan':
      return { ...o, floorPlans: { ...o.floorPlans, [ev.floorId]: ev.items } };
    case 'preview':
      return { ...o, previews: { ...o.previews, [ev.preview.floorId]: ev.preview } };
    case 'world':
      return { ...o, world: ev.world };
  }
}

interface State extends Office {
  connected: boolean;
  apply(ev: ServerEvent): void;
  setConnected(connected: boolean): void;
}

export const useStore = create<State>()((set) => ({
  ...EMPTY_OFFICE,
  connected: false,
  apply: (ev) => set((s) => reduce(s, ev)),
  setConnected: (connected) => set({ connected }),
}));
