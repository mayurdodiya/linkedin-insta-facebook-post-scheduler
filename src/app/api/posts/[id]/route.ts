import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { route } from '@/server/http';
import type { PostInput } from '@/server/services/posts.service';
import { parseMultipart } from '@/server/uploads';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const PATCH = route(async (req, ctx) => {
  const u = await requireUser(req);
  const { id } = await ctx.params;
  const { body, files } = await parseMultipart(req, 10);
  return services.posts.update(u.id, id, body as PostInput, files);
});

export const DELETE = route(async (req, ctx) => {
  const u = await requireUser(req);
  const { id } = await ctx.params;
  return services.posts.remove(u.id, id);
});
