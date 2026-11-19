import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { appBaseUrl, ConfigService } from '../config';
import { BadRequestException, ServiceUnavailableException } from '../http';
import { JwtService } from '../jwt';
import { Logger } from '../logger';
import { blobEnabled, putFile, readStored, removeFiles, uploadDirOf, type StoredRef } from '../storage';
import { PublishError } from './linkedin.service';
import type { UsersService } from './users.service';

export interface InstagramMedia {
  path: string;
  /** public URL when stored in object storage (then `path` is not on local disk) */
  url?: string;
  kind: 'image' | 'video';
}

interface PreparedMedia {
  url: string;
  kind: 'image' | 'video';
  /** derived file that is deleted again once publishing finished */
  temporary?: StoredRef;
}

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
  error_message?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const INSTAGRAM_MIN_ASPECT = 4 / 5;
const INSTAGRAM_MAX_ASPECT = 1.91;
const INSTAGRAM_MIN_DIMENSION = 320;
const INSTAGRAM_MAX_CAROUSEL_ITEMS = 10;

/** Instagram API with Instagram Login (professional - Business/Creator - accounts). */
export class InstagramService {
  private readonly log = new Logger(InstagramService.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  private get graph() {
    return `https://graph.instagram.com/${this.config.get('INSTAGRAM_API_VERSION') ?? 'v23.0'}`;
  }

  private get uploadDir() {
    return uploadDirOf(this.config);
  }

  /** Public base URL of this server (OAuth redirect + media URLs). Must be reachable by Instagram. */
  get publicBase(): string {
    return (this.config.get<string>('PUBLIC_URL') || appBaseUrl(this.config)).replace(/\/$/, '');
  }

  mediaUrl(filename: string) {
    return `${this.publicBase}/uploads/${filename}`;
  }

  private creds() {
    const appId = this.config.get<string>('INSTAGRAM_APP_ID');
    const appSecret = this.config.get<string>('INSTAGRAM_APP_SECRET');
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException('Instagram integration is not configured on the server');
    }
    return { appId, appSecret, redirectUri: `${this.publicBase}/api/instagram/callback` };
  }

  // ---------------- OAuth ----------------

  async connectUrl(userId: string) {
    const c = this.creds();
    const state = await this.jwt.signAsync({ sub: userId, typ: 'instagram-state' }, { expiresIn: '10m' });
    const q = new URLSearchParams({
      client_id: c.appId,
      redirect_uri: c.redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_content_publish',
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  }

  async handleCallback(code: string, state: string) {
    const c = this.creds();
    let userId: string;
    try {
      const s = await this.jwt.verifyAsync<{ sub: string; typ: string }>(state);
      if (s.typ !== 'instagram-state') throw new Error();
      userId = s.sub;
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    // 1) code -> short-lived token (1h)
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.appId,
        client_secret: c.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: c.redirectUri,
        code: code.replace(/#_$/, ''),
      }),
    });
    if (!shortRes.ok) {
      this.log.warn(`Instagram code exchange failed: ${shortRes.status} ${await shortRes.text()}`);
      throw new BadRequestException('Instagram token exchange failed');
    }
    const short = (await shortRes.json()) as { access_token: string };

    // 2) short-lived -> long-lived token (~60 days)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: c.appSecret,
        access_token: short.access_token,
      })}`,
    );
    if (!longRes.ok) {
      this.log.warn(`Instagram long-lived exchange failed: ${longRes.status} ${await longRes.text()}`);
      throw new BadRequestException('Instagram long-lived token exchange failed');
    }
    const long = (await longRes.json()) as { access_token: string; expires_in: number };

    // 3) profile
    const meRes = await fetch(
      `${this.graph}/me?${new URLSearchParams({
        fields: 'user_id,username,profile_picture_url,account_type',
        access_token: long.access_token,
      })}`,
    );
    if (!meRes.ok) throw new BadRequestException('Could not read Instagram profile');
    const me = (await meRes.text()).replace(/"user_id":\s*(\d+)/, '"user_id":"$1"'); // keep big ids exact
    const p = JSON.parse(me) as {
      user_id?: string;
      username: string;
      profile_picture_url?: string;
      account_type?: string;
    };
    if (p.account_type && !['BUSINESS', 'MEDIA_CREATOR'].includes(p.account_type)) {
      throw new BadRequestException('Only Instagram Business or Creator accounts can publish - switch the account type in Instagram settings');
    }

    await this.users.setInstagram(userId, {
      igUserId: p.user_id,
      username: p.username,
      picture: p.profile_picture_url,
      accessToken: long.access_token,
      expiresAt: new Date(Date.now() + long.expires_in * 1000),
    });
    return userId;
  }

  disconnect(userId: string) {
    return this.users.clearInstagram(userId);
  }

  /** Long-lived tokens can be refreshed (>24h old, not expired) - do it before the last 15 days. */
  async refreshExpiring() {
    const ids = await this.users.findInstagramExpiringIds(new Date(Date.now() + 15 * 86400_000));
    for (const id of ids) {
      try {
        const cred = await this.users.getInstagramCredentials(id);
        if (!cred) continue;
        const last = (cred.refreshedAt ?? cred.connectedAt).getTime();
        if (Date.now() - last < 25 * 3600_000) continue;
        const res = await fetch(
          `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
            grant_type: 'ig_refresh_token',
            access_token: cred.accessToken,
          })}`,
        );
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const t = (await res.json()) as { access_token: string; expires_in: number };
        await this.users.updateInstagramToken(id, t.access_token, new Date(Date.now() + t.expires_in * 1000));
        this.log.log(`Refreshed Instagram token for user ${id}`);
      } catch (e) {
        this.log.warn(`Instagram token refresh failed for ${id}: ${(e as Error).message}`);
      }
    }
  }

  // ---------------- Publishing ----------------

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    token: string,
    params: Record<string, string> = {},
    context = `${method} ${path}`,
  ): Promise<T> {
    const all = new URLSearchParams({ ...params, access_token: token });
    let res: Response;
    try {
      res =
        method === 'GET'
          ? await fetch(`${this.graph}${path}?${all}`)
          : await fetch(`${this.graph}${path}`, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: all,
            });
    } catch (e) {
      throw new PublishError(`Network error: ${(e as Error).message}`, true);
    }
    const text = await res.text();
    if (res.ok) return JSON.parse(text.replace(/"id":\s*(\d{15,})/g, '"id":"$1"')) as T;

    let body: GraphError = {};
    try {
      body = JSON.parse(text) as GraphError;
    } catch {
      /* not json */
    }
    const code = body.error?.code;
    const msg = body.error?.message ?? body.error_message ?? text.slice(0, 300);
    if (code === 190 || res.status === 401) {
      throw new PublishError('Instagram session expired or revoked - reconnect your Instagram account', false);
    }
    const retryable = res.status >= 500 || [1, 2, 4, 17, 32, 341, 613].includes(code ?? -1);
    const codeInfo = code === undefined ? '' : ` (code ${code}${body.error?.error_subcode ? `/${body.error.error_subcode}` : ''})`;
    throw new PublishError(`Instagram API ${res.status}${codeInfo} while ${context}: ${msg}`, retryable);
  }

  /**
   * Instagram accepts photos only within a fixed aspect range. Tall/wide screenshots are divided
   * into ordered carousel panels so the full image is preserved instead of silently cropped.
   */
  private async prepareMedia(media: InstagramMedia[]): Promise<PreparedMedia[]> {
    const prepared: PreparedMedia[] = [];
    try {
      for (const item of media) {
        if (item.kind === 'video') {
          prepared.push({ url: item.url ?? this.mediaUrl(basename(item.path)), kind: item.kind });
          continue;
        }

        let image: Buffer;
        try {
          image = await sharp(await readStored(item), { limitInputPixels: 100_000_000 })
            .rotate()
            .jpeg({ quality: 90 })
            .toBuffer();
        } catch (e) {
          throw new PublishError(`Instagram image could not be decoded: ${(e as Error).message}`, false);
        }
        const { width, height } = await sharp(image).metadata();
        if (!width || !height || width < INSTAGRAM_MIN_DIMENSION || height < INSTAGRAM_MIN_DIMENSION) {
          throw new PublishError(
            `Instagram photos must be at least ${INSTAGRAM_MIN_DIMENSION} × ${INSTAGRAM_MIN_DIMENSION} pixels`,
            false,
          );
        }

        const aspect = width / height;
        if (aspect >= INSTAGRAM_MIN_ASPECT && aspect <= INSTAGRAM_MAX_ASPECT) {
          const filename = `instagram-${randomUUID()}.jpg`;
          const jpeg = await sharp(image).jpeg({ quality: 90 }).toBuffer();
          const temporary = await putFile(this.uploadDir, filename, jpeg, 'image/jpeg');
          prepared.push({ url: temporary.url ?? this.mediaUrl(filename), kind: 'image', temporary });
          continue;
        }

        const vertical = aspect < INSTAGRAM_MIN_ASPECT;
        const count = vertical
          ? Math.ceil(height / (width / INSTAGRAM_MIN_ASPECT))
          : Math.ceil(width / (height * INSTAGRAM_MAX_ASPECT));
        for (let i = 0; i < count; i++) {
          const left = vertical ? 0 : Math.floor((i * width) / count);
          const top = vertical ? Math.floor((i * height) / count) : 0;
          const right = vertical ? width : Math.floor(((i + 1) * width) / count);
          const bottom = vertical ? Math.floor(((i + 1) * height) / count) : height;
          const filename = `instagram-${randomUUID()}.jpg`;
          const panel = await sharp(image)
            .extract({ left, top, width: right - left, height: bottom - top })
            .jpeg({ quality: 90 })
            .toBuffer();
          const temporary = await putFile(this.uploadDir, filename, panel, 'image/jpeg');
          prepared.push({ url: temporary.url ?? this.mediaUrl(filename), kind: 'image', temporary });
        }
      }

      if (prepared.length > INSTAGRAM_MAX_CAROUSEL_ITEMS) {
        throw new PublishError(
          `Instagram allows up to ${INSTAGRAM_MAX_CAROUSEL_ITEMS} carousel items after fitting photos to its aspect ratio`,
          false,
        );
      }
      if (prepared.length > 1 && prepared.some((item) => item.kind === 'video')) {
        throw new PublishError(
          'Instagram carousel videos are not supported by this scheduler; publish the video separately',
          false,
        );
      }
      return prepared;
    } catch (e) {
      await this.removeTemporary(prepared);
      throw e;
    }
  }

  private removeTemporary(prepared: PreparedMedia[]) {
    return removeFiles(
      this.uploadDir,
      prepared.flatMap((item) => (item.temporary ? [item.temporary] : [])),
    );
  }

  private async verifyPublicMedia(media: PreparedMedia[]) {
    for (const item of media) {
      let response: Response;
      try {
        response = await fetch(item.url, {
          headers: { range: 'bytes=0-15' },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        throw new PublishError(
          `Instagram cannot reach the media URL configured by PUBLIC_URL (${item.url}). Use an anonymous, public HTTPS URL that serves backend /uploads directly. ${(e as Error).message}`,
          false,
        );
      }

      const expectedType = item.kind === 'image' ? 'image/jpeg' : 'video/mp4';
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (!response.ok || contentType !== expectedType || !response.body) {
        await response.body?.cancel();
        throw new PublishError(
          `The media URL configured by PUBLIC_URL did not return ${expectedType} (HTTP ${response.status}, received ${contentType ?? 'no content type'}). Use an anonymous, public HTTPS URL that serves backend /uploads directly.`,
          false,
        );
      }

      const reader = response.body.getReader();
      let prefix: Uint8Array;
      try {
        const first = await reader.read();
        if (first.done || first.value.length < 3) {
          throw new PublishError('The public Instagram media URL returned an empty file', false);
        }
        prefix = first.value;
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (
        item.kind === 'image' &&
        !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)
      ) {
        throw new PublishError(
          'The public Instagram media URL claims to be JPEG but does not return JPEG image data. Check PUBLIC_URL and its /uploads proxy.',
          false,
        );
      }
      if (
        item.kind === 'video' &&
        !(prefix.length >= 8 && String.fromCharCode(...prefix.slice(4, 8)) === 'ftyp')
      ) {
        throw new PublishError(
          'The public Instagram media URL claims to be MP4 but does not return MP4 video data. Check PUBLIC_URL and its /uploads proxy.',
          false,
        );
      }
    }
  }

  /** Wait until Instagram has finished downloading/processing the media container. */
  private async waitReady(token: string, containerId: string, isVideo: boolean) {
    const tries = isVideo ? 40 : 10; // videos: up to ~3.5 min
    for (let i = 0; i < tries; i++) {
      const s = await this.call<{ status_code?: string; status?: string }>('GET', `/${containerId}`, token, {
        fields: 'status_code,status',
      });
      if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
        throw new PublishError(`Instagram could not process the media: ${s.status ?? s.status_code}`, false);
      }
      await sleep(isVideo ? 5000 : 2000);
    }
    throw new PublishError('Instagram is still processing the media (timed out)', true);
  }

  /** Publishes as the connected account. Returns { id, permalink }. */
  async publish(userId: string, caption: string, media: InstagramMedia[]) {
    const cred = await this.users.getInstagramCredentials(userId);
    if (!cred) throw new PublishError('Instagram account is not connected', false);
    if (cred.expiresAt.getTime() < Date.now()) {
      throw new PublishError('Instagram connection expired - reconnect your Instagram account', false);
    }
    if (media.length === 0) throw new PublishError('Instagram posts need an image or a video', false);
    if (!cred.igUserId) {
      throw new PublishError('Instagram account details are incomplete - reconnect your Instagram account', false);
    }
    // media in object storage (Vercel Blob) already has a public HTTPS URL; local-disk media is
    // served by this app and needs a public base URL
    if (!blobEnabled()) {
      let publicUrl: URL;
      try {
        publicUrl = new URL(this.publicBase);
      } catch {
        throw new PublishError('Set PUBLIC_URL to a public HTTPS URL so Instagram can download your media', false);
      }
      if (
        publicUrl.protocol !== 'https:' ||
        ['localhost', '127.0.0.1', '::1'].includes(publicUrl.hostname) ||
        publicUrl.hostname.endsWith('.local')
      ) {
        throw new PublishError('Set PUBLIC_URL to a public HTTPS URL so Instagram can download your media', false);
      }
    }
    const t = cred.accessToken;
    const prepared = await this.prepareMedia(media);

    try {
      await this.verifyPublicMedia(prepared);
      let creationId: string;
      const mediaPath = `/${cred.igUserId}/media`;
      if (prepared.length === 1) {
        const m = prepared[0];
        const c = await this.call<{ id: string }>(
          'POST',
          mediaPath,
          t,
          {
            caption,
            ...(m.kind === 'video'
              ? { media_type: 'REELS', video_url: m.url }
              : { image_url: m.url }),
          },
          'creating the photo or video container',
        );
        creationId = c.id;
        await this.waitReady(t, creationId, m.kind === 'video');
      } else {
        const children: string[] = [];
        for (const m of prepared) {
          const c = await this.call<{ id: string }>(
            'POST',
            mediaPath,
            t,
            {
              image_url: m.url,
              is_carousel_item: 'true',
            },
            'creating a carousel photo container',
          );
          await this.waitReady(t, c.id, false);
          children.push(c.id);
        }
        const c = await this.call<{ id: string }>(
          'POST',
          mediaPath,
          t,
          {
            media_type: 'CAROUSEL',
            children: children.join(','),
            caption,
          },
          'creating the carousel container',
        );
        creationId = c.id;
        await this.waitReady(t, creationId, false);
      }

      const pub = await this.call<{ id: string }>(
        'POST',
        `/${cred.igUserId}/media_publish`,
        t,
        { creation_id: creationId },
        'publishing the media container',
      );
      let permalink: string | undefined;
      try {
        permalink = (
          await this.call<{ permalink?: string }>('GET', `/${pub.id}`, t, { fields: 'permalink' })
        ).permalink;
      } catch {
        /* permalink is only cosmetic */
      }
      return { id: pub.id, permalink };
    } finally {
      await this.removeTemporary(prepared);
    }
  }
}
