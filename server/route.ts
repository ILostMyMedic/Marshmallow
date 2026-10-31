// A REST handler's answer goes out as JSON ({ ok: true } when it returns nothing); what it throws goes to the error
// handler, which answers { error }.
// Adapted from cubefarm server/index.ts (MIT).
import type { NextFunction, Request, Response } from 'express';

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

export const route = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    next(err);
  }
};
