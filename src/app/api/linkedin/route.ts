import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { route } from '@/server/http';

export const runtime = 'nodejs';

export const DELETE = route(async (req) => {
  const u = await requireUser(req);
  await services.linkedin.disconnect(u.id);
  return { ok: true };
});
