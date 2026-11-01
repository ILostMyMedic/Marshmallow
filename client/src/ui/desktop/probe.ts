// window.__mmDesk: puts a desk into this tab's store, to see the desktop's every state without a server that has one.
//   __mmDesk()            the sample (sampleDesk.ts): chats, project cards in every state, discussions, an issue thread
//   __mmDesk(desk)        your own DeskView
//   __mmDesk('empty')     an empty desk
//   __mmDesk.noCeo()      the office without its CEO (until the server next sends them)
//   __mmDesk.questions(q) questions for the issue threads (the sample adds its own)
// What the server sends next replaces it. New in Marshmallow.
import type { DeskView, Question } from '../../../../shared/types';
import { EMPTY_DESK } from '../../../../shared/types';
import { useStore } from '../../store';

type Probe = ((desk?: DeskView | 'empty') => Promise<DeskView>) & { noCeo(): void; questions(q: Question[]): void };

if (typeof window !== 'undefined') {
  const probe = (async (desk?: DeskView | 'empty') => {
    if (desk === 'empty') {
      useStore.setState({ desk: EMPTY_DESK });
      return EMPTY_DESK;
    }
    if (desk) {
      useStore.setState({ desk });
      return desk;
    }
    // The sample loads only when asked for, so it stays out of the game's bundle.
    const { sampleDesk, sampleQuestions, sampleNotices } = await import('./sampleDesk');
    const s = useStore.getState();
    const floors = s.floors.map((f) => f.id);
    const sample = sampleDesk(Date.now(), floors);
    const extra = sampleQuestions(Date.now(), floors).filter((q) => !s.questions.some((x) => x.id === q.id));
    useStore.setState({ desk: sample, questions: [...s.questions, ...extra], messages: s.messages.some((m) => m.from === 'office') ? s.messages : [...s.messages, ...sampleNotices(Date.now(), floors)] });
    return sample;
  }) as Probe;
  probe.noCeo = () => {
    const workers = Object.fromEntries(Object.entries(useStore.getState().workers).filter(([, w]) => w.role !== 'ceo'));
    useStore.setState({ workers });
  };
  probe.questions = (q) => useStore.setState({ questions: q });
  (window as unknown as Record<string, unknown>).__mmDesk = probe;
}
