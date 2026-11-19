import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { route } from '@/server/http';
import type { PostInput } from '@/server/services/posts.service';
import { parseMultipart } from '@/server/uploads';

export const runtime = 'nodejs';
export const maxDuration = 300;

// multipart/form-data: content, media[] - publishes right away, no slot needed
export const POST = route(async (req) => {
  const u = await requireUser(req);
  const { body, files } = await parseMultipart(req, 10);
  return services.posts.createInstant(u.id, body as PostInput, files);
});
