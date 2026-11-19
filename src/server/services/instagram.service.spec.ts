import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config';
import type { JwtService } from '../jwt';
import { InstagramService } from './instagram.service';
import type { UsersService } from './users.service';

describe('InstagramService publishing', () => {
  let directory: string;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function setup() {
    directory = await mkdtemp(join(tmpdir(), 'instagram-publish-'));
    const users = {
      getInstagramCredentials: vi.fn().mockResolvedValue({
        igUserId: '123456789',
        accessToken: 'test-token',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    };
    const config = {
      get: (key: string) =>
        key === 'PUBLIC_URL' ? 'https://media.example.test' : key === 'UPLOAD_DIR' ? directory : undefined,
      getOrThrow: (key: string) => {
        if (key === 'BACKEND_URL') return 'https://media.example.test';
        throw new Error(`Unexpected config key: ${key}`);
      },
    };
    const service = new InstagramService(
      users as unknown as UsersService,
      config as ConfigService,
      {} as JwtService,
    );
    return { service, users };
  }

  function mockInstagramApi(mediaUnavailable = false) {
    const calls: {
      url: URL;
      init?: RequestInit;
      body?: URLSearchParams;
      dimensions?: { width?: number; height?: number };
    }[] = [];
    let container = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const body = init?.body instanceof URLSearchParams ? init.body : undefined;
        const call = { url, init, body } as (typeof calls)[number];
        if (url.hostname === 'media.example.test' && url.pathname.startsWith('/uploads/')) {
          if (mediaUnavailable) {
            return new Response('<html>Sign in to access this tunnel</html>', {
              headers: { 'content-type': 'text/html' },
            });
          }
          const bytes = await readFile(join(directory, url.pathname.split('/').at(-1)!));
          return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
        }
        if (body?.has('image_url')) {
          const filename = new URL(body.get('image_url')!).pathname.split('/').at(-1)!;
          call.dimensions = await sharp(join(directory, filename)).metadata();
        }
        calls.push(call);

        if (url.pathname.endsWith('/media_publish')) return Response.json({ id: 'published-id' });
        if (url.pathname.endsWith('/media') && init?.method === 'POST') {
          container++;
          return Response.json({ id: `container-${container}` });
        }
        if (url.pathname.endsWith('/published-id')) return Response.json({ permalink: 'https://instagram.test/post' });
        if (init?.method !== 'POST') return Response.json({ status_code: 'FINISHED' });
        throw new Error(`Unexpected Instagram API request: ${init?.method} ${url.pathname}`);
      }),
    );
    return calls;
  }

  it('splits an overly tall JPEG into supported carousel panels before calling Instagram', async () => {
    const { service } = await setup();
    const calls = mockInstagramApi();
    const imagePath = join(directory, 'tall.jpg');
    await sharp({
      create: {
        width: 920,
        height: 4360,
        channels: 3,
        background: { r: 10, g: 120, b: 200 },
      },
    })
      .jpeg()
      .toFile(imagePath);

    await expect(service.publish('user-id', 'Tall image', [{ path: imagePath, kind: 'image' }])).resolves.toEqual({
      id: 'published-id',
      permalink: 'https://instagram.test/post',
    });

    const childCalls = calls.filter((call) => call.body?.get('is_carousel_item') === 'true');
    expect(childCalls).toHaveLength(4);
    for (const call of childCalls) {
      const url = new URL(call.body!.get('image_url')!);
      expect(url.pathname).toMatch(/\/uploads\/instagram-.+\.jpg$/);
      expect(call.dimensions).toBeDefined();
      const { width, height } = call.dimensions!;
      expect(width! / height!).toBeGreaterThanOrEqual(0.8);
      expect(width! / height!).toBeLessThanOrEqual(1.91);
    }

    const carousel = calls.find((call) => call.body?.get('media_type') === 'CAROUSEL');
    expect(carousel?.url.pathname).toBe('/v23.0/123456789/media');
    expect(carousel?.body?.get('children')?.split(',')).toHaveLength(4);
    expect(calls.some((call) => call.url.pathname === '/v23.0/123456789/media_publish')).toBe(true);
    expect(await readdir(directory)).toEqual(['tall.jpg']);
  });

  it('normalizes an in-range JPEG to a temporary photo container', async () => {
    const { service } = await setup();
    const calls = mockInstagramApi();
    const imagePath = join(directory, 'photo.jpg');
    await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: { r: 10, g: 120, b: 200 },
      },
    })
      .jpeg()
      .toFile(imagePath);

    await service.publish('user-id', 'A photo', [{ path: imagePath, kind: 'image' }]);

    const container = calls.find(
      (call) => call.url.pathname === '/v23.0/123456789/media' && call.init?.method === 'POST',
    );
    const imageUrl = new URL(container?.body?.get('image_url') ?? '');
    expect(imageUrl.pathname).toMatch(/\/uploads\/instagram-.+\.jpg$/);
    expect(container?.dimensions).toMatchObject({ format: 'jpeg', width: 1200, height: 900 });
    expect(container?.body?.has('media_type')).toBe(false);
    expect(await readdir(directory)).toEqual(['photo.jpg']);
  });

  it('reports an inaccessible public media URL before calling Instagram', async () => {
    const { service } = await setup();
    const calls = mockInstagramApi(true);
    const imagePath = join(directory, 'photo.jpg');
    await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: { r: 10, g: 120, b: 200 },
      },
    })
      .jpeg()
      .toFile(imagePath);

    await expect(
      service.publish('user-id', 'A photo', [{ path: imagePath, kind: 'image' }]),
    ).rejects.toThrow(/did not return image\/jpeg.*received text\/html/);
    expect(calls.some((call) => call.url.hostname === 'graph.instagram.com')).toBe(false);
    expect(await readdir(directory)).toEqual(['photo.jpg']);
  });
});
