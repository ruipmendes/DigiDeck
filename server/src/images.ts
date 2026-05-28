import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const APP_DIR = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
  'digi-deck',
);
const IMAGE_DIR = join(APP_DIR, 'images');

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp';

const MIME_BY_EXT: Record<ImageExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function imageMime(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m?.[1];
  if (ext === 'png') return MIME_BY_EXT.png;
  if (ext === 'jpg' || ext === 'jpeg') return MIME_BY_EXT.jpg;
  if (ext === 'gif') return MIME_BY_EXT.gif;
  if (ext === 'webp') return MIME_BY_EXT.webp;
  return 'application/octet-stream';
}

/** Detect format from magic bytes. Returns the canonical extension, or null. */
export function sniffImageExt(buf: Buffer): ImageExt | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // GIF: 47 49 46 38 (37|39) 61
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
      && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) return 'gif';
  // WebP: RIFF .... WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  return null;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
}

/** Save bytes to disk; filename is `<sha256[:16]>.<ext>`. Returns the filename. */
export async function saveImage(buf: Buffer): Promise<string> {
  const ext = sniffImageExt(buf);
  if (!ext) throw new Error('unsupported image format (png, jpg, gif, webp)');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`image too large (max ${MAX_IMAGE_BYTES} bytes)`);
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const filename = `${hash}.${ext}`;
  await ensureDir();
  const dest = join(IMAGE_DIR, filename);
  // If a file with this content-hash already exists, reuse it (skip rewrite).
  try {
    await fs.access(dest);
  } catch {
    await fs.writeFile(dest, buf);
  }
  return filename;
}

/** Resolve a filename to its absolute path, refusing anything that escapes the image dir. */
export function imagePath(filename: string): string | null {
  // Reject anything with separators, traversal, or null bytes.
  if (!filename || filename.includes('\0') || /[\\/]/.test(filename) || filename.includes('..')) {
    return null;
  }
  const abs = resolve(IMAGE_DIR, filename);
  if (!abs.startsWith(resolve(IMAGE_DIR))) return null;
  return abs;
}

export async function imageExists(filename: string): Promise<boolean> {
  const p = imagePath(filename);
  if (!p) return false;
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function deleteImage(filename: string): Promise<boolean> {
  const p = imagePath(filename);
  if (!p) return false;
  try {
    await fs.unlink(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
