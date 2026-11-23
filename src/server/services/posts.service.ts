import { join } from 'node:path';
import { Types, type Model } from 'mongoose';
import { ConfigService } from '../config';
import { BadRequestException, ConflictException, NotFoundException } from '../http';
import { Logger } from '../logger';
import type { Platform, Post, PostDocument, PostMedia } from '../models/post';
import { isValidSlot, SLOT_FIRST_HOUR } from '../slots';
import { removeFiles, uploadDirOf, type StoredRef } from '../storage';
import type { FacebookService } from './facebook.service';
import type { InstagramService } from './instagram.service';
import { isPublishError, PublishError, type LinkedinService } from './linkedin.service';
import type { UsersService } from './users.service';

/** A file received in a multipart request and already written to storage (replaces multer's file). */
export interface UploadedFile extends StoredRef {
  originalname: string;
  mimetype: string;
  size: number;
}

export const MAX_ATTEMPTS = 3;
const MAX_IMAGES = 9;
const IG_MAX_IMAGES = 10;
const BULK_MAX_POSTS = 30;
const CAPTION_LIMIT: Record<Platform, number> = { linkedin: 3000, instagram: 2200, facebook: 63206 };
const PLATFORM_NAMES: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

export interface PostInput {
  platform?: string;
  platforms?: string | string[];
  content?: string;
  scheduledAt?: string;
  removeMedia?: string | string[];
}

/**
 * Multi-day scheduling: one post per day, each with its own slot and optional caption.
 * `scheduledAts` / `captions` have one entry per POST; `assignments` has one entry per uploaded
 * file and names the post (0-based index) that file belongs to, so a day can hold several photos.
 * Without `assignments` every file is its own post (one scheduledAt per file).
 */
export interface BulkPostInput extends PostInput {
  scheduledAts?: string | string[];
  captions?: string | string[];
  assignments?: string | string[];
}

export class PostsService {
  private readonly log = new Logger(PostsService.name);
  readonly uploadDir: string;

  constructor(
    private readonly model: Model<Post>,
    private readonly users: UsersService,
    private readonly linkedin: LinkedinService,
    private readonly instagram: InstagramService,
    private readonly facebook: FacebookService,
    config: ConfigService,
  ) {
    this.uploadDir = uploadDirOf(config);
  }

  // ---------- helpers ----------

  private parsePlatform(raw?: string): Platform {
    if (raw === undefined || raw === '' || raw === 'linkedin') return 'linkedin';
    if (raw === 'instagram') return 'instagram';
    if (raw === 'facebook') return 'facebook';
    throw new BadRequestException('platform must be "linkedin", "instagram", or "facebook"');
  }

  /** Multi-platform input such as "linkedin,instagram,facebook" or repeated fields. */
  private parsePlatforms(raw: string | string[] | undefined): Platform[] {
    const parts = (Array.isArray(raw) ? raw : [raw ?? ''])
      .flatMap((s) => String(s).split(/[\s,]+/))
      .filter(Boolean);
    if (parts.length === 0) return ['linkedin'];
    const out: Platform[] = [];
    for (const p of parts) {
      if (p !== 'linkedin' && p !== 'instagram' && p !== 'facebook') {
        throw new BadRequestException('platforms must be "linkedin", "instagram", and/or "facebook"');
      }
      if (!out.includes(p)) out.push(p);
    }
    return out;
  }

  /** Posts created from one composer share a groupId; legacy posts are their own group. */
  private async groupOf(userId: string, post: PostDocument) {
    if (!post.groupId) return [post];
    return this.model.find({ userId, groupId: post.groupId }).sort({ platform: 1 });
  }

  toDto(p: PostDocument) {
    return {
      id: p.id as string,
      platform: (p.platform ?? 'linkedin') as Platform,
      groupId: p.groupId,
      content: p.content,
      scheduledAt: p.scheduledAt,
      timezone: p.timezone,
      status: p.status,
      attempts: p.attempts,
      lastError: p.lastError,
      linkedinPostUrn: p.linkedinPostUrn,
      permalink: p.permalink,
      publishedAt: p.publishedAt,
      media: p.media.map((m) => ({
        filename: m.filename,
        originalName: m.originalName,
        kind: m.kind,
        size: m.size,
        url: m.url ?? `/uploads/${m.filename}`,
        cleaned: m.cleaned === true,
      })),
    };
  }

  private async deleteFiles(files: StoredRef[]) {
    await removeFiles(this.uploadDir, files);
  }

  /**
   * Media files can be referenced by several posts (one per network in a group, or a published
   * copy of an edited post), so a file is only removed once no post still has to upload it:
   * published copies have already sent their media to the network. Those copies get a `cleaned`
   * flag so the UI stops pointing at a file that is gone from storage.
   */
  private async deleteFilesIfUnused(files: StoredRef[]) {
    if (files.length === 0) return;
    const filenames = files.map((f) => f.filename);
    const pending = await this.model
      .find({ 'media.filename': { $in: filenames }, status: { $in: ['scheduled', 'publishing', 'failed'] } })
      .select('media.filename');
    const needed = new Set(pending.flatMap((p) => p.media.map((m) => m.filename)));
    const unused = files.filter((f) => !needed.has(f.filename));
    if (unused.length === 0) return;
    const unusedNames = unused.map((f) => f.filename);
    // flag first: a half-deleted file must never be shown as a broken thumbnail
    await this.model.updateMany(
      { 'media.filename': { $in: unusedNames }, status: 'published' },
      { $set: { 'media.$[e].cleaned': true } },
      { arrayFilters: [{ 'e.filename': { $in: unusedNames } }] },
    );
    await this.deleteFiles(unused);
  }

  private toMedia(files: UploadedFile[]): PostMedia[] {
    return files.map((f) => ({
      filename: f.filename,
      url: f.url,
      originalName: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      kind: f.mimetype.startsWith('video/') ? 'video' : 'image',
    }));
  }

  /** text + media rules; LinkedIn behaviour is unchanged, Instagram adds its own constraints */
  private validateContent(platform: Platform, content: string, media: PostMedia[]) {
    if (platform === 'instagram') {
      if (media.length === 0) throw new BadRequestException('Instagram posts need an image or a video');
      if (media.some((m) => m.kind === 'image' && m.mimetype !== 'image/jpeg')) {
        throw new BadRequestException('Instagram only accepts JPEG images (PNG/GIF are not supported)');
      }
      if (media.length > IG_MAX_IMAGES) throw new BadRequestException(`At most ${IG_MAX_IMAGES} images per Instagram post`);
    } else if (!content && media.length === 0) {
      throw new BadRequestException('Post needs text or media');
    }
    if (platform === 'facebook' && media.some((m) => !['image/jpeg', 'image/png', 'video/mp4'].includes(m.mimetype))) {
      throw new BadRequestException('Facebook accepts JPEG/PNG images and MP4 video');
    }
    const limit = CAPTION_LIMIT[platform];
    if (content.length > limit) throw new BadRequestException(`Text is limited to ${limit} characters`);
    this.checkMedia(media, platform);
  }

  private checkMedia(media: PostMedia[], platform: Platform = 'linkedin') {
    const videos = media.filter((m) => m.kind === 'video').length;
    if (videos > 1) throw new BadRequestException('Only one video per post');
    if (videos === 1 && media.length > 1) {
      throw new BadRequestException('A post can contain either one video or images, not both');
    }
    const maxImages = platform === 'facebook' ? 10 : MAX_IMAGES;
    if (platform !== 'instagram' && media.length > maxImages) {
      throw new BadRequestException(`At most ${maxImages} images per post`);
    }
  }

  private parseSlot(raw: string | undefined, timezone: string): Date {
    const d = new Date(raw ?? '');
    if (!raw || Number.isNaN(d.getTime())) throw new BadRequestException('scheduledAt is not a valid date');
    if (!isValidSlot(d, timezone)) {
      throw new BadRequestException(
        `Scheduled posts are published once a day at ${SLOT_FIRST_HOUR}:00 AM (${timezone})`,
      );
    }
    return d;
  }

  private async userTz(userId: string) {
    const u = await this.users.findById(userId);
    if (!u) throw new NotFoundException('User not found');
    return u.timezone;
  }

  // ---------- CRUD ----------

  async list(userId: string, from?: string, to?: string, platform?: string) {
    const q: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    const range: Record<string, Date> = {};
    if (from && !Number.isNaN(Date.parse(from))) range.$gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) range.$lt = new Date(to);
    if (Object.keys(range).length) q.scheduledAt = range;
    if (platform === 'instagram' || platform === 'facebook') q.platform = platform;
    else if (platform === 'linkedin') q.platform = { $nin: ['instagram', 'facebook'] }; // legacy docs have no platform
    const posts = await this.model.find(q).sort({ scheduledAt: 1 }).limit(1000);
    return posts.map((p) => this.toDto(p));
  }

  async stats(userId: string) {
    const rows = await this.model.aggregate<{ _id: string; n: number }>([
      { $match: { userId: new Types.ObjectId(userId) } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const out = { scheduled: 0, publishing: 0, published: 0, failed: 0 };
    for (const r of rows) out[r._id as keyof typeof out] = r.n;
    return out;
  }

  async create(userId: string, input: PostInput, files: UploadedFile[]) {
    try {
      const platforms = this.parsePlatforms(input.platforms ?? input.platform);
      const timezone = await this.userTz(userId);
      const content = (input.content ?? '').trim();
      const media = this.toMedia(files);
      // one copy goes to every network, so it must satisfy the strictest target (Instagram)
      for (const platform of platforms) this.validateContent(platform, content, media);

      const scheduledAt = this.parseSlot(input.scheduledAt, timezone);
      if (scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestException('Pick a slot in the future');
      }

      const groupId = new Types.ObjectId().toHexString();
      try {
        const created = await this.model.insertMany(
          platforms.map((platform) => ({ userId, platform, groupId, content, scheduledAt, timezone, media })),
          { ordered: true },
        );
        return created.length === 1 ? this.toDto(created[0]) : created.map((p) => this.toDto(p));
      } catch (e) {
        await this.model.deleteMany({ groupId }); // never keep a half-created group
        if ((e as { code?: number }).code === 11000) {
          throw new ConflictException('You already have a post in that time slot');
        }
        throw e;
      }
    } catch (e) {
      await this.deleteFiles(files);
      throw e;
    }
  }

  /**
   * Plan several days in one request: each uploaded photo becomes its own post (one group per
   * photo) on consecutive slots. Days whose slot is already taken are skipped instead of failing
   * the whole batch, and the skipped slots are returned so the UI can report them.
   */
  async bulkCreate(userId: string, input: BulkPostInput, files: UploadedFile[]) {
    try {
      if (files.length === 0) throw new BadRequestException('Add at least one photo');
      if (files.length > BULK_MAX_POSTS) throw new BadRequestException(`At most ${BULK_MAX_POSTS} posts at once`);

      const platforms = this.parsePlatforms(input.platforms ?? input.platform);
      const timezone = await this.userTz(userId);
      const fallback = (input.content ?? '').trim();
      const captions = [input.captions ?? []].flat();
      const slots = [input.scheduledAts ?? []].flat();
      const postCount = slots.length;
      if (postCount === 0) throw new BadRequestException('Send a scheduledAt for each post');
      if (postCount > BULK_MAX_POSTS) throw new BadRequestException(`At most ${BULK_MAX_POSTS} posts at once`);
      const rawAssign = [input.assignments ?? []]
        .flat()
        .flatMap((x) => String(x).split(','))
        .filter((x) => x.trim() !== '');
      const assignments = rawAssign.length > 0 ? rawAssign.map(Number) : files.map((_, i) => i);
      if (assignments.length !== files.length) {
        throw new BadRequestException('Send one assignment for each photo');
      }
      if (assignments.some((a) => !Number.isInteger(a) || a < 0 || a >= postCount)) {
        throw new BadRequestException('A photo is assigned to a post that does not exist');
      }
      for (let k = 0; k < postCount; k++) {
        if (!assignments.includes(k)) throw new BadRequestException('Every post needs at least one photo');
      }
      if (captions.length > 0 && captions.length !== postCount) {
        throw new BadRequestException('Send one caption for each post, or none at all');
      }

      const media = this.toMedia(files);
      const items = slots.map((slot, k) => {
        const scheduledAt = this.parseSlot(slot, timezone);
        if (scheduledAt.getTime() <= Date.now()) {
          throw new BadRequestException('Every post must be scheduled in the future');
        }
        // an empty per-post caption falls back to the shared default caption
        const content = ((captions[k] ?? '').trim() || fallback).trim();
        const itemMedia = media.filter((_, i) => assignments[i] === k);
        // validate each post against every selected network
        for (const platform of platforms) this.validateContent(platform, content, itemMedia);
        return { content, scheduledAt, media: itemMedia };
      });

      const times = items.map((i) => i.scheduledAt.getTime());
      if (new Set(times).size !== times.length) {
        throw new BadRequestException('Two posts would use the same time slot');
      }

      const existing = await this.model
        .find({ userId, platform: { $in: platforms }, scheduledAt: { $in: times.map((t) => new Date(t)) } })
        .select('scheduledAt');
      const taken = new Set(existing.map((p) => p.scheduledAt.getTime()));

      const toCreate = items.filter((i) => !taken.has(i.scheduledAt.getTime()));
      const skippedItems = items.filter((i) => taken.has(i.scheduledAt.getTime()));
      const skipped = skippedItems.map((i) => i.scheduledAt);

      // photos of skipped days are not referenced by any post, so drop them from disk
      await this.deleteFiles(skippedItems.flatMap((i) => i.media));
      if (toCreate.length === 0) return { count: 0, created: [], skipped };

      const docs = toCreate.flatMap((item) => {
        const groupId = new Types.ObjectId().toHexString();
        return platforms.map((platform) => ({
          userId,
          platform,
          groupId,
          content: item.content,
          scheduledAt: item.scheduledAt,
          timezone,
          media: item.media,
        }));
      });
      const groupIds = docs.map((d) => d.groupId);
      let created: PostDocument[];
      try {
        created = await this.model.insertMany(docs, { ordered: true });
      } catch (e) {
        await this.model.deleteMany({ groupId: { $in: groupIds } }); // never keep a half-created batch
        if ((e as { code?: number }).code === 11000) {
          throw new ConflictException('One of those days already has a post in that time slot');
        }
        throw e;
      }

      return { count: toCreate.length, created: created.map((p) => this.toDto(p)), skipped };
    } catch (e) {
      await this.deleteFiles(files);
      throw e;
    }
  }

  /** Create and publish immediately (no slot). Failures are final - the user is waiting on the result. */
  async createInstant(userId: string, input: PostInput, files: UploadedFile[]) {
    try {
      const platforms = this.parsePlatforms(input.platforms ?? input.platform);
      const timezone = await this.userTz(userId);
      const content = (input.content ?? '').trim();
      const media = this.toMedia(files);
      for (const platform of platforms) this.validateContent(platform, content, media);

      const now = new Date();
      const groupId = new Types.ObjectId().toHexString();
      const created = await this.model
        .insertMany(
          platforms.map((platform) => ({
            userId,
            platform,
            groupId,
            content,
            media,
            timezone,
            scheduledAt: now,
            status: 'publishing',
            lockedAt: now,
            attempts: MAX_ATTEMPTS, // no automatic retries
          })),
          { ordered: true },
        )
        .catch(async (e) => {
          await this.model.deleteMany({ groupId }); // never leave half-published copies behind
          throw e;
        });

      const results: PostDocument[] = [];
      for (const post of created) results.push(await this.publishClaimed(post));
      const failed = results.filter((r) => r.status !== 'published');
      if (failed.length) {
        // one network can succeed while the other fails - report the failed copy but keep both
        const msg = failed
          .map((r) =>
            results.length === 1
              ? (r.lastError ?? 'Publishing failed')
              : `${PLATFORM_NAMES[r.platform]}: ${r.lastError ?? 'Publishing failed'}`,
          )
          .join(' · ');
        throw new BadRequestException(msg);
      }
      return results.length === 1 ? this.toDto(results[0]) : results.map((r) => this.toDto(r));
    } catch (e) {
      // keep media of a failed publish (the post is kept as "failed"); drop it for validation errors
      const referenced = await this.model.exists({ 'media.filename': { $in: files.map((f) => f.filename) } });
      if (!referenced) await this.deleteFiles(files);
      throw e;
    }
  }

  async update(userId: string, id: string, input: PostInput, files: UploadedFile[]) {
    try {
      const post = await this.findOwned(userId, id);
      if (post.status === 'publishing' || post.status === 'published') {
        throw new BadRequestException(`A ${post.status} post can no longer be edited`);
      }
      const timezone = await this.userTz(userId);

      const group = await this.groupOf(userId, post);
      const editable = group.filter((p) => p.status === 'scheduled' || p.status === 'failed');
      if (editable.length === 0) {
        throw new BadRequestException('This post is already published and can no longer be edited');
      }

      const content = input.content !== undefined ? input.content.trim() : post.content;

      const remove = new Set([input.removeMedia ?? []].flat());
      const kept = post.media.filter((m) => !remove.has(m.filename));
      const removedFiles = post.media.filter((m) => remove.has(m.filename));
      const media = [...kept, ...this.toMedia(files)];
      // the same copy is published to every network in the group, so validate it for all of them
      for (const p of editable) this.validateContent(this.parsePlatform(p.platform), content, media);

      let scheduledAt = post.scheduledAt;
      if (input.scheduledAt) {
        scheduledAt = this.parseSlot(input.scheduledAt, timezone);
      }
      const rescheduled = scheduledAt.getTime() !== post.scheduledAt.getTime();
      // failed posts need a future slot when they are put back in the queue
      if ((rescheduled || editable.some((p) => p.status === 'failed')) && scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestException('Pick a slot in the future');
      }

      const ids = editable.map((p) => p._id);
      const clash = await this.model.exists({
        userId,
        scheduledAt,
        platform: { $in: editable.map((p) => p.platform) },
        _id: { $nin: ids },
      });
      if (clash) throw new ConflictException('You already have a post in that time slot');

      // edit the whole composed post at once (published copies are left untouched)
      await this.model.updateMany(
        { _id: { $in: ids } },
        {
          content,
          media,
          scheduledAt,
          timezone,
          status: 'scheduled',
          attempts: 0,
          $unset: { lastError: 1, lockedAt: 1, retryAfter: 1 },
        },
      );
      await this.deleteFilesIfUnused(removedFiles);

      const updated = await this.model.findById(post._id);
      if (!updated) throw new NotFoundException('Post not found');
      return this.toDto(updated);
    } catch (e) {
      await this.deleteFiles(files);
      throw e;
    }
  }

  async remove(userId: string, id: string) {
    const post = await this.findOwned(userId, id);
    const group = await this.groupOf(userId, post);
    // deleting a composed post removes its copies on the other networks too
    const deletable = group.filter((p) => p.status !== 'publishing');
    if (deletable.length === 0) throw new ConflictException('Post is being published right now');
    await this.model.deleteMany({ _id: { $in: deletable.map((p) => p._id) } });
    await this.deleteFilesIfUnused([
      ...new Map(deletable.flatMap((p) => p.media).map((m) => [m.filename, m] as const)).values(),
    ]);
    return { ok: true };
  }

  private async findOwned(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Post not found');
    const post = await this.model.findOne({ _id: id, userId });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  // ---------- publishing ----------

  /** Manual "post now" (also handy to verify the connection end to end). Publishes the whole group. */
  async publishNow(userId: string, id: string) {
    const owned = await this.findOwned(userId, id);
    const group = await this.groupOf(userId, owned);
    const targets = group.filter((p) => p.status === 'scheduled' || p.status === 'failed');
    if (targets.length === 0) throw new ConflictException('Post is not in a publishable state');

    const claimed: PostDocument[] = [];
    for (const target of targets) {
      const c = await this.model.findOneAndUpdate(
        { _id: target._id, status: { $in: ['scheduled', 'failed'] } },
        { status: 'publishing', lockedAt: new Date(), $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      );
      if (c) claimed.push(c);
    }
    if (claimed.length === 0) throw new ConflictException('Post is not in a publishable state');

    const results: PostDocument[] = [];
    for (const post of claimed) results.push(await this.publishClaimed(post));
    const failed = results.filter((r) => r.status !== 'published');
    if (failed.length) {
      const msg = failed
        .map((r) =>
          results.length === 1
            ? (r.lastError ?? 'Publishing failed')
            : `${PLATFORM_NAMES[r.platform]}: ${r.lastError ?? 'Publishing failed'}`,
        )
        .join(' · ');
      throw new BadRequestException(msg);
    }
    return results.length === 1 ? this.toDto(results[0]) : results.map((r) => this.toDto(r));
  }

  /** Atomically claim the next due post, or null. */
  claimNextDue(now: Date, notBefore: Date) {
    return this.model.findOneAndUpdate(
      {
        status: 'scheduled',
        scheduledAt: { $lte: now, $gte: notBefore },
        $or: [{ retryAfter: null }, { retryAfter: { $lte: now } }],
      },
      { status: 'publishing', lockedAt: now, $inc: { attempts: 1 } },
      { sort: { scheduledAt: 1 }, returnDocument: 'after' },
    );
  }

  /** Posts that stayed overdue longer than the grace window are not published late. */
  async failMissed(notBefore: Date) {
    const res = await this.model.updateMany(
      { status: 'scheduled', scheduledAt: { $lt: notBefore } },
      { status: 'failed', lastError: 'Missed: the server could not publish this post in time' },
    );
    return res.modifiedCount;
  }

  /** A crash mid-publish leaves posts "publishing"; put them back in the queue. */
  async releaseStuck(olderThan: Date) {
    const res = await this.model.updateMany(
      { status: 'publishing', lockedAt: { $lt: olderThan } },
      { status: 'scheduled' },
    );
    return res.modifiedCount;
  }

  async publishClaimed(post: PostDocument): Promise<PostDocument> {
    try {
      if (post.platform === 'instagram') {
        const r = await this.instagram.publish(
          post.userId.toString(),
          post.content,
          post.media.map((m) => ({ path: join(this.uploadDir, m.filename), url: m.url, kind: m.kind })),
        );
        post.set({
          status: 'published',
          remoteId: r.id,
          permalink: r.permalink,
          publishedAt: new Date(),
          lastError: undefined,
        });
        this.log.log(`Published Instagram post ${post.id} -> ${r.id}`);
      } else if (post.platform === 'facebook') {
        const r = await this.facebook.publish(
          post.userId.toString(),
          post.content,
          post.media.map((m) => ({ url: m.url ?? this.facebook.mediaUrl(m.filename), kind: m.kind })),
        );
        post.set({
          status: 'published',
          remoteId: r.id,
          permalink: r.permalink,
          publishedAt: new Date(),
          lastError: undefined,
        });
        this.log.log(`Published Facebook post ${post.id} -> ${r.id}`);
      } else {
        const urn = await this.linkedin.publish(
          post.userId.toString(),
          post.content,
          post.media.map((m) => ({
            path: join(this.uploadDir, m.filename),
            url: m.url,
            kind: m.kind,
            mimetype: m.mimetype,
          })),
        );
        post.set({
          status: 'published',
          linkedinPostUrn: urn,
          permalink: `https://www.linkedin.com/feed/update/${urn}`,
          publishedAt: new Date(),
          lastError: undefined,
        });
        this.log.log(`Published post ${post.id} -> ${urn}`);
      }
    } catch (e) {
      const err = isPublishError(e) ? e : new PublishError((e as Error).message, true);
      const giveUp = !err.retryable || post.attempts >= MAX_ATTEMPTS;
      post.set({
        status: giveUp ? 'failed' : 'scheduled',
        lastError: err.message,
        retryAfter: giveUp ? undefined : new Date(Date.now() + 10 * 60_000),
      });
      this.log.warn(`Post ${post.id} attempt ${post.attempts} failed: ${err.message}`);
    }
    post.lockedAt = undefined;
    const saved = await post.save();
    if (saved.status === 'published') {
      // the network has its copy of the media now, so drop the files from storage;
      // best effort - publishing already succeeded, the sweep retries whatever is left
      await this.deleteFilesIfUnused(saved.media).catch((e: Error) =>
        this.log.warn(`Could not clean media of post ${saved.id}: ${e.message}`),
      );
    }
    return saved;
  }

  /**
   * Backstop for media that outlived its publish (a crash between save and cleanup) and for posts
   * published before cleanup existed: drop the files no pending post needs and flag them.
   */
  async cleanupPublishedMedia(limit = 200) {
    const posts = await this.model
      .find({ status: 'published', media: { $elemMatch: { cleaned: { $ne: true } } } })
      .limit(limit);
    for (const post of posts) {
      await this.deleteFilesIfUnused(post.media).catch((e: Error) =>
        this.log.warn(`Could not clean media of post ${post.id}: ${e.message}`),
      );
    }
    return posts.length;
  }
}
