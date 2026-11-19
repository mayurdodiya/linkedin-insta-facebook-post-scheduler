import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { route } from '@/server/http';

export const runtime = 'nodejs';

/** The SPA calls this (with its bearer token) then navigates the browser to the returned URL. */
export const GET = route(async (req) => {
  const u = await requireUser(req);
  return { url: await services.linkedin.connectUrl(u.id) };
});
