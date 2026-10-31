// Words for the debug page: a worker's task and activity, and the feed's moments.
import type { ActivityKind, Moment, Task } from '../../../shared/types';

const ACTIVITY_ICONS: Record<ActivityKind, string> = {
  read: '📖',
  edit: '✏️',
  test: '🧪',
  build: '🔨',
  browse: '🌐',
  git: '🌿',
  ci: '⏳',
  qa: '🔍',
  fix: '🩹',
  talk: '💬',
  run: '▶️',
};

export const activityIcon = (kind: ActivityKind) => ACTIVITY_ICONS[kind];

export function taskText(task: Task | null): string {
  if (!task) return '';
  if (task.kind === 'issue') return `Building #${task.issueNumber}: ${task.title}`;
  return `${task.kind === 'qa' ? 'Testing' : 'Fixing'} PR #${task.prNumber}: ${task.title}`;
}

/** One line for the feed. `name` finds a worker's name from their id (they may have left). */
export function momentText(m: Moment, name: (workerId: string | null) => string): string {
  switch (m.type) {
    case 'hired':
      return `${m.worker.name} joined ${m.worker.floorId}`;
    case 'left':
      return `${m.worker.name} left ${m.worker.floorId}`;
    case 'issuesFiled':
      return `${m.numbers.length === 1 ? 'An issue' : `${m.numbers.length} issues`} filed on ${m.floorId}: ${m.numbers.map((n) => `#${n}`).join(', ')}`;
    case 'prOpened':
      return `${name(m.workerId)} opened PR #${m.prNumber}${m.issueNumber ? ` for #${m.issueNumber}` : ''} on ${m.floorId}`;
    case 'qaPassed':
      return `PR #${m.prNumber} on ${m.floorId} passed QA (tested by ${name(m.qaWorkerId)})`;
    case 'qaFailed':
      return `PR #${m.prNumber} on ${m.floorId} failed QA (tested by ${name(m.qaWorkerId)})`;
    case 'merged':
      return `PR #${m.prNumber} merged on ${m.floorId}`;
  }
}
