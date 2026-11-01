// The desktop's REST: chats with the CEO, its project cards and its discussions. Every change also reaches the tabs as
// the whole desk (the 'desk' event); each route answers with the chat, card or discussion it changed. Writing to the
// CEO needs one (409); an empty message is a 400, an unknown id a 404.
import express from 'express';
import { titleFrom, type Desk } from './db/desk.ts';
import type { Projects } from './desk/projects.ts';
import { HttpError } from './httpError.ts';
import type { Ctx } from './pipeline/context.ts';
import { route } from './route.ts';

const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** An id from the path; one that can't be an id names nothing (404). */
const idOf = (raw: unknown, what: string) => {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, `No ${what} ${String(raw)}`);
  return n;
};

export function deskRoutes(ctx: Ctx, desk: Desk, projects: Projects) {
  const r = express.Router();
  const { ceo } = ctx;

  // { text? } → ChatView: a new chat, named by the text's first line ("New chat" without), the text going to the CEO
  r.post('/chats', route((req) => ceo.newChat(str(req.body?.text))));
  // { text } → ChatView
  r.post('/chats/:id/messages', route((req) => ceo.postToChat(idOf(req.params.id, 'chat'), str(req.body?.text))));
  // { title } → ChatView
  r.patch(
    '/chats/:id',
    route((req) => {
      const id = idOf(req.params.id, 'chat');
      if (!str(req.body?.title).trim()) throw new HttpError(400, 'A chat needs a title');
      return desk.renameChat(id, titleFrom(str(req.body.title)));
    }),
  );
  // → { ok: true }; 409 while its project is starting
  r.delete(
    '/chats/:id',
    route(async (req) => {
      await desk.deleteChat(idOf(req.params.id, 'chat'));
    }),
  );

  // { repo?: ProposalRepo, teamSize?, tasks?: number[] (the indices kept; all by default) } → ProjectProposal, now
  // 'starting': the steps that follow show on the desk
  r.post('/proposals/:id/approve', route((req) => projects.approve(idOf(req.params.id, 'proposal'), req.body ?? {})));
  // { note? } → ProjectProposal: the note goes back to the chat as the manager's, and to the CEO
  r.post('/proposals/:id/decline', route((req) => projects.decline(idOf(req.params.id, 'proposal'), str(req.body?.note))));

  // { text } → DiscussionView (a settled one opens again)
  r.post('/discussions/:id/messages', route((req) => ceo.postToDiscussion(idOf(req.params.id, 'discussion'), str(req.body?.text))));
  // { outcome? } → DiscussionView: an outcome goes to the CEO, who carries on with what it held up
  r.post('/discussions/:id/resolve', route((req) => ceo.resolveDiscussion(idOf(req.params.id, 'discussion'), str(req.body?.outcome))));

  return r;
}
