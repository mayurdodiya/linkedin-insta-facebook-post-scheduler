import { appBaseUrl, ConfigService } from '../config';
import { BadRequestException, ServiceUnavailableException } from '../http';
import { JwtService } from '../jwt';
import { Logger } from '../logger';
import { PublishError } from './linkedin.service';
import type { UsersService } from './users.service';

export interface FacebookMedia {
  url: string;
  kind: 'image' | 'video';
}

interface GraphError {
  error?: { message?: string; code?: number };
}

interface FacebookPageResponse {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
}

export class FacebookService {
  private readonly log = new Logger(FacebookService.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  private get graph() {
    return `https://graph.facebook.com/${this.config.get('FACEBOOK_API_VERSION') ?? 'v23.0'}`;
  }

  private get publicBase() {
    return (this.config.get<string>('PUBLIC_URL') || appBaseUrl(this.config)).replace(/\/$/, '');
  }

  mediaUrl(filename: string) {
    return `${this.publicBase}/uploads/${filename}`;
  }

  private credentials() {
    const appId = this.config.get<string>('FACEBOOK_APP_ID');
    const appSecret = this.config.get<string>('FACEBOOK_APP_SECRET');
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException('Facebook integration is not configured on the server');
    }
    return {
      appId,
      appSecret,
      redirectUri: `${appBaseUrl(this.config)}/api/facebook/callback`,
    };
  }

  async connectUrl(userId: string) {
    const c = this.credentials();
    const state = await this.jwt.signAsync({ sub: userId, typ: 'facebook-state' }, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: c.appId,
      redirect_uri: c.redirectUri,
      response_type: 'code',
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts',
      state,
    });
    return `https://www.facebook.com/${this.config.get('FACEBOOK_API_VERSION') ?? 'v23.0'}/dialog/oauth?${params}`;
  }

  async handleCallback(code: string, state: string) {
    const c = this.credentials();
    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(state);
      if (payload.typ !== 'facebook-state') throw new Error();
      userId = payload.sub;
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    const shortToken = await this.graphRequest<{ access_token: string }>(
      '/oauth/access_token',
      new URLSearchParams({
        client_id: c.appId,
        client_secret: c.appSecret,
        redirect_uri: c.redirectUri,
        code,
      }),
      'GET',
      true,
    );
    const longToken = await this.graphRequest<{ access_token: string }>(
      '/oauth/access_token',
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: c.appId,
        client_secret: c.appSecret,
        fb_exchange_token: shortToken.access_token,
      }),
      'GET',
      true,
    );

    const pages: FacebookPageResponse[] = [];
    let after: string | undefined;
    do {
      const params = new URLSearchParams({
        fields: 'id,name,access_token,picture{url}',
        limit: '100',
        access_token: longToken.access_token,
      });
      if (after) params.set('after', after);
      const result = await this.graphRequest<{
        data: FacebookPageResponse[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>('/me/accounts', params, 'GET', true);
      pages.push(...result.data);
      after = result.paging?.next ? result.paging.cursors?.after : undefined;
    } while (after);

    if (pages.length === 0) {
      throw new BadRequestException(
        'No Facebook Pages are available. Grant access to at least one Page and reconnect.',
      );
    }
    const saved = await this.users.setFacebookPages(
      userId,
      pages.map((page) => ({
        id: page.id,
        name: page.name,
        picture: page.picture?.data?.url,
        accessToken: page.access_token,
      })),
    );
    if (!saved) throw new BadRequestException('The connected user no longer exists');
    return userId;
  }

  async selectPage(userId: string, pageId: string) {
    if (!pageId || !(await this.users.selectFacebookPage(userId, pageId))) {
      throw new BadRequestException('Choose a Facebook Page that you manage');
    }
    return { ok: true };
  }

  disconnect(userId: string) {
    return this.users.clearFacebook(userId);
  }

  private async graphRequest<T>(
    path: string,
    params: URLSearchParams,
    method: 'GET' | 'POST' = 'GET',
    oauth = false,
  ): Promise<T> {
    let response: Response;
    try {
      response =
        method === 'GET'
          ? await fetch(`${this.graph}${path}?${params}`)
          : await fetch(`${this.graph}${path}`, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: params,
            });
    } catch (e) {
      if (oauth) throw new BadRequestException('Facebook could not be reached during authorization');
      throw new PublishError(`Network error: ${(e as Error).message}`, true);
    }
    const text = await response.text();
    if (!response.ok) {
      let body: GraphError = {};
      try {
        body = JSON.parse(text) as GraphError;
      } catch {
        // Graph API may return a non-JSON error body.
      }
      if (oauth) throw new BadRequestException(body.error?.message ?? 'Facebook authorization failed');
      const code = body.error?.code;
      if (code === 190 || response.status === 401) {
        throw new PublishError('Facebook Page access expired or was revoked - reconnect Facebook', false);
      }
      const retryable = response.status === 429 || response.status >= 500 || [1, 2, 4, 17, 32, 613].includes(code ?? -1);
      throw new PublishError(
        `Facebook API ${response.status}: ${body.error?.message ?? text.slice(0, 300)}`,
        retryable,
      );
    }
    const json = text.replace(/"id":\s*(\d{15,})/g, '"id":"$1"');
    return JSON.parse(json) as T;
  }

  private async publishRequest<T>(path: string, accessToken: string, values: Record<string, string>) {
    return this.graphRequest<T>(
      path,
      new URLSearchParams({ ...values, access_token: accessToken }),
      'POST',
    );
  }

  private async permalink(id: string, accessToken: string) {
    try {
      const params = new URLSearchParams({ fields: 'permalink_url', access_token: accessToken });
      return (await this.graphRequest<{ permalink_url?: string }>(`/${id}`, params)).permalink_url;
    } catch (e) {
      this.log.warn(`Facebook permalink unavailable: ${(e as Error).message}`);
      return undefined;
    }
  }

  async publish(userId: string, message: string, media: FacebookMedia[]) {
    const page = await this.users.getFacebookCredentials(userId);
    if (!page) throw new PublishError('Choose a Facebook Page before publishing', false);

    let id: string;
    if (media.length === 0) {
      const result = await this.publishRequest<{ id: string }>(`/${page.pageId}/feed`, page.accessToken, {
        message,
      });
      id = result.id;
    } else if (media.length === 1 && media[0].kind === 'video') {
      const result = await this.publishRequest<{ id: string }>(`/${page.pageId}/videos`, page.accessToken, {
        file_url: media[0].url,
        description: message,
      });
      id = result.id;
    } else if (media.length === 1) {
      const result = await this.publishRequest<{ id: string; post_id?: string }>(
        `/${page.pageId}/photos`,
        page.accessToken,
        { url: media[0].url, caption: message, published: 'true' },
      );
      id = result.post_id ?? result.id;
    } else {
      const uploaded: { media_fbid: string }[] = [];
      for (const item of media) {
        const photo = await this.publishRequest<{ id: string }>(
          `/${page.pageId}/photos`,
          page.accessToken,
          { url: item.url, published: 'false' },
        );
        uploaded.push({ media_fbid: photo.id });
      }
      const attachedMedia = Object.fromEntries(
        uploaded.map((photo, index) => [`attached_media[${index}]`, JSON.stringify(photo)]),
      );
      const result = await this.publishRequest<{ id: string }>(`/${page.pageId}/feed`, page.accessToken, {
        message,
        ...attachedMedia,
      });
      id = result.id;
    }

    const permalink = await this.permalink(id, page.accessToken);
    return { id, permalink };
  }
}
