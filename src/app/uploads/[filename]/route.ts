import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { ConfigService } from '@/server/config';
import { getGridFsFile, getS3File, MIME_EXT, uploadDirOf } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPE_BY_EXT = Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]));

/**
 * Serves S3 uploads through a public app URL, plus legacy GridFS and local-disk uploads.
 * Vercel Blob uploads use their public Blob URLs directly.
 */
export async function GET(req: Request, ctx: { params: Promise<{ filename: string }> }) {
  const filename = basename((await ctx.params).filename); // no path traversal
  const ext = filename.slice(filename.lastIndexOf('.'));
  const type = TYPE_BY_EXT[ext];
  if (!type) {
    return NextResponse.json({ statusCode: 404, message: 'Not Found', error: 'Not Found' }, { status: 404 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get('storage') === 's3') {
    try {
      const stored = await getS3File(filename);
      if (!stored) {
        return NextResponse.json({ statusCode: 404, message: 'Not Found', error: 'Not Found' }, { status: 404 });
      }
      return new Response(stored.body, {
        headers: {
          'content-type': stored.contentType || type,
          'content-length': String(stored.size),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (e) {
      console.error('[MediaRoute] S3 media download failed', e);
      return NextResponse.json(
        { statusCode: 503, message: 'Media storage is temporarily unavailable', error: 'Service Unavailable' },
        { status: 503 },
      );
    }
  }

  if (process.env.VERCEL) {
    const stored = await getGridFsFile(filename);
    if (stored) {
      return new Response(Readable.toWeb(stored.stream) as ReadableStream, {
        headers: {
          'content-type': stored.contentType || type,
          'content-length': String(stored.size),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }
  }

  const path = join(uploadDirOf(new ConfigService()), filename);
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not found');
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        'content-type': type,
        'content-length': String(info.size),
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ statusCode: 404, message: 'Not Found', error: 'Not Found' }, { status: 404 });
  }
}
