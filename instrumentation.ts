/**
 * Outside Vercel there is no Vercel Cron, so run the scheduler in-process like the old Nest
 * server did: once shortly after boot (catch-up after downtime) and then every 15 minutes.
 * On Vercel this does nothing - vercel.json's cron calls /api/cron/scheduler instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL) return;
  if (!process.env.MONGODB_URI) return;

  const g = globalThis as unknown as { __schedulerTimer?: boolean };
  if (g.__schedulerTimer) return; // dev hot-reload registers again
  g.__schedulerTimer = true;

  const tick = async () => {
    try {
      const { connectDb } = await import('./src/server/db');
      const { services } = await import('./src/server/container');
      await connectDb();
      await services.scheduler.run();
    } catch (e) {
      console.error(`[Scheduler] ${(e as Error).message}`);
    }
  };
  setTimeout(() => void tick(), 5000).unref();
  setInterval(() => void tick(), 15 * 60_000).unref();
}
