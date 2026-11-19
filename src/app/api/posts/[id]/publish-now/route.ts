import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { route } from '@/server/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = route(async (req, ctx) => {
  const u = await requireUser(req);
  const { id } = await ctx.params;
  return services.posts.publishNow(u.id, id);
});
