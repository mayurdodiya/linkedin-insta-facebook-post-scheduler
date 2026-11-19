import { appBaseUrl, ConfigService } from '../config';
import { BadRequestException, ServiceUnavailableException } from '../http';
import { JwtService } from '../jwt';
import { Logger } from '../logger';
import { readStored } from '../storage';
import type { UsersService } from './users.service';

export class PublishError extends Error {
  constructor(
    message: string,
    /** true = transient (network / 5xx / rate-limit): worth retrying on a later run */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

/** The bundler may load this module more than once, so don't rely on `instanceof` alone. */
export function isPublishError(e: unknown): e is PublishError {
  return (
    e instanceof PublishError ||
    (e instanceof Error && e.name === 'PublishError' && typeof (e as PublishError).retryable === 'boolean')
  );
}

export interface PublishMedia {
  path: string;
  /** public URL when stored in object storage (then `path` is not on local disk) */
  url?: string;
  kind: 'image' | 'video';
  mimetype: string;
}

const API = 'https://api.linkedin.com/v2';

export class LinkedinService {
  private readonly log = new Logger(LinkedinService.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  // ---------------- OAuth ----------------

  private creds() {
    const clientId = this.config.get<string>('LINKEDIN_CLIENT_ID');
    const clientSecret = this.config.get<string>('LINKEDIN_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException('LinkedIn integration is not configured on the server');
    }
    return {
      clientId,
      clientSecret,
      redirectUri: `${appBaseUrl(this.config)}/api/linkedin/callback`,
    };
  }

  async connectUrl(userId: string) {
    const c = this.creds();
    const state = await this.jwt.signAsync({ sub: userId, typ: 'linkedin-state' }, { expiresIn: '10m' });
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: c.redirectUri,
      state,
      scope: 'openid profile email w_member_social',
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  }

  /** Completes the OAuth flow and stores the (encrypted) token on the user. */
  async handleCallback(code: string, state: string) {
    const c = this.creds();
    let userId: string;
    try {
      const s = await this.jwt.verifyAsync<{ sub: string; typ: string }>(state);
      if (s.typ !== 'linkedin-state') throw new Error();
      userId = s.sub;
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: c.redirectUri,
        client_id: c.clientId,
        client_secret: c.clientSecret,
      }),
    });
    if (!tokenRes.ok) {
      this.log.warn(`LinkedIn token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
      throw new BadRequestException('LinkedIn token exchange failed');
    }
    const tok = (await tokenRes.json()) as { access_token: string; expires_in: number };

    const infoRes = await fetch(`${API}/userinfo`, {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    if (!infoRes.ok) throw new BadRequestException('Could not read LinkedIn profile');
    const p = (await infoRes.json()) as { sub: string; name?: string; picture?: string };

    await this.users.setLinkedin(userId, {
      personUrn: `urn:li:person:${p.sub}`,
      name: p.name,
      picture: p.picture,
      accessToken: tok.access_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000),
    });
    return userId;
  }

  disconnect(userId: string) {
    return this.users.clearLinkedin(userId);
  }

  // ---------------- Publishing ----------------

  private headers(token: string, json = true): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      'X-Restli-Protocol-Version': '2.0.0',
      ...(json ? { 'content-type': 'application/json' } : {}),
    };
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new PublishError(`Network error: ${(e as Error).message}`, true);
    }
    if (res.ok) return res;
    const body = (await res.text()).slice(0, 500);
    if (res.status === 401) {
      throw new PublishError('LinkedIn session expired or revoked - reconnect your LinkedIn account', false);
    }
    const retryable = res.status === 429 || res.status >= 500;
    throw new PublishError(`LinkedIn API ${res.status}: ${body}`, retryable);
  }

  private async uploadMedia(token: string, owner: string, m: PublishMedia): Promise<string> {
    const recipe = m.kind === 'video' ? 'feedshare-video' : 'feedshare-image';
    const reg = await this.call(`${API}/assets?action=registerUpload`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: [`urn:li:digitalmediaRecipe:${recipe}`],
          owner,
          serviceRelationships: [
            { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
          ],
        },
      }),
    });
    const { value } = (await reg.json()) as {
      value: {
        asset: string;
        uploadMechanism: Record<string, { uploadUrl: string }>;
      };
    };
    const uploadUrl =
      value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
    if (!uploadUrl) throw new PublishError('LinkedIn did not return an upload URL', true);

    let data: Buffer;
    try {
      data = await readStored(m);
    } catch {
      throw new PublishError('Media file is missing on the server', false);
    }
    await this.call(uploadUrl, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(data),
    });
    return value.asset;
  }

  /** Publishes a post as the user. Returns the LinkedIn post URN. */
  async publish(userId: string, text: string, media: PublishMedia[]): Promise<string> {
    const cred = await this.users.getLinkedinCredentials(userId);
    if (!cred) throw new PublishError('LinkedIn account is not connected', false);
    if (cred.expiresAt.getTime() < Date.now()) {
      throw new PublishError('LinkedIn connection expired - reconnect your LinkedIn account', false);
    }

    const assets: string[] = [];
    for (const m of media) assets.push(await this.uploadMedia(cred.accessToken, cred.personUrn, m));

    const category = media.length === 0 ? 'NONE' : media[0].kind === 'video' ? 'VIDEO' : 'IMAGE';
    const res = await this.call(`${API}/ugcPosts`, {
      method: 'POST',
      headers: this.headers(cred.accessToken),
      body: JSON.stringify({
        author: cred.personUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: category,
            ...(assets.length
              ? { media: assets.map((a) => ({ status: 'READY', media: a })) }
              : {}),
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    });
    const urn =
      res.headers.get('x-restli-id') ?? ((await res.json().catch(() => ({}))) as { id?: string }).id;
    if (!urn) throw new PublishError('LinkedIn accepted the post but returned no id', false);
    return urn;
  }
}
