import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { readJson, route } from '@/server/http';

export const runtime = 'nodejs';

export const POST = route(async (req) => {
  const u = await requireUser(req);
  const { pageId } = await readJson<{ pageId?: string }>(req);
  return services.facebook.selectPage(u.id, pageId as string);
});
