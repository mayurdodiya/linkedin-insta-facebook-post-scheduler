import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { route } from '@/server/http';

export const runtime = 'nodejs';

export const GET = route(async (req) => services.posts.stats((await requireUser(req)).id));
