import { promises as fs } from 'node:fs';
import type { Layout, Tile, Page } from './layout.js';
import { validateLayout } from './layout.js';
import { imagePath, saveImage } from './images.js';

export type LayoutBundle = {
  version: 1;
  exportedAt: string;
  layout: Layout;
  /** Base64-encoded image bytes keyed by the filename referenced in the layout. */
  images: Record<string, string>;
};

/** Read the current layout + all referenced images and pack them into a portable bundle. */
export async function exportBundle(layout: Layout): Promise<LayoutBundle> {
  const filenames = collectImageFilenames(layout);
  const images: Record<string, string> = {};
  for (const filename of filenames) {
    const abs = imagePath(filename);
    if (!abs) continue;
    try {
      const buf = await fs.readFile(abs);
      images[filename] = buf.toString('base64');
    } catch {
      // Missing on disk — skip; the layout reference will become a broken link on import.
    }
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    layout,
    images,
  };
}

/**
 * Validate a bundle, write its images to disk (content-hashed filenames),
 * and return the resulting Layout with image references rewritten to match.
 */
export async function importBundle(input: unknown): Promise<Layout> {
  if (!input || typeof input !== 'object') throw new Error('bundle must be a JSON object');
  const obj = input as Record<string, unknown>;
  if (obj.version !== 1) throw new Error(`unsupported bundle version: ${JSON.stringify(obj.version)}`);
  if (!obj.layout || typeof obj.layout !== 'object') throw new Error('bundle.layout missing');
  const imagesIn = obj.images;
  if (imagesIn !== undefined && (typeof imagesIn !== 'object' || imagesIn === null)) {
    throw new Error('bundle.images must be an object');
  }

  // Save each image; build a rename map old → new (usually identical since both ends content-hash).
  const rename = new Map<string, string>();
  if (imagesIn) {
    for (const [oldName, b64] of Object.entries(imagesIn as Record<string, unknown>)) {
      if (typeof b64 !== 'string') throw new Error(`bundle.images["${oldName}"] must be base64 string`);
      let buf: Buffer;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        throw new Error(`bundle.images["${oldName}"] is not valid base64`);
      }
      const newName = await saveImage(buf);
      rename.set(oldName, newName);
    }
  }

  // Rewrite layout image references through the rename map.
  const rewritten = rewriteImageRefs(obj.layout, rename);
  return validateLayout(rewritten);
}

function collectImageFilenames(layout: Layout): Set<string> {
  const set = new Set<string>();
  for (const p of layout.pages) {
    if (p.image) set.add(p.image);
    if (p.backgroundImage) set.add(p.backgroundImage);
    for (const t of p.buttons) {
      if ((t as Tile).image) set.add((t as Tile).image!);
    }
  }
  return set;
}

function rewriteImageRefs(layout: unknown, rename: Map<string, string>): unknown {
  if (rename.size === 0) return layout;
  if (!layout || typeof layout !== 'object') return layout;
  const obj = layout as { pages?: unknown };
  if (!Array.isArray(obj.pages)) return layout;

  const remap = (name: unknown): string | undefined => {
    if (typeof name !== 'string') return undefined;
    return rename.get(name) ?? name;
  };

  for (const p of obj.pages as Page[]) {
    if (p.image) p.image = remap(p.image);
    if (p.backgroundImage) p.backgroundImage = remap(p.backgroundImage);
    if (Array.isArray(p.buttons)) {
      for (const t of p.buttons) {
        if ((t as Tile).image) (t as Tile).image = remap((t as Tile).image);
      }
    }
  }
  return layout;
}
