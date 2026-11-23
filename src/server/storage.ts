import { del, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { GridFSBucket } from 'mongodb';
import mongoose from 'mongoose';
import { join, resolve } from 'node:path';
import { appBaseUrl, ConfigService } from './config';
import { connectDb } from './db';

/**
 * Media storage. Local disk (UPLOAD_DIR) for development and self-hosting, Vercel Blob when
 * configured, or MongoDB GridFS on Vercel as a persistent fallback.
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
export const gridFsEnabled = () => !!process.env.VERCEL && !blobEnabled();

async function gridFsBucket() {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB is not connected');
  return new GridFSBucket(db, { bucketName: 'uploads' });
}

function gridFsPublicBase(config: ConfigService) {
  if (config.get<string>('APP_URL')) return appBaseUrl(config);
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return appBaseUrl(config);
}

function isGridFsRef(ref: StoredRef) {
  if (!ref.url) return false;
  try {
    const url = new URL(ref.url);
    const base = new URL(gridFsPublicBase(new ConfigService()));
    return url.origin === base.origin && url.pathname === `/uploads/${encodeURIComponent(ref.filename)}`;
  } catch {
    return false;
  }
}

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
    const bucket = await gridFsBucket();
    await new Promise<void>((resolveUpload, rejectUpload) => {
      const upload = bucket.openUploadStream(filename, {
        metadata: { contentType },
      });
      upload.once('error', rejectUpload);
      upload.once('finish', () => resolveUpload());
      upload.end(data);
    });
    const base = gridFsPublicBase(new ConfigService()).replace(/\/$/, '');
    return { filename, url: `${base}/uploads/${encodeURIComponent(filename)}` };
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), data);
  return { filename };
}

/** Best-effort delete of stored files (never throws). */
export async function removeFiles(dir: string, refs: StoredRef[]) {
  if (refs.length === 0) return;
  const gridfs = refs.filter((r) => gridFsEnabled() && isGridFsRef(r));
  const remote = refs.filter((r) => r.url && !gridfs.includes(r));
  const local = refs.filter((r) => !r.url);
  await Promise.all([
    remote.length ? del(remote.map((r) => r.url!)).catch(() => undefined) : undefined,
    gridfs.length
      ? (async () => {
          const bucket = await gridFsBucket();
          for (const ref of gridfs) {
            const files = await bucket.find({ filename: ref.filename }).toArray();
            await Promise.all(files.map((file) => bucket.delete(file._id)));
          }
        })().catch(() => undefined)
      : undefined,
    ...local.map((r) => unlink(join(dir, r.filename)).catch(() => undefined)),
  ]);
}

export async function getGridFsFile(filename: string) {
  const bucket = await gridFsBucket();
  const file = await bucket.find({ filename }).sort({ uploadDate: -1 }).limit(1).next();
  if (!file) return null;
  return {
    stream: bucket.openDownloadStream(file._id),
    size: file.length,
    contentType: String(file.metadata?.contentType ?? ''),
  };
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
