import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { route } from '@/server/http';
import type { BulkPostInput } from '@/server/services/posts.service';
import { parseMultipart } from '@/server/uploads';

export const runtime = 'nodejs';
export const maxDuration = 300;

// multipart/form-data: content, platforms, scheduledAts[], captions[], media[] -
// one post per file, each using its own scheduledAt/caption (multi-day planning)
export const POST = route(async (req) => {
  const u = await requireUser(req);
  const { body, files } = await parseMultipart(req, 30);
  return services.posts.bulkCreate(u.id, body as BulkPostInput, files);
});
