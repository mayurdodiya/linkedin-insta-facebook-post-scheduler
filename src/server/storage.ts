import { del, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigService } from './config';
import { ServiceUnavailableException } from './http';

/**
 * Media storage. Local disk (UPLOAD_DIR, served from /uploads/<file>) for development and
 * self-hosting; Vercel Blob when BLOB_READ_WRITE_TOKEN is set - serverless functions have no
 * persistent disk, and Blob URLs are public so Instagram / Facebook can download them directly.
 */
export interface StoredRef {
  filename: string;
  /** set for object storage; local-disk files are addressed by filename only */
  url?: string;
}

export const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
};

export const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export function uploadDirOf(config: ConfigService) {
  // local-disk mode only; the hint stops the bundler tracing the whole project for this dynamic path
  return resolve(/* turbopackIgnore: true */ config.get<string>('UPLOAD_DIR') ?? 'uploads');
}

export const newFilename = (mimetype: string) => randomUUID() + MIME_EXT[mimetype];

export async function putFile(dir: string, filename: string, data: Buffer, contentType: string): Promise<StoredRef> {
  if (blobEnabled()) {
    const blob = await put(`uploads/${filename}`, data, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { filename, url: blob.url };
  }
  if (process.env.VERCEL) {
    throw new ServiceUnavailableException(
      'Media storage is not configured: add a Vercel Blob store (BLOB_READ_WRITE_TOKEN) to this project',
    );
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), data);
  return { filename };
}

/** Best-effort delete of stored files (never throws). */
export async function removeFiles(dir: string, refs: StoredRef[]) {
  if (refs.length === 0) return;
  const remote = refs.filter((r) => r.url);
  const local = refs.filter((r) => !r.url);
  await Promise.all([
    remote.length ? del(remote.map((r) => r.url!)).catch(() => undefined) : undefined,
    ...local.map((r) => unlink(join(dir, r.filename)).catch(() => undefined)),
  ]);
}

/** Bytes of a stored file: fetched from its public URL (object storage) or read from local disk. */
export async function readStored(m: { path: string; url?: string }): Promise<Buffer> {
  if (m.url) {
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(m.path);
}
