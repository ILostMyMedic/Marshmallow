// Questions to the manager, asked on GitHub: when an issue is too unclear to build, the worker (or the CEO) asks on
// the issue, as a 🤖 comment, and the issue gets the mm:needs-answer label, which the scheduler skips. After each sync
// the office looks for the manager's reply; once it's there the label comes off and the issue's next prompt carries
// the question and the answer. The office posts as the manager (their gh login), so its own comments carry a hidden
// marker that tells them apart from the manager's.
import type { Floor, IssueInfo, Question } from '../../shared/types.ts';
import type { IssueComment } from '../backend/backend.ts';
import { HttpError } from '../httpError.ts';
import { oneLine, type Ctx } from './context.ts';

/** The label an issue waits under for the manager's answer. */
export const QUESTION_LABEL = 'mm:needs-answer';
/** In every comment the office posts on an issue, so the manager's replies can be told apart from it. */
export const OFFICE_MARK = '<!-- marshmallow -->';
/** In a prompt, where the manager's answer starts (the demo's fake sessions look for it too). */
export const ANSWER_LEAD = "Manager's answer:";

/** The question a session ended with: everything after its line starting "QUESTION FOR THE MANAGER:", else null. */
export function managerQuestion(text: string): string | null {
  const m = text.match(/^[ \t*_>`#-]*QUESTION FOR THE MANAGER[*_`]*[ \t]*:[*_`]*[ \t]*/im);
  if (!m || m.index === undefined) return null;
  const question = text.slice(m.index + m[0].length).trim();
  return question || null;
}

/** The comment the office posts to ask the question. */
export function questionComment(from: string, text: string): string {
  const quoted = text
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join('\n');
  return `🤖 **${from}** (a Marshmallow worker) has a question before building this:\n\n${quoted}\n\nReply in a comment and the issue goes back to the team with your answer.\n${OFFICE_MARK}`;
}

/** The manager's answer: the first comment after the question that the office didn't post. */
export function findAnswer(comments: IssueComment[], askedAt: number): IssueComment | null {
  return comments.find((c) => Date.parse(c.createdAt) >= askedAt - 1000 && !c.body.includes(OFFICE_MARK) && c.body.trim()) ?? null;
}

/** The questions asked about an issue and their answers, for its next prompt ('' when there are none). */
export function questionsPrompt(questions: Question[]): string {
  const answered = questions.filter((q) => q.answer);
  if (!answered.length) return '';
  return ['Questions asked about this issue, with the manager\'s answers (they settle what the issue leaves open):', ...answered.map((q) => `- ${q.from} asked: ${q.text}\n  ${ANSWER_LEAD} ${q.answer}`)].join('\n');
}

export class Questions {
  constructor(private readonly ctx: Ctx) {}

  /** Asks the manager about an issue: the comment, the label, and the office's record. The issue waits for the answer. */
  async ask(floorId: string, issueNumber: number, text: string, from: string): Promise<Question> {
    const { store } = this.ctx;
    const gh = this.ctx.backend.github;
    const floor = store.floor(floorId);
    if (store.questionList(floorId).some((q) => q.issueNumber === issueNumber && !q.answer)) throw new HttpError(409, `#${issueNumber} already waits for an answer`);
    const askedAt = Date.now();
    const url = await gh.commentIssue(floor.fullName, issueNumber, questionComment(from, text));
    await gh.editIssue(floor.fullName, issueNumber, { addLabels: [QUESTION_LABEL] });
    // The scheduler skips it from now on, without waiting for the next sync to list the label.
    this.labelLocally(floor, issueNumber, (labels) => [...labels.filter((l) => l !== QUESTION_LABEL), QUESTION_LABEL]);
    const question = store.putQuestion({ id: 0, floorId, issueNumber, from, text, askedAt, url: url || null, answer: null, answeredAt: null });
    store.say(`❓ ${from} asks about #${issueNumber} on ${floor.fullName}: ${text}`, floorId);
    return question;
  }

  /** The manager answers from the office: their reply goes on the issue, as if they'd written it there. */
  async answer(id: number, text: string): Promise<Question> {
    const { store } = this.ctx;
    const q = store.question(id);
    if (q.answer) throw new HttpError(409, 'That question is answered already');
    if (!text.trim()) throw new HttpError(400, 'The answer is empty');
    await this.ctx.backend.github.commentIssue(store.floor(q.floorId).fullName, q.issueNumber, text.trim());
    await this.check(q.floorId);
    return store.question(id);
  }

  /** After a sync: answers that came in, and questions whose issue closed. Never throws: the next sync tries again. */
  async check(floorId: string): Promise<void> {
    const { store } = this.ctx;
    const gh = this.ctx.backend.github;
    if (!store.hasFloor(floorId)) return;
    for (const q of store.questionList(floorId)) {
      const floor = store.floor(floorId);
      const issue = floor.issues.find((i) => i.number === q.issueNumber);
      if (!issue) {
        store.removeQuestion(q.id); // closed: nothing left to answer or to build
        continue;
      }
      if (q.answer) continue;
      try {
        const reply = findAnswer(await gh.issueComments(floor.fullName, q.issueNumber), q.askedAt);
        // A label the manager took off by hand, with no reply, counts as "go ahead as it is".
        const unlabelled = !issue.labels.includes(QUESTION_LABEL) && Date.now() - q.askedAt > 60_000;
        if (!reply && !unlabelled) continue;
        store.putQuestion({ ...q, answer: reply?.body.trim() ?? '(no answer: the label was removed, so go ahead as the issue says)', answeredAt: Date.now() });
        if (issue.labels.includes(QUESTION_LABEL)) await gh.editIssue(floor.fullName, q.issueNumber, { removeLabels: [QUESTION_LABEL] });
        this.labelLocally(floor, q.issueNumber, (labels) => labels.filter((l) => l !== QUESTION_LABEL));
        store.say(`💬 Your answer on #${q.issueNumber} (${floor.fullName}) is in: it's back on the board.`, floorId);
        this.ctx.soon(200);
      } catch (err) {
        console.warn(`  couldn't check for an answer on #${q.issueNumber}: ${oneLine(err)}`);
      }
    }
  }

  /** The issue's questions and answers, for its next prompt. */
  promptFor(floorId: string, issueNumber: number): string {
    return questionsPrompt(this.ctx.store.questionList(floorId).filter((q) => q.issueNumber === issueNumber));
  }

  private labelLocally(floor: Floor, n: number, change: (labels: string[]) => string[]) {
    const issues = floor.issues.map((i): IssueInfo => (i.number === n ? { ...i, labels: change(i.labels) } : i));
    if (this.ctx.store.hasFloor(floor.id)) this.ctx.store.patchFloor(floor.id, { issues: this.ctx.store.floor(floor.id).issues.map((i) => issues.find((x) => x.number === i.number) ?? i) });
  }
}
