// Commands go to the server over REST. What they change comes back over /ws, never in the reply.

async function send(method: string, url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(out.error ?? `${res.status} ${res.statusText}`);
  return out;
}

/** Sends a command; throws the server's { error } message when it refuses. */
export const command = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) => send(method, url, body);

/** Asks for something that isn't part of the office's state, such as the repositories you could connect. */
export const query = <T>(url: string) => send('GET', url) as Promise<T>;

/** A floor's id ("owner/name") as one path segment. */
export const floorPath = (floorId: string) => encodeURIComponent(floorId);
