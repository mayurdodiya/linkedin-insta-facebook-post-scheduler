import { services } from '@/server/container';
import { HttpException, route } from '@/server/http';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Vercel Cron target (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      throw new HttpException(401, 'Unauthorized', 'Unauthorized');
    }
  } else if (process.env.VERCEL) {
    throw new HttpException(401, 'Set CRON_SECRET to enable the scheduler endpoint', 'Unauthorized');
  }
  const processed = await services.scheduler.run();
  return { ok: true, processed: processed ?? 0 };
});
