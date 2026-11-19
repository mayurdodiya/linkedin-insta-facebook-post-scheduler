import type { NextRequest } from 'next/server';
import { BadRequestException, PayloadTooLargeException } from './http';
import { services } from './container';
import type { UploadedFile } from './services/posts.service';
import { MIME_EXT, newFilename, putFile, removeFiles, uploadDirOf } from './storage';

export interface ParsedMultipart {
  body: Record<string, string | string[]>;
  files: UploadedFile[];
}

/**
 * multipart/form-data -> { body, files } like multer did: repeated fields become arrays, every
 * `media` file is type/size-checked and written to storage before the service sees it.
 */
export async function parseMultipart(req: NextRequest, maxFiles: number): Promise<ParsedMultipart> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new BadRequestException('Expected multipart/form-data');
  }
  const body: Record<string, string | string[]> = {};
  const uploads: File[] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') {
      if (key === 'media') uploads.push(value);
      else throw new BadRequestException(`Unexpected field ${key}`);
      continue;
    }
    const prev = body[key];
    body[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }

  if (uploads.length > maxFiles) throw new BadRequestException('Unexpected field');
  const maxBytes = Number(services.config.get('MAX_UPLOAD_MB') ?? 100) * 1024 * 1024;
  for (const f of uploads) {
    if (!MIME_EXT[f.type]) throw new BadRequestException('Only JPG, PNG, GIF images and MP4 video are allowed');
    if (f.size > maxBytes) throw new PayloadTooLargeException('File too large');
  }

  const dir = uploadDirOf(services.config);
  const files: UploadedFile[] = [];
  try {
    for (const f of uploads) {
      const ref = await putFile(dir, newFilename(f.type), Buffer.from(await f.arrayBuffer()), f.type);
      files.push({ ...ref, originalname: f.name, mimetype: f.type, size: f.size });
    }
  } catch (e) {
    await removeFiles(dir, files);
    throw e;
  }
  return { body, files };
}
