import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { ConfigService } from '@/server/config';
import { getGridFsFile, gridFsEnabled, MIME_EXT, uploadDirOf } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPE_BY_EXT = Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]));

/**
 * Serves local-disk uploads in development/self-hosting and MongoDB GridFS uploads on Vercel.
 * Vercel Blob uploads use their public Blob URLs directly.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ filename: string }> }) {
  const filename = basename((await ctx.params).filename); // no path traversal
  const ext = filename.slice(filename.lastIndexOf('.'));
  const type = TYPE_BY_EXT[ext];
  if (!type) {
    return NextResponse.json({ statusCode: 404, message: 'Not Found', error: 'Not Found' }, { status: 404 });
  }

  if (gridFsEnabled()) {
    const stored = await getGridFsFile(filename);
    if (!stored) {
      return NextResponse.json({ statusCode: 404, message: 'Not Found', error: 'Not Found' }, { status: 404 });
    }
    return new Response(Readable.toWeb(stored.stream) as ReadableStream, {
      headers: {
        'content-type': stored.contentType || type,
        'content-length': String(stored.size),
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
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
