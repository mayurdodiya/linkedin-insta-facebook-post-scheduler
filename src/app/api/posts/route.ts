import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { route } from '@/server/http';
import type { PostInput } from '@/server/services/posts.service';
import { parseMultipart } from '@/server/uploads';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const GET = route(async (req) => {
  const u = await requireUser(req);
  const q = req.nextUrl.searchParams;
  return services.posts.list(u.id, q.get('from') ?? undefined, q.get('to') ?? undefined, q.get('platform') ?? undefined);
});

// multipart/form-data: content, scheduledAt (ISO), media[] files
export const POST = route(async (req) => {
  const u = await requireUser(req);
  const { body, files } = await parseMultipart(req, 10);
  return services.posts.create(u.id, body as PostInput, files);
});
