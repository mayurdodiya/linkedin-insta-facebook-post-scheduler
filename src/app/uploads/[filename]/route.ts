import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { ConfigService } from '@/server/config';
import { MIME_EXT, uploadDirOf } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPE_BY_EXT = Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]));

/**
 * Local-disk media (development / self-hosting): /uploads/<uuid>.<ext>. On Vercel the files live in
 * Vercel Blob and the UI/Instagram/Facebook use the blob URL directly, so this finds nothing there.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ filename: string }> }) {
  const filename = basename((await ctx.params).filename); // no path traversal
  const ext = filename.slice(filename.lastIndexOf('.'));
  const type = TYPE_BY_EXT[ext];
  const path = join(uploadDirOf(new ConfigService()), filename);
  try {
    const info = await stat(path);
    if (!type || !info.isFile()) throw new Error('not found');
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
