import { del, put } from '@vercel/blob';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { GridFSBucket } from 'mongodb';
import mongoose from 'mongoose';
import { join, resolve } from 'node:path';
import { appBaseUrl, ConfigService } from './config';
import { connectDb } from './db';
import { ServiceUnavailableException } from './http';

/**
 * Media storage. S3 takes precedence when configured, followed by Vercel Blob, MongoDB GridFS
 * on Vercel, and local disk for development and self-hosting.
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
const s3Configured = () =>
  !!(
    process.env.AWS_S3_BUCKET ||
    process.env.AWS_REGION ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_SECRET_ACCESS_KEY
  );

function s3Settings() {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  const region = process.env.AWS_REGION?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!s3Configured()) return null;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new ServiceUnavailableException(
      'S3 storage needs AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in the server environment.',
    );
  }
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
  };
}

export const s3Enabled = () => !!s3Settings();
export const gridFsEnabled = () => !!process.env.VERCEL && !blobEnabled() && !s3Configured();

let s3Client: S3Client | undefined;
let s3ClientKey = '';

function getS3Client(settings: NonNullable<ReturnType<typeof s3Settings>>) {
  const key = `${settings.region}:${settings.accessKeyId}:${settings.secretAccessKey}`;
  if (!s3Client || key !== s3ClientKey) {
    s3Client = new S3Client({
      region: settings.region,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
    s3ClientKey = key;
  }
  return s3Client;
}

function publicMediaBase(config: ConfigService) {
  if (config.get<string>('APP_URL')) return appBaseUrl(config);
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return appBaseUrl(config);
}

async function gridFsBucket() {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB is not connected');
  return new GridFSBucket(db, { bucketName: 'uploads' });
}

function gridFsPublicBase(config: ConfigService) {
  return publicMediaBase(config);
}

function isGridFsRef(ref: StoredRef) {
  if (!ref.url) return false;
  try {
    const url = new URL(ref.url);
    const base = new URL(gridFsPublicBase(new ConfigService()));
    return (
      url.origin === base.origin &&
      url.pathname === `/uploads/${encodeURIComponent(ref.filename)}` &&
      url.searchParams.get('storage') !== 's3'
    );
  } catch {
    return false;
  }
}

function isS3Ref(ref: StoredRef) {
  if (!ref.url) return false;
  try {
    const url = new URL(ref.url);
    const base = new URL(publicMediaBase(new ConfigService()));
    return (
      url.origin === base.origin &&
      url.pathname === `/uploads/${encodeURIComponent(ref.filename)}` &&
      url.searchParams.get('storage') === 's3'
    );
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
  const s3 = s3Settings();
  if (s3) {
    try {
      await getS3Client(s3).send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: `uploads/${filename}`,
          Body: data,
          ContentType: contentType,
        }),
      );
    } catch (e) {
      console.error('[MediaStorage] S3 upload failed', e);
      throw new ServiceUnavailableException(
        'S3 could not store the uploaded media. Check the bucket, region, and IAM permissions in Vercel settings.',
      );
    }
    const base = publicMediaBase(new ConfigService()).replace(/\/$/, '');
    return { filename, url: `${base}/uploads/${encodeURIComponent(filename)}?storage=s3` };
  }
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
    try {
      await new Promise<void>((resolveUpload, rejectUpload) => {
        const upload = bucket.openUploadStream(filename, {
          metadata: { contentType },
        });
        upload.once('error', rejectUpload);
        upload.once('finish', () => resolveUpload());
        upload.end(data);
      });
    } catch (e) {
      console.error('[MediaStorage] MongoDB GridFS upload failed', e);
      const message =
        e instanceof Error && /not authorized|unauthorized|permission/i.test(e.message)
          ? 'MongoDB cannot write media. Grant the database user readWrite access, then try again.'
          : 'MongoDB could not store the uploaded media. Check the Vercel function logs for the database error.';
      throw new ServiceUnavailableException(message);
    }
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
  let s3: ReturnType<typeof s3Settings> = null;
  try {
    s3 = s3Settings();
  } catch (e) {
    console.error('[MediaStorage] S3 is not configured for media deletion', e);
  }
  const s3Refs = refs.filter(isS3Ref);
  const gridfs = refs.filter((r) => process.env.VERCEL && !s3Refs.includes(r) && isGridFsRef(r));
  const remote = refs.filter((r) => r.url && !s3Refs.includes(r) && !gridfs.includes(r));
  const local = refs.filter((r) => !r.url);
  await Promise.all([
    remote.length ? del(remote.map((r) => r.url!)).catch(() => undefined) : undefined,
    s3Refs.length && s3
      ? Promise.all(
          s3Refs.map((ref) =>
            getS3Client(s3).send(
              new DeleteObjectCommand({ Bucket: s3.bucket, Key: `uploads/${ref.filename}` }),
            ),
          ),
        ).catch((e) => {
          console.error('[MediaStorage] Could not delete S3 media', e);
        })
      : undefined,
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

export async function getS3File(filename: string) {
  const s3 = s3Settings();
  if (!s3) return null;
  let result;
  try {
    result = await getS3Client(s3).send(
      new GetObjectCommand({ Bucket: s3.bucket, Key: `uploads/${filename}` }),
    );
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      ('name' in e && (e.name === 'NoSuchKey' || e.name === 'NotFound') ||
        '$metadata' in e &&
          typeof e.$metadata === 'object' &&
          e.$metadata !== null &&
          'httpStatusCode' in e.$metadata &&
          e.$metadata.httpStatusCode === 404)
    ) {
      return null;
    }
    throw e;
  }
  if (!result.Body) return null;
  return {
    body: result.Body.transformToWebStream(),
    size: result.ContentLength ?? 0,
    contentType: result.ContentType ?? '',
  };
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
