import { ConfigService } from '../config';
import { Logger } from '../logger';
import type { InstagramService } from './instagram.service';
import type { PostsService } from './posts.service';

/**
 * Publishes due posts. Slots are on the hour in the *user's* timezone.
 * On Vercel this is triggered once daily by the Hobby-compatible cron in vercel.json.
 * Outside Vercel, instrumentation.ts checks every 15 minutes for local development.
 */
export class SchedulerService {
  private readonly log = new Logger(SchedulerService.name);
  private running = false;

  constructor(
    private readonly posts: PostsService,
    private readonly instagram: InstagramService,
    private readonly config: ConfigService,
  ) {}

  async run() {
    if (this.running) return; // never overlap with a slow previous run
    this.running = true;
    try {
      const now = new Date();
      const graceH = Number(this.config.get('MISSED_GRACE_HOURS') ?? 24);
      const notBefore = new Date(now.getTime() - graceH * 3600_000);

      const released = await this.posts.releaseStuck(new Date(now.getTime() - 30 * 60_000));
      const missed = await this.posts.failMissed(notBefore);
      if (released || missed) this.log.warn(`released ${released} stuck, marked ${missed} missed`);

      await this.instagram.refreshExpiring().catch((e: Error) => this.log.warn(`IG refresh: ${e.message}`));

      let done = 0;
      for (;;) {
        const post = await this.posts.claimNextDue(now, notBefore);
        if (!post) break;
        await this.posts.publishClaimed(post);
        done++;
        if (done >= 200) break;
      }
      if (done) this.log.log(`Processed ${done} due post(s)`);

      // drop media of posts whose publish outlived its cleanup (crash / older posts)
      const cleaned = await this.posts.cleanupPublishedMedia();
      if (cleaned) this.log.log(`Cleaned up media of ${cleaned} published post(s)`);
      return done;
    } catch (e) {
      this.log.error(`Scheduler run failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
